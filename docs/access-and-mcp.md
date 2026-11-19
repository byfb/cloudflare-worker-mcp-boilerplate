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

Terraform provisions the Access application, its email allow policy and
Managed OAuth. Dynamic client registration and `127.0.0.1` callbacks are
enabled by default. You can reuse existing identity providers or provision
email OTP. The deployment workflow passes the generated audience and team
domain to Wrangler. Setting a separate `MCP_HOSTNAME` provisions a second
Access application with the same callback policy for MCP. [Terraform deployment setup](deployment.md#terraform-mode-configuration)

For a manually managed deployment, configure the hostname and OAuth callbacks
before connecting the client.

1. Attach the custom domain to the Worker in root `wrangler.toml`. In Zero Trust,
   configure a self-hosted Access application covering the **entire MCP hostname**,
   including `/.well-known/`. Choose the identity providers and policies for that app.
2. Under **Access controls → Applications**, edit the application's **Advanced
   settings**. Enable **Managed OAuth**, allow dynamic client registration, and
   turn on **Allow loopback clients** for Codex CLI. This covers the port Codex
   chooses on `127.0.0.1`.
3. For a client that uses the hostname `localhost`, turn on **Allow localhost
   clients**. For a hosted or native client, add its published callback to
   **Allowed redirect URIs**. The MCP server URL belongs in the client's server
   configuration. [Cloudflare Managed OAuth settings](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings)

Add these non-secret values to root `wrangler.toml` under `[vars]`:

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
it must not return an Astro document.

## Client contract

The Worker supports Streamable HTTP clients using the `2025-11-25` and
`2026-07-28` protocols. A legacy client reports its name in
`initialize.params.clientInfo`. It can then list and call tools without
repeating its name.

On the 2026 protocol, send the protocol version and client capabilities with
each request. Include the optional `clientInfo` to identify the client in
**Account → Connected applications**. [MCP per-request fields](https://modelcontextprotocol.io/specification/2026-07-28/basic#_meta)

```json
{
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        "name": "example-client",
        "version": "1.0.0"
      }
    }
  }
}
```

Each authenticated request is stateless. Requests with a name use the account's
entry for that client. Requests without one share **MCP clients without a name**.
Disconnecting any entry also blocks unnamed requests for that account because
the Worker cannot tell which client sent them. Other named clients can continue
to use their active entries. Reconnect or forget the disconnected entries to
allow unnamed requests again. Forgetting an entry deletes the local record.
Manage OAuth grants separately in the provider.

## Add an MCP operation

1. Add its strict input schema, name, and discovery metadata to
   `apps/worker/src/app/mcp/contracts.ts`.
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
