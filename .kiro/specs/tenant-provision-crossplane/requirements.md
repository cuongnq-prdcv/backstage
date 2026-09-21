# Requirements Document

## Introduction

This feature adds a **second, Crossplane-based tenant-provisioning backend behavior** alongside the
existing Terragrunt one, without modifying the existing Terragrunt plugin. Where the current
`tenant:provision` action renders a `terragrunt.hcl` and opens a pull request against the Terragrunt
"live" repository, this feature adds a new custom Backstage scaffolder action that renders a
Crossplane `XTenantEnvironment` composite-resource (XR) manifest (YAML) and opens a pull request
against a separate Crossplane "live" repository.

The action is named `tenant:provision-crossplane`, following Backstage's `namespace:verb` action-id
convention and deliberately distinct from the existing `tenant:provision` action so both can be
registered and run side by side during the migration from Terragrunt to Crossplane. It is delivered
as a **new** backend module,
`@internal/backstage-plugin-platform-backend-module-tenant-provisioning-crossplane`, living at
`plugins/platform-backend-module-tenant-provisioning-crossplane/` and registered in
`packages/backend/src/index.ts` next to the existing module. A new
`templates/tenant-provisioning-crossplane/template.yaml` Template collects the inputs and invokes the
action.

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

**Components (temporarily disabled, retained for re-enable):** the earlier iteration rendered one
optional `spec.<component>.enabled` block per Allowed_Component (e.g. `table`, `repository`). That
capability is **retained in code, config, and tests but disabled**: the renderer does not emit
component blocks, the Template does not show the components selector, and the action does not surface
the selection in the manifest. It is re-enabled by uncommenting the marked seams (renderer emit loop,
Template `components` parameter and step input). Requirement 9 and the component-related clauses of
Requirement 3 are retained below and marked **DISABLED** for this reason.

**In scope:** the `tenant:provision-crossplane` action's inputs (tenant, environment, and the Azure
`location` / `storageAccountSkuName` selections); reading Crossplane-specific app-config; cloning the
Crossplane live repo at the configured ref; rendering an `XTenantEnvironment` manifest from the
validated inputs; writing it at `tenants/<tenant>/<environment>/xr.yaml`; timestamped branch
creation, commit, push, and pull-request creation (reusing an already-open PR); temporary-file
cleanup including on failure; secret handling; input validation; and error handling for
validation/git/network failures. A new Template and the app-config block for this action are also in
scope.

**Out of scope:** any modification to the existing Terragrunt plugin, action, template, or its config
block; a shared/common package extracted from the Terragrunt plugin (the GitOps helpers are copied
into the new plugin instead); running `crossplane`, `kubectl apply`, or any Kubernetes/cluster/cloud
execution of the manifest; migrating or deleting manifests written under the previous
`examples/tenantenvironments/<tenant>-<environment>.yaml` layout; and any destroy/de-provisioning
workflow. The pull request is the hard boundary — this feature performs **no** cluster apply,
cost-affecting, or otherwise irreversible operation, and does not do so in tests or CI.

## Glossary

- **Crossplane_Action**: The custom Backstage scaffolder action, registered with the action id
  `tenant:provision-crossplane`, that performs the provisioning workflow described by this document.
- **Crossplane_Module**: The new Backstage backend module
  (`@internal/backstage-plugin-platform-backend-module-tenant-provisioning-crossplane`) that
  registers the Crossplane_Action and is added in `packages/backend/src/index.ts`.
- **Scaffolder_Backend**: The Backstage scaffolder backend that executes a Template's steps,
  including the Crossplane_Action.
- **Template**: The `tenant-provisioning-crossplane` `scaffolder.backstage.io/v1beta3` Template
  entity whose `spec.steps` invoke the Crossplane_Action.
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
  component names the Crossplane_Action recognizes, read from the
  `crossplaneProvisioning.components` app-config list. `table` and `repository` are the
  Allowed_Components today. The component-to-`spec.<component>.enabled` rendering is currently
  disabled; the config value and expansion logic are retained so the capability can be re-enabled.
- **Selected_Components** *(DISABLED — retained for re-enable)*: The array of component names the
  user would select in the Template's multi-select components parameter for a single execution; a
  subset of the Allowed_Components. The selector is currently hidden in the Template.
- **Component_Flag** *(DISABLED — retained for re-enable)*: A single Allowed_Component's boolean
  entry, mapping to the `spec.<component>.enabled` field in the rendered manifest and defaulting to
  `false`. Not emitted while components are disabled.
