# Terraform infrastructure

Terraform can provision D1, Access applications, their allow policies, and Managed
OAuth before the Worker is deployed. Use Terraform for those resources and
Wrangler for code, static assets, custom-domain routing, migrations, and runtime
secrets. See [deployment setup](deployment.md) for workflow inputs and activation.

## Resource ownership

| Concern | Owner | Provider capability |
| --- | --- | --- |
| Database lifecycle | Terraform | `cloudflare_d1_database` creates a database from `account_id` and `name`, and returns its UUID. [D1 resource](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/resources/d1_database.md) |
| Access allowlist | Terraform | `cloudflare_zero_trust_access_policy` supports explicit email rules and reusable policy IDs. [Policy resource](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/resources/zero_trust_access_policy.md) |
| Protected hostname and Managed OAuth | Terraform | `cloudflare_zero_trust_access_application` supports `type = "self_hosted"`, `allowed_idps`, policy references, `oauth_configuration`, and the computed `aud` value. [Application resource](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/resources/zero_trust_access_application.md) |
| Existing Zero Trust organization | Account bootstrap; Terraform reads it | The organization data source exposes `auth_domain`, allowing the issuer and JWKS URL to be derived. [Organization data source](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/data-sources/zero_trust_organization.md) |
| Login provider | Existing account IdPs, or an explicitly requested Terraform OTP provider | Cloudflare documents an `onetimepin` provider with `config = {}`. [One-time PIN setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) |
| Worker, domain attachment, and application schema | Wrangler | A custom-domain route can be configured with `custom_domain = true`; Cloudflare creates the associated DNS record and certificate. [Custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) |

The stack in `infra/cloudflare` pins Cloudflare **5.28.1** and commits the dependency
lock file so provider schema changes are reviewed deliberately. The release is
published in the [official release history](https://github.com/cloudflare/terraform-provider-cloudflare/releases/tag/v5.28.1).

Terraform also offers a `cloudflare_workers_custom_domain` resource, but this
design leaves domain attachment with Wrangler, which already owns the Worker.
Do not declare the same attachment in both tools. This avoids needing a
Terraform-managed placeholder Worker before the first deployment.
[Domain resource](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/resources/workers_custom_domain.md)

## Access and OAuth contract

Use one hostname and one Access audience by default, matching the application
contract in [Access and MCP](access-and-mcp.md). Cover the whole hostname,
including discovery paths. A separate MCP hostname can have another Access
application with the same allow policy and its own audience.

The Managed OAuth fields are `oauth_configuration.enabled`,
`dynamic_client_registration.enabled`, `allowed_uris`,
`allow_any_on_localhost`, `allow_any_on_loopback`, and the grant's
`access_token_lifetime` and `session_duration`. Policy attachments can use
`{ id = policy.id, precedence = 1 }`. These fields exist in the pinned provider;
no post-apply REST patch is needed.
[Provider schema](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/internal/services/zero_trust_access_application/schema.go)

Managed OAuth applies the application's Access policies and exchanges the
client's opaque OAuth token for a signed `Cf-Access-Jwt-Assertion` at the edge.
The Worker continues to validate that assertion and resolve the linked account.
It does not receive an IdP client secret or implement an authorization server.
Configure callback URIs for the intended clients and leave blanket localhost and
loopback allowance off unless needed.
[Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)

Cloudflare's current OAuth guide permits HTTP/HTTPS callbacks and explicitly
listed native schemes. The pinned provider description still says HTTPS, while
its schema passes strings without a URI validator. Treat native callbacks as a
deployment-specific compatibility check rather than assuming every client works.
[Current callback rules](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings),
[Pinned schema](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/internal/services/zero_trust_access_application/schema.go)

Require a nonempty email allowlist and explicitly selected IdPs. Reuse existing
IdP IDs by default. Optional OTP creation is useful for a new account, but import
an existing provider into its intended state instead of trying to recreate it.
External Google, OIDC, or SAML applications still need their own provider-side
configuration and credentials; the Cloudflare resource configures Cloudflare's
connection to them.
[Identity-provider resource](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/resources/zero_trust_access_identity_provider.md)

## Remote state

Use a private R2 bucket through Terraform's S3 backend, with a unique state key
per application/environment and `use_lockfile = true`. Terraform documents lock
files through S3 object operations; R2 documents atomic conditional `PutObject`
writes, including `If-None-Match: *`. Together these support the selected locking
design. GitHub workflow concurrency also serializes the deployment sequence.
[Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3),
[R2 conditional writes](https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject)

This compatibility conclusion is based on the documented APIs; a live R2
backend integration and simultaneous-writer test have not been performed as
part of the template validation. Before enabling deployment, verify that a
second Terraform writer cannot acquire the same lock. Never resolve a lock
conflict by disabling locking.

Create the state bucket before initializing this stack. Use separate R2
credentials scoped to **Object Read & Write** for that bucket, supplied through
the backend's credential environment variables. The Cloudflare provider token
does not replace these S3 credentials.
[R2 authentication](https://developers.cloudflare.com/r2/api/tokens/)

R2 does not implement S3 bucket versioning. Maintain protected, independently
retained state backups; do not treat the current state object as a backup.
HCP Terraform is an alternative when managed state history is preferred: Local
execution mode keeps Terraform execution in GitHub Actions while HCP stores
state. That is an alternative backend, not an additional deployment runner.
[R2 compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[HCP state](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/state),
[HCP execution modes](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/settings#execution-mode)

State and saved plans contain infrastructure metadata and policy email addresses.
If IdP secrets are later managed by Terraform, they can also enter state despite
being marked sensitive. Keep these files private and out of Git and build
artifacts. Keep the Worker `JWT_SECRET` in the existing Wrangler secrets path.
[Terraform sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)

## CI/CD sequence and bootstrap

The deployment sequence is: application checks and build → Terraform
validation and saved plan → apply that plan → read non-secret outputs → generate
Wrangler configuration → dry run → D1 migrations → Worker deployment. Access
protection is created before the first domain attachment. Generated settings
disable `workers_dev` and preview URLs, so the custom domain is the intended
entry point. Keep the existing repository deployment switch off until bootstrap
and the target configuration are complete.

Bootstrap once per account or deployment target:

1. An active Cloudflare account, DNS zone, and Zero Trust organization.
2. The private state bucket, its object credentials, and a state backup process.
3. Existing IdP IDs, or explicit permission to create the OTP provider.
4. GitHub environment variables/secrets, including a stable Worker JWT secret
   and permitted OAuth callbacks.

Scope the Cloudflare API token to the target account and zone. Terraform needs
D1 Write, Access: Apps and Policies Write, and Access: Organizations, Identity
Providers, and Groups Read for organization discovery. Creating OTP additionally
needs the corresponding Organizations, Identity Providers, and Groups Write
permission. Wrangler needs Worker deployment and applicable domain/route
permissions. The exact configured inputs are described in
[deployment setup](deployment.md).
[D1 permissions](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/resources/d1_database.md),
[Access permissions](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/),
[Organization permissions](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/data-sources/zero_trust_organization.md),
[OTP permissions](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/),
[Worker CI authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

Import existing resources before the first managed apply. D1 replacement loses
its data, so retain a `prevent_destroy` lifecycle rule and review replacements
explicitly. That rule does not protect a resource after its configuration block
is removed. An apply or migration that succeeded is not undone if a later
deployment step fails; retries must use the same state and database.
[D1 lifecycle](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.28.1/docs/resources/d1_database.md),
[Terraform lifecycle](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle#prevent_destroy)
