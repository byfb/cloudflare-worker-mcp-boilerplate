# Access and MCP

## Local protocol development

`pnpm run dev:mcp` starts a separate, loopback-only Worker on port 8788 with a synthetic
profile. It cannot read the application's D1 database. Use it to test discovery
and new protocol behavior before provisioning a hosted environment.

The production entrypoint has no anonymous MCP mode. Missing Access configuration
fails closed, and an invalid assertion is rejected before querying D1.

## Hosted configuration

Use separate browser and MCP hostnames pointing to the same Worker, for example
`app.example.com` and `mcp.example.com`. Add these as your own custom-domain routes
in root `wrangler.jsonc`, and configure two Cloudflare Access applications:

1. A browser application covering the app hostname.
2. A self-hosted application covering the **entire MCP hostname**, with Access
   Managed OAuth enabled for MCP clients.

Use your own identity provider and allow policies. Keep the applications' audience
values distinct. Consult Cloudflare's [MCP security guide](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/)
for current Access configuration and client callback requirements.

Add these non-secret values to root `wrangler.jsonc` under `vars`:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | Canonical browser HTTPS origin, with no trailing slash |
| `MCP_ORIGIN` | Canonical MCP HTTPS origin; defaults to `APP_ORIGIN` if omitted |
| `ACCESS_ISSUER` | Your team's `https://team.cloudflareaccess.com` issuer |
| `ACCESS_JWKS_URL` | The issuer's `/cdn-cgi/access/certs` endpoint |
| `ACCESS_BROWSER_AUDIENCE` | Browser Access application audience |
| `ACCESS_MCP_AUDIENCE` | Distinct MCP Access application audience |

The application also needs `JWT_SECRET`, configured as a Worker secret. No IdP
client secret or Managed OAuth token belongs in this repository. If Access is
intended to protect all browser traffic, disable `workers_dev`, preview URLs,
and other unprotected hostname routes as part of that deployment's routing policy.

## Link an account and connect

1. Sign into the deployed browser app through Access, then create or sign into
   an application account using the username/password form.
2. Open Account and select **Link current Access identity**. This operation
   requires the browser assertion, existing session, same origin, and CSRF token.
3. Connect an MCP client to `https://mcp.example.com/mcp` through Managed OAuth.
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
