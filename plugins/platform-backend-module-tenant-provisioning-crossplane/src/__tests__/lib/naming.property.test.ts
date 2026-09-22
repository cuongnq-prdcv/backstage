/**
 * Property-based tests for the branch-name, PR-title, and commit-message
 * builders.
 *
 * The branch name is now **deterministic** (`devops/<tenant>-<environment>`, no
 * timestamp): the Template opens the pull request with the built-in action's
 * `update: true`, so one branch per tenant/environment is updated rather than a
 * new branch and a duplicate pull request being created per submission.
 *
 * See the tenant-provision-crossplane design ("Testing Strategy" →
 * Property-based tests, Properties 2 and 7).
 */

import fc from 'fast-check';

import {
  buildBranchName,
  buildCommitMessage,
  buildPullRequestDescription,
  buildPullRequestTitle,
} from '../../lib/naming';

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

describe('naming builders', () => {
  // Feature: tenant-provision-crossplane, Property 2: Feature branch name is
  // well-formed and deterministic
  // Validates: Requirements 4.1
  it('branch name is well-formed and deterministic (Property 2)', () => {
    fc.assert(
      fc.property(tenantName, environment, (tenant, env) => {
        const name = buildBranchName(tenant, env);

        expect(name).toMatch(
          /^devops\/[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]-(dev|staging|prod)$/,
        );
        expect(name).toBe(`devops/${tenant}-${env}`);

        // Deterministic: no timestamp, no other hidden input.
        expect(buildBranchName(tenant, env)).toBe(name);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-provision-crossplane, Property 7: Pull request title and
  // commit message identify tenant and environment
  // Validates: Requirements 4.3, 5.3
  it('PR title and commit message contain tenant and environment (Property 7)', () => {
    fc.assert(
      fc.property(tenantName, environment, (tenant, env) => {
        const title = buildPullRequestTitle(tenant, env);
        expect(title).toContain(tenant);
        expect(title).toContain(env);

        const message = buildCommitMessage(tenant, env);
        expect(message).toContain(tenant);
        expect(message).toContain(env);
      }),
      { numRuns: 200 },
    );
  });

  it('PR description summarises the rendered values', () => {
    const description = buildPullRequestDescription({
      tenantName: 'acme',
      environment: 'dev',
      location: 'japaneast',
      storageAccountSkuName: 'Standard_LRS',
      manifestPath: 'tenants/acme/dev/xr.yaml',
    });

    expect(description).toContain('acme');
    expect(description).toContain('dev');
    expect(description).toContain('japaneast');
    expect(description).toContain('Standard_LRS');
    expect(description).toContain('tenants/acme/dev/xr.yaml');
  });
});
