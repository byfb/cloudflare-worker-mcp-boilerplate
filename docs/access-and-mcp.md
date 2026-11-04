# Access and MCP

## Local protocol development

`pnpm run dev:mcp` starts a separate, loopback-only Worker on port 8788 with a synthetic
profile. It cannot read the application's D1 database. Use it to test discovery
and new protocol behavior before provisioning a hosted environment.

The production entrypoint has no anonymous MCP mode. Missing Access configuration
fails closed, and an invalid assertion is rejected before querying D1.

## Hosted configuration

By default, the browser app and MCP share one hostname and one Cloudflare Access
application. For example, serve the app at `https://app.example.com` and MCP at
`https://app.example.com/mcp` from the same Worker.

Add your hostname as a custom-domain route in root `wrangler.jsonc`. Configure one
self-hosted Access application covering the **entire hostname**, enable Managed
OAuth for MCP clients, and choose your identity provider and allow policies.
Consult Cloudflare's [Managed OAuth guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
for current Access configuration and client callback requirements.

Add these non-secret values to root `wrangler.jsonc` under `vars`:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | Canonical browser HTTPS origin, with no trailing slash |
| `MCP_ORIGIN` | Optional canonical MCP HTTPS origin, without `/mcp`; defaults to `APP_ORIGIN` if omitted |
| `ACCESS_ISSUER` | Your team's `https://team.cloudflareaccess.com` issuer |
| `ACCESS_JWKS_URL` | The issuer's `/cdn-cgi/access/certs` endpoint |
| `ACCESS_BROWSER_AUDIENCE` | Access application audience used by the browser and, by default, MCP |
| `ACCESS_MCP_AUDIENCE` | Optional MCP Access application audience; defaults to `ACCESS_BROWSER_AUDIENCE` if omitted |

Both overrides may explicitly equal their browser values. Set `MCP_ORIGIN` only
when using another origin, and `ACCESS_MCP_AUDIENCE` when using another Access
application. They can be overridden independently. For separate hostnames, add
the MCP custom-domain route and cover the entire MCP hostname with its Access
application and Managed OAuth. If applications share a hostname but use separate
path policies, also configure OAuth discovery coverage and verify the client login
flow. Explicit empty or invalid override values are rejected rather than defaulted.

With a shared audience, a valid Access assertion for that application is accepted
at both browser and MCP boundaries. MCP still requires a linked account and
connection authorization. A separate MCP audience accepts only assertions for
that configured audience.

The application also needs `JWT_SECRET`, configured as a Worker secret. No IdP
client secret or Managed OAuth token belongs in this repository. If Access is
intended to protect all browser traffic, disable `workers_dev`, preview URLs,
and other unprotected hostname routes as part of that deployment's routing policy.

## Link an account and connect

1. Sign into the deployed browser app through Access, then create or sign into
   an application account using the username/password form.
2. Open Account and select **Link current Access identity**. This operation
   requires the browser assertion, existing session, same origin, and CSRF token.
3. Connect an MCP client to `https://app.example.com/mcp` through Managed OAuth
   (or `<MCP_ORIGIN>/mcp` when overriding the origin).
   The Worker verifies the edge-provided `Cf-Access-Jwt-Assertion`, resolves the
   already linked account, then applies connection authorization.
4. Run `exec` with `tools`, then `call get_user_profile {}`.

The Worker does not implement an OAuth authorization server. Access owns
discovery and login at the edge. An opaque bearer token alone is not accepted
as a Worker identity. Without that edge setup, `/.well-known/*` returns 404;
it must not return the SPA document.

## Client contract

This starter uses MCP SDK v2 and per-request implementation metadata:

```json
{
  "params": {
    "_meta": {
      "io.modelcontextprotocol/clientInfo": {
        "name": "example-client",
        "version": "1.0.0"
      }
    }
  }
}
```

The v2 client used by the integration tests supplies this metadata. Clients that
only report their name during legacy initialization are rejected. Verify your
intended client's protocol support before depending on hosted authentication.

Connection controls are keyed by a self-reported normalized client name. A
disconnect blocks that name for the account; it is not OAuth grant revocation.
Forgetting a disconnected connection deletes that local record and allows it to
appear as a new connection later. Revoke provider access separately when needed.

## Add an MCP operation

1. Add its strict input schema, name, and discovery metadata to
   `backend/apps/worker/mcp/contracts.ts`.
2. Add a narrow capability in `types.ts`, wired from its owning module in the
   Worker composition root. Keep repository access out of the MCP adapter.
3. Dispatch the operation in `server.ts` and explicitly select public output
   fields. Pass the request-bound user ID and cancellation signal to the capability.
4. Update `MCP_EXEC_ANNOTATIONS` if any operation can write data, and document
   retry/idempotency behavior. These hints describe the whole `exec` catalog.
5. Test rejected input, account isolation, cancellation, and result bounds.

The command grammar is an allowlist, not shell execution. Requests are limited to
64 KiB, commands to 16 KiB, results to 256 KiB, and tools to 10 seconds. Request
aborts are propagated; future capabilities must honor cancellation to stop work.
The transport follows Cloudflare's [MCP handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/).
