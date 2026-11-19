# Cloudflare Worker + MCP boilerplate

A domain-neutral TypeScript foundation for a Cloudflare Worker, D1 database,
Astro application, and authenticated remote MCP server.

## Included

- A pnpm monorepo with `apps/worker` and `apps/web` workspace packages.
- Drizzle ORM for typed D1 queries, with module-owned schemas and generated migrations.
- Username/password accounts, Argon2id password hashes, signed session cookies,
  and CSRF protection for authenticated writes.
- Optional Cloudflare Access identity linking and browser session bootstrap.
- A stateless Streamable HTTP MCP server using SDK v2 and the Cloudflare Agents
  handler. Clients can discover `exec` and run the allowlisted `get_user_profile`
  operation by default.
- Account-scoped MCP connection controls, bounded requests/results, timeouts,
  and audit events that omit arguments, results, and raw identities.
- Static Astro pages with Tailwind CSS and TypeScript for sign-in, account settings, and a PWA app shell.
- A fresh account schema, behavioral tests, build checks, and setup documentation.

All infrastructure IDs are placeholders. There are no configured accounts,
custom domains, credentials, product data, historical migrations, or old plans.

## Run locally

Use Node.js 24 and pnpm 10.33.2 (minimum Node.js 22.23.4).
All commands below run from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm run setup:local
pnpm run db:migrate
pnpm run dev
```

Open **http://localhost:8787** and create an account. `setup:local` generates a random
secret in ignored root and `apps/worker/.env` files; existing files are preserved.
No Cloudflare login or remote resources are needed for local development.

Local secrets use dotenv `KEY=value` syntax. Each `.env` file sits beside its
Wrangler configuration; `.env.example` documents the available settings. See
[Cloudflare's loading rules](https://developers.cloudflare.com/workers/local-development/environment-variables/)
for environment-specific overrides.

For frontend hot reload, use two terminals instead of `pnpm run dev`:

```sh
pnpm run dev:api
pnpm run dev:web
```

Open **http://localhost:5173**. Astro’s development server proxies API and MCP
requests to the local Worker. Use `localhost` because the session cookie is `Secure`.
Both development modes and migrations share `.wrangler/state` in the repo root.
The PWA service worker is built for the production preview, not the Astro dev server.

## Connect to hosted MCP with Managed OAuth

In Terraform mode, the deployment workflow provisions the D1 `DB` binding,
applies migrations, and enables Managed OAuth on the Access application for
the MCP hostname. Dynamic client registration allows callbacks on `127.0.0.1`
at any port, including the one Codex CLI chooses. If you manage Access manually, enable
**Managed OAuth**, dynamic client registration, and **Allow loopback clients**
on that application. [Deployment setup](docs/deployment.md#terraform-mode-configuration) · [Manual Access setup](docs/access-and-mcp.md#hosted-configuration)

1. Open the deployed web app through Access and create or sign in to your app
   account. Under **Account**, select **Link current Access identity** once.
2. Add the MCP server to Codex using your deployed hostname.

   ```sh
   codex mcp add app --url https://app.example.com/mcp
   ```

3. Complete the browser sign-in. To start sign-in manually, run
   `codex mcp login app`. In Codex, ask it to call the app's `exec` tool with
   `{"command":"call get_user_profile {}"}`. It returns your app username.

Browser and MCP share a hostname and Access audience by default. If you set
`MCP_ORIGIN`, use `<MCP_ORIGIN>/mcp` as the server URL. For a hosted client,
add its published OAuth callback to the Access application's **Allowed redirect
URIs**. [Access and MCP settings](docs/access-and-mcp.md#hosted-configuration)

## Try MCP locally without provisioning Access

```sh
pnpm run dev:mcp
```

Connect a Streamable HTTP client to **http://127.0.0.1:8788/mcp**. This separate local
entrypoint returns synthetic data and has no database. It is not used by `deploy`.

The single `exec` tool accepts commands such as:

```text
tools
search profile
info get_user_profile
schema get_user_profile
call get_user_profile {}
```

Both the local fixture and the hosted Worker register the same tool catalog.
[Adding an MCP operation](docs/access-and-mcp.md#add-an-mcp-operation)

## Verify

```sh
pnpm run ci
```

This checks template hygiene, Drizzle migration metadata, Astro/TypeScript, Worker and
web tests, the web build, and a non-deploying bundle using the production
Worker configuration. Schema tests compare the typed tables with migration
snapshots and exercise constraints against SQLite.
Integration tests use an isolated in-memory SQLite database and the actual MCP
client SDK. No production credentials or remote database are used.

GitHub Actions runs these checks on pushes and pull requests through
`.github/workflows/ci.yml`. Local verification with `pnpm run ci` is also available.
An optional Cloudflare deployment workflow is included and disabled by default.
Its Terraform mode provisions D1, Access policies and Managed OAuth, with remote
state in R2. It supports a plan-only run before enabling deployments. Changed
Terraform plans require a human review through a protected GitHub environment;
unchanged infrastructure skips that approval and apply. Terraform
validation and mock-provider tests run separately in CI without cloud credentials;
run them locally with `pnpm run check:infra` using `.terraform-version`.
See [GitHub Actions deployment](docs/deployment.md) for its enable switch, required
variables, and secrets.

## Make it your project

1. Rename `app-worker` and `app-db` in `wrangler.toml`. The Worker package’s Wrangler
   config is for local development; keep its database name aligned if you rename it.
2. Replace the generic package names, page title, PWA manifest, and `apps/web/public/icon.svg`.
   PNG icons are generated from that SVG during the web build.
3. Add business modules under `apps/worker/src/modules`, routes in the Worker composition
   root, and typed tables in each module's `persistence/schema.ts`. Generate and
   review migrations with `pnpm run db:generate --name describe_change`, then
   apply locally with `pnpm run db:migrate`. See [database setup](docs/database.md)
   and [architecture](docs/architecture.md).
4. The GitHub deployment workflow injects infrastructure IDs into an ignored
   generated config, so `check:template` can remain enabled. If you instead commit
   real IDs in a derived project, remove that check from `ci` or adapt it to your
   project's policy. Its placeholder checks are intentional.

## Deploy your own instance

For automated infrastructure and deployment, follow
[GitHub Actions deployment](docs/deployment.md). Terraform manages D1 and Access;
Wrangler attaches the domain and deploys the application. The first account,
zone, Zero Trust organization and private state bucket are one-time prerequisites.

For manual provisioning:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create app-db
```

