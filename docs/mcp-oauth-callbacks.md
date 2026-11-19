# OAuth redirect URIs for hosted MCP clients

Enter your Worker endpoint, such as `https://app.example.com/mcp`, in the
client’s **MCP server URL** field. In Cloudflare Access, allow the client’s
**redirect URI**. This is where Access returns the browser with the authorization
code after sign-in. [Cloudflare Managed OAuth settings](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings)

## Apply the allowlist

Terraform applies these four rules to the Access application protecting the MCP
hostname when `OAUTH_REDIRECT_URIS` is unset. The separate loopback setting
covers Codex CLI on `127.0.0.1`. [Deployment variables](deployment.md#terraform-mode-configuration)

```json
[
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://chatgpt.com/connector/oauth/*",
  "https://claude.ai/api/mcp/auth_callback",
  "https://www.cursor.com/agents/mcp/oauth/callback"
]
```

To customize the list in GitHub Actions, set `OAUTH_REDIRECT_URIS` in the
**production** environment to the complete JSON array and run the Terraform-enabled
deployment. For Terraform CLI, set `oauth_redirect_uris` in your `.tfvars` file
and apply. For example, to allow only Claude as a hosted client, use the following
override. [Terraform settings](terraform.md#access-and-oauth-contract)

```hcl
oauth_redirect_uris = ["https://claude.ai/api/mcp/auth_callback"]
```

If you manage Access manually, open **Zero Trust → Access controls →
Applications** and edit the application protecting the MCP hostname. Under
**Advanced settings → Managed OAuth → Allowed redirect URIs**, add each
selected callback as a separate URI and save. [Cloudflare Managed OAuth settings](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings)

## When ChatGPT reports a rejected redirect

ChatGPT uses `https://chatgpt.com/connector_platform_oauth_redirect` when
the authorization server supports RFC 9207 issuer identification, and for some
older published plugins. Otherwise it assigns a URL under
`https://chatgpt.com/connector/oauth/` for each connection. Cloudflare Access
owns issuer discovery and the authorization response in this template. Its
trailing `/*` rule allows clients to register callbacks under that path.
ChatGPT still sends the exact URL with its assigned ID. [OpenAI callback selection](https://developers.openai.com/plugins/build/auth#redirect-url) · [Cloudflare path matching](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings)

Access returns `Redirect URI not allowed by application configuration` when the
requested callback falls outside the application's allowlist.

1. Check the redirect URI on the plugin's MCP server management page, or read
   the decoded `redirect_uri` in the failed authorization request.
2. If your existing allowlist has only the shared ChatGPT callback, add
   `https://chatgpt.com/connector/oauth/*` alongside it to cover new connections.
   To allow just the callback for the affected connection, use its complete
   assigned URL as your only ChatGPT entry. Keep the other clients you use.
3. Apply the Terraform change or save the Access dashboard change on the MCP
   hostname's application, then retry the same plugin. [Account linking](access-and-mcp.md#link-an-account-and-connect)

## Find the callback

| Client | Redirect URI or setup |
| --- | --- |
| ChatGPT web | Both callback forms are covered by default. For an exact-URI allowlist, copy the production redirect URI from the MCP server's management page. [OpenAI redirect URL guide](https://developers.openai.com/plugins/build/auth#redirect-url) |
| Claude web | `https://claude.ai/api/mcp/auth_callback` is included. Choose **Register automatically** in the custom connector's OAuth settings. [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) |
| Cursor web and Cursor Agents | `https://www.cursor.com/agents/mcp/oauth/callback` is included. For Cursor Desktop with dynamic registration, also add `http://localhost:8787/callback`. The desktop app registers both URLs. [Cursor MCP redirect URLs](https://cursor.com/docs/mcp#static-redirect-url) |
| Microsoft Copilot Studio | Select **OAuth 2.0 → Dynamic discovery**. Copy the callback if the wizard displays it after **Create**. For a Power Apps custom connector, copy its **Redirect URL** from the **Security** page. Add the assigned URL to your allowlist. [Copilot Studio MCP setup](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent#configure-oauth-20-authentication) · [Microsoft connector settings](https://learn.microsoft.com/en-us/connectors/custom-connectors/azure-active-directory-authentication) |
| Glean | If Glean reports `MCP_DCR_REDIRECT_URI_REJECTED`, copy the callback URL from the message, allow it in Access, and select **Initiate connection** again. [Glean DCR callback guidance](https://docs.glean.com/troubleshooting/error-codes/tools/mcp-dcr-redirect-uri-rejected) |
