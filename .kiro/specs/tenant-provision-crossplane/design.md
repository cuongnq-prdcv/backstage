# Design Document

## Overview

Implements the `tenant:provision-crossplane` custom Backstage scaffolder action in a new backend
module `@internal/backstage-plugin-platform-backend-module-tenant-provisioning-crossplane`
(`plugins/platform-backend-module-tenant-provisioning-crossplane/`). It is a self-contained plugin
registered alongside the existing modules in `packages/backend/src/index.ts`.

Workflow (ends at the pull request):

1. Validate inputs; expand selected components against the config-driven allowed set.
2. Clone the Crossplane live repo at the base branch into a per-execution temp working directory.
3. Render/write a `TenantEnvironment` manifest at `examples/tenantenvironments/<tenant>-<env>.yaml`.
4. Create a timestamped feature branch; commit only that file; push.
5. Open (or reuse) a pull request.
6. Clean up the working directory.

**Hard boundary:** the action never runs `crossplane`, `kubectl apply`, or any cluster/cloud
execution — in production, tests, or CI (Req 5.5, `AGENTS.md`).

Requirement coverage: registration + input/config schema (Req 1), clone (Req 2), render + write
(Req 3), branch + commit (Req 4), push + PR idempotency (Req 5), cleanup (Req 6), secret protection +
tenant isolation (Req 7), fail-fast validation (Req 8), extensible components (Req 9).

## Module layout

Each unit has a single responsibility and is independently testable.

| File | Responsibility |
| --- | --- |
| `actions/tenantProvisionCrossplane.ts` | Action factory + orchestration handler |
| `config.ts` | Read/validate the `crossplaneProvisioning` config block |
| `manifest.ts` | Pure renderer → `TenantEnvironment` YAML |
| `git.ts` | Clone/branch/commit/push (`isomorphic-git`), PR create/lookup (Octokit), `resolveLiveRepoToken`, error classification |
| `workspace.ts` | Per-execution temp dir: `mkdtemp` uniqueness, `resolveWithin` confinement, verified `cleanup` |
| `naming.ts` | `buildBranchName` (`devops/<tenant>-<env>-<yyyymmdd-hhmmss>`, UTC), `buildPullRequestTitle` |
| `redact.ts` | `redact` + `REDACTION_PLACEHOLDER` |
| `components.ts` | `expandComponents(selected, allowed)` |
| `module.ts` | Registers `tenant:provision-crossplane` (`moduleId: 'tenant-provisioning-crossplane'`) |
| `config.d.ts` | Schema declaration for the `crossplaneProvisioning` block |
| `index.ts` | Module export point |

## Research notes

- **Action registration.** `createBackendModule` depends on `scaffolderActionsExtensionPoint`
  (`@backstage/plugin-scaffolder-node/alpha`) in `registerInit` and calls
  `scaffolder.addActions(...)`; the action is built with `createTemplateAction`. Distinct action ids
  coexist, so the only backend-index change is one `backend.add(import('...'))` line. (Sources:
  Backstage docs — Writing Custom Actions; Migrating to the New Backend System. Rephrased for
  licensing compliance.)
- **Target API.** `TenantEnvironment` is a Crossplane v2 namespaced composite resource:
  `apiVersion: platform.hello-crossplane.io/v1alpha1`, `kind: TenantEnvironment`. Spec: `tenant`
  (required), `environment` (required, `dev|staging|prod`), optional `region`, `bucket.versioning`,
  `table.enabled`, `repository.enabled`. Examples live at `examples/tenantenvironments/<name>.yaml`
  with `metadata.name` and `metadata.namespace` both `<tenant>-<env>`. This iteration renders that
  shape; `region`, `bucket.versioning`, `table.hashKey`/`billingMode` use XRD defaults and are not on
  the form.
- **Config vs env.** Values are `${ENV_VAR}` references in `app-config*.yaml`, read via
  `coreServices.rootConfig` (Req 1.9).
- **GitHub auth.** `resolveLiveRepoToken` resolves the token for the live-repo host through
  `ScmIntegrations` / `DefaultGithubCredentialsProvider` (`@backstage/integration`) using
  `integrations.github` (`token: ${GITHUB_TOKEN}`). The token is never read from `process.env` in
  code and never appears as a literal (Req 7.1, 7.2).
