/**
 * Property-based tests for `renderTenantEnvironmentManifest` (manifest renderer).
 *
 * The renderer turns validated inputs into an `XTenantEnvironment` XR YAML
 * manifest. These properties assert the rendered YAML round-trips the inputs
 * (P1) and that output is deterministic (P8).
 *
 * Components are DISABLED (retained for re-enable): the renderer emits no
 * `spec.<component>.enabled` blocks, so the component-emit property is skipped.
 * The retained defense-in-depth validation (invalid key / oversized map) is
 * still exercised, since that code remains active alongside the commented emit
 * loop.
 *
 * See the tenant-provision-crossplane design ("Testing Strategy" →
 * Property-based tests, Properties 1 and 8).
 */

import fc from 'fast-check';
import { parse } from 'yaml';

import {
  renderTenantEnvironmentManifest,
  type Environment,
} from '../../lib/manifest';

const componentName = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
    { minLength: 1, maxLength: 12 },
  )
  .map(chars => chars.join(''));

const tenantName = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    fc
      .array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
        { minLength: 1, maxLength: 20 },
      )
      .map(chars => chars.join('')),
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  )
  .map(([first, mid, last]) => `${first}${mid}${last}`);

const environment = fc.constantFrom<Environment>('dev', 'staging', 'prod');

const location = fc.constantFrom('japaneast', 'japanwest', 'southeastasia');

const storageAccountSkuName = fc.constantFrom(
  'Standard_LRS',
  'Standard_GRS',
  'Standard_RAGRS',
  'Standard_ZRS',
  'Premium_LRS',
);

/** A components record: unique valid keys (0..100) each mapped to a boolean. */
const componentsRecord = fc
  .uniqueArray(componentName, { minLength: 0, maxLength: 100 })
  .chain(keys =>
    fc
      .tuple(...keys.map(() => fc.boolean()))
      .map(values => {
        const record: Record<string, boolean> = {};
        keys.forEach((k, i) => {
          record[k] = values[i] as boolean;
        });
        return record;
      }),
  );

const validInput = fc.record({
  tenantName,
  environment,
  apiVersion: fc.constant('adp.example.org/v1alpha1'),
  kind: fc.constant('XTenantEnvironment'),
  location,
  storageAccountSkuName,
  components: componentsRecord,
});

describe('renderTenantEnvironmentManifest', () => {
  // Feature: tenant-provision-crossplane, Property 1: Rendered manifest
  // round-trips the inputs
  // Validates: Requirements 3.1, 3.2
  it('round-trips apiVersion/kind/metadata/spec into the XR shape (Property 1)', () => {
    fc.assert(
      fc.property(validInput, input => {
        const yaml = renderTenantEnvironmentManifest(input);
        const parsed = parse(yaml);

        const name = `${input.tenantName}-${input.environment}`;
        expect(parsed.apiVersion).toBe(input.apiVersion);
        expect(parsed.kind).toBe(input.kind);
        expect(parsed.metadata.name).toBe(name);
        // XR is cluster-scoped: no namespace is emitted.
        expect(parsed.metadata.namespace).toBeUndefined();

        expect(parsed.spec.compositionRef).toBeUndefined();
        expect(parsed.spec.tenantName).toBe(input.tenantName);
        expect(parsed.spec.environment).toBe(input.environment);
        expect(parsed.spec.location).toBe(input.location);
        expect(parsed.spec.storageAccountSkuName).toBe(
          input.storageAccountSkuName,
        );

        // Components are disabled: spec has exactly these four keys and no
        // component blocks, regardless of the components map contents.
        expect(Object.keys(parsed.spec).sort()).toEqual(
          ['environment', 'location', 'storageAccountSkuName', 'tenantName'].sort(),
        );
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-provision-crossplane, Property 8: Rendering is deterministic
  // Validates: Requirements 3.9
  it('is byte-for-byte deterministic for the same input (Property 8)', () => {
    fc.assert(
      fc.property(validInput, input => {
        const yaml = renderTenantEnvironmentManifest(input);
        expect(renderTenantEnvironmentManifest(input)).toBe(yaml);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects an invalid component key before producing output (retained check)', () => {
    const invalid = fc
      .tuple(tenantName, environment, location, storageAccountSkuName)
      .map(([t, e, loc, sku]) => ({
        tenantName: t,
        environment: e,
        apiVersion: 'adp.example.org/v1alpha1',
        kind: 'XTenantEnvironment',
        location: loc,
        storageAccountSkuName: sku,
        components: { 'Bad-Key': true } as Record<string, boolean>,
      }));

    fc.assert(
      fc.property(invalid, input => {
        expect(() => renderTenantEnvironmentManifest(input)).toThrow(
          /Bad-Key/,
        );
      }),
      { numRuns: 50 },
    );
  });

  it('rejects an oversized component map before producing output (retained check)', () => {
    const oversized: Record<string, boolean> = {};
    for (let i = 0; i < 101; i++) {
      oversized[`component_${i}`] = true;
    }
    expect(() =>
      renderTenantEnvironmentManifest({
        tenantName: 'acme',
        environment: 'dev',
        apiVersion: 'adp.example.org/v1alpha1',
        kind: 'XTenantEnvironment',
        location: 'japaneast',
        storageAccountSkuName: 'Standard_LRS',
        components: oversized,
      }),
    ).toThrow(/exceeds the allowed maximum/);
  });

  it('emits no component blocks even when the components map is non-empty (components disabled)', () => {
    const yaml = renderTenantEnvironmentManifest({
      tenantName: 'acme',
      environment: 'dev',
      apiVersion: 'adp.example.org/v1alpha1',
      kind: 'XTenantEnvironment',
      location: 'japaneast',
      storageAccountSkuName: 'Standard_LRS',
      components: { table: true, repository: false },
    });
    const parsed = parse(yaml);
    expect(Object.keys(parsed.spec).sort()).toEqual(
      ['environment', 'location', 'storageAccountSkuName', 'tenantName'].sort(),
    );
    expect(parsed.spec.table).toBeUndefined();
    expect(parsed.spec.repository).toBeUndefined();
  });
});
