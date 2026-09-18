/**
 * Property-based tests for the branch-name and PR-title builders.
 *
 * See the tenant-provision-crossplane design ("Testing Strategy" →
 * Property-based tests, Properties 2 and 7).
 */

import fc from 'fast-check';

import { buildBranchName, buildPullRequestTitle } from '../naming';

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

const environment = fc.constantFrom('dev', 'staging', 'prod');

const anyDate = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .filter(d => !Number.isNaN(d.getTime()));

describe('naming builders', () => {
  // Feature: tenant-provision-crossplane, Property 2: Feature branch name is well-formed
  // Validates: Requirements 4.2
  it('branch name is well-formed and embeds the UTC timestamp (Property 2)', () => {
    fc.assert(
      fc.property(tenantName, environment, anyDate, (tenant, env, date) => {
        const name = buildBranchName(tenant, env, date);

        expect(name).toMatch(
          /^devops\/[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]-(dev|staging|prod)-\d{8}-\d{6}$/,
        );

        const y = String(date.getUTCFullYear()).padStart(4, '0');
        const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        const h = String(date.getUTCHours()).padStart(2, '0');
        const mi = String(date.getUTCMinutes()).padStart(2, '0');
        const s = String(date.getUTCSeconds()).padStart(2, '0');
        expect(name).toBe(`devops/${tenant}-${env}-${y}${mo}${d}-${h}${mi}${s}`);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-provision-crossplane, Property 7: Pull request title identifies tenant and environment
  // Validates: Requirements 5.3
  it('PR title contains tenant and environment (Property 7)', () => {
    fc.assert(
      fc.property(tenantName, environment, (tenant, env) => {
        const title = buildPullRequestTitle(tenant, env);
        expect(title).toContain(tenant);
        expect(title).toContain(env);
      }),
      { numRuns: 200 },
    );
  });
});
