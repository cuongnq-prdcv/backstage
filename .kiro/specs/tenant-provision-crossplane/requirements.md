# Requirements Document

## Introduction

This feature adds a **second, Crossplane-based tenant-provisioning behavior** alongside the existing
Terragrunt one, without modifying the existing Terragrunt plugin. Where the current `tenant:provision`
action renders a `terragrunt.hcl` and opens a pull request against the Terragrunt "live" repository,
this feature renders a Crossplane `XTenantEnvironment` composite-resource (XR) manifest (YAML) and
opens a pull request against a separate Crossplane "live" repository.

> ## Revision: hybrid design — thin custom action + built-in `publish:github:pull-request`
>
> An earlier iteration of this spec put the **entire** workflow into one custom action: clone the live
> repo with `isomorphic-git`, write the manifest, create a branch, commit, push, and open the pull
> request with Octokit, inside a self-managed temporary working directory with its own secret
> redaction and path-confinement layer.
>
> That is now **superseded**. Backstage already ships
> `publish:github:pull-request` (in `@backstage/plugin-scaffolder-backend-module-github`, already
> installed and registered in `packages/backend/src/index.ts`), which takes files from the scaffolder
> task workspace and creates or updates a branch **and** a pull request through the GitHub API — with
> no clone, and with credentials resolved from `integrations.github`.
>
> The feature is therefore delivered as a **two-step Template**:
>
> 1. **Custom action** `tenant:render-crossplane-manifest` — the domain logic only: validate inputs,
>    read the `crossplaneProvisioning` config, render the XR manifest into the task workspace, and
>    emit the wiring values (repo URL, paths, branch name, titles) as step outputs.
> 2. **Built-in action** `publish:github:pull-request` — branch, commit, and pull request.
>
> Consequences, each reflected in the requirements below:
>
> - **Requirement 2 (clone) is removed.** No code in this feature clones a repository.
> - **Requirement 4 (branch/commit) is delegated**, and the Feature_Branch becomes **deterministic**
>   (`devops/<tenant>-<environment>`, no timestamp) combined with `update: true`, so re-submitting the
>   same tenant/environment updates the one open pull request instead of accumulating a new branch and
>   a new pull request per submission.
> - **Requirement 5 (push/PR) is delegated**, and pull-request idempotency becomes a real property of
>   the flow rather than an unreachable branch of custom code.
> - **Requirement 6 (cleanup) is delegated** to the scaffolder, which already creates one workspace
>   directory per task and removes it when the task ends.
> - **Requirement 7 (secret protection) is strengthened**: the custom action never resolves, receives,
>   or handles a Git_Token at all, so there is no secret in this feature's code path to leak or redact.
> - **Requirements 3, 8, and 9 keep their intent** — rendering, fail-fast validation, and the
>   (disabled) components capability remain the custom action's responsibility.

The custom action is named `tenant:render-crossplane-manifest`, following Backstage's `namespace:verb`
action-id convention and deliberately distinct from the existing `tenant:provision` action so both
flows can be registered and run side by side during the migration from Terragrunt to Crossplane. It is
delivered as the existing backend module
`@internal/backstage-plugin-platform-backend-module-tenant-provisioning-crossplane`, living at
`plugins/platform-backend-module-tenant-provisioning-crossplane/` and registered in
`packages/backend/src/index.ts` next to the existing module.
`templates/tenant-provisioning-crossplane/template.yaml` collects the inputs and composes the two
steps.

The generated manifest targets the `XTenantEnvironment` XR API
(`apiVersion: adp.example.org/v1alpha1`, `kind: XTenantEnvironment`, cluster-scoped). The manifest
models the **Azure-flavored** `XTenantEnvironment`: it pins a `spec.compositionRef.name` to select
the Azure composition, and carries `spec.tenantName`, `spec.environment`, `spec.location` (Azure
region), and `spec.storageAccountSkuName` (Azure Storage SKU). The rendered shape is:

```yaml
apiVersion: adp.example.org/v1alpha1
kind: XTenantEnvironment
metadata:
  name: <tenant>-<environment>
spec:
  compositionRef:
    name: xtenantenvironments.azure.adp.example.org
  tenantName: <tenant>
  environment: <environment>
  location: <location>
  storageAccountSkuName: <storageAccountSkuName>
```

