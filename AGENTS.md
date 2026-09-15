# Working in this boilerplate

Keep this repository reusable until a concrete product is requested. Use generic
names, reserved example domains, and placeholder infrastructure IDs. Store local
credentials in ignored `.env` files and deployment secrets in Cloudflare.

## Boundaries

- `backend/apps/worker` composes HTTP routes, authentication, and MCP capabilities.
- `backend/modules/account` owns users, linked Access identities, and MCP connection records.
- New business behavior belongs in a module that owns its data and rules. Start
  with the smallest useful module; introduce layers when behavior needs them.
- `backend/platform` owns runtime, HTTP, D1, and authentication mechanics. It must
  remain independent of application modules.
- Domain code imports only its own domain and the dependency-free shared kernel.
- MCP receives the authenticated user from the request boundary. New tools must
  use narrow module capabilities, strict input schemas, and explicit output projections.
- `backend/dev` contains synthetic local fixtures and must stay outside the
  production import graph.

Read [architecture](docs/architecture.md) when adding a module or changing its
ownership. Read [Access and MCP](docs/access-and-mcp.md) when changing authentication,
deployment trust settings, or tool contracts.

## Verification

Run `pnpm run ci` before handing off changes. Keep authentication, account scoping,
MCP limits, and database integrity covered with behavioral tests. For frontend
changes, check the rendered page at desktop and mobile widths.

Update the relevant setup or architecture document when behavior changes. Keep
session logs, old product plans, and deployment-specific values out of the template.