- **Component_Set** *(DISABLED — retained for re-enable)*: The complete component→boolean mapping the
  Crossplane_Action expands for one execution, formed by expanding the Selected_Components against
  the Allowed_Components so that every Allowed_Component is present with value `true` when it is in
  Selected_Components and `false` otherwise. Computed but not emitted while components are disabled.
- **Crossplane_Live_Repo**: The Git repository holding tenant Crossplane manifests, identified by the
  `CROSSPLANE_LIVE_REPO_URL` configuration value, with layout
  `tenants/<tenant-name>/<environment>/xr.yaml`.
- **Live_Repo_Base_Branch**: The branch of the Crossplane_Live_Repo that the Crossplane_Action clones
  from and opens the pull request against, identified by the `CROSSPLANE_LIVE_REPO_BRANCH`
  configuration value.
- **Api_Version**: The `apiVersion` written into the rendered manifest, identified by the
  `crossplaneProvisioning.apiVersion` configuration value; defaults to `adp.example.org/v1alpha1`.
- **Manifest_Kind**: The `kind` written into the rendered manifest, identified by the
  `crossplaneProvisioning.kind` configuration value; defaults to `XTenantEnvironment`.
- **Manifest_File**: The generated `XTenantEnvironment` XR YAML file at
  `tenants/<Tenant_Name>/<Environment>/xr.yaml` within a checkout of the Crossplane_Live_Repo.
- **Feature_Branch**: The new branch created by the Crossplane_Action, named
  `devops/<Tenant_Name>-<Environment>-<yyyymmdd-hhmmss>`.
- **Working_Directory**: The temporary directory into which the Crossplane_Action clones the
  Crossplane_Live_Repo and performs all file operations for a single execution.
- **Git_Token**: The GitHub Personal Access Token (`GITHUB_TOKEN`), resolved through the Backstage
  `integrations.github` configuration by the Crossplane_Live_Repo host, used to authenticate clone,
  push, and pull-request operations against the Crossplane_Live_Repo.
- **Secret_Value**: Any sensitive configuration value, specifically the Git_Token and any cloud
  credentials available to the Scaffolder_Backend process.

## Requirements

### Requirement 1: Register the `tenant:provision-crossplane` scaffolder action

**User Story:** As a platform operator, I want a `tenant:provision-crossplane` scaffolder action
registered in the backend without disturbing the existing `tenant:provision` action, so that the
Crossplane provisioning Template can invoke provisioning as a workflow step while the Terragrunt flow
keeps working.

#### Acceptance Criteria

1. THE Crossplane_Module SHALL register a scaffolder action with the action id `tenant:provision-crossplane`.
2. WHEN the Scaffolder_Backend starts with the Crossplane_Module added in the backend, THE Scaffolder_Backend SHALL make the `tenant:provision-crossplane` action available to Templates while leaving the existing `tenant:provision` action registered and available.
3. THE Crossplane_Action SHALL accept a Tenant_Name input value matching the pattern `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$` (lowercase RFC1123: start/end alphanumeric, 3-22 chars), an Environment input value that is one of `dev`, `staging`, `prod`, an optional Location input value, and an optional Storage_Account_Sku_Name input value.
4. IF the Tenant_Name input value does not match `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$` or the Environment input value is not one of `dev`, `staging`, `prod`, THEN THE Crossplane_Action SHALL fail the step with an error identifying the invalid input, SHALL NOT clone the Crossplane_Live_Repo, and SHALL leave the Crossplane_Live_Repo unchanged.
5. WHERE the Location input value is absent, THE Crossplane_Action SHALL use the Default_Location; WHERE the Storage_Account_Sku_Name input value is absent, THE Crossplane_Action SHALL use the Default_Storage_Account_Sku_Name.
6. THE Crossplane_Action SHALL read the Crossplane_Live_Repo location from the `CROSSPLANE_LIVE_REPO_URL` configuration value and the Live_Repo_Base_Branch from the `CROSSPLANE_LIVE_REPO_BRANCH` configuration value.
7. WHERE the `CROSSPLANE_LIVE_REPO_BRANCH` configuration value is not supplied, THE Crossplane_Action SHALL default the Live_Repo_Base_Branch to `main`.
8. IF the `CROSSPLANE_LIVE_REPO_URL` configuration value is absent or empty, THEN THE Crossplane_Action SHALL fail the step with an error identifying the missing configuration, SHALL NOT clone the Crossplane_Live_Repo, and SHALL leave the Crossplane_Live_Repo unchanged.
9. THE Crossplane_Action SHALL obtain configuration values from environment-backed app-config references rather than from hardcoded literals.
10. THE Crossplane_Action SHALL read the Composition_Name, Default_Location, and Default_Storage_Account_Sku_Name from app-config values rather than from hardcoded literals, defaulting Composition_Name to `xtenantenvironments.azure.adp.example.org`, Default_Location to `japaneast`, and Default_Storage_Account_Sku_Name to `Standard_LRS` when absent.
11. WHERE the `crossplaneProvisioning.apiVersion` or `crossplaneProvisioning.kind` configuration values are not supplied, THE Crossplane_Action SHALL default Api_Version to `adp.example.org/v1alpha1` and Manifest_Kind to `XTenantEnvironment`.
12. *(DISABLED — retained for re-enable)* THE Crossplane_Action SHALL read the Allowed_Components from an app-config list rather than from a hardcoded list of component names. While components are disabled, the value is read but not rendered into the manifest.

