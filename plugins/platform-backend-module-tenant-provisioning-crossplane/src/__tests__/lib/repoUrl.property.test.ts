/**
 * Property-based tests for `buildScaffolderRepoUrl`.
 *
 * The built-in `publish:github:pull-request` action accepts the live repository
 * as `<host>?owner=<owner>&repo=<repo>`. Deriving that form in code (rather than
 * pasting a literal into `template.yaml`) is what keeps the live repository
 * config-driven via `${CROSSPLANE_LIVE_REPO_URL}`.
 *
 * See the tenant-provision-crossplane design ("Testing Strategy" →
 * Property-based tests, Property 10).
 */

import fc from 'fast-check';

import { buildScaffolderRepoUrl } from '../../lib/repoUrl';

const slug = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split(''),
    ),
    { minLength: 1, maxLength: 20 },
  )
  .map(chars => chars.join(''))
  // Keep slugs that survive a URL round-trip and are not confusable with path
  // navigation or a `.git` suffix (covered separately below).
  .filter(s => !s.startsWith('.') && !s.endsWith('.') && !/\.git$/i.test(s));

const host = fc.constantFrom(
  'github.com',
  'github.example.com',
  'ghe.internal.example.org',
);

describe('buildScaffolderRepoUrl', () => {
  // Feature: tenant-provision-crossplane, Property 10: Scaffolder repo URL
  // round-trips owner and repo
  // Validates: Requirements 1.6, 1.9
  it('round-trips host/owner/repo into the repoUrl form (Property 10)', () => {
    fc.assert(
      fc.property(
        host,
        slug,
        slug,
        fc.boolean(),
        fc.boolean(),
        (h, owner, repo, withGitSuffix, withTrailingSlash) => {
          const suffix = withGitSuffix ? '.git' : '';
          const trailing = withTrailingSlash && !withGitSuffix ? '/' : '';
          const url = `https://${h}/${owner}/${repo}${suffix}${trailing}`;

          expect(buildScaffolderRepoUrl(url)).toBe(
            `${h}?owner=${owner}&repo=${repo}`,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is deterministic for the same input', () => {
    fc.assert(
      fc.property(host, slug, slug, (h, owner, repo) => {
        const url = `https://${h}/${owner}/${repo}`;
        expect(buildScaffolderRepoUrl(url)).toBe(buildScaffolderRepoUrl(url));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: tenant-provision-crossplane, Property 10 (negative half): malformed
  // URLs are rejected with an error naming the config key
  // Validates: Requirements 1.6, 1.8
  it('rejects URLs it cannot derive owner/repo from, naming the config key (Property 10)', () => {
    const malformed = fc.oneof(
      fc.constant('not a url'),
      fc.constant('https://github.com'),
      fc.constant('https://github.com/'),
      fc.constant('https://github.com/owner-only'),
      fc.constant('https://github.com/owner-only/'),
      fc.constant(''),
      fc.constant('   '),
      fc.constant('github.com/owner/repo'),
    );

    fc.assert(
      fc.property(malformed, url => {
        expect(() => buildScaffolderRepoUrl(url)).toThrow(
          /crossplaneProvisioning\.liveRepoUrl/,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('strips a .git suffix and keeps the rest of the repo name', () => {
    expect(
      buildScaffolderRepoUrl(
        'https://github.com/xuansangphamprdcv/adp-gitops-tenants.git',
      ),
    ).toBe('github.com?owner=xuansangphamprdcv&repo=adp-gitops-tenants');
  });
});