Put the returned database ID into **root `wrangler.toml`**. Keep the all-zero ID
in `apps/worker/wrangler.toml` for local development. Set a new, random production
secret of at least 32 bytes, apply migrations, then deploy:

```sh
pnpm exec wrangler secret put JWT_SECRET --config wrangler.toml
pnpm run db:migrate:remote
pnpm run deploy
```

The deploy command serves the Worker and built web assets together. Root
`wrangler.toml` is the deployment source; the optional GitHub workflow derives
`wrangler.deploy.toml` from it. Terraform mode supplies protected domain routes
and Access settings automatically; existing-infrastructure mode preserves yours.
Account registration is open by default; decide your access and rate-limit policy
before making a public service. Password hashing also needs a Worker CPU budget
appropriate for your traffic.

## Layout

```text
apps/
  worker/                  @app/worker
    src/app/               HTTP/MCP composition and protocol adapters
    src/modules/account/   Account rules, services, persistence, and routes
    src/platform/          D1, HTTP, auth, runtime, and logging
    src/shared-kernel/     Dependency-free rule errors
    dev/                   Synthetic local MCP server
    tests/                 Database integration and architecture checks
    migrations/            Ordered D1 SQL and Drizzle snapshots
  web/                     @app/web
    src/pages/             Thin Astro route adapters
    src/app/               Application shell, startup, styles, and PWA policy
    src/_pages/            FSD screen slices with markup and browser controllers
    src/shared/            API transport, session, and DOM helpers
    tests/                 Page integration and FSD architecture checks
    public/                PWA icons and static assets
infra/cloudflare/          Optional Terraform D1 and Access infrastructure
scripts/                   Local setup, deployment, and template hygiene
docs/                      Architecture and Access/MCP setup
wrangler.toml             Combined Worker + web deployment configuration
```

## License

[MIT](LICENSE).
