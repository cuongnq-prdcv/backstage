import { stringify } from 'yaml';

/** Deployment environment accepted by the tenant:provision-crossplane action. */
export type Environment = 'dev' | 'staging' | 'prod';

/** Input to the pure TenantEnvironment manifest renderer. */
export interface RenderManifestInput {
  tenantName: string;
  environment: Environment;
  apiVersion: string;
  kind: string;
  /** component name -> enabled; e.g. `{ repository: false, table: true }`. */
  components: Record<string, boolean>;
}

/** Pattern every component key must match (defense in depth; Req 9.7). */
const COMPONENT_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Maximum number of component entries permitted (defense in depth; Req 9.8). */
const MAX_COMPONENTS = 100;

/** Ascending lexicographic byte-order comparator for component keys. */
function byteOrder(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Renders the tenant `TenantEnvironment` manifest (YAML) from the given inputs.
 *
 * Pure function (no I/O). Builds a plain object with a fixed key order and
 * component keys sorted in ascending lexicographic byte order, then serializes
 * it with `yaml.stringify`, so the same inputs always yield byte-for-byte
 * identical output (Req 3.9, 9.4).
 *
 * Emitted shape:
 *
 * ```yaml
 * apiVersion: <apiVersion>
 * kind: <kind>
 * metadata:
 *   name: <tenant>-<environment>
 *   namespace: <tenant>-<environment>
 * spec:
 *   tenant: <tenant>
 *   environment: <environment>
 *   <component>:
 *     enabled: <bool>
 * ```
 *
 * The `<component>.enabled` entries are produced with the same logic for every
 * key (no per-name branching), sorted by key. A missing/undefined value is
 * treated as `false`. An empty `components` map yields a `spec` block with only
 * `tenant` and `environment`.
 *
 * Defense-in-depth validation runs before any output is produced.
 *
 * @throws If any component key does not match `^[a-z0-9_]+$`.
 * @throws If the `components` map has more than 100 entries.
 * @throws If `apiVersion`, `kind`, or `tenantName` contains a newline (which
 *   would break the YAML scalar).
 */
export function renderTenantEnvironmentManifest(
  input: RenderManifestInput,
): string {
  const { tenantName, environment, apiVersion, kind, components } = input;

  // Defense-in-depth: reject scalars that would break the emitted YAML.
  for (const [label, value] of [
    ['apiVersion', apiVersion],
    ['kind', kind],
    ['tenantName', tenantName],
  ] as const) {
    if (/[\r\n]/.test(value)) {
      throw new Error(`Invalid ${label}: must not contain a newline`);
    }
  }

  const keys = Object.keys(components);

  // Defense-in-depth: reject an oversized component map.
  if (keys.length > MAX_COMPONENTS) {
    throw new Error(
      `Component count exceeds the allowed maximum of ${MAX_COMPONENTS}`,
    );
  }

  // Defense-in-depth: reject any component key that could break the manifest.
  for (const key of keys) {
    if (!COMPONENT_NAME_PATTERN.test(key)) {
      throw new Error(
        `Invalid component name: '${key}' does not match ^[a-z0-9_]+$`,
      );
    }
  }

  const name = `${tenantName}-${environment}`;

  // Build the spec as a Map so key order is preserved exactly as inserted.
  // A plain object would reorder integer-like keys (e.g. "0", "5") ahead of
  // string keys, which would corrupt both the tenant/environment ordering and
  // the ascending byte-order of component keys. `yaml.stringify` serializes a
  // Map preserving insertion order.
  const spec = new Map<string, unknown>();
  spec.set('tenant', tenantName);
  spec.set('environment', environment);
  for (const key of [...keys].sort(byteOrder)) {
    spec.set(key, new Map([['enabled', components[key] === true]]));
  }

  const metadata = new Map<string, string>([
    ['name', name],
    ['namespace', name],
  ]);

  const manifest = new Map<string, unknown>([
    ['apiVersion', apiVersion],
    ['kind', kind],
    ['metadata', metadata],
    ['spec', spec],
  ]);

  return stringify(manifest);
}