- **Git libraries.** `isomorphic-git` (pure-JS, no `git` CLI on the host) for local git; Octokit
  (`@octokit/rest`) for PR create + "already-open PR" lookup.
- **YAML rendering.** A pure builder produces a plain object with fixed key order and component keys
  sorted in ascending byte order; `yaml.stringify` serializes it, giving byte-for-byte identical
  output per input (Req 3.9, 9.4). (Source: `yaml` package docs. Rephrased for licensing compliance.)
- **Form.** A JSON-schema `array` of `enum` items with `ui:widget: checkboxes` renders as a checkbox
  list; the selection arrives as `string[]`. The authoritative set is config; the template mirrors it
  in its `enum` (`table`, `repository`).

## Architecture

One `createTemplateAction` handler orchestrating four collaborators:

- **ConfigReader** — resolves/validates `crossplaneProvisioning`.
- **ManifestRenderer** — pure object-builder + `yaml.stringify`.
- **GitHelper** — clone/branch/commit/push + PR.
- **WorkspaceManager** — per-execution temp dir + path confinement.

Validation runs first, in-process, before any side-effecting collaborator.

### Module wiring

```
packages/backend/src/index.ts
  ├─ backend.add(import('@internal/...-tenant-provisioning'))            // existing — unchanged
  └─ backend.add(import('@internal/...-tenant-provisioning-crossplane')) // NEW line
        └─ platformModuleTenantProvisioningCrossplane (createBackendModule)
              └─ registerInit deps: scaffolder (scaffolderActionsExtensionPoint),
                 config (coreServices.rootConfig), logger (coreServices.logger)
              └─ init: scaffolder.addActions(createTenantProvisionCrossplaneAction({ config, logger }))
```

`pluginId: 'scaffolder'`, `moduleId: 'tenant-provisioning-crossplane'`.

### Execution flow

```mermaid
flowchart TD
    A[Action invoked with ctx.input] --> B{Validate inputs\ntenantName, environment,\nselectedComponents}
    B -- invalid --> BX[Fail: validation error\nNo workdir, no clone]
    B -- valid --> C{Read + validate config\nURL required, branch=main default,\napiVersion/kind defaults,\nallowedComponents}
    C -- URL missing/empty\nor invalid allowed name --> CX[Fail: missing/invalid config\nNo workdir, no clone]
    C -- ok --> CE{Expand selectedComponents\nagainst allowedComponents}
    CE -- selected not in allowed --> CEX[Fail: unknown component\nNo workdir, no clone]
    CE -- ok --> D[Create unique Working_Directory]
    D --> E[Clone live repo at base branch\ntimeout 120s]
    E -- network/ref/auth/timeout error --> Z[Cleanup path]
    E -- ok --> F[Compute target path\nexamples/tenantenvironments/<tenant>-<env>.yaml\nconfine to workdir]
    F -- path escapes workdir --> Z
    F -- ok --> G[Render TenantEnvironment YAML\ncreate folders, write/overwrite]
    G -- write error --> Z
    G -- ok --> H{Feature branch exists?\nlocal or remote}
    H -- exists --> Z
    H -- no --> I[Create branch devops/<t>-<e>-<ts>\ncommit only the manifest]
    I --> J[Push branch\ntimeout 60s]
    J -- push fail/timeout --> Z
    J -- ok --> K{Open PR toward base branch\ntimeout 60s}
    K -- existing open PR --> L[Reuse existing PR URL]
    K -- create --> M[New PR URL]
    K -- PR fail/timeout --> ZP[Cleanup, then fail\nreport pushed branch name]
    L --> N[Set outputs: pullRequestUrl, branchName]
    M --> N
    N --> O[Cleanup Working_Directory]
    O -- cleanup incomplete --> OX[Fail: cleanup error\nname unremovable path, redacted]
    O -- ok --> P[Return success]
    Z --> ZF[Fail step with redacted error]
```

Cleanup runs from a `try/finally` wrapping everything after the working directory is created (Req 6.1,
6.2). Validation, config, and expansion all run before the working directory exists, so those
failures never create one (Req 8.1, 8.4, 9.6, 9.7).

## Components and Interfaces

### 1. Action factory — `createTenantProvisionCrossplaneAction`

`src/actions/tenantProvisionCrossplane.ts`.

