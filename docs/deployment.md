# GitHub Actions deployment

`.github/workflows/deploy.yml` can provision infrastructure with Terraform, then
deploy the Worker, web assets and D1 migrations with Wrangler. Both provisioning
and deployment are **disabled by default**. The separate CI workflow checks
application code and runs Terraform validation with a mock provider on every
push and pull request, without cloud credentials.

Application tables and queries use Drizzle ORM. Generate and review SQL with
`pnpm run db:generate` before committing schema changes. The existing Wrangler
migration step applies those committed files; CI never uses `drizzle-kit push`
or generates migrations against production. See [database setup](database.md).

## Choose a mode

Set the following switches as **repository-level Actions variables**. Job
conditions are evaluated before environment-level variables are available.

| Repository variable | Effect when `true` |
| --- | --- |
| `CLOUDFLARE_TERRAFORM_ENABLED` | Use Terraform to manage D1 and Access. Allows a manually requested plan without enabling deployments. |
| `CLOUDFLARE_DEPLOY_ENABLED` | Allow pushes to `main` and manual runs to change cloud resources and deploy. |

With only the Terraform switch enabled, pushes do not provision or deploy.
Select **Actions → Deploy to Cloudflare → Run workflow**, choose `main`, and
check **terraform_plan_only** to inspect an infrastructure plan. This reads the
target infrastructure and writes a temporary state lock, but does not apply the
plan, migrate D1 or deploy the Worker. The redacted plan appears in the job
summary and log; policy emails are marked sensitive. A plan-only run does not
retain a binary plan for later apply.

After reviewing the setup and plan, set `CLOUDFLARE_DEPLOY_ENABLED=true` to enable
deployment. When both switches are enabled, pushes to `main` start the workflow.
Infrastructure changes wait for manual approval before apply; a no-change plan
continues directly to application deployment. Manual runs follow the same rule
unless `terraform_plan_only` is checked. Runs from other branches are skipped.

## Review infrastructure changes

Configure a GitHub environment named **production-infrastructure** before the
first Terraform deployment:

1. Under **Settings → Environments**, add the environment and enable **Required
   reviewers** with at least one trusted person or team.
2. Disable **Allow administrators to bypass configured protection rules**.
3. Restrict deployment branches to the `main` branch. If the sole reviewer also
   starts deployments, leave **Prevent self-review** off so that person can
   approve their own run manually.