**Components (temporarily disabled, retained for re-enable):** an earlier iteration rendered one
optional `spec.<component>.enabled` block per Allowed_Component (e.g. `table`, `repository`). That
capability is **retained in code, config, and tests but disabled**: the renderer does not emit
component blocks, the Template does not show the components selector, and the action does not surface
the selection in the manifest. It is re-enabled by uncommenting the marked seams (renderer emit loop,
Template `components` parameter and step input). Requirement 9 and the component-related clauses of
Requirement 3 are retained below and marked **DISABLED** for this reason.

**In scope:** the Render_Action's inputs (tenant, environment, and the Azure `location` /
`storageAccountSkuName` selections); reading Crossplane-specific app-config; rendering an
`XTenantEnvironment` manifest from the validated inputs into the task workspace so that it lands at
`tenants/<tenant>/<environment>/xr.yaml` in the live repository; emitting the values the built-in
pull-request action needs; the Template that composes both steps; input validation; and error handling
for validation and rendering failures.

**Out of scope:** any modification to the existing Terragrunt plugin, action, template, or its config
block; hand-rolled git transport, commit, push, or pull-request code (delegated to the built-in
action); a self-managed temporary working directory (delegated to the scaffolder); running
`crossplane`, `kubectl apply`, or any Kubernetes/cluster/cloud execution of the manifest; migrating or
deleting manifests written under the previous `examples/tenantenvironments/<tenant>-<environment>.yaml`
layout; and any destroy/de-provisioning workflow. The pull request is the hard boundary — this feature
performs **no** cluster apply, cost-affecting, or otherwise irreversible operation, and does not do so
in tests or CI.

## Glossary

- **Render_Action**: The custom Backstage scaffolder action, registered with the action id
  `tenant:render-crossplane-manifest`, that validates the inputs, renders the Manifest_File into the
  Workspace, and emits the Pull_Request_Inputs.
- **Pull_Request_Action**: The built-in Backstage scaffolder action `publish:github:pull-request`
  (from `@backstage/plugin-scaffolder-backend-module-github`) that creates or updates the
  Feature_Branch, its commit, and the pull request from files in the Workspace.
- **Crossplane_Module**: The Backstage backend module
  (`@internal/backstage-plugin-platform-backend-module-tenant-provisioning-crossplane`) that
  registers the Render_Action and is added in `packages/backend/src/index.ts`.
- **Scaffolder_Backend**: The Backstage scaffolder backend that executes a Template's steps,
  including the Render_Action and the Pull_Request_Action.
- **Template**: The `tenant-provisioning-crossplane` `scaffolder.backstage.io/v1beta3` Template
  entity whose `spec.steps` invoke the Render_Action and then the Pull_Request_Action.
- **Workspace**: The single directory the Scaffolder_Backend creates for one task execution and
  removes when the task ends, exposed to actions as `ctx.workspacePath`.
- **Source_Directory**: The dedicated subdirectory of the Workspace that the Render_Action writes the
  Manifest_File into, and that the Pull_Request_Action is pointed at via its `sourcePath` input, so
  that only the rendered manifest is committed.
- **Pull_Request_Inputs**: The set of step output values the Render_Action emits for the
  Pull_Request_Action to consume: Scaffolder_Repo_Url, Source_Directory, Target_Directory,
  Feature_Branch, Live_Repo_Base_Branch, pull request title, and commit message.
- **Scaffolder_Repo_Url**: The Crossplane_Live_Repo expressed in the `repoUrl` form the
  Pull_Request_Action accepts — `<host>?owner=<owner>&repo=<repo>` — derived by the Render_Action from
  the configured Crossplane_Live_Repo URL.
- **Target_Directory**: The subdirectory of the Crossplane_Live_Repo the rendered manifest is applied
  to, `tenants/<Tenant_Name>/<Environment>`, passed to the Pull_Request_Action as its `targetPath`
  input.
- **Tenant_Name**: The tenant identifier supplied by the Template parameters, written to the
  manifest `spec.tenantName` field and used as part of the manifest metadata name and the manifest
  file path.
