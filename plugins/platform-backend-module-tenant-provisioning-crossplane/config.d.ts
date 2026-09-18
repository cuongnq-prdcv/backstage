export interface Config {
  /**
   * Configuration for the `tenant:provision-crossplane` scaffolder action.
   */
  crossplaneProvisioning?: {
    /**
     * URL of the Crossplane "live" Git repository that holds tenant
     * `TenantEnvironment` manifests (layout
     * `examples/tenantenvironments/<tenant>-<environment>.yaml`). Sourced from
     * `${CROSSPLANE_LIVE_REPO_URL}`.
     */
    liveRepoUrl?: string;

    /**
     * Base branch of the live repository to clone from and open the pull
     * request against. Sourced from `${CROSSPLANE_LIVE_REPO_BRANCH}`; defaults
     * to `main` when omitted.
     */
    liveRepoBranch?: string;

    /**
     * `apiVersion` written into the rendered manifest. Defaults to
     * `platform.hello-crossplane.io/v1alpha1` when omitted.
     */
    apiVersion?: string;

    /**
     * `kind` written into the rendered manifest. Defaults to
     * `TenantEnvironment` when omitted.
     */
    kind?: string;

    /**
     * The authoritative set of allowed component names (Allowed_Components).
     * Each name must match `^[a-z0-9_]+$`. Defaults to `['table', 'repository']`
     * when omitted.
     */
    components?: string[];
  };
}
