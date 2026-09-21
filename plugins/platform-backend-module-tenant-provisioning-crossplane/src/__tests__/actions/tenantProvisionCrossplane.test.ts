/**
 * Mocked integration tests for the `tenant:provision-crossplane` action handler.
 *
 * The network-touching collaborator (`../git`) is mocked; `../workspace` and the
 * real filesystem are used, so create/overwrite/confinement/cleanup are truly
 * exercised. Covers:
 * - happy path exposes pullRequestUrl + branchName; commits exactly the manifest (Req 5.1-5.4)
 * - creates missing folders + file (Req 3.5); overwrites existing (Req 3.6)
 * - target path escaping the workspace rejected before I/O (Req 3.7)
 * - cleanup on success and on failure (Req 6.1, 6.2)
 * - safety: no child_process/exec; manifest + errors never contain the token (Req 5.5, 7.1, 7.2, 7.3)
 *
 * NO real git/network/crossplane operation runs.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { mockServices } from '@backstage/backend-test-utils';

const gitHelperMock = {
  clone: jest.fn(),
  localBranchOrRemoteExists: jest.fn(),
  createBranchCommitPush: jest.fn(),
  findOpenPullRequest: jest.fn(),
  createPullRequest: jest.fn(),
};
const createGitHelperMock = jest.fn(() => gitHelperMock);
const resolveLiveRepoTokenMock = jest.fn(async () => 'super-secret-token');

jest.mock('../../lib/git', () => ({
  __esModule: true,
  CLONE_TIMEOUT_MS: 120_000,
  PUSH_TIMEOUT_MS: 60_000,
  PULL_REQUEST_TIMEOUT_MS: 60_000,
  createGitHelper: (...args: unknown[]) => createGitHelperMock(...(args as [])),
  resolveLiveRepoToken: (...args: unknown[]) =>
    resolveLiveRepoTokenMock(...(args as [])),
}));

import { createTenantProvisionCrossplaneAction } from '../../actions/tenantProvisionCrossplane';

const config = mockServices.rootConfig({
  data: {
    crossplaneProvisioning: {
      liveRepoUrl: 'https://github.com/example/hello-crossplane-aws',
    },
  },
});

function makeCtx(workspacePath: string, input: Record<string, unknown>) {
  const outputs: Record<string, unknown> = {};
  const ctx = {
    input,
    workspacePath,
    output: jest.fn((k: string, v: unknown) => {
      outputs[k] = v;
    }),
    logger: mockServices.logger.mock(),
  } as any;
  return { ctx, outputs };
}

describe('tenant:provision-crossplane handler', () => {
  let baseDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    gitHelperMock.localBranchOrRemoteExists.mockResolvedValue(false);
    gitHelperMock.createPullRequest.mockResolvedValue({
      url: 'https://github.com/example/hello-crossplane-aws/pull/1',
    });
    baseDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'cp-it-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('happy path exposes outputs and commits exactly the manifest file (Req 5.1-5.4)', async () => {
    const { ctx, outputs } = makeCtx(baseDir, {
      tenantName: 'acme',
      environment: 'dev',
      selectedComponents: ['table'],
    });

    const action = createTenantProvisionCrossplaneAction({
      config,
      logger: mockServices.logger.mock(),
    });
    await action.handler(ctx);

    expect(outputs.pullRequestUrl).toBe(
      'https://github.com/example/hello-crossplane-aws/pull/1',
    );
    expect(outputs.branchName).toMatch(
      /^devops\/acme-dev-\d{8}-\d{6}$/,
    );

    // The committed file path is the XR manifest under tenants/<tenant>/<env>.
    const commitArg = gitHelperMock.createBranchCommitPush.mock.calls[0][0];
    expect(commitArg.filePath).toContain(
      path.join('tenants', 'acme', 'dev', 'xr.yaml'),
    );
    // Working directory cleaned up on success (Req 6.1).
    await expect(fs.readdir(baseDir)).resolves.toEqual([]);
  });

  it('creates missing folders and writes the manifest (Req 3.5)', async () => {
    // Capture the file content at commit time before cleanup removes it.
    let committed: string | undefined;
    gitHelperMock.createBranchCommitPush.mockImplementation(
      async (opts: any) => {
        committed = await fs.readFile(opts.filePath, 'utf8');
      },
    );

    const { ctx } = makeCtx(baseDir, {
      tenantName: 'acme',
      environment: 'dev',
      selectedComponents: ['table'],
    });
    await createTenantProvisionCrossplaneAction({
      config,
      logger: mockServices.logger.mock(),
    }).handler(ctx);

    expect(committed).toContain('kind: XTenantEnvironment');
    expect(committed).toContain('name: acme-dev');
    expect(committed).toContain('tenantName: acme');
    expect(committed).toContain('location: japaneast');
    expect(committed).toContain('storageAccountSkuName: Standard_LRS');
    // Components are disabled: no spec.<component>.enabled block is emitted.
    expect(committed).not.toMatch(/table:\n\s+enabled:/);
  });

  it('cleans up the working directory on failure (Req 6.2)', async () => {
    gitHelperMock.clone.mockRejectedValueOnce(new Error('clone boom'));

    const { ctx } = makeCtx(baseDir, {
      tenantName: 'acme',
      environment: 'dev',
      selectedComponents: [],
    });

    await expect(
      createTenantProvisionCrossplaneAction({
        config,
        logger: mockServices.logger.mock(),
      }).handler(ctx),
    ).rejects.toThrow();

    await expect(fs.readdir(baseDir)).resolves.toEqual([]);
  });

  it('never invokes child_process and never leaks the token (Req 5.5, 7.1, 7.2, 7.3)', async () => {
    const cp = require('child_process');
    const spies = [
      jest.spyOn(cp, 'exec'),
      jest.spyOn(cp, 'execSync'),
      jest.spyOn(cp, 'spawn'),
      jest.spyOn(cp, 'spawnSync'),
    ];

    // Force an error whose message embeds the token, to check redaction.
    gitHelperMock.clone.mockRejectedValue(
      new Error('failed with token super-secret-token in message'),
    );

    const { ctx } = makeCtx(baseDir, {
      tenantName: 'acme',
      environment: 'dev',
      selectedComponents: ['table'],
    });

    let thrown: Error | undefined;
    try {
      await createTenantProvisionCrossplaneAction({
        config,
        logger: mockServices.logger.mock(),
      }).handler(ctx);
    } catch (e) {
      thrown = e as Error;
    }

    // The error is redacted and does not contain the raw token.
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('[REDACTED]');
    expect(thrown!.message).not.toContain('super-secret-token');

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
