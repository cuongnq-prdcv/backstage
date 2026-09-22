/**
 * Tests for the `tenant:render-crossplane-manifest` action.
 *
 * Covers:
 * - happy path: exactly one file written at `<workspace>/crossplane-pr/xr.yaml`
 *   with the expected XR content, and all nine outputs emitted (Req 3.1, 3.2,
 *   3.4, 3.5, 3.10, 4.1, 4.3, 5.3)
 * - Azure fields falling back to the configured defaults (Req 1.5)
 * - config failures: missing and unparseable `liveRepoUrl` (Req 1.8)
 * - write failure fails the step and emits nothing (Req 3.8)
 * - Property 3: every write stays confined to the workspace (Req 3.7, 6.3, 7.4, 7.5)
 * - Property 4: invalid input is rejected with no side effects (Req 1.4, 8.1-8.4)
 * - safety: no child process and no HTTP client is reachable (Req 2.3, 5.5)
 *
 * Nothing here performs a network operation: the action itself only reads config
 * and writes into a real temporary workspace directory, and the git/pull-request
 * half now lives in the built-in `publish:github:pull-request` action, which is
 * not under test here.
 */

import { mockServices } from '@backstage/backend-test-utils';
import type { JsonObject } from '@backstage/types';
import fc from 'fast-check';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'yaml';

import {
  SOURCE_DIRECTORY,
  createRenderCrossplaneManifestAction,
} from '../../actions/renderCrossplaneManifest';

const LIVE_REPO_URL = 'https://github.com/example/adp-gitops-tenants';

function makeConfig(
  crossplaneProvisioning: JsonObject = {
    liveRepoUrl: LIVE_REPO_URL,
  },
) {
  return mockServices.rootConfig({ data: { crossplaneProvisioning } });
}

/** Config with no `crossplaneProvisioning` block at all. */
function makeConfigWithoutBlock() {
  return mockServices.rootConfig({ data: {} });
}

function makeAction(config = makeConfig()) {
  return createRenderCrossplaneManifestAction({
    config,
    logger: mockServices.logger.mock(),
  });
}

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'crossplane-render-test-'));
}

/** Lists every file (relative, posix-style) under `root`. */
async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter(entry => entry.isFile())
    .map(entry =>
      path
        .relative(root, path.join(entry.parentPath ?? root, entry.name))
        .split(path.sep)
        .join('/'),
    )
    .sort();
}

function makeContext(workspacePath: string, input: Record<string, unknown>) {
  const outputs: Record<string, unknown> = {};
  const output = jest.fn((key: string, value: unknown) => {
    outputs[key] = value;
  });
  return {
    ctx: {
      input,
      workspacePath,
      output,
      logger: mockServices.logger.mock(),
    } as any,
    outputs,
    output,
  };
}

