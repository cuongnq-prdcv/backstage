import * as fs from 'fs';
import * as path from 'path';
import git, { type AuthCallback, type GitAuth } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { Octokit } from '@octokit/rest';
import {
  DefaultGithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import type { RootConfigService } from '@backstage/backend-plugin-api';

import { redact } from './redact';

/** Clone timeout mandated by Requirement 2.6. */
export const CLONE_TIMEOUT_MS = 120_000;
/** Push timeout mandated by Requirement 5.7. */
export const PUSH_TIMEOUT_MS = 60_000;
/** Pull-request timeout mandated by Requirements 5.6/5.8. */
export const PULL_REQUEST_TIMEOUT_MS = 60_000;

/** Author/committer identity written on the provisioning commit. */
const COMMIT_IDENTITY = {
  name: 'Backstage Tenant Provisioning',
  email: 'noreply@backstage.local',
};

/**
 * Wraps local git (isomorphic-git) and GitHub PR (Octokit) operations. The only
 * collaborator that touches the network.
 */
export interface GitHelper {
  clone(opts: {
    url: string;
    ref: string;
    dir: string;
    timeoutMs: number;
  }): Promise<void>;
  localBranchOrRemoteExists(branch: string): Promise<boolean>;
  createBranchCommitPush(opts: {
    branch: string;
    baseBranch: string;
    filePath: string;
    message: string;
    timeoutMs: number;
  }): Promise<void>;
  findOpenPullRequest(opts: {
    head: string;
    base: string;
  }): Promise<{ url: string } | undefined>;
  createPullRequest(opts: {
    head: string;
    base: string;
    title: string;
    timeoutMs: number;
  }): Promise<{ url: string }>;
}

/** Categories the clone/push error mapping distinguishes. */
export type GitErrorKind =
  | 'network-unreachable'
  | 'missing-ref'
  | 'auth-rejected'
  | 'timeout'
  | 'push-rejected'
  | 'unknown';

/**
 * Error raised by the {@link GitHelper} once an underlying git failure has been
 * classified and its message routed through {@link redact}.
 */
export class GitOperationError extends Error {
  readonly kind: GitErrorKind;

  constructor(kind: GitErrorKind, message: string) {
    super(message);
    this.name = 'GitOperationError';
    this.kind = kind;
  }
}

/** Sentinel thrown internally when a timeout wins the {@link Promise.race}. */
class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Runs `work` but rejects with a {@link TimeoutError} if it has not settled
 * within `timeoutMs`. The {@link AbortController} is signalled on timeout so the
 * underlying I/O can stop (Req 2.6, 5.7).
 */
async function withTimeout<T>(
  timeoutMs: number,
  label: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });

  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Best-effort classification of an underlying git error into a clone category. */
function classifyCloneError(error: unknown): GitErrorKind {
  if (error instanceof TimeoutError) {
    return 'timeout';
  }

  const code = (error as { code?: string } | undefined)?.code;
  const status =
    (error as { data?: { statusCode?: number } } | undefined)?.data
      ?.statusCode ??
    (error as { statusCode?: number } | undefined)?.statusCode;
  const raw =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  const lower = raw.toLowerCase();

  if (
    code === 'NotFoundError' ||
    /could not find ref|ref .* not found|unknown ref|remote does not have|couldn't find remote ref/.test(
      lower,
    )
  ) {
    return 'missing-ref';
  }

  if (code === 'HttpError' && (status === 401 || status === 403)) {
    return 'auth-rejected';
  }
  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|authentication|forbidden|bad credentials|permission/.test(
      lower,
    )
  ) {
    return 'auth-rejected';
  }

  if (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    /enotfound|econnrefused|econnreset|etimedout|getaddrinfo|network|could not resolve|failed to fetch|socket hang up/.test(
      lower,
    )
  ) {
    return 'network-unreachable';
  }

  return 'unknown';
}

/** Human-readable message for a classified clone failure. */
function cloneErrorMessage(kind: GitErrorKind, url: string): string {
  switch (kind) {
    case 'network-unreachable':
      return `Could not reach the Crossplane live repository at ${url}`;
    case 'missing-ref':
      return `The requested ref does not exist in the Crossplane live repository at ${url}`;
    case 'auth-rejected':
      return `Authentication was rejected while accessing the Crossplane live repository at ${url}`;
    case 'timeout':
      return `Cloning the Crossplane live repository at ${url} timed out`;
    default:
      return `Failed to clone the Crossplane live repository at ${url}`;
  }
}