### Requirement 2: Clone the Crossplane live repository

**User Story:** As a tenant, I want the provisioning workflow to start from the current live
Crossplane configuration, so that my change is applied on top of the latest committed state.

#### Acceptance Criteria

1. WHEN the Crossplane_Action executes, THE Crossplane_Action SHALL clone the Crossplane_Live_Repo identified by `CROSSPLANE_LIVE_REPO_URL` at the Live_Repo_Base_Branch identified by `CROSSPLANE_LIVE_REPO_BRANCH` into a Working_Directory, leaving the Working_Directory checked out on the Live_Repo_Base_Branch.
2. THE Crossplane_Action SHALL create the Working_Directory as a temporary directory dedicated to the current execution.
3. IF the clone fails because the Crossplane_Live_Repo cannot be reached over the network, THEN THE Crossplane_Action SHALL fail the step with an error indicating the repository could not be reached.
4. IF the clone fails because the ref identified by `CROSSPLANE_LIVE_REPO_BRANCH` does not exist in the Crossplane_Live_Repo, THEN THE Crossplane_Action SHALL fail the step with an error identifying the missing ref.
5. IF the clone fails because authentication with the Git_Token is rejected, THEN THE Crossplane_Action SHALL fail the step with an authentication error that excludes the Secret_Value.
6. IF the clone does not complete within 120 seconds, THEN THE Crossplane_Action SHALL abort the clone and fail the step with an error indicating the clone timed out.

### Requirement 3: Render and write the tenant Crossplane manifest

**User Story:** As a tenant, I want a `TenantEnvironment` manifest generated from my inputs, so that
my tenant and environment are provisioned without hand-writing Crossplane YAML.

#### Acceptance Criteria

1. THE Crossplane_Action SHALL render a Manifest_File whose `apiVersion` is the Api_Version, whose `kind` is the Manifest_Kind, and whose `metadata.name` is `<Tenant_Name>-<Environment>`. The rendered manifest SHALL NOT include a `metadata.namespace` field (the XR is cluster-scoped).
2. THE Crossplane_Action SHALL set the manifest `spec.compositionRef.name` to the Composition_Name, `spec.tenantName` to the Tenant_Name, `spec.environment` to the Environment, `spec.location` to the resolved Location, and `spec.storageAccountSkuName` to the resolved Storage_Account_Sku_Name.
3. *(DISABLED — retained for re-enable)* THE Crossplane_Action SHALL render one `spec.<component>.enabled` entry for each Component_Flag in the Component_Set, setting each entry's boolean value from the corresponding Component_Flag input value, and SHALL do so without hardcoding a fixed list of component names in the rendering logic. While components are disabled, the renderer SHALL NOT emit any `spec.<component>.enabled` entry.
4. THE Crossplane_Action SHALL write the Manifest_File to the path `tenants/<Tenant_Name>/<Environment>/xr.yaml`, where `<Tenant_Name>` and `<Environment>` are the validated Tenant_Name and Environment input values, relative to the root of the Working_Directory.
5. IF the target folder or Manifest_File does not exist in the Working_Directory, THEN THE Crossplane_Action SHALL create the folder path and the Manifest_File.
6. IF the target Manifest_File already exists in the Working_Directory, THEN THE Crossplane_Action SHALL overwrite the Manifest_File with the rendered content.
7. IF the computed path for the target folder or Manifest_File resolves to a location outside the Working_Directory, THEN THE Crossplane_Action SHALL fail the step with an error indicating the path is outside the Working_Directory and SHALL NOT create or modify any file.
8. IF creating the folder path or writing the Manifest_File fails, THEN THE Crossplane_Action SHALL fail the step with an error indicating the file could not be written and SHALL leave any pre-existing Manifest_File content unchanged.
9. THE Crossplane_Action SHALL render valid YAML whose parsed structure is stable and byte-for-byte identical for the same inputs.