- **Environment**: The deployment environment supplied by the Template parameters, written to the
  manifest `spec.environment` field and used as part of the manifest metadata name and the manifest
  file path. Environment is one of the fixed values `dev`, `staging`, or `prod`.
- **Location**: The Azure region supplied by the Template parameters, written to the manifest
  `spec.location` field (e.g. `japaneast`). Optional on the action input; when absent it defaults to
  the configured `Default_Location`.
- **Storage_Account_Sku_Name**: The Azure Storage account SKU supplied by the Template parameters,
  written to the manifest `spec.storageAccountSkuName` field (e.g. `Standard_LRS`). Optional on the
  action input; when absent it defaults to the configured `Default_Storage_Account_Sku_Name`.
- **Composition_Name**: The Crossplane composition selector written to the manifest
  `spec.compositionRef.name` field, read from the `crossplaneProvisioning.compositionName`
  app-config value; defaults to `xtenantenvironments.azure.adp.example.org`.
- **Default_Location**: The fallback Location, read from the
  `crossplaneProvisioning.defaultLocation` app-config value; defaults to `japaneast`.
- **Default_Storage_Account_Sku_Name**: The fallback Storage_Account_Sku_Name, read from the
  `crossplaneProvisioning.defaultStorageAccountSkuName` app-config value; defaults to
  `Standard_LRS`.
- **Allowed_Components** *(DISABLED — retained for re-enable)*: The configured set of valid optional
  component names the Render_Action recognizes, read from the `crossplaneProvisioning.components`
  app-config list. `table` and `repository` are the Allowed_Components today. The
  component-to-`spec.<component>.enabled` rendering is currently disabled; the config value and
  expansion logic are retained so the capability can be re-enabled.
- **Selected_Components** *(DISABLED — retained for re-enable)*: The array of component names the
  user would select in the Template's multi-select components parameter for a single execution; a
  subset of the Allowed_Components. The selector is currently hidden in the Template.
- **Component_Flag** *(DISABLED — retained for re-enable)*: A single Allowed_Component's boolean
  entry, mapping to the `spec.<component>.enabled` field in the rendered manifest and defaulting to
  `false`. Not emitted while components are disabled.
- **Component_Set** *(DISABLED — retained for re-enable)*: The complete component→boolean mapping the
  Render_Action expands for one execution, formed by expanding the Selected_Components against the
  Allowed_Components so that every Allowed_Component is present with value `true` when it is in
  Selected_Components and `false` otherwise. Computed but not emitted while components are disabled.
- **Crossplane_Live_Repo**: The Git repository holding tenant Crossplane manifests, identified by the
  `CROSSPLANE_LIVE_REPO_URL` configuration value, with layout
  `tenants/<tenant-name>/<environment>/xr.yaml`.
- **Live_Repo_Base_Branch**: The branch of the Crossplane_Live_Repo that the pull request targets,
  identified by the `CROSSPLANE_LIVE_REPO_BRANCH` configuration value.
- **Api_Version**: The `apiVersion` written into the rendered manifest, identified by the
  `crossplaneProvisioning.apiVersion` configuration value; defaults to `adp.example.org/v1alpha1`.
- **Manifest_Kind**: The `kind` written into the rendered manifest, identified by the
  `crossplaneProvisioning.kind` configuration value; defaults to `XTenantEnvironment`.
- **Manifest_File**: The generated `XTenantEnvironment` XR YAML file, written by the Render_Action as
  `xr.yaml` inside the Source_Directory and applied by the Pull_Request_Action to
  `tenants/<Tenant_Name>/<Environment>/xr.yaml` in the Crossplane_Live_Repo.
- **Feature_Branch**: The branch the Pull_Request_Action creates or updates, named
  `devops/<Tenant_Name>-<Environment>`.
- **Git_Token**: The GitHub Personal Access Token (`GITHUB_TOKEN`), resolved from the Backstage
  `integrations.github` configuration **by the Pull_Request_Action**, used to authenticate the
  branch, commit, and pull-request calls. The Render_Action never resolves, receives, or handles it.