describe('tenant:render-crossplane-manifest', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await makeWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it('has the expected action id and supports dry run (Req 1.1)', () => {
    const action = makeAction();
    expect(action.id).toBe('tenant:render-crossplane-manifest');
    expect(action.supportsDryRun).toBe(true);
  });

  it('writes exactly one manifest file and emits every pull-request input (Req 3.4, 3.10, 4.1, 4.3, 5.3)', async () => {
    const action = makeAction();
    const { ctx, outputs } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'dev',
      location: 'japanwest',
      storageAccountSkuName: 'Premium_LRS',
    });

    await action.handler(ctx);

    // Exactly one file, in the dedicated source directory: this is what makes
    // the built-in action's commit a single-file commit (Req 3.10).
    expect(await listFiles(workspacePath)).toEqual([
      `${SOURCE_DIRECTORY}/xr.yaml`,
    ]);

    const contents = await fs.readFile(
      path.join(workspacePath, SOURCE_DIRECTORY, 'xr.yaml'),
      'utf8',
    );
    const manifest = parse(contents);
    expect(manifest.apiVersion).toBe('adp.example.org/v1alpha1');
    expect(manifest.kind).toBe('XTenantEnvironment');
    expect(manifest.metadata.name).toBe('acme-dev');
    expect(manifest.metadata.namespace).toBeUndefined();
    expect(manifest.spec.compositionRef).toBeUndefined();
    expect(manifest.spec.tenantName).toBe('acme');
    expect(manifest.spec.environment).toBe('dev');
    expect(manifest.spec.location).toBe('japanwest');
    expect(manifest.spec.storageAccountSkuName).toBe('Premium_LRS');
    // Components are disabled: no component blocks.
    expect(Object.keys(manifest.spec).sort()).toEqual([
      'environment',
      'location',
      'storageAccountSkuName',
      'tenantName',
    ]);

    expect(outputs).toMatchObject({
      repoUrl: 'github.com?owner=example&repo=adp-gitops-tenants',
      sourcePath: SOURCE_DIRECTORY,
      targetPath: 'tenants/acme/dev',
      manifestPath: 'tenants/acme/dev/xr.yaml',
      branchName: 'devops/acme-dev',
      targetBranchName: 'main',
    });
    expect(outputs.title).toContain('acme');
    expect(outputs.title).toContain('dev');
    expect(outputs.commitMessage).toContain('acme');
    expect(outputs.commitMessage).toContain('dev');
    expect(outputs.description).toContain('tenants/acme/dev/xr.yaml');
  });

  it('falls back to the configured Azure defaults when the inputs are omitted (Req 1.5)', async () => {
    const action = makeAction(
      makeConfig({
        liveRepoUrl: LIVE_REPO_URL,
        defaultLocation: 'southeastasia',
        defaultStorageAccountSkuName: 'Standard_ZRS',
      }),
    );
    const { ctx, outputs } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'prod',
    });

    await action.handler(ctx);

    const manifest = parse(
      await fs.readFile(
        path.join(workspacePath, SOURCE_DIRECTORY, 'xr.yaml'),
        'utf8',
      ),
    );
    expect(manifest.spec.location).toBe('southeastasia');
    expect(manifest.spec.storageAccountSkuName).toBe('Standard_ZRS');
    expect(outputs.branchName).toBe('devops/acme-prod');
  });

  it('uses the configured base branch as targetBranchName (Req 1.6, 1.7)', async () => {
    const action = makeAction(
      makeConfig({ liveRepoUrl: LIVE_REPO_URL, liveRepoBranch: 'release' }),
    );
    const { ctx, outputs } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'dev',
    });

    await action.handler(ctx);

    expect(outputs.targetBranchName).toBe('release');
  });

  it('fails with no file written when liveRepoUrl is missing (Req 1.8, 8.4)', async () => {
    const action = makeAction(makeConfigWithoutBlock());
    const { ctx, output } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'dev',
    });

    await expect(action.handler(ctx)).rejects.toThrow(
      /crossplaneProvisioning\.liveRepoUrl/,
    );
    expect(await listFiles(workspacePath)).toEqual([]);
    expect(output).not.toHaveBeenCalled();
  });

  it('fails with no file written when liveRepoUrl cannot be parsed (Req 1.6, 8.4)', async () => {
    const action = makeAction(makeConfig({ liveRepoUrl: 'not-a-url' }));
    const { ctx, output } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'dev',
    });

    await expect(action.handler(ctx)).rejects.toThrow(
      /crossplaneProvisioning\.liveRepoUrl/,
    );
    expect(await listFiles(workspacePath)).toEqual([]);
    expect(output).not.toHaveBeenCalled();
  });

  it('fails the step and emits nothing when the write fails (Req 3.8)', async () => {
    const action = makeAction();
    const { ctx, output } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'dev',
    });

    const writeFileSpy = jest
      .spyOn(fs, 'writeFile')
      .mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    await expect(action.handler(ctx)).rejects.toThrow(
      /Failed to write the tenant XTenantEnvironment manifest/,
    );
    expect(output).not.toHaveBeenCalled();

    writeFileSpy.mockRestore();
  });

  it('rejects an unknown selected component before writing (Req 9.6)', async () => {
    const action = makeAction();
    const { ctx, output } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'dev',
      selectedComponents: ['not_a_component'],
    });

    await expect(action.handler(ctx)).rejects.toThrow(/not_a_component/);
    expect(await listFiles(workspacePath)).toEqual([]);
    expect(output).not.toHaveBeenCalled();
  });

  it('never invokes a child process or an HTTP client (Req 2.3, 5.5)', async () => {
    const cp = require('child_process');
    const http = require('http');
    const https = require('https');
    const spies = [
      jest.spyOn(cp, 'exec'),
      jest.spyOn(cp, 'execSync'),
      jest.spyOn(cp, 'spawn'),
      jest.spyOn(cp, 'spawnSync'),
      jest.spyOn(cp, 'execFile'),
      jest.spyOn(http, 'request'),
      jest.spyOn(https, 'request'),
    ];

    const action = makeAction();
    const { ctx } = makeContext(workspacePath, {
      tenantName: 'acme',
      environment: 'dev',
    });

    await action.handler(ctx);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('workspace confinement (Property 3)', () => {
  // Feature: tenant-provision-crossplane, Property 3: Target path stays confined
  // to the workspace
  // Validates: Requirements 3.7, 6.3, 7.4, 7.5
  it('never writes outside the workspace for hostile tenant/environment values (Property 3)', async () => {
    const hostile = fc.oneof(
      fc.constant('../escape'),
      fc.constant('../../escape'),
      fc.constant('/etc/passwd'),
      fc.constant('..'),
      fc.constant('./..'),
      fc.constant('a/../../b'),
      fc.constant('~root'),
      fc.string({ maxLength: 30 }).map(s => `../${s}`),
    );

    await fc.assert(
      fc.asyncProperty(hostile, hostile, async (tenant, env) => {
        const ws = await makeWorkspace();
        const parent = path.dirname(ws);
        const parentBefore = await fs.readdir(parent);

        try {
          const action = makeAction();
          const { ctx } = makeContext(ws, {
            tenantName: tenant,
            environment: env,
          });

          // Hostile values never reach the filesystem: they fail input
          // validation first. The assertion that matters is that nothing was
          // created, inside or outside the workspace.
          await expect(action.handler(ctx)).rejects.toThrow();

          expect(await listFiles(ws)).toEqual([]);
          expect((await fs.readdir(parent)).sort()).toEqual(
            parentBefore.sort(),
          );
        } finally {
          await fs.rm(ws, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('fail-fast input validation (Property 4)', () => {
  // Feature: tenant-provision-crossplane, Property 4: Invalid input is rejected
  // with no side effects
  // Validates: Requirements 1.4, 8.1, 8.2, 8.3, 8.4
  it('rejects invalid tenantName/environment with an empty workspace and no output (Property 4)', async () => {
    const invalidTenant = fc
      .string({ maxLength: 40 })
      .filter(s => !/^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$/.test(s));
    const invalidEnv = fc
      .string({ maxLength: 12 })
      .filter(s => !['dev', 'staging', 'prod'].includes(s));

    await fc.assert(
      fc.asyncProperty(invalidTenant, invalidEnv, async (tenant, env) => {
        const ws = await makeWorkspace();
        try {
          const action = makeAction();
          const { ctx, output } = makeContext(ws, {
            tenantName: tenant,
            environment: env,
          });

          await expect(action.handler(ctx)).rejects.toThrow();
          expect(await listFiles(ws)).toEqual([]);
          expect(output).not.toHaveBeenCalled();
        } finally {
          await fs.rm(ws, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