/**
 * Resolves the GitHub token for `url` through the same integration configuration
 * the rest of the app uses (`ScmIntegrations.fromConfig` +
 * `DefaultGithubCredentialsProvider`), keyed by the live repo host. The token
 * is returned to the caller only; it is never logged nor persisted here.
 */
export async function resolveLiveRepoToken(
  config: RootConfigService,
  url: string,
): Promise<string> {
  const integrations = ScmIntegrations.fromConfig(config);
  const credentialsProvider =
    DefaultGithubCredentialsProvider.fromIntegrations(integrations);
  const { token } = await credentialsProvider.getCredentials({ url });
  if (!token) {
    throw new Error(
      `No GitHub credentials configured for the Crossplane live repository host of ${url}`,
    );
  }
  return token;
}

/** Parses the `owner`/`repo` slug pair out of a GitHub repository URL. */
export function parseGithubOwnerRepo(url: string): {
  owner: string;
  repo: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(
      `Could not parse owner/repo from the Crossplane live repository URL '${url}'`,
    );
  }

  const segments = parsed.pathname
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  if (segments.length < 2) {
    throw new Error(
      `Could not parse owner/repo from the Crossplane live repository URL '${url}'`,
    );
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!owner || !repo) {
    throw new Error(
      `Could not parse owner/repo from the Crossplane live repository URL '${url}'`,
    );
  }

  return { owner, repo };
}

/**
 * isomorphic-git implementation of the local git portion of {@link GitHelper}
 * (clone/branch/commit/push) plus Octokit-backed PR lookup/creation.
 */
class IsomorphicGitHelper implements GitHelper {
  private readonly url: string;
  private readonly token: string;
  private dir?: string;
  private octokitClient?: Octokit;

  constructor(opts: { url: string; token: string }) {
    this.url = opts.url;
    this.token = opts.token;
  }

  private get octokit(): Octokit {
    if (!this.octokitClient) {
      this.octokitClient = new Octokit({ auth: this.token });
    }
    return this.octokitClient;
  }

  private get secrets(): string[] {
    return [this.token];
  }

  private authCallback(): AuthCallback {
    return (): GitAuth => ({
      username: this.token,
      password: 'x-oauth-basic',
    });
  }

  private requireDir(): string {
    if (!this.dir) {
      throw new GitOperationError(
        'unknown',
        'Git operation attempted before the repository was cloned',
      );
    }
    return this.dir;
  }

  async clone(opts: {
    url: string;
    ref: string;
    dir: string;
    timeoutMs: number;
  }): Promise<void> {
    this.dir = opts.dir;
    try {
      await withTimeout(opts.timeoutMs, 'clone', () =>
        git.clone({
          fs,
          http,
          dir: opts.dir,
          url: opts.url,
          ref: opts.ref,
          singleBranch: true,
          depth: 1,
          onAuth: this.authCallback(),
        }),
      );
    } catch (error) {
      const kind = classifyCloneError(error);
      throw new GitOperationError(
        kind,
        redact(cloneErrorMessage(kind, opts.url), this.secrets),
      );
    }
  }

  async localBranchOrRemoteExists(branch: string): Promise<boolean> {
    const dir = this.requireDir();
    try {
      const localBranches = await git.listBranches({ fs, dir });
      if (localBranches.includes(branch)) {
        return true;
      }

      const remoteInfo = await withTimeout(
        PUSH_TIMEOUT_MS,
        'branch lookup',
        () =>
          git.getRemoteInfo({
            http,
            url: this.url,
            onAuth: this.authCallback(),
            forPush: true,
          }),
      );
      const heads = remoteInfo.heads ?? {};
      const fullRef = `refs/heads/${branch}`;
      return (
        Object.prototype.hasOwnProperty.call(heads, branch) ||
        Object.prototype.hasOwnProperty.call(heads, fullRef)
      );
    } catch (error) {
      const kind = classifyCloneError(error);
      throw new GitOperationError(
        kind,
        redact(
          `Failed to check whether branch '${branch}' already exists in the Crossplane live repository at ${this.url}`,
          this.secrets,
        ),
      );
    }
  }

