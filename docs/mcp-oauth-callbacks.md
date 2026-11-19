# OAuth redirect URIs for hosted MCP clients

Enter your Worker endpoint, such as `https://app.example.com/mcp`, in the
client’s **MCP server URL** field. In Cloudflare Access, allow the client’s
**redirect URI**. This is where Access returns the browser with the authorization
code after sign-in. [Cloudflare Managed OAuth settings](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings)

## Find the callback

| Hosted client | Redirect URI to allow |
| --- | --- |
| ChatGPT web | Copy the production redirect URI from the MCP server’s management page. It can be `https://chatgpt.com/connector_platform_oauth_redirect` or `https://chatgpt.com/connector/oauth/{callback_id}`. For the second form, copy the complete URL with the assigned ID. [OpenAI redirect URL guide](https://developers.openai.com/plugins/build/auth#redirect-url) |
| Claude web | `https://claude.ai/api/mcp/auth_callback`. In the custom connector’s OAuth client settings, choose **Register automatically** to use the template’s dynamic client registration (DCR). [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) |
| Cursor web and Cursor Agents | `https://www.cursor.com/agents/mcp/oauth/callback`. Use the full hostname including `www`. [Cursor MCP redirect URLs](https://cursor.com/docs/mcp#static-redirect-url) |
| Microsoft Copilot Studio | Select **OAuth 2.0 → Dynamic discovery**. Copy the callback if the wizard displays it after **Create**. For a Power Apps custom connector, copy its **Redirect URL** from the **Security** page. [Copilot Studio MCP setup](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent#configure-oauth-20-authentication) · [Microsoft connector settings](https://learn.microsoft.com/en-us/connectors/custom-connectors/azure-active-directory-authentication) |
| Glean | If Glean reports `MCP_DCR_REDIRECT_URI_REJECTED` while adding your MCP server, copy the callback URL from that message, allow it in Access, and select **Initiate connection** again. [Glean DCR callback guidance](https://docs.glean.com/troubleshooting/error-codes/tools/mcp-dcr-redirect-uri-rejected) |

## Apply the allowlist

In GitHub's **production** environment, set the Actions variable
`OAUTH_REDIRECT_URIS` to a JSON array and run the Terraform-enabled deployment.
This example allows ChatGPT, Claude, and Cursor web when ChatGPT shows its
shared callback. Choose the clients you use, substitute ChatGPT's assigned URL
if it differs, and retain any existing callbacks you still need. The template's
separate loopback setting covers Codex CLI. [Deployment variables](deployment.md#terraform-mode-configuration)

```json
[
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
  "https://www.cursor.com/agents/mcp/oauth/callback"
]
```

For Terraform CLI, assign the array to `oauth_redirect_uris` in your
`.tfvars` file and apply it. For example, a deployment that needs only Claude's
hosted callback can use this line. [Terraform settings](terraform.md#access-and-oauth-contract)

```hcl
oauth_redirect_uris = ["https://claude.ai/api/mcp/auth_callback"]
```

If you manage Access manually, open **Zero Trust → Access controls →
Applications** and edit the application protecting the MCP hostname. Under
**Advanced settings → Managed OAuth → Allowed redirect URIs**, add each
selected callback as a separate URI and save. [Cloudflare Managed OAuth settings](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings)

After the Access configuration takes effect, link your Access identity in the
deployed app and connect from the client. [Account linking](access-and-mcp.md#link-an-account-and-connect)