```ts
export type Environment = 'dev' | 'staging' | 'prod';

export interface TenantProvisionCrossplaneInput {
  tenantName: string;
  environment: Environment;
  selectedComponents?: string[]; // subset of allowed; default []
}

export interface TenantProvisionCrossplaneOutput {
  pullRequestUrl: string;
  branchName: string;
}

export function createTenantProvisionCrossplaneAction(options: {
  config: RootConfigService;
  logger: LoggerService;
}): TemplateAction<TenantProvisionCrossplaneInput, TenantProvisionCrossplaneOutput>;
```

- Action id: `tenant:provision-crossplane`.
- Zod input: `tenantName` matches `^[A-Za-z0-9-]{1,32}$`; `environment` ∈ `dev|staging|prod`;
  `selectedComponents` optional `string[]`.
- Outputs: `pullRequestUrl`, `branchName`.
- Handler order: validate → config → expand → workspace → clone → render/write → branch/commit/push →
  PR → cleanup (`finally`). All surfaced errors pass through `redact`.

### 2. ConfigReader — `readCrossplaneProvisioningConfig`

`src/config.ts`.

```ts
export interface CrossplaneProvisioningConfig {
  liveRepoUrl: string;         // ${CROSSPLANE_LIVE_REPO_URL}; required, non-empty
  liveRepoBranch: string;      // ${CROSSPLANE_LIVE_REPO_BRANCH}; default 'main'
  apiVersion: string;          // default 'platform.hello-crossplane.io/v1alpha1'
  kind: string;                // default 'TenantEnvironment'
  allowedComponents: string[]; // crossplaneProvisioning.components; default ['table','repository']
}

export function readCrossplaneProvisioningConfig(config: RootConfigService): CrossplaneProvisioningConfig;
```

| Rule | Requirement |
| --- | --- |
| `liveRepoBranch` defaults to `main` | 1.7 |
| `apiVersion`/`kind` default to values above | 1.11 |
| `components` defaults to `['table','repository']` | 1.10 |
| Fail (key-naming error) when `liveRepoUrl` absent/empty | 1.8 |
| Reject allowed name not matching `^[a-z0-9_]+$` | 9.7 |
| Reject allowed set > 100 entries | 9.8 |

### 3. ManifestRenderer — `renderTenantEnvironmentManifest`

`src/manifest.ts`.

```ts
export interface RenderManifestInput {
  tenantName: string;
  environment: Environment;
  apiVersion: string;
  kind: string;
  components: Record<string, boolean>; // e.g. { repository: false, table: true }
}

export function renderTenantEnvironmentManifest(input: RenderManifestInput): string;
```

Pure function. Builds an object, serializes with `yaml.stringify`:

```yaml
apiVersion: platform.hello-crossplane.io/v1alpha1
kind: TenantEnvironment
metadata:
  name: acme-dev
  namespace: acme-dev
spec:
  tenant: acme
  environment: dev
  repository:
    enabled: false
  table:
    enabled: true
```

Rules:
- `metadata.name` = `metadata.namespace` = `<tenantName>-<environment>`.
- `spec.tenant` = `tenantName`; `spec.environment` = `environment`.
- One `spec.<component>.enabled` per entry, keys sorted ascending byte order, same logic for every
  key; missing → `false`; empty map → no component blocks (Req 3.3, 9.2–9.4, 9.8, 9.9).
- Defense-in-depth before output: reject component key not matching `^[a-z0-9_]+$`, map > 100
  entries, and any `apiVersion`/`kind`/`tenantName` that would break the YAML scalar. Output is
  deterministic (Req 3.9).

### 4. GitHelper / WorkspaceManager / redact / naming / components

`src/git.ts`, `workspace.ts`, `redact.ts`, `naming.ts`, `components.ts`.

- `git.ts`: exports `resolveLiveRepoToken(config, url)`, `createGitHelper({ url, token })`
  (clone/branch/commit/push/PR), and timeout constants `CLONE_TIMEOUT_MS` 120s / `PUSH_TIMEOUT_MS`
  60s / `PULL_REQUEST_TIMEOUT_MS` 60s (Req 2.6, 5.7, 5.8).