- **Secret_Value**: Any sensitive configuration value, specifically the Git_Token and any cloud
  credentials available to the Scaffolder_Backend process.

## Requirements

### Requirement 1: Register the `tenant:render-crossplane-manifest` scaffolder action

**User Story:** As a platform operator, I want a `tenant:render-crossplane-manifest` scaffolder action
registered in the backend without disturbing the existing `tenant:provision` action, so that the
Crossplane provisioning Template can render a tenant manifest as a workflow step while the Terragrunt
flow keeps working.

#### Acceptance Criteria

1. THE Crossplane_Module SHALL register a scaffolder action with the action id `tenant:render-crossplane-manifest`.
2. WHEN the Scaffolder_Backend starts with the Crossplane_Module added in the backend, THE Scaffolder_Backend SHALL make the `tenant:render-crossplane-manifest` action available to Templates while leaving the existing `tenant:provision` action registered and available.
3. THE Render_Action SHALL accept a Tenant_Name input value matching the pattern `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$` (lowercase RFC1123: start/end alphanumeric, 3-22 chars), an Environment input value that is one of `dev`, `staging`, `prod`, an optional Location input value, and an optional Storage_Account_Sku_Name input value.
4. IF the Tenant_Name input value does not match `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$` or the Environment input value is not one of `dev`, `staging`, `prod`, THEN THE Render_Action SHALL fail the step with an error identifying the invalid input, SHALL NOT write any file, and SHALL NOT emit any Pull_Request_Inputs.
5. WHERE the Location input value is absent, THE Render_Action SHALL use the Default_Location; WHERE the Storage_Account_Sku_Name input value is absent, THE Render_Action SHALL use the Default_Storage_Account_Sku_Name.
6. THE Render_Action SHALL read the Crossplane_Live_Repo location from the `CROSSPLANE_LIVE_REPO_URL` configuration value and the Live_Repo_Base_Branch from the `CROSSPLANE_LIVE_REPO_BRANCH` configuration value, and SHALL emit both to the Pull_Request_Action as step outputs, so that neither value appears in the Template.
7. WHERE the `CROSSPLANE_LIVE_REPO_BRANCH` configuration value is not supplied, THE Render_Action SHALL default the Live_Repo_Base_Branch to `main`.
8. IF the `CROSSPLANE_LIVE_REPO_URL` configuration value is absent or empty, THEN THE Render_Action SHALL fail the step with an error identifying the missing configuration, SHALL NOT write any file, and SHALL NOT emit any Pull_Request_Inputs.
9. THE Render_Action SHALL obtain configuration values from environment-backed app-config references rather than from hardcoded literals.
10. THE Render_Action SHALL read the Composition_Name, Default_Location, and Default_Storage_Account_Sku_Name from app-config values rather than from hardcoded literals, defaulting Composition_Name to `xtenantenvironments.azure.adp.example.org`, Default_Location to `japaneast`, and Default_Storage_Account_Sku_Name to `Standard_LRS` when absent.
11. WHERE the `crossplaneProvisioning.apiVersion` or `crossplaneProvisioning.kind` configuration values are not supplied, THE Render_Action SHALL default Api_Version to `adp.example.org/v1alpha1` and Manifest_Kind to `XTenantEnvironment`.
12. *(DISABLED — retained for re-enable)* THE Render_Action SHALL read the Allowed_Components from an app-config list rather than from a hardcoded list of component names. While components are disabled, the value is read but not rendered into the manifest.

### Requirement 2: Delegate repository access to the built-in pull-request action

> **Revised.** The previous version of this requirement specified cloning the Crossplane_Live_Repo
> with a 120-second timeout and classifying network, missing-ref, and authentication clone failures.
> All of that is **removed**: the Pull_Request_Action reaches the Crossplane_Live_Repo through the
> GitHub API and needs no clone, so this feature contains no git transport code. Clauses 2.1-2.6 of
> the previous version are superseded by the clauses below.

**User Story:** As a platform operator, I want repository access handled by Backstage's own
maintained action rather than by bespoke git code in this plugin, so that transport, retries,
authentication, and error reporting are not ours to maintain.

#### Acceptance Criteria

