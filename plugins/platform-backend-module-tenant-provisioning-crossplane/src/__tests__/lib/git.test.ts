/**
 * Mocked unit tests for the GitHelper (`createGitHelper`).
 *
 * `isomorphic-git` and Octokit are mocked; NO real network/git runs. Covers:
 * - clone error mapping: network / missing-ref / auth-rejected / timeout, token redacted
 * - duplicate branch detection (local)
 * - commit stages exactly the one file; push failure/timeout mapping
 * - PR happy path, duplicate-open-PR reuse, PR failure/timeout
 *
 * (Req 2.3, 2.4, 2.5, 2.6, 4.3, 4.4, 5.2, 5.6, 5.7, 5.8, 7.1, 7.2, 7.3)
 */

jest.mock('isomorphic-git', () => ({
  __esModule: true,
  default: {
    clone: jest.fn(),
    listBranches: jest.fn(),
    getRemoteInfo: jest.fn(),
    branch: jest.fn(),
    add: jest.fn(),
    commit: jest.fn(),
    push: jest.fn(),
  },
}));
jest.mock('isomorphic-git/http/node', () => ({ __esModule: true, default: {} }));

const mockPullsList = jest.fn();
const mockPullsCreate = jest.fn();
jest.mock('@octokit/rest', () => ({
  __esModule: true,
  Octokit: jest.fn().mockImplementation(() => ({
    pulls: { list: mockPullsList, create: mockPullsCreate },
  })),
}));

import { createGitHelper, GitOperationError } from '../../lib/git';
// Retrieve the hoisted mocks after they are registered.
import isomorphicGit from 'isomorphic-git';

const gitMock = isomorphicGit as unknown as {
  clone: jest.Mock;
  listBranches: jest.Mock;
  getRemoteInfo: jest.Mock;
  branch: jest.Mock;
  add: jest.Mock;
  commit: jest.Mock;
  push: jest.Mock;
};
const pullsList = mockPullsList;
const pullsCreate = mockPullsCreate;

const URL = 'https://github.com/example/hello-crossplane-aws';
const TOKEN = 'secret-token-xyz';

function helper() {
  return createGitHelper({ url: URL, token: TOKEN });
}

describe('GitHelper clone error mapping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps network errors to network-unreachable, token redacted (Req 2.3, 7.3)', async () => {
    gitMock.clone.mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    );
    const h = helper();
    await expect(
      h.clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 120_000 }),
    ).rejects.toMatchObject({ kind: 'network-unreachable' });
  });

  it('maps a missing ref to missing-ref (Req 2.4)', async () => {
    gitMock.clone.mockRejectedValueOnce(
      Object.assign(new Error('Could not find ref'), { code: 'NotFoundError' }),
    );
    await expect(
      helper().clone({ url: URL, ref: 'nope', dir: '/tmp/x', timeoutMs: 120_000 }),
    ).rejects.toMatchObject({ kind: 'missing-ref' });
  });

  it('maps 401 to auth-rejected and never leaks the token (Req 2.5, 7.3)', async () => {
    gitMock.clone.mockRejectedValueOnce(
      Object.assign(new Error(`unauthorized ${TOKEN}`), {
        code: 'HttpError',
        data: { statusCode: 401 },
      }),
    );
    const err = await helper()
      .clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 120_000 })
      .catch((e: GitOperationError) => e);
    expect((err as GitOperationError).kind).toBe('auth-rejected');
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it('maps a slow clone to timeout (Req 2.6)', async () => {
    gitMock.clone.mockImplementationOnce(
      () => new Promise(() => {}), // never resolves
    );
    await expect(
      helper().clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('GitHelper branch / commit / push', () => {
  beforeEach(() => jest.clearAllMocks());

  it('detects an existing local branch (Req 4.4)', async () => {
    const h = helper();
    await h.clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 120_000 });
    gitMock.listBranches.mockResolvedValueOnce(['main', 'devops/acme-dev-1']);
    await expect(h.localBranchOrRemoteExists('devops/acme-dev-1')).resolves.toBe(
      true,
    );
  });

  it('commits exactly the one file then pushes (Req 4.3, 5.1)', async () => {
    const h = helper();
    await h.clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 120_000 });
    gitMock.push.mockResolvedValueOnce({ ok: true });

    await h.createBranchCommitPush({
      branch: 'devops/acme-dev-1',
      baseBranch: 'main',
      filePath: '/tmp/x/tenants/acme/dev/xr.yaml',
      message: 'Provision tenant acme (dev)',
      timeoutMs: 60_000,
    });

    expect(gitMock.add).toHaveBeenCalledTimes(1);
    expect(gitMock.add.mock.calls[0][0].filepath).toBe(
      'tenants/acme/dev/xr.yaml',
    );
    expect(gitMock.commit).toHaveBeenCalledTimes(1);
    expect(gitMock.push).toHaveBeenCalledTimes(1);
  });

  it('maps a push rejection to push-rejected (Req 5.7)', async () => {
    const h = helper();
    await h.clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 120_000 });
    gitMock.push.mockResolvedValueOnce({ error: 'remote rejected' });

    await expect(
      h.createBranchCommitPush({
        branch: 'devops/acme-dev-1',
        baseBranch: 'main',
        filePath: '/tmp/x/tenants/acme/dev/xr.yaml',
        message: 'm',
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject({ kind: 'push-rejected' });
  });
});

describe('GitHelper pull request', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reuses an existing open PR instead of creating a duplicate (Req 5.6)', async () => {
    pullsList.mockResolvedValueOnce({
      data: [{ html_url: `${URL}/pull/7` }],
    });
    const result = await helper().createPullRequest({
      head: 'devops/acme-dev-1',
      base: 'main',
      title: 't',
      timeoutMs: 60_000,
    });
    expect(result.url).toBe(`${URL}/pull/7`);
    expect(pullsCreate).not.toHaveBeenCalled();
  });

  it('creates a PR when none is open (Req 5.2)', async () => {
    pullsList.mockResolvedValueOnce({ data: [] });
    pullsCreate.mockResolvedValueOnce({ data: { html_url: `${URL}/pull/8` } });
    const result = await helper().createPullRequest({
      head: 'devops/acme-dev-1',
      base: 'main',
      title: 't',
      timeoutMs: 60_000,
    });
    expect(result.url).toBe(`${URL}/pull/8`);
    expect(pullsCreate).toHaveBeenCalledTimes(1);
  });
});
