# Hello Terragrunt Backstage

A [Backstage](https://backstage.io) application that lets tenants self-service provision and
update their cloud infrastructure through Software Templates. A tenant picks a template, fills in
a form (tenant ID, which components to provision, sizing, etc.), and the scaffolder drives
[Terragrunt](https://terragrunt.gruntwork.io/)/[Terraform](https://www.terraform.io/) against
that tenant's folder in the
[`hello-terragrunt-live`](https://github.com/hoangviet1vu/hello-terragrunt-live) repository to
apply the change.

> For guidance on how to work in this codebase (as a human contributor or an AI coding agent),
> see [AGENTS.md](./AGENTS.md).

## How it works

```
Tenant --> Backstage UI --> Software Template --> Scaffolder action(s)
                                                        |
                                                        v
                                   git clone/checkout hello-terragrunt-live
                                   (tenant-specific folder, e.g. tenants/<tenant-id>/)
                                                        |
                                                        v
                                       terragrunt <plan|apply> (Terraform under the hood)
                                                        |
                                                        v
                                        AWS infrastructure provisioned/updated
```

1. The tenant opens a **Template** in the Backstage catalog (Create... page).
2. The template form collects the inputs needed to provision infra (tenant ID, region,
   components to enable, sizing, etc.).
3. The scaffolder backend runs the template's steps, which check out (or update) the tenant's
   folder in `hello-terragrunt-live`, render/update the `terragrunt.hcl` configuration for that
   tenant, and invoke the Terragrunt CLI.
4. Terragrunt wraps Terraform to plan/apply the infrastructure changes against AWS, using the
   backend's configured AWS credentials.
5. Results (and links to the generated PR/commit in `hello-terragrunt-live`) are reported back to
   the tenant in the Backstage UI.

## Tech stack

- **Framework:** [Backstage](https://backstage.io) (Node.js + TypeScript monorepo, Yarn workspaces)
- **Frontend:** `packages/app` (React, via `@backstage/cli`)
- **Backend:** `packages/backend` (new-style Backstage backend, `@backstage/backend-defaults`)
- **Infra tooling:** Terraform, Terragrunt, AWS SDK, invoked from scaffolder actions
- **Source of truth for infra:** [`hello-terragrunt-live`](https://github.com/hoangviet1vu/hello-terragrunt-live)
  (per-tenant `terragrunt.hcl` files), accessed over Git using a GitHub PAT
- **Database:**
  - Local development: SQLite (`better-sqlite3`, in-memory)
  - Production: PostgreSQL

## Repository structure

```
.
├── app-config.yaml              # Base Backstage config (local dev defaults, SQLite)
├── app-config.production.yaml   # Production overrides (Postgres, prod backend/base URLs)
├── catalog-info.yaml            # This app's own catalog entity
├── templates/                   # Example catalog entities, org data, and a starter template
├── packages/
│   ├── app/                     # Frontend (Backstage app)
│   └── backend/                 # Backend (plugins wired up in src/index.ts)
├── plugins/                     # Custom plugins/modules (e.g. Terragrunt scaffolder actions) live here
└── AGENTS.md                    # Guidance for contributors / coding agents
```

## Prerequisites

- Node.js 22 or 24, and Yarn (see `packageManager` in [package.json](./package.json))
- [Terraform](https://developer.hashicorp.com/terraform/install) and
  [Terragrunt](https://terragrunt.gruntwork.io/docs/getting-started/install/) CLIs on the machine
  running the backend (whatever executes scaffolder actions)
- AWS credentials with permissions to manage the provisioned resources
- Git, and a GitHub [Personal Access Token](https://backstage.io/docs/integrations/github/locations#configuration)
  with access to `hello-terragrunt-live`
- PostgreSQL for production use (SQLite is used automatically for local development)

## Environment variables

| Variable                          | Purpose                                              | Used in                       |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `GITHUB_TOKEN`                    | PAT for reading/writing `hello-terragrunt-live` and other GitHub integrations | `app-config.yaml` |
| `GITHUB_CLIENT_ID`                | Identifies the GitHub OAuth App used for GitHub sign-in | `app-config.yaml`, `app-config.production.yaml` |
| `GITHUB_CLIENT_SECRET`            | Authenticates the GitHub OAuth App used for GitHub sign-in | `app-config.yaml`, `app-config.production.yaml` |
| `AZURE_CLIENT_ID`                 | Identifies the Azure Entra ID App Registration used for Microsoft sign-in | `app-config.yaml`, `app-config.production.yaml` |
| `AZURE_CLIENT_SECRET`             | Authenticates the Azure Entra ID App Registration used for Microsoft sign-in | `app-config.yaml`, `app-config.production.yaml` |
| `AZURE_TENANT_ID`                 | Scopes Microsoft sign-in to a single Azure Entra ID tenant | `app-config.yaml`, `app-config.production.yaml` |
| `POSTGRES_HOST` / `POSTGRES_PORT` | Production database connection                        | `app-config.production.yaml` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Production database credentials                    | `app-config.production.yaml` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or role-based credentials) | AWS credentials used by the AWS SDK and by Terraform/Terragrunt when applying infra | Terragrunt/Terraform steps |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Default AWS region for provisioning                  | Terragrunt/Terraform steps    |

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are both obtained from a GitHub OAuth App
(GitHub → Settings → Developer settings → OAuth Apps).

`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID` are obtained from an Azure Entra ID
App Registration (Azure Portal → Microsoft Entra ID → App registrations).

Never commit real values for these — including `GITHUB_CLIENT_SECRET` and `AZURE_CLIENT_SECRET` —
use a local `.env` (already gitignored) or your deployment platform's secret manager.

## Quick start

To start the app, run:

```sh
yarn install
yarn start
```

This starts the frontend and backend together (frontend on `http://localhost:3000`, backend on
`http://localhost:7007`), using the local SQLite database and the example catalog data/template
under [`templates/`](./templates).

To run against production config (Postgres, etc.) locally, supply the required environment
variables and pass the extra config file:

```sh
yarn workspace backend start --config ../../app-config.yaml --config ../../app-config.production.yaml
```

## Useful scripts

- `yarn test` / `yarn test:all` — unit tests (via `backstage-cli repo test`)
- `yarn test:e2e` — Playwright end-to-end tests
- `yarn lint` / `yarn lint:all` — lint changed/all packages
- `yarn build:backend` — build the backend for deployment
- `yarn new` — scaffold a new plugin/module under `plugins/`

## Installed plugins

### Backend (`packages/backend`)

| Plugin | Purpose |
| --- | --- |
| `@backstage/plugin-app-backend` | Serves the built frontend app from the backend. |
| `@backstage/plugin-proxy-backend` | Proxies frontend requests to external services. |
| `@backstage/plugin-scaffolder-backend` | Runs Software Templates and scaffolder actions — this is where the Terragrunt/Terraform provisioning logic will plug in. |
| `@backstage/plugin-scaffolder-backend-module-github` | Adds the `publish:github` scaffolder action (push generated content to a GitHub repo). |
| `@backstage/plugin-scaffolder-backend-module-notifications` | Adds the `notification:send` scaffolder action. |
| `@backstage/plugin-techdocs-backend` | Generates/serves TechDocs documentation sites. |
| `@backstage/plugin-auth-backend` + `-module-guest-provider` | Authentication; currently only the guest provider is enabled. |
| `@backstage/plugin-catalog-backend` | The Software Catalog: ingests and stores entities (Components, APIs, Templates, etc.). |
| `@backstage/plugin-catalog-backend-module-scaffolder-entity-model` | Teaches the catalog how to process `Template` entities. |
| `@backstage/plugin-catalog-backend-module-logs` | Logs catalog processing errors. |
| `@backstage/plugin-permission-backend` + `-module-allow-all-policy` | Permission framework; currently set to allow everything. |
| `@backstage/plugin-search-backend` + `-module-pg` | Search indexing, backed by a Postgres full-text search engine. |
| `@backstage/plugin-search-backend-module-catalog` / `-techdocs` | Feed catalog entities and TechDocs content into the search index. |
| `@backstage/plugin-kubernetes-backend` | Surfaces Kubernetes resources for cataloged components. |
| `@backstage/plugin-user-settings-backend` | Stores per-user settings (e.g. theme, pinned items). |
| `@backstage/plugin-notifications-backend` + `@backstage/plugin-signals-backend` | In-app notifications and the realtime signal channel that delivers them. |
| `@backstage/plugin-mcp-actions-backend` | Exposes catalog/scaffolder/auth actions as MCP tools for AI clients. |

### Frontend (`packages/app`)

| Plugin | Purpose |
| --- | --- |
| `@backstage/plugin-catalog` + `-graph` + `-import` | Catalog browsing UI, entity relationship graph, and "register existing component" flow. |
| `@backstage/plugin-scaffolder` | The "Create..." UI that lists and runs Software Templates. |
| `@backstage/plugin-techdocs` (+ `-module-addons-contrib`) | Documentation viewer UI. |
| `@backstage/plugin-search` | Search UI. |
| `@backstage/plugin-auth` | Sign-in page/provider UI. |
| `@backstage/plugin-kubernetes` | Kubernetes resources tab on entity pages. |
| `@backstage/plugin-notifications` + `@backstage/plugin-signals` | Notification inbox UI. |
| `@backstage/plugin-user-settings` + `@backstage/plugin-app-module-user-settings` | User profile/settings page. |
| `@backstage/plugin-org` | Organization (Users/Groups) browsing. |
| `@backstage/plugin-api-docs` | API entity documentation viewer (OpenAPI/AsyncAPI/etc.). |
| `@backstage/plugin-home` (+ `-react`) | The homepage and its configurable widgets (see `app-config.yaml`). |
| `@backstage/plugin-app-visualizer` | Debug view of the app's frontend extension tree. |

## Adding a new plugin or module

New plugins/modules are scaffolded with the root script:

```sh
yarn new
```

This walks you through an interactive picker. The important choices:

- **"Select the thing you want to be creating"** — pick `backend-module` to extend an existing
  backend plugin (most common case here — e.g. a new scaffolder action), `frontend-plugin` for a
  new UI plugin, or `backend-plugin`/`frontend-module` for the less common cases.
- **"Enter the package name of the plugin this module extends"** (only for `*-module` types) —
  the plugin whose extension points you're hooking into. For a new Terragrunt scaffolder action,
  enter `@backstage/plugin-scaffolder-backend` (the same extension point
  `@backstage/plugin-scaffolder-backend-module-github` already uses in this repo). See the
  installed-plugins tables above for other extension points.

After scaffolding:

1. The new package appears under `plugins/<name>/`.
2. Register it in the relevant place:
   - Backend modules/plugins → add a `backend.add(import('...'))` line in
     [`packages/backend/src/index.ts`](packages/backend/src/index.ts), next to the plugin it extends.
   - Frontend plugins/modules → wire into [`packages/app/src/App.tsx`](packages/app/src/App.tsx)
     per the plugin's own docs.
3. Run `yarn install` (adds the new workspace to the lockfile) and `yarn lint`/`yarn tsc` to verify.

> Note: if `yarn new` fails with an error like `Your application tried to access
> @backstage/cli-module-new, but it isn't declared in your dependencies`, it's because this repo
> uses Yarn PnP (no `.yarnrc.yml` overriding the default), which forbids requiring undeclared
> transitive dependencies. Add `@backstage/cli-module-new` to the root `devDependencies` in
> [`package.json`](./package.json) and re-run `yarn install`.

## Related repositories

- [`hello-terragrunt-live`](https://github.com/hoangviet1vu/hello-terragrunt-live) — holds the
  per-tenant `terragrunt.hcl` files this app provisions against.