1. THE Crossplane_Module SHALL NOT include git transport, clone, commit, push, or pull-request-API code, and SHALL NOT depend on a git or GitHub client library for these purposes.
2. THE Template SHALL perform all Crossplane_Live_Repo access through the Pull_Request_Action.
3. THE Render_Action SHALL perform no network operation of any kind.
4. WHEN the Pull_Request_Action fails, THE Scaffolder_Backend SHALL surface that action's own error to the task log, and THE Crossplane_Module SHALL NOT wrap, reclassify, or suppress it.

### Requirement 3: Render and write the tenant Crossplane manifest

**User Story:** As a tenant, I want an `XTenantEnvironment` manifest generated from my inputs, so that
my tenant and environment are provisioned without hand-writing Crossplane YAML.

#### Acceptance Criteria

1. THE Render_Action SHALL render a Manifest_File whose `apiVersion` is the Api_Version, whose `kind` is the Manifest_Kind, and whose `metadata.name` is `<Tenant_Name>-<Environment>`. The rendered manifest SHALL NOT include a `metadata.namespace` field (the XR is cluster-scoped).
2. THE Render_Action SHALL set the manifest `spec.compositionRef.name` to the Composition_Name, `spec.tenantName` to the Tenant_Name, `spec.environment` to the Environment, `spec.location` to the resolved Location, and `spec.storageAccountSkuName` to the resolved Storage_Account_Sku_Name.
3. *(DISABLED — retained for re-enable)* THE Render_Action SHALL render one `spec.<component>.enabled` entry for each Component_Flag in the Component_Set, setting each entry's boolean value from the corresponding Component_Flag input value, and SHALL do so without hardcoding a fixed list of component names in the rendering logic. While components are disabled, the renderer SHALL NOT emit any `spec.<component>.enabled` entry.
4. THE Render_Action SHALL write the Manifest_File as `xr.yaml` inside the Source_Directory, and SHALL emit the Target_Directory `tenants/<Tenant_Name>/<Environment>` as a step output, so that the Pull_Request_Action applies the manifest to `tenants/<Tenant_Name>/<Environment>/xr.yaml` in the Crossplane_Live_Repo.
5. IF the Source_Directory does not exist in the Workspace, THEN THE Render_Action SHALL create it before writing the Manifest_File.
6. THE Render_Action SHALL write the Manifest_File such that the Pull_Request_Action's commit replaces the content of any pre-existing `tenants/<Tenant_Name>/<Environment>/xr.yaml` in the Crossplane_Live_Repo.
7. IF the computed path for the Source_Directory or the Manifest_File resolves to a location outside the Workspace, THEN THE Render_Action SHALL fail the step with an error indicating the path is outside the Workspace and SHALL NOT create or modify any file.
8. IF creating the Source_Directory or writing the Manifest_File fails, THEN THE Render_Action SHALL fail the step with an error indicating the file could not be written and SHALL NOT emit any Pull_Request_Inputs.
9. THE Render_Action SHALL render valid YAML whose parsed structure is stable and byte-for-byte identical for the same inputs.
10. THE Render_Action SHALL write no file into the Workspace other than the Manifest_File inside the Source_Directory, so that the Pull_Request_Action commits exactly one file.

### Requirement 4: Deliver the change on a deterministic feature branch

> **Revised.** The previous version required the Render_Action itself to create a branch named
> `devops/<tenant>-<env>-<yyyymmdd-hhmmss>` and commit to it, and to fail if that branch already
> existed. Branch creation and committing are now the Pull_Request_Action's job, and the timestamp is
> **dropped**: a timestamped branch produced a new branch and a new pull request on every submission
> for the same tenant and environment, which made the "reuse the open pull request" behaviour of
> Requirement 5 unreachable. Clauses 4.1-4.4 of the previous version are superseded by the clauses
> below.

**User Story:** As a platform operator, I want one branch and one open pull request per tenant and
environment, so that re-submitting a tenant's configuration updates the pending change instead of
accumulating duplicate pull requests.

#### Acceptance Criteria

