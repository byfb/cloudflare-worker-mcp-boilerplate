# Cloudflare Worker + MCP boilerplate

A domain-neutral TypeScript foundation for a Cloudflare Worker, D1 database,
React application, and authenticated remote MCP server.

## Included

- A pnpm workspace with separate backend and frontend packages.
- Username/password accounts, Argon2id password hashes, signed session cookies,
  and CSRF protection for authenticated writes.
- Optional Cloudflare Access identity linking and browser session bootstrap.
- Stateless MCP using SDK v2 and the Cloudflare Agents handler, with an
  allowlisted `exec` command catalog and one example: `get_user_profile`.
- Account-scoped MCP connection controls, bounded requests/results, timeouts,
  and audit events that omit arguments, results, and raw identities.
- A neutral React app with sign-in, account settings, and a PWA app shell.
- A fresh account schema, behavioral tests, build checks, and setup documentation.

All infrastructure IDs are placeholders. There are no configured accounts,
custom domains, credentials, product data, historical migrations, or old plans.

## Run locally

Use Node.js 24 and pnpm 10.33.2. All commands below run from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm run setup:local
pnpm run db:migrate
pnpm run dev
```

Open **http://localhost:8787** and create an account. `setup:local` generates a random
secret in ignored root and backend `.env` files; existing files are preserved.
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

Open **http://localhost:5173**. Vite proxies API and MCP requests to the local
Worker. Use `localhost` in your browser because the session cookie is `Secure`.
Both development modes and migrations share `.wrangler/state` in the repo root.
The PWA service worker is built for the production preview, not the Vite dev server.

## Try MCP without provisioning Access

```sh
pnpm run dev:mcp
```

Connect an MCP SDK v2 client to **http://127.0.0.1:8788/mcp**. This separate local
entrypoint returns synthetic data and has no database. It is not used by `deploy`.

The single `exec` tool accepts commands such as:

```text
tools
search profile
info get_user_profile
schema get_user_profile
call get_user_profile {}
```

The main application's `/mcp` endpoint requires configured Cloudflare Access
and a linked account. See [Access and MCP](docs/access-and-mcp.md) for hosted setup,
client requirements, and how to add operations.

## Verify

```sh
pnpm run ci
```

This checks template hygiene, TypeScript, backend and frontend tests, the web
build, and a non-deploying bundle using the production Worker configuration.
Integration tests use an isolated in-memory SQLite database and the actual MCP
client SDK. No production credentials or remote database are used.

GitHub Actions runs these checks on pushes and pull requests through
`.github/workflows/ci.yml`. Local verification with `pnpm run ci` is also available.

## Make it your project

1. Rename `app-worker` and `app-db` in `wrangler.jsonc`. The backend Wrangler
   config is for local development; keep its database name aligned if you rename it.
2. Replace the generic package names, page title, PWA manifest, and `web/public/icon.svg`.
   PNG icons are generated from that SVG during the web build.
3. Add business modules under `backend/modules`, routes in the Worker composition
   root, and new SQL migrations. See [architecture](docs/architecture.md).
4. Once adding real infrastructure IDs, remove `check:template` from `ci` or adapt
   that check to your new project's policy. Its placeholder checks are intentional.

## Deploy your own instance

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create app-db
```

Put the returned database ID into **root `wrangler.jsonc`**. Keep the all-zero ID
in `backend/wrangler.toml` for local development. Set a new, random production
secret of at least 32 bytes, apply migrations, then deploy:

```sh
pnpm exec wrangler secret put JWT_SECRET --config wrangler.jsonc
pnpm run db:migrate:remote
pnpm run deploy
```

The deploy command serves the Worker and built web assets together. Root
`wrangler.jsonc` is the only deployment configuration. Domain routes and Access
settings are opt-in. Account registration is open by default; decide your access
and rate-limit policy before making a public service. Password hashing also
needs a Worker CPU budget appropriate for your traffic.

## Layout

```text
backend/
  apps/worker/       HTTP/MCP composition and protocol adapters
  modules/account/  Account rules, services, persistence, and routes
  platform/         D1, HTTP, auth, runtime, and logging
  shared-kernel/    Dependency-free rule errors
  dev/              Synthetic local MCP server
  tests/            Database integration and architecture checks
web/                React + Vite application and PWA assets
migrations/         Fresh D1 schema and future schema changes
scripts/            Local setup and template hygiene
docs/               Architecture and Access/MCP setup
```

## License

[MIT](LICENSE).