### Requirement 4: Create a timestamped feature branch

**User Story:** As a platform operator, I want each provisioning change on its own branch, so that
concurrent tenant changes do not collide and each change maps to one pull request.

#### Acceptance Criteria

1. WHEN the Crossplane_Action has written the Manifest_File, THE Crossplane_Action SHALL create a Feature_Branch in the Working_Directory checkout, based on the Live_Repo_Base_Branch, without modifying the Live_Repo_Base_Branch.
2. THE Crossplane_Action SHALL name the Feature_Branch `devops/<Tenant_Name>-<Environment>-<yyyymmdd-hhmmss>`, where `<yyyymmdd-hhmmss>` is the execution start time expressed in Coordinated Universal Time (UTC) as a four-digit year, followed by two-digit zero-padded month (01-12), two-digit zero-padded day (01-31), a hyphen, then two-digit zero-padded hour (00-23), two-digit zero-padded minute (00-59), and two-digit zero-padded second (00-59), so that repeated provisions of the same Tenant_Name and Environment each produce a distinct Feature_Branch and pull request.
3. THE Crossplane_Action SHALL commit onto the Feature_Branch exactly the added or updated Manifest_File and any parent folders it created for that file, and no other files, with a commit message that includes both the Tenant_Name and the Environment being provisioned.
4. IF a branch named identically to the computed Feature_Branch name already exists in the Working_Directory checkout or the Crossplane_Live_Repo, THEN THE Crossplane_Action SHALL fail the step with an error indicating the branch name already exists and SHALL NOT create a commit or a pull request.

### Requirement 5: Push the branch and open a pull request

**User Story:** As a platform operator, I want the provisioning change delivered as a pull request,
so that a human reviews it before any infrastructure is applied.

#### Acceptance Criteria

1. WHEN the commit has been created, THE Crossplane_Action SHALL push the Feature_Branch to the Crossplane_Live_Repo.
2. WHEN the Feature_Branch has been pushed, THE Crossplane_Action SHALL open a pull request in the Crossplane_Live_Repo from the Feature_Branch targeting the Live_Repo_Base_Branch.
3. THE Crossplane_Action SHALL set a pull request title that identifies the Tenant_Name and Environment being provisioned.
4. WHEN the pull request has been created, THE Crossplane_Action SHALL expose both the pull request URL and the Feature_Branch name as step output values.
5. THE Crossplane_Action SHALL stop after the pull request is created and SHALL NOT run `crossplane`, `kubectl apply`, any other cluster command, or any Kubernetes or cloud execution against the tenant configuration.
6. IF an open pull request from the Feature_Branch targeting the Live_Repo_Base_Branch already exists, THEN THE Crossplane_Action SHALL NOT create a duplicate pull request and SHALL expose the existing pull request URL as a step output value.
7. IF the push does not succeed within 60 seconds or is rejected by the Crossplane_Live_Repo, THEN THE Crossplane_Action SHALL fail the step with an error describing the failed push and SHALL NOT attempt to create a pull request.
8. IF the pull request cannot be created within 60 seconds after a successful push, THEN THE Crossplane_Action SHALL fail the step with an error describing the pull-request failure and SHALL report the pushed Feature_Branch name.

### Requirement 6: Clean up temporary files

**User Story:** As a platform operator, I want the workflow to leave no temporary files behind, so
that the backend host does not accumulate clones or leak tenant data between executions.

#### Acceptance Criteria

1. WHEN the Crossplane_Action completes successfully, THE Crossplane_Action SHALL delete the Working_Directory and all files and subdirectories created within it during that execution before the action returns.
2. IF the Crossplane_Action fails after the Working_Directory has been created, THEN THE Crossplane_Action SHALL delete the Working_Directory and all files and subdirectories created within it before the action returns the failure.
3. IF the Crossplane_Action attempts to delete the Working_Directory and the deletion does not fully remove it, THEN THE Crossplane_Action SHALL return an error indicating that cleanup did not complete and identifying the path that could not be removed, without exposing tenant secrets or credentials.
4. WHERE the Scaffolder_Backend is configured with a scaffolder working directory, THE Crossplane_Action SHALL create the Working_Directory as a uniquely named subdirectory under that configured directory, distinct from any other concurrent execution's Working_Directory.
5. WHERE the Scaffolder_Backend is not configured with a scaffolder working directory, THE Crossplane_Action SHALL create the Working_Directory as a uniquely named subdirectory under the operating system temporary directory, distinct from any other concurrent execution's Working_Directory.