1. THE Render_Action SHALL emit the Feature_Branch name `devops/<Tenant_Name>-<Environment>` as a step output, derived only from the validated Tenant_Name and Environment so that the same tenant and environment always produce the same branch name.
2. THE Template SHALL pass the emitted Feature_Branch name to the Pull_Request_Action as its `branchName` input and the emitted Live_Repo_Base_Branch as its `targetBranchName` input, so that the pull request is opened against the configured base branch without modifying that base branch.
3. THE Render_Action SHALL emit a commit message that includes both the Tenant_Name and the Environment being provisioned, and THE Template SHALL pass it to the Pull_Request_Action as its `commitMessage` input.
4. THE Template SHALL point the Pull_Request_Action at the Source_Directory via its `sourcePath` input and at the Target_Directory via its `targetPath` input, so that the commit contains exactly the rendered Manifest_File at `tenants/<Tenant_Name>/<Environment>/xr.yaml` and no other file.

### Requirement 5: Open or update the pull request

> **Revised.** Push and pull-request creation, their 60-second timeouts, the duplicate-pull-request
> lookup, and the "report the pushed branch on failure" behaviour were previously implemented in this
> plugin. They are now the Pull_Request_Action's responsibility. Clauses 5.1-5.3 and 5.6-5.8 of the
> previous version are superseded by the clauses below; the hard boundary (previous clause 5.5) is
> retained unchanged as clause 5.5.

**User Story:** As a platform operator, I want the provisioning change delivered as a pull request,
so that a human reviews it before any infrastructure is applied.

#### Acceptance Criteria

1. THE Template SHALL invoke the Pull_Request_Action after the Render_Action, passing the Pull_Request_Inputs emitted by the Render_Action.
2. THE Template SHALL set the Pull_Request_Action's `update` input to `true`, so that WHEN an open pull request already exists for the Feature_Branch, the existing pull request and its branch are updated instead of a duplicate pull request being created.
3. THE Render_Action SHALL emit a pull request title that identifies the Tenant_Name and Environment being provisioned, and THE Template SHALL pass it to the Pull_Request_Action as its `title` input.
4. WHEN the Pull_Request_Action completes, THE Template SHALL expose the pull request URL from that action's `remoteUrl` output and the Feature_Branch name from the Render_Action's output as Template output values.
5. THE Template SHALL stop after the pull request is created or updated and SHALL NOT run `crossplane`, `kubectl apply`, any other cluster command, or any Kubernetes or cloud execution against the tenant configuration.
6. THE Crossplane_Module SHALL NOT implement pull-request lookup, creation, or update logic of its own.

### Requirement 6: Leave no temporary files behind

> **Revised.** The previous version required the action to create its own uniquely named temporary
> Working_Directory (under the configured scaffolder working directory or the OS temporary directory)
> and to delete it on both success and failure, reporting a residual path if deletion was incomplete.
> The Scaffolder_Backend already creates exactly one directory per task and removes it when the task
> ends, so that layer is removed as duplication. Clauses 6.1-6.5 of the previous version are
> superseded by the clauses below.

**User Story:** As a platform operator, I want the workflow to leave no temporary files behind, so
that the backend host does not accumulate stale files or leak tenant data between executions.

#### Acceptance Criteria

1. THE Render_Action SHALL write only inside the Workspace provided by the Scaffolder_Backend and SHALL NOT create any directory outside it.
2. THE Crossplane_Module SHALL NOT implement its own temporary-directory creation or cleanup, relying on the Scaffolder_Backend's per-task Workspace lifecycle instead.
3. THE Render_Action SHALL confine every path it resolves to a descendant of the Workspace.

### Requirement 7: Protect sensitive configuration

> **Revised and strengthened.** The previous version required the action to resolve the Git_Token,
> keep it out of logs and committed files, and replace it with a redaction placeholder in any surfaced
> message. Because the Render_Action no longer performs any authenticated operation, the stronger
> guarantee below replaces redaction: the token never enters this feature's code path.

**User Story:** As a platform operator, I want credentials kept out of logs and committed files, so
that tenant provisioning does not leak secrets.

#### Acceptance Criteria

