export interface Config {
  /**
   * Configuration for the `tenant:render-crossplane-manifest` scaffolder action
   * and the `publish:github:pull-request` step it feeds.
   */
  crossplaneProvisioning?: {
    /**
     * URL of the Crossplane "live" Git repository that holds tenant
     * `XTenantEnvironment` XR manifests (layout
     * `tenants/<tenant-name>/<environment>/xr.yaml`). Sourced from
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
     * `adp.example.org/v1alpha1` when omitted.
     */
    apiVersion?: string;

    /**
     * `kind` written into the rendered manifest. Defaults to
     * `XTenantEnvironment` when omitted.
     */
    kind?: string;

    /**
     * Fallback `spec.location` (Azure region) used when the action input omits
     * it. Defaults to `japaneast` when omitted.
     */
    defaultLocation?: string;

    /**
     * Fallback `spec.storageAccountSkuName` (Azure Storage SKU) used when the
     * action input omits it. Defaults to `Standard_LRS` when omitted.
     */
    defaultStorageAccountSkuName?: string;

    /**
     * The authoritative set of allowed component names (Allowed_Components).
     * Each name must match `^[a-z0-9_]+$`. Defaults to `['table', 'repository']`
     * when omitted. DISABLED — retained for re-enable; read but not rendered
     * into the manifest while component emission is off.
     */
    components?: string[];
  };
}
