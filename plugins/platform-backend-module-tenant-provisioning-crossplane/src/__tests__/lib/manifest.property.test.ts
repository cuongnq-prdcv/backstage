/**
 * Property-based tests for `renderTenantEnvironmentManifest` (manifest renderer).
 *
 * The renderer turns validated inputs into a `TenantEnvironment` YAML manifest.
 * These properties assert the rendered YAML round-trips the inputs (P1) and
 * that component rendering is data-driven, ordered, validated, and
 * deterministic (P8).
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

/** Ascending byte-order comparator (matches the renderer's ordering). */
function byteOrder(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

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
  apiVersion: fc.constant('platform.hello-crossplane.io/v1alpha1'),
  kind: fc.constant('TenantEnvironment'),
  components: componentsRecord,
});

describe('renderTenantEnvironmentManifest', () => {
  // Feature: tenant-provision-crossplane, Property 1: Rendered manifest
  // round-trips the inputs
  // Validates: Requirements 3.1, 3.2, 3.3, 1.5, 9.1, 9.3, 9.4, 9.8, 9.9
  it('round-trips apiVersion/kind/metadata/spec and one enabled per component (Property 1)', () => {
    fc.assert(
      fc.property(validInput, input => {
        const yaml = renderTenantEnvironmentManifest(input);
        const parsed = parse(yaml);

        const name = `${input.tenantName}-${input.environment}`;
        expect(parsed.apiVersion).toBe(input.apiVersion);
        expect(parsed.kind).toBe(input.kind);
        expect(parsed.metadata.name).toBe(name);
        expect(parsed.metadata.namespace).toBe(name);
        expect(parsed.spec.tenant).toBe(input.tenantName);
        expect(parsed.spec.environment).toBe(input.environment);

        const componentKeys = Object.keys(input.components);
        for (const key of componentKeys) {
          expect(parsed.spec[key]).toEqual({ enabled: input.components[key] });
        }
        // spec has exactly tenant + environment + one block per component.
        expect(Object.keys(parsed.spec).sort()).toEqual(
          ['tenant', 'environment', ...componentKeys].sort(),
        );
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-provision-crossplane, Property 8: Component rendering is
  // data-driven, ordered, validated, and deterministic
  // Validates: Requirements 9.2, 9.3, 9.4, 9.7, 9.8, 3.9
  it('emits component blocks in ascending byte order and is deterministic (Property 8)', () => {
    fc.assert(
      fc.property(validInput, input => {
        const yaml = renderTenantEnvironmentManifest(input);

        // Deterministic: re-rendering the same input is byte-for-byte identical.
        expect(renderTenantEnvironmentManifest(input)).toBe(yaml);

        // Component keys appear in ascending byte order within spec. Scan the
        // spec-level lines (indented two spaces, `  <key>:`) directly from the
        // YAML text — `Object.keys` on a parsed object reorders integer-like
        // keys, so text-order is the reliable source of truth.
        const specStart = yaml.indexOf('\nspec:\n');
        const specBody = yaml.slice(specStart + '\nspec:\n'.length);
        const specKeysInDoc = specBody
          .split('\n')
          .map(line => /^ {2}"?([A-Za-z0-9_]+)"?:/.exec(line))
          .filter((m): m is RegExpExecArray => m !== null)
          .map(m => m[1]);
        const componentKeysInDoc = specKeysInDoc.filter(
          k => k !== 'tenant' && k !== 'environment',
        );
        const sorted = [...Object.keys(input.components)].sort(byteOrder);
        expect(componentKeysInDoc).toEqual(sorted);
        // tenant and environment come first, in that order.
        expect(specKeysInDoc.slice(0, 2)).toEqual(['tenant', 'environment']);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects an invalid component key before producing output (Property 8)', () => {
    const invalid = fc
      .tuple(tenantName, environment)
      .map(([t, e]) => ({
        tenantName: t,
        environment: e,
        apiVersion: 'platform.hello-crossplane.io/v1alpha1',
        kind: 'TenantEnvironment',
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

  it('rejects an oversized component map before producing output (Property 8)', () => {
    const oversized: Record<string, boolean> = {};
    for (let i = 0; i < 101; i++) {
      oversized[`component_${i}`] = true;
    }
    expect(() =>
      renderTenantEnvironmentManifest({
        tenantName: 'acme',
        environment: 'dev',
        apiVersion: 'platform.hello-crossplane.io/v1alpha1',
        kind: 'TenantEnvironment',
        components: oversized,
      }),
    ).toThrow(/exceeds the allowed maximum/);
  });

  it('emits only tenant and environment when the components map is empty (Req 9.9)', () => {
    const yaml = renderTenantEnvironmentManifest({
      tenantName: 'acme',
      environment: 'dev',
      apiVersion: 'platform.hello-crossplane.io/v1alpha1',
      kind: 'TenantEnvironment',
      components: {},
    });
    const parsed = parse(yaml);
    expect(Object.keys(parsed.spec).sort()).toEqual(['environment', 'tenant']);
  });
});
