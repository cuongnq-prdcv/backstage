/**
 * Property-based test for `expandComponents` (component expansion).
 *
 * `expandComponents(selected, allowed)` turns the user's selected component
 * names plus the config-driven Allowed_Components into the full boolean record
 * the manifest renderer consumes: one entry per allowed name, `true` iff the
 * name is in `selected`, and it throws for any selected name that is not a
 * member of the allowed set — before producing any record.
 *
 * See the tenant-provision-crossplane design ("Testing Strategy" →
 * Property-based tests, Property 9).
 */

import fc from 'fast-check';

import { expandComponents } from '../../lib/components';

/** Allowed component names must match `^[a-z0-9_]+$` (Req 9.7). */
const componentName = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
    { minLength: 1, maxLength: 12 },
  )
  .map(chars => chars.join(''));

/** An arbitrary allowed set: de-duplicated valid names, size 0..100. */
const allowedSet = fc
  .uniqueArray(componentName, { minLength: 0, maxLength: 100 })
  .map(names => names.slice(0, 100));

describe('expandComponents: component expansion', () => {
  // Feature: tenant-provision-crossplane, Property 9: Component expansion is
  // total over the allowed set and rejects unknown selections
  // Validates: Requirements 9.1, 9.5, 9.6, 9.8, 9.9
  it('returns one entry per allowed name, true iff selected (Property 9)', () => {
    const allowedAndSelected = allowedSet.chain(allowed =>
      fc
        .array(
          allowed.length === 0
            ? fc.constant<string>('')
            : fc.constantFrom(...allowed),
          {
            minLength: 0,
            maxLength: allowed.length === 0 ? 0 : allowed.length * 2,
          },
        )
        .map(selected => ({ allowed, selected })),
    );

    fc.assert(
      fc.property(allowedAndSelected, ({ allowed, selected }) => {
        const record = expandComponents(selected, allowed);

        const keys = Object.keys(record);
        expect(keys.sort()).toEqual([...allowed].sort());
        expect(keys).toHaveLength(allowed.length);

        const selectedSet = new Set(selected);
        for (const name of allowed) {
          expect(record[name]).toBe(selectedSet.has(name));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('throws for a selection containing a name not in the allowed set, before producing a record (Property 9)', () => {
    const withUnknown = allowedSet.chain(allowed => {
      const allowedLookup = new Set(allowed);
      const unknown = componentName.filter(name => !allowedLookup.has(name));
      const known = fc.array(
        allowed.length === 0
          ? fc.constant<string>('')
          : fc.constantFrom(...allowed),
        { minLength: 0, maxLength: allowed.length === 0 ? 0 : allowed.length },
      );
      return fc.tuple(fc.constant(allowed), known, unknown).map(([a, k, u]) => ({
        allowed: a,
        selected: [...k, u],
        unknown: u,
      }));
    });

    fc.assert(
      fc.property(withUnknown, ({ allowed, selected, unknown }) => {
        expect(() => expandComponents(selected, allowed)).toThrow(unknown);
      }),
      { numRuns: 200 },
    );
  });
});
