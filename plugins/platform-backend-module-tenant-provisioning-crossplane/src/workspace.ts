import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { redact } from './redact';

/** A per-execution working directory with path-confinement and cleanup. */
export interface Workspace {
  /** Absolute path to the per-execution directory. */
  root: string;
  /** Resolves `relPath` against `root`, throwing if it escapes `root`. */
  resolveWithin(relPath: string): string;
  /** Removes the directory recursively; throws if anything remains. */
  cleanup(): Promise<void>;
}

/** Options for creating a per-execution {@link Workspace}. */
export interface CreateWorkspaceOptions {
  /** Scaffolder working directory when configured; otherwise undefined. */
  baseDir?: string;
  tenantName: string;
  environment: string;
  /** Secret values to strip from any error message this workspace produces. */
  secrets?: string[];
}

/**
 * Returns true when `child` is `parent` itself or a descendant of `parent`.
 * The check is done on path segments (via `path.relative`) rather than string
 * prefixes, so a sibling directory whose name merely starts with `parent` is
 * correctly treated as outside `parent`.
 */
function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

/**
 * Creates a uniquely named per-execution working directory under `baseDir` when
 * provided, otherwise under the OS temp directory.
 *
 * The directory is created with `fs.mkdtemp`, which appends random characters
 * to the prefix, guaranteeing a distinct path per invocation even for two
 * concurrent executions with identical tenant/environment values (Req 6.4,
 * 6.5). The prefix embeds tenant/environment purely for operator legibility;
 * uniqueness comes from `mkdtemp`.
 */
export async function createWorkspace(
  opts: CreateWorkspaceOptions,
): Promise<Workspace> {
  const { baseDir, tenantName, environment, secrets = [] } = opts;

  const parentDir = baseDir ?? os.tmpdir();
  const label = `tenant-provision-crossplane-${tenantName}-${environment}-`.replace(
    /[^a-zA-Z0-9._-]/g,
    '_',
  );

  await fs.mkdir(parentDir, { recursive: true });

  const root = await fs.mkdtemp(path.join(parentDir, label));

  const resolveWithin = (relPath: string): string => {
    const resolved = path.resolve(root, relPath);
    if (!isWithin(root, resolved)) {
      throw new Error(
        `Resolved path is outside the working directory: ${redact(
          resolved,
          secrets,
        )}`,
      );
    }
    return resolved;
  };

  const cleanup = async (): Promise<void> => {
    await fs.rm(root, { recursive: true, force: true });

    let stillExists = true;
    try {
      await fs.stat(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        stillExists = false;
      } else {
        throw new Error(
          `Failed to verify cleanup of the working directory: ${redact(
            String((err as Error).message ?? err),
            secrets,
          )}`,
        );
      }
    }

    if (stillExists) {
      throw new Error(
        `Cleanup did not complete; the working directory could not be removed: ${redact(
          root,
          secrets,
        )}`,
      );
    }
  };

  return { root, resolveWithin, cleanup };
}
