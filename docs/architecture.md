# Architecture

One Worker serves HTTP APIs and MCP. Cloudflare static assets serves the React
application from the same deployment. API, MCP, and discovery paths run through
the Worker first; the service worker also excludes them from navigation fallback.
Cloudflare's [SPA routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
describes the routing mechanism.

## Ownership

| Area | Responsibility |
| --- | --- |
| Worker composition | Wire Account, its repositories, session verification, and MCP |
| Account domain | Username/password rules, external identity keys, client descriptors |
| Account application | Register, sign in, read current profile, link identities, manage connections |
| Account persistence | Own Drizzle tables and writes to `users`, `auth_identities`, and `mcp_connections` |
| Platform | Runtime/transport mechanics, Drizzle D1 client and errors, cryptography, Access JWT verification |
| MCP adapter | Protocol limits, command discovery, strict schemas, explicit result projections |
| Web | Routes, account views, session state, and network calls |
| Infrastructure | Terraform owns D1 and Access resources; Wrangler owns Worker code, domain attachment, schema migrations and runtime secrets |

Account is the only starting module. Its public profile contains a username.
There is deliberately no sample business entity, product profile schema, or
pre-created account. Username is unique and immutable in this starter.

The optional infrastructure stack lives in `infra/cloudflare`, outside the
application import graph. Its narrow `deployment` output feeds the generated
Wrangler configuration. Shared account settings and the private Terraform state
bucket are bootstrapped separately. See [Terraform infrastructure](terraform.md)
and [deployment](deployment.md) for ownership and execution details.

## Add a feature

1. Name the business capability and the data it owns. Place it under
   `backend/modules/<capability>`; avoid empty layers and generic CRUD frameworks.
2. Keep invariants next to the owning model. Add application services and
   repository boundaries when orchestration and persistence need to vary independently.
3. Define typed tables in the module's `persistence/schema.ts` and use Drizzle's
   query builder in its repository. Generate and review ordered migrations with
   `pnpm run db:generate`. Each table has one write owner. Wrangler applies
   migrations explicitly before code that requires them; see [database setup](database.md).
4. Register HTTP handlers in `backend/apps/worker/index.ts`. Authenticate before
   reading account data, and verify CSRF before parsing an authenticated mutation.
5. Share a narrow capability through the module's `public` entrypoint for MCP or
   another module. Pass the authenticated user ID from composition; tool input
   must not choose another account.
6. Cover behavior at the boundary where it matters. Keep SQLite migration tests
   and Worker-runtime smoke checks alongside unit tests for new persistence work.

Platform imports no application modules. Domain code depends only on its own
domain and the shared kernel. `architecture.test.ts` checks these directions and
ensures production composition never imports the local demo.

The platform creates a schema-free Drizzle D1 client. Modules supply their own
tables to queries; domain models and repository ports do not import Drizzle.
Repositories use explicit projections at account boundaries and preserve atomic
upserts for identity ownership and MCP connection counters. `executeD1` maps
driver errors to the existing public codes while removing Drizzle wrappers that
contain SQL parameters. Query logging is disabled.

## Authentication and data

Browser sessions use a seven-day signed JWT in an HttpOnly, Secure, SameSite=Strict
cookie. Authenticated writes compare `X-CSRF-Token` with the signed token's CSRF
claim. Sign-out clears the browser cookie; it does not invalidate a copied JWT.
Server-side session revocation, password reset, invitation policy, and distributed
rate limiting are extension points for the future application's requirements.

Cloudflare Access is optional for normal account sign-in and mandatory for the
production MCP route. Browser and MCP share an origin and Access audience by
default; `MCP_ORIGIN` and `ACCESS_MCP_AUDIENCE` independently override those defaults.
Each boundary verifies its configured audience. Linking is explicit, keyed by
verified issuer/subject; matching email addresses never merge accounts.

The PWA caches the application shell only. Authenticated data stays network-only;
there is no offline write queue or account-data cache.