1. THE Render_Action SHALL NOT resolve, read, accept as input, or otherwise handle the Git_Token or any other Secret_Value.
2. THE Crossplane_Module SHALL leave resolution of the Git_Token entirely to the Pull_Request_Action and the Backstage `integrations.github` configuration.
3. THE Render_Action SHALL exclude every Secret_Value from the Manifest_File, so that no Secret_Value can be committed to the Crossplane_Live_Repo.
4. THE Render_Action SHALL restrict the paths it writes for a single execution to the Source_Directory within that execution's Workspace, so that one execution's file operations cannot read or write another execution's files.
5. IF a path resolved during an execution falls outside that execution's Workspace, THEN THE Render_Action SHALL abort before performing any file read or write at that path and SHALL return an error indicating the path violated workspace confinement.

### Requirement 8: Validate inputs before performing side effects

**User Story:** As a platform operator, I want invalid inputs rejected before any file is written or
any pull request is opened, so that the workflow fails fast.

#### Acceptance Criteria

1. IF the Tenant_Name input value or the Environment input value is absent, null, or an empty string, THEN THE Render_Action SHALL fail the step with a validation error that identifies the offending input and SHALL NOT write any file.
2. IF the Tenant_Name input value does not match the pattern `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$` (lowercase alphanumeric with interior hyphens, 3-22 chars, matching the XTenantEnvironment XRD), THEN THE Render_Action SHALL fail the step with a validation error that identifies the Tenant_Name as invalid and SHALL NOT write any file.
3. IF the Environment input value is not exactly one of the values `dev`, `staging`, or `prod`, THEN THE Render_Action SHALL fail the step with a validation error that identifies the Environment as invalid and SHALL NOT write any file.
4. WHEN the Render_Action fails validation, THE Render_Action SHALL emit no Pull_Request_Inputs, so that the Scaffolder_Backend skips the Pull_Request_Action and the Crossplane_Live_Repo is left unchanged with no Feature_Branch, no commit, and no pull request.

### Requirement 9: Support an extensible set of components *(DISABLED — retained for re-enable)*

> **Status: DISABLED.** Component rendering is currently turned off. The expansion logic
> (`expandComponents`), the `crossplaneProvisioning.components` config value, and the acceptance
> criteria below are **retained unchanged** so the capability can be re-enabled by uncommenting the
> renderer emit loop and the Template `components` parameter/step input. While disabled, the renderer
> emits no `spec.<component>.enabled` entries and the Template hides the components selector.

**User Story:** As a platform operator, I want the provisioning action to handle new optional
components without code changes to its core logic, so that additional `spec.<component>.enabled`
fields can be introduced as the Crossplane API grows.

#### Acceptance Criteria

1. THE Render_Action SHALL determine the Component_Set by expanding the Selected_Components against the Allowed_Components, including every Allowed_Component with value `true` when it is a member of the Selected_Components and `false` otherwise.
2. THE Render_Action SHALL render one `spec.<component>.enabled` entry for each Allowed_Component, using the same rendering logic for every component with no component-name-specific branching.
3. THE Render_Action SHALL name each rendered field `spec.<component>.enabled`, where `<component>` is the component name.
4. THE Render_Action SHALL render the component entries ordered by component name in ascending lexicographic byte order, so that the same Allowed_Components and Selected_Components always produce byte-for-byte identical Manifest_File content.
5. WHERE the Allowed_Components is extended with a new component name in configuration, THE Render_Action SHALL render that component's `spec.<component>.enabled` entry without any change to the Render_Action's rendering logic.
6. IF a name in the Selected_Components is not a member of the Allowed_Components, THEN THE Render_Action SHALL fail the step with an error identifying the unrecognized component and SHALL NOT render or write any Manifest_File content.
7. IF any Allowed_Component name does not match the pattern `^[a-z0-9_]+$`, THEN THE Render_Action SHALL fail the step with an error identifying the invalid component name and SHALL NOT render or write any Manifest_File content.
8. WHERE the Selected_Components is empty, THE Render_Action SHALL render one `spec.<component>.enabled` entry set to `false` for every Allowed_Component.
9. WHERE the Allowed_Components is empty, THE Render_Action SHALL render the manifest with no `spec.<component>.enabled` entries.
