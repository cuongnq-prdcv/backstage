/**
 * Tests for the WorkspaceManager (`createWorkspace` / `Workspace`).
 *
 * Property-based coverage for path confinement (P3) and per-execution
 * uniqueness (P6), plus example-based cleanup behavior (task 7.4). These touch
 * the real filesystem under the OS temp dir only; no git/network/crossplane
 * operation is exercised.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import fc from 'fast-check';

import { createWorkspace } from '../../lib/workspace';

describe('createWorkspace', () => {
  const created: string[] = [];

  afterEach(async () => {
    // Best-effort cleanup of any workspace roots left by a test.
    await Promise.all(
      created.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
    );
  });

  // Feature: tenant-provision-crossplane, Property 3: Target path stays confined to the working directory
  // Validates: Requirements 3.4, 3.7, 7.4, 7.5
  it('resolveWithin keeps paths inside root or throws (Property 3)', async () => {
    const ws = await createWorkspace({
      tenantName: 'acme',
      environment: 'dev',
    });
    created.push(ws.root);

    const relArb = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.constantFrom(
        '../escape',
        '../../etc/passwd',
        '/absolute/path',
        'a/../../b',
        './ok/path.yaml',
        'nested/dir/file.yaml',
      ),
    );

    fc.assert(
      fc.property(relArb, rel => {
        let resolved: string | undefined;
        try {
          resolved = ws.resolveWithin(rel);
        } catch {
          return; // rejecting an escaping path is acceptable
        }
        // If it did not throw, the resolved path must be inside root.
        const relative = path.relative(ws.root, resolved);
        const escapes =
          relative === '..' ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative);
        expect(escapes).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-provision-crossplane, Property 6: Working directories are unique per execution
  // Validates: Requirements 6.4, 6.5
  it('creates a unique directory per invocation (Property 6)', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cp-uniq-base-'));
    created.push(base);

    const roots = await Promise.all(
      Array.from({ length: 25 }, () =>
        createWorkspace({ baseDir: base, tenantName: 'acme', environment: 'dev' }),
      ),
    );
    roots.forEach(r => created.push(r.root));

    const uniquePaths = new Set(roots.map(r => r.root));
    expect(uniquePaths.size).toBe(roots.length);
    // Also verify the os.tmpdir() branch produces unique paths.
    const tmpRoots = await Promise.all(
      Array.from({ length: 10 }, () =>
        createWorkspace({ tenantName: 'acme', environment: 'dev' }),
      ),
    );
    tmpRoots.forEach(r => created.push(r.root));
    expect(new Set(tmpRoots.map(r => r.root)).size).toBe(tmpRoots.length);
  });

  it('removes the directory on cleanup (task 7.4)', async () => {
    const ws = await createWorkspace({ tenantName: 'acme', environment: 'dev' });
    const file = ws.resolveWithin('nested/file.yaml');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'x', 'utf8');

    await ws.cleanup();

    await expect(fs.stat(ws.root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleanup is idempotent and succeeds when already removed (task 7.4)', async () => {
    const ws = await createWorkspace({ tenantName: 'acme', environment: 'dev' });
    await ws.cleanup();
    await expect(ws.cleanup()).resolves.toBeUndefined();
  });
});
