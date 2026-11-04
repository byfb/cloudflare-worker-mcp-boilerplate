# GitHub Actions deployment

`.github/workflows/deploy.yml` deploys the Worker, web assets, and D1 migrations.
It is disabled by default: its job is skipped unless the repository variable
`CLOUDFLARE_DEPLOY_ENABLED` is set to `true`. This applies to both automatic and
manual runs. The existing CI workflow continues to check pushes and pull requests.

## Prepare the target

1. Create the D1 database once using `pnpm exec wrangler d1 create app-db`, or use
   an existing database. The deployment workflow applies migrations to that
   database; it does not provision infrastructure.
2. For hosted MCP, configure Cloudflare Access and your custom-domain routes as
   described in [Access and MCP](access-and-mcp.md). Put non-secret Worker `vars`,
   routes, and other runtime settings in root `wrangler.jsonc`.
3. Create a GitHub environment named `production`. Under its variables and
   secrets, configure the following values. Repository-level values also work.

| Variable | Required | Value |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `CLOUDFLARE_WORKER_NAME` | Yes | Worker name to deploy |
| `CLOUDFLARE_D1_DATABASE_ID` | Yes | Existing D1 database UUID |
| `CLOUDFLARE_D1_DATABASE_NAME` | No | Override the `DB` binding's database name; otherwise keep the name in `wrangler.jsonc` |

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deployment API token scoped to the target account |
| `JWT_SECRET` | Stable, randomly generated production secret of at least 32 bytes |

Use Cloudflare's **Edit Cloudflare Workers** token template and include D1 write
permissions for migrations. Add the relevant zone permissions when managing
custom domains or routes. See the [Cloudflare CI authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
and [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

Keep `JWT_SECRET` stable between deployments; changing it invalidates existing
application sessions. Only this secret is uploaded to the Worker. The Cloudflare
API token authenticates the deployment and is not included in the Worker config
or its runtime secrets.

## Enable or disable deployment

After configuring the target, add the **repository-level** Actions variable
`CLOUDFLARE_DEPLOY_ENABLED=true`. Keep this switch at repository level because
the job condition is evaluated before environment-level variables are available.

Once enabled, pushes to `main` deploy automatically. You can also select
**Actions → Deploy to Cloudflare → Run workflow**, selecting `main`. Manual runs
on other branches are skipped. If the project's production branch has another
name, update both the push branch filter and the job's `github.ref` condition.

Remove the variable or set it to `false` to stop subsequent deployments. An
already-running deployment continues. The `production` environment's configured
deployment rules also apply.

## Deployment sequence

1. Install the locked dependencies with Node.js 24 and pnpm 10.33.2.
2. Run `pnpm run ci`, including tests and the web/Worker build.
3. Run `pnpm run deploy:prepare` to validate the inputs and generate
   `wrangler.deploy.json` beside the source config. This preserves relative paths
   for the Worker entrypoint, web assets, and migrations.
4. Validate the generated configuration with a Wrangler dry run.
5. Apply pending remote D1 migrations, then deploy the Worker and built assets
   together with `JWT_SECRET`.
6. Remove the generated config and temporary secrets file, including after failure.

The committed `wrangler.jsonc` retains its placeholder IDs, so template checks can
stay enabled. The generated config overrides only the Worker name, account ID,
and `DB` database ID/name; it preserves the other settings. Secrets are written to
a permission-restricted file in the runner's temporary directory and never enter
the generated config or a build artifact.

Production deployments are serialized, and a new run does not cancel one already
applying migrations. Use migrations compatible with the currently deployed code:
a later deployment failure does not undo migrations that already succeeded.

The workflow uses the repository's pinned Wrangler CLI. Secrets are uploaded
alongside the code through [`--secrets-file`](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code).
