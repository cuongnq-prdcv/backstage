import { stringify } from 'yaml';

/** Deployment environment accepted by the tenant:render-crossplane-manifest action. */
export type Environment = 'dev' | 'staging' | 'prod';

/** Input to the pure XTenantEnvironment XR manifest renderer. */
export interface RenderManifestInput {
  tenantName: string;
  environment: Environment;
  apiVersion: string;
  kind: string;
  /** `spec.location` (Azure region), e.g. `japaneast`. */
  location: string;
  /** `spec.storageAccountSkuName` (Azure Storage SKU), e.g. `Standard_LRS`. */
  storageAccountSkuName: string;
  /**
   * component name -> enabled; e.g. `{ repository: false, table: true }`.
   *
   * DISABLED — retained for re-enable. Accepted so the action wiring
   * (`expandComponents`) keeps compiling, but NOT emitted into the manifest
   * while component emission is off. Re-enable by uncommenting the emit loop
   * below.
   */
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
 * Renders the tenant `XTenantEnvironment` XR manifest (YAML) from the given
 * inputs.
 *
 * Pure function (no I/O). Builds a plain object with a fixed key order, then
 * serializes it with `yaml.stringify`, so the same inputs always yield
 * byte-for-byte identical output (Req 3.9).
 *
 * Emitted shape:
 *
 * ```yaml
 * apiVersion: <apiVersion>
 * kind: <kind>
 * metadata:
 *   name: <tenant>-<environment>
 * spec:
 *   tenantName: <tenant>
 *   environment: <environment>
 *   location: <location>
 *   storageAccountSkuName: <storageAccountSkuName>
 * ```
 *
 * The XR is cluster-scoped, so no `metadata.namespace` is emitted. No
 * `spec.compositionRef` is emitted either: composition selection is left to
 * Crossplane's own default-composition resolution for the XRD.
 *
 * Components are DISABLED (retained for re-enable): the `spec.<component>.enabled`
 * emit loop is commented out, so no component blocks appear in the output. The
 * component-key validation is retained alongside it.
 *
 * Defense-in-depth validation runs before any output is produced.
 *
 * @throws If `apiVersion`, `kind`, `tenantName`, `location`, or
 *   `storageAccountSkuName` contains a newline (which would break the YAML
 *   scalar).
 * @throws If any component key does not match `^[a-z0-9_]+$` (retained check).
 * @throws If the `components` map has more than 100 entries (retained check).
 */
export function renderTenantEnvironmentManifest(
  input: RenderManifestInput,
): string {
  const {
    tenantName,
    environment,
    apiVersion,
    kind,
    location,
    storageAccountSkuName,
    components,
  } = input;

  // Defense-in-depth: reject scalars that would break the emitted YAML.
  for (const [label, value] of [
    ['apiVersion', apiVersion],
    ['kind', kind],
    ['tenantName', tenantName],
    ['location', location],
    ['storageAccountSkuName', storageAccountSkuName],
  ] as const) {
    if (/[\r\n]/.test(value)) {
      throw new Error(`Invalid ${label}: must not contain a newline`);
    }
  }

  const keys = Object.keys(components);

  // Defense-in-depth: reject an oversized component map. (Retained while
  // components are disabled so re-enabling needs no re-validation.)
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
  // A plain object would reorder integer-like keys ahead of string keys.
  // `yaml.stringify` serializes a Map preserving insertion order.
  const spec = new Map<string, unknown>();
  spec.set('tenantName', tenantName);
  spec.set('environment', environment);
  spec.set('location', location);
  spec.set('storageAccountSkuName', storageAccountSkuName);

  // --- Components emit (DISABLED — retained for re-enable) -----------------
  // Uncomment to render one `spec.<component>.enabled` entry per component,
  // sorted in ascending byte order (Req 3.3, 9.2-9.4):
  //
  // for (const key of [...keys].sort(byteOrder)) {
  //   spec.set(key, new Map([['enabled', components[key] === true]]));
  // }
  // -------------------------------------------------------------------------
  // Reference the comparator + values so they are not flagged as unused while
  // the emit loop is commented out; this is a no-op.
  void byteOrder;
  void components;

  const metadata = new Map<string, string>([['name', name]]);

  const manifest = new Map<string, unknown>([
    ['apiVersion', apiVersion],
    ['kind', kind],
    ['metadata', metadata],
    ['spec', spec],
  ]);

  return stringify(manifest);
}
