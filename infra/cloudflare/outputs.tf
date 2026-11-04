# A narrow contract consumed by scripts/prepare-deploy.mjs, not raw Terraform state.
output "deployment" {
  description = "Non-secret deployment inputs for Wrangler after a successful apply."
  value = {
    schema_version     = 1
    account_id         = var.account_id
    worker_name        = var.worker_name
    database_id        = cloudflare_d1_database.app.id
    database_name      = cloudflare_d1_database.app.name
    app_hostname       = var.app_hostname
    mcp_hostname       = local.mcp_hostname
    access_team_domain = data.cloudflare_zero_trust_organization.account.auth_domain
    browser_audience   = cloudflare_zero_trust_access_application.app.aud
    mcp_audience       = local.separate_mcp ? cloudflare_zero_trust_access_application.mcp[0].aud : cloudflare_zero_trust_access_application.app.aud
  }
}