### Requirement 7: Protect sensitive configuration

**User Story:** As a platform operator, I want credentials kept out of logs and committed files, so
that tenant provisioning does not leak secrets.

#### Acceptance Criteria

1. THE Crossplane_Action SHALL exclude every Secret_Value from its log output at all log levels, including debug-level output.
2. THE Crossplane_Action SHALL exclude every Secret_Value from the Manifest_File and from any other file committed to the Crossplane_Live_Repo.
3. IF an error message, stack trace, or exception detail would otherwise contain a Secret_Value, THEN THE Crossplane_Action SHALL replace each Secret_Value with a fixed non-reversible redaction placeholder before the message is logged or returned to the caller, and SHALL preserve the remaining non-secret content of the message.
4. THE Crossplane_Action SHALL restrict all Working_Directory paths for a single execution to a path composed of that execution's Tenant_Name and Environment, so that one execution's file operations cannot read or write another tenant's Working_Directory.
5. IF a Working_Directory path resolved during an execution falls outside that execution's Tenant_Name and Environment path, THEN THE Crossplane_Action SHALL abort the execution before performing any file read or write at that path and SHALL return an error indicating the path violated tenant isolation.
6. WHEN the Crossplane_Action terminates, whether by success or failure, THE Crossplane_Action SHALL remove every file it created that contains a Secret_Value from the local filesystem.

### Requirement 8: Validate inputs before performing side effects

**User Story:** As a platform operator, I want invalid inputs rejected before any repository change,
so that the workflow fails fast without creating branches, commits, or pull requests.

#### Acceptance Criteria

1. IF the Tenant_Name input value or the Environment input value is absent, null, or an empty string, THEN THE Crossplane_Action SHALL fail the step with a validation error that identifies the offending input, SHALL NOT create a Working_Directory, and SHALL NOT clone the Crossplane_Live_Repo.
2. IF the Tenant_Name input value does not match the pattern `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$` (lowercase alphanumeric with interior hyphens, 3-22 chars, matching the TenantEnvironment XRD), THEN THE Crossplane_Action SHALL fail the step with a validation error that identifies the Tenant_Name as invalid and SHALL NOT clone the Crossplane_Live_Repo.
3. IF the Environment input value is not exactly one of the values `dev`, `staging`, or `prod`, THEN THE Crossplane_Action SHALL fail the step with a validation error that identifies the Environment as invalid and SHALL NOT clone the Crossplane_Live_Repo.
4. WHEN the Crossplane_Action fails validation, THE Crossplane_Action SHALL leave the Crossplane_Live_Repo unchanged, creating no Working_Directory, no Feature_Branch, no commit, and no pull request.

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

1. THE Crossplane_Action SHALL determine the Component_Set by expanding the Selected_Components against the Allowed_Components, including every Allowed_Component with value `true` when it is a member of the Selected_Components and `false` otherwise.
2. THE Crossplane_Action SHALL render one `spec.<component>.enabled` entry for each Allowed_Component, using the same rendering logic for every component with no component-name-specific branching.
3. THE Crossplane_Action SHALL name each rendered field `spec.<component>.enabled`, where `<component>` is the component name.
4. THE Crossplane_Action SHALL render the component entries ordered by component name in ascending lexicographic byte order, so that the same Allowed_Components and Selected_Components always produce byte-for-byte identical Manifest_File content.
5. WHERE the Allowed_Components is extended with a new component name in configuration, THE Crossplane_Action SHALL render that component's `spec.<component>.enabled` entry without any change to the Crossplane_Action's rendering logic.
6. IF a name in the Selected_Components is not a member of the Allowed_Components, THEN THE Crossplane_Action SHALL fail the step with an error identifying the unrecognized component and SHALL NOT render or write any Manifest_File content.
7. IF any Allowed_Component name does not match the pattern `^[a-z0-9_]+$`, THEN THE Crossplane_Action SHALL fail the step with an error identifying the invalid component name and SHALL NOT render or write any Manifest_File content.
8. WHERE the Selected_Components is empty, THE Crossplane_Action SHALL render one `spec.<component>.enabled` entry set to `false` for every Allowed_Component.
9. WHERE the Allowed_Components is empty, THE Crossplane_Action SHALL render the manifest with `spec.tenant` and `spec.environment` only and no `spec.<component>.enabled` entries.