  async createBranchCommitPush(opts: {
    branch: string;
    baseBranch: string;
    filePath: string;
    message: string;
    timeoutMs: number;
  }): Promise<void> {
    const dir = this.requireDir();

    try {
      await git.branch({ fs, dir, ref: opts.branch, checkout: true });
    } catch {
      throw new GitOperationError(
        'unknown',
        redact(`Failed to create feature branch '${opts.branch}'`, this.secrets),
      );
    }

    const relFilePath = path
      .relative(dir, path.resolve(dir, opts.filePath))
      .split(path.sep)
      .join('/');
    try {
      await git.add({ fs, dir, filepath: relFilePath });
      await git.commit({
        fs,
        dir,
        message: opts.message,
        author: COMMIT_IDENTITY,
        committer: COMMIT_IDENTITY,
      });
    } catch {
      throw new GitOperationError(
        'unknown',
        redact(
          `Failed to commit '${relFilePath}' onto branch '${opts.branch}'`,
          this.secrets,
        ),
      );
    }

    try {
      const result = await withTimeout(opts.timeoutMs, 'push', () =>
        git.push({
          fs,
          http,
          dir,
          url: this.url,
          ref: opts.branch,
          remoteRef: opts.branch,
          onAuth: this.authCallback(),
        }),
      );
      if (result.error) {
        throw new Error(result.error);
      }
    } catch (error) {
      const kind = error instanceof TimeoutError ? 'timeout' : 'push-rejected';
      const detail =
        error instanceof Error ? error.message : String(error ?? '');
      throw new GitOperationError(
        kind,
        redact(
          kind === 'timeout'
            ? `Pushing branch '${opts.branch}' to the Crossplane live repository timed out`
            : `Pushing branch '${opts.branch}' to the Crossplane live repository was rejected: ${detail}`,
          this.secrets,
        ),
      );
    }
  }

  async findOpenPullRequest(opts: {
    head: string;
    base: string;
  }): Promise<{ url: string } | undefined> {
    const { owner, repo } = parseGithubOwnerRepo(this.url);
    try {
      const response = await this.octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        base: opts.base,
        head: `${owner}:${opts.head}`,
        per_page: 1,
      });
      const existing = response.data[0];
      return existing ? { url: existing.html_url } : undefined;
    } catch {
      throw new GitOperationError(
        'unknown',
        redact(
          `Failed to look up an existing pull request for branch '${opts.head}' in the Crossplane live repository at ${this.url}`,
          this.secrets,
        ),
      );
    }
  }

  async createPullRequest(opts: {
    head: string;
    base: string;
    title: string;
    timeoutMs: number;
  }): Promise<{ url: string }> {
    const existing = await this.findOpenPullRequest({
      head: opts.head,
      base: opts.base,
    });
    if (existing) {
      return existing;
    }

    const { owner, repo } = parseGithubOwnerRepo(this.url);
    try {
      const response = await withTimeout(
        opts.timeoutMs,
        'pull request creation',
        signal =>
          this.octokit.pulls.create({
            owner,
            repo,
            title: opts.title,
            head: opts.head,
            base: opts.base,
            request: { signal },
          }),
      );
      return { url: response.data.html_url };
    } catch (error) {
      const kind: GitErrorKind =
        error instanceof TimeoutError ? 'timeout' : 'unknown';
      throw new GitOperationError(
        kind,
        redact(
          kind === 'timeout'
            ? `Creating a pull request for the pushed branch '${opts.head}' in the Crossplane live repository timed out`
            : `Failed to create a pull request for the pushed branch '${opts.head}' in the Crossplane live repository at ${this.url}`,
          this.secrets,
        ),
      );
    }
  }
}

/**
 * Creates a {@link GitHelper} bound to the given live repository URL and a
 * pre-resolved token. Callers resolve the token via {@link resolveLiveRepoToken}.
 */
export function createGitHelper(opts: { url: string; token: string }): GitHelper {
  return new IsomorphicGitHelper(opts);
}