- `workspace.ts`: per-execution confinement + verified cleanup (Req 6, 7.4, 7.5).
- `naming.buildBranchName`: `devops/<tenant>-<env>-<yyyymmdd-hhmmss>` UTC (Req 4.2).
- `redact`: strips secret values from any surfaced string (Req 7.3).
- `expandComponents`: maps the selected subset onto the full allowed set as booleans (Req 9.1).

### 5. Backend module — `platformModuleTenantProvisioningCrossplane`

`src/module.ts`. `createBackendModule({ pluginId: 'scaffolder', moduleId: 'tenant-provisioning-crossplane' })`;
`registerInit` deps `{ scaffolder, config, logger }`; init calls
`scaffolder.addActions(createTenantProvisionCrossplaneAction({ config, logger }))`.

### 6. Template — `templates/tenant-provisioning-crossplane/template.yaml`

New `scaffolder.backstage.io/v1beta3` Template.

| Parameter | Type | Notes |
| --- | --- | --- |
| `tenantName` | string | pattern `^[A-Za-z0-9-]{1,32}$` |
| `environment` | string | enum `dev|staging|prod`, default `dev` |
| `components` | array/enum | `[table, repository]`, `ui:widget: checkboxes`, default `[]` |

One step invokes `tenant:provision-crossplane`; output links to the PR URL and shows the branch name.
Registered under `catalog.locations` in `app-config.yaml`.

### 7. App-config block

```yaml
crossplaneProvisioning:
  liveRepoUrl: ${CROSSPLANE_LIVE_REPO_URL}          # required
  liveRepoBranch: ${CROSSPLANE_LIVE_REPO_BRANCH}    # optional; defaults to main
  apiVersion: platform.hello-crossplane.io/v1alpha1 # optional; default shown
  kind: TenantEnvironment                           # optional; default shown
  components: [table, repository]                   # Allowed_Components
```

`.env` gains `CROSSPLANE_LIVE_REPO_URL` (and optionally `CROSSPLANE_LIVE_REPO_BRANCH`). `GITHUB_TOKEN`
is used via `integrations.github`. No AWS/Azure credentials required (PR-only).

## Error Handling

- Fail-fast validation before any side effect (Req 8).
- Every side-effecting phase wrapped so cleanup runs in `finally` (Req 6).
- Git failures classified: `network-unreachable` / `missing-ref` / `auth-rejected` / `timeout` /
  `push-rejected` / `unknown`.
- Every surfaced message passes through `redact(message, [token])` (Req 7.3).
- PR-creation failure after a successful push reports the pushed branch name (Req 5.8).

## Testing Strategy

**No test runs `crossplane`/`kubectl` or any real network operation** — git/Octokit are mocked
(Req 5.5).

- **Property-based** (`fast-check`, ≥100 iterations, tagged
  `Feature: tenant-provision-crossplane, Property N: <text>`):
  - Manifest round-trip: parse rendered YAML; assert `apiVersion`/`kind`/`metadata.name`/`namespace`/
    `spec.tenant`/`spec.environment` and one `spec.<c>.enabled` per allowed (true iff selected);
    assert determinism (Req 3, 9).
  - Component expansion total over allowed; rejects unknown (Req 9.1, 9.5, 9.6, 9.8, 9.9).
  - Path confinement rejects escaping paths (Req 3.7, 7.4, 7.5).
  - Redaction: token never survives (Req 7.3).
- **Mock-based unit/integration:** config defaults + missing-`liveRepoUrl` (Req 1.7, 1.8, 1.11);
  orchestration happy path with git mocked (outputs set, only the manifest committed); clone/push/PR
  error mapping + timeouts; PR idempotency reuse (Req 5.6); cleanup on success and failure
  (Req 6.1–6.3); module registration exposes the action (Req 1.1, 1.2).
- **Safety:** no code path invokes a cluster/apply command; manifest and logs never contain the token
  (Req 5.5, 7.1, 7.2).

## Design Decisions and Trade-offs

| Decision | Rationale |
| --- | --- |
| Standalone plugin, existing plugins untouched | Both flows run side by side during migration; no risk to the current flow |
| `apiVersion`/`kind` are config with defaults | Seam to point at a future Azure API by config alone — no code change, no extra work now (YAGNI) |
| Structured object + `yaml.stringify` (not string templating) | Valid YAML, no hand-escaping, deterministic via fixed key order + sorted keys |
| PR is the hard boundary | No cluster apply anywhere, including tests/CI |