Keep configuration and secrets in `production` as described below; the approval
environment needs no cloud secrets. Configure reviewer protection on
`production-infrastructure`, rather than on `production`, to request approval
only when the Terraform plan changes. GitHub enforces the environment gate, and
the approval job also verifies that required reviewers exist. Missing protection
or an unreadable environment fails the workflow instead of silently applying.
[GitHub deployment protection rules](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

The workflow uses `terraform plan -detailed-exitcode`: exit `0` means no changes,
`2` requires review, and an error stops the run. Review the **Terraform plan** in
the run summary, including its commit and SHA-256, then use **Review deployments**
to approve or reject **production-infrastructure**. A rejection blocks apply,
migrations and Worker deployment. This gate covers Terraform infrastructure;
application code and SQL migrations keep their existing deployment behavior.
[Terraform plan exit codes](https://developer.hashicorp.com/terraform/cli/commands/plan#detailed-exitcode)

Changed plans are retained privately in the existing R2 state bucket under
`terraform-plans/<owner>/<repository>/<run-id>/<attempt>.tfplan`. They are never
uploaded as public GitHub artifacts. After approval, deployment retrieves the
same binary plan and verifies its SHA-256. It does not create a new plan. A plan
older than 24 hours, a missing or altered plan, or a Terraform stale-state error
stops deployment and requires a new workflow run and review. The account,
backend and source commit are fixed by the planning job.

The cleanup job removes the saved plan after completion, rejection or failure.
Configure an R2 lifecycle rule for the `terraform-plans/` prefix to expire objects
after two days as a fallback for interrupted or failed cleanup. Do not apply that
rule to state objects. Once cleanup runs, start a new workflow run instead of
rerunning only the deploy job. [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

For an already provisioned environment, leave Terraform disabled and use the
existing-infrastructure mode below. Removing the deployment switch stops future
deployments; it does not cancel one already running or destroy resources.

## Prepare the account once

For Terraform mode, prepare an active Cloudflare account, a DNS zone in that
account, and its Zero Trust organization. The stack reads the organization's
team domain; it does not change account-wide organization settings or create an
external Google/OIDC/SAML identity service.

Create a private R2 bucket for Terraform state before initializing the stack:

```sh
pnpm exec wrangler r2 bucket create example-terraform-state
```

Create R2 **Object Read & Write** credentials scoped to that bucket. These are
separate from the Cloudflare deployment API token. Keep a stable, unique state
key per application/environment and maintain protected state backups. R2 does
not provide S3 bucket versioning. The configured backend uses S3 lock files;
verify locking against the target bucket before relying on concurrent writers.
See [Terraform infrastructure](terraform.md#remote-state) for the source-backed
design and the limits of the template's offline validation.

Create a GitHub environment named `production` for configuration. Put the
following values in its variables and secrets; repository-level values also
work except where the switches above explicitly require repository scope.

## Shared configuration

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Target account's 32-character hexadecimal ID |
| `CLOUDFLARE_WORKER_NAME` | Worker name; also prefixes Terraform Access resource names |

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token scoped to the target account and zones |
| `JWT_SECRET` | Stable, randomly generated production secret of at least 32 bytes; required for deployment, not plan-only runs |

The token needs **Workers Scripts Write** and **D1 Write** for deployment and
migrations, plus the zone access needed for Wrangler custom-domain discovery
and attachment. Use Cloudflare's Edit Cloudflare Workers template and scope its
zone permissions to the target zone. Terraform additionally needs **Access:
Apps and Policies Write** and **Access: Organizations, Identity Providers, and
Groups Read**. Managing an OTP provider requires the latter permission's
**Write** variant. See [CI authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
and the [Terraform permission references](terraform.md#cicd-sequence-and-bootstrap).

Keep `JWT_SECRET` stable between deployments; changing it invalidates application
sessions. It is passed directly to Wrangler through a temporary secrets file,
and never to Terraform. The deployment token is not a Worker runtime secret.

## Terraform mode configuration

| Variable | Required | Value |
| --- | --- | --- |
| `TERRAFORM_STATE_BUCKET` | Yes | Existing private R2 state bucket |
| `TERRAFORM_STATE_KEY` | No | Defaults to `<GitHub owner>/<repository>/production.tfstate`; keep it unchanged after the first apply |
| `APP_HOSTNAME` | Yes | Full hostname such as `app.example.com`, without scheme, port or path |
| `MCP_HOSTNAME` | No | Defaults to `APP_HOSTNAME`; a different hostname creates a second Access app and audience |
| `CLOUDFLARE_D1_DATABASE_NAME` | No | Defaults to `app-db`; choose a distinct name for each application |
| `ACCESS_ALLOWED_EMAILS` | Yes | JSON array of explicit email addresses, for example `["owner@example.com"]` |
| `ACCESS_IDENTITY_PROVIDER_IDS` | Usually | JSON array of existing account IdP IDs |
| `ACCESS_CREATE_EMAIL_IDP` | No | Set to `true` to manage an email OTP provider instead of supplying existing IdP IDs; default `false` |
| `OAUTH_REDIRECT_URIS` | Usually | JSON array of callbacks registered by the intended MCP clients, for example `["https://client.example.com/oauth/callback"]` |
| `OAUTH_ALLOW_LOCALHOST` | No | Explicitly permit any localhost callback; default `false` |
| `OAUTH_ALLOW_LOOPBACK` | No | Explicitly permit any `127.0.0.1` callback; default `false` |

| Additional secret | Value |
| --- | --- |
| `TERRAFORM_R2_ACCESS_KEY_ID` | Bucket-scoped R2 S3 access key ID |
| `TERRAFORM_R2_SECRET_ACCESS_KEY` | Matching R2 S3 secret access key |

Select existing IdPs **or** opt in to OTP creation, not both. An existing OTP
provider can be reused by ID; importing it into this stack transfers its
management to this state and should only be done when this stack owns it.
OAuth needs at least one allowed callback or an explicit localhost/loopback
opt-in. Access supports exact native callback schemes as well as web callbacks;
use the actual callback published by your client, not an example value.
[Managed OAuth callback rules](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/#managed-oauth-settings)

Terraform creates the D1 database, email allow policy and Access applications.
Its output supplies the database ID, team domain and audiences to the deploy
script, so `CLOUDFLARE_D1_DATABASE_ID` is not needed in this mode. Wrangler creates
the custom-domain attachment during deployment; the hostname must be available
in the target zone. Avoid an existing conflicting DNS record or Worker binding.
[Custom-domain requirements](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

The generated Wrangler config replaces routes with the protected hostnames and
disables `workers_dev` and preview URLs. It injects Access settings and preserves
unrelated Worker vars and bindings. Shared hosting omits the optional MCP
overrides; separate hosting sets them. Do not define the same domain attachment
in Terraform or add unprotected routes outside this workflow.

## Existing-infrastructure mode

Leave `CLOUDFLARE_TERRAFORM_ENABLED` unset or `false`.

1. Create D1 once with `pnpm exec wrangler d1 create app-db`, or reuse a database.
2. Configure custom domains, Cloudflare Access and Managed OAuth as described in
   [Access and MCP](access-and-mcp.md). Store non-secret Worker vars and routes in
   root `wrangler.jsonc`.
3. Set `CLOUDFLARE_D1_DATABASE_ID` to the existing database UUID. Optionally set
   `CLOUDFLARE_D1_DATABASE_NAME` to override the template's binding name.
4. Configure the shared variables/secrets and enable the deployment switch.

This mode only injects the Worker/account/database identifiers; it preserves the
source config's routing and Access settings. R2 and Terraform inputs are unused.
When moving a Terraform-managed deployment to this mode, first supply its
database ID and retain all generated routes, Access vars and disabled alternate
URLs in the source config. Keep its Terraform state and resource ownership
intact until they have been explicitly transferred.

## Deployment sequence

1. Install the locked dependencies and run `pnpm run ci`.
2. Validate deployment credentials before any infrastructure apply.
3. In Terraform mode, initialize the locked provider and R2 backend, validate the
   stack, run mock-provider tests and save a plan. Publish its redacted review
   summary. A plan-only run stops here.
4. When the plan has changes, save it privately in R2 and wait for the required
   reviewer. After approval, verify and apply that exact plan. With no changes,
   skip both approval and `terraform apply`. Export the narrow `deployment`
   output in either case.
   D1 and Access protection exist before Wrangler attaches the hostname.
5. Generate ignored `wrangler.deploy.json` alongside the source config, retaining
   relative entrypoint, asset and migration paths. Write `JWT_SECRET` to a
   permission-restricted file in the runner's temporary directory.
6. Validate the bundle with a Wrangler dry run, apply pending D1 migrations,
   then deploy code, assets and the runtime secret together.
7. Clean up generated config, local and remote plans, output, backend metadata
   and secret files, including after failure.

Deployment runs are serialized. The committed `wrangler.jsonc` keeps placeholder
IDs, so template checks stay enabled. An apply or migration is not rolled back
if a later step fails. Use migrations compatible with the currently running
code and retry in a new workflow run using the same state key. The workflow
contains no destroy step; D1, Access applications and an owned OTP provider
also use `prevent_destroy`.
Changing from separate MCP hosting back to shared hosting needs an explicit
resource/state migration because deleting the old Access app is protected.

## Local checks and adopting existing resources

Use the Terraform version in `.terraform-version` and commit provider lock-file
changes. The following checks do not read or modify cloud resources:

```sh
pnpm run ci
pnpm run check:infra
```

For real plans or imports, copy `infra/cloudflare/terraform.tfvars.example` to
ignored `infra/cloudflare/terraform.tfvars` and configure your own values. Supply
`CLOUDFLARE_API_TOKEN`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` via the
environment or an ignored local `.env` file loaded into your shell. Initialize
the **same bucket and key used by CI**, for example:

```sh
terraform -chdir=infra/cloudflare init -reconfigure \
  -backend-config='bucket=example-terraform-state' \
  -backend-config='key=example/repository/production.tfstate' \
  -backend-config="endpoints={s3=\"https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com\"}"
```

Before enabling Terraform for an existing deployment, import all resources it
will own. For example:

```sh
terraform -chdir=infra/cloudflare import cloudflare_d1_database.app \
  "$CLOUDFLARE_ACCOUNT_ID/$EXISTING_DATABASE_ID"
terraform -chdir=infra/cloudflare import cloudflare_zero_trust_access_application.app \
  "accounts/$CLOUDFLARE_ACCOUNT_ID/$EXISTING_ACCESS_APP_ID"
```

Also adopt or explicitly replace its policy and any separately managed MCP app
or OTP provider. Review the resulting plan for the existing resources before
applying. Do not switch state keys to start over: Terraform would lose its record
of infrastructure it already manages. `prevent_destroy` is a configuration
guard, not a database backup, and removing a resource block removes its guard.
[Import formats and resource ownership](terraform.md#resource-ownership)
