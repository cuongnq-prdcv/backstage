/**
 * Config key surfaced in errors, so a misconfigured URL points the operator at
 * the value to fix rather than at this code.
 */
const LIVE_REPO_URL_KEY = 'crossplaneProvisioning.liveRepoUrl';

/**
 * Converts the configured Crossplane live repository URL into the `repoUrl`
 * form the built-in `publish:github:pull-request` action accepts:
 * `<host>?owner=<owner>&repo=<repo>`.
 *
 * Pure function (no I/O). Accepts the usual HTTPS clone forms, with or without
 * a trailing `.git` and with or without a trailing slash, for example
 * `https://github.com/acme/adp-gitops-tenants` or
 * `https://github.com/acme/adp-gitops-tenants.git`.
 *
 * Keeping this conversion in code is what lets the live repository stay
 * config-driven (`${CROSSPLANE_LIVE_REPO_URL}`) instead of a `repoUrl` literal
 * pasted into `template.yaml` (Req 1.6, 1.9).
 *
 * @throws If the URL cannot be parsed, or does not carry both an owner and a
 *   repository segment. The message names {@link LIVE_REPO_URL_KEY}.
 */
export function buildScaffolderRepoUrl(liveRepoUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(liveRepoUrl.trim());
  } catch {
    throw new Error(
      `Config value '${LIVE_REPO_URL_KEY}' is not a valid URL: '${liveRepoUrl}'`,
    );
  }

  const host = parsed.host;
  const segments = parsed.pathname
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  if (host.length === 0 || segments.length < 2) {
    throw new Error(
      `Could not derive owner/repo from config value '${LIVE_REPO_URL_KEY}': '${liveRepoUrl}'`,
    );
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!owner || !repo) {
    throw new Error(
      `Could not derive owner/repo from config value '${LIVE_REPO_URL_KEY}': '${liveRepoUrl}'`,
    );
  }

  return `${host}?owner=${owner}&repo=${repo}`;
}
