mock_provider "cloudflare" {
  mock_data "cloudflare_zero_trust_organization" {
    defaults = { auth_domain = "example-team.cloudflareaccess.com" }
  }
  mock_resource "cloudflare_d1_database" {
    defaults = { id = "11111111-2222-3333-4444-555555555555" }
  }
  mock_resource "cloudflare_zero_trust_access_application" {
    defaults = { aud = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  }
}

variables {
  account_id                     = "0123456789abcdef0123456789abcdef"
  worker_name                    = "example-worker"
  database_name                  = "example-db"
  app_hostname                   = "app.example.com"
  mcp_hostname                   = ""
  allowed_emails                 = ["owner@example.com"]
  identity_provider_ids          = ["11111111-1111-1111-1111-111111111111"]
  oauth_redirect_uris            = ["https://client.example.com/oauth/callback"]
  create_email_identity_provider = false
  oauth_allow_localhost          = false
  oauth_allow_loopback           = false
}

run "shared_application" {
  command = apply

  assert {
    condition     = length(cloudflare_zero_trust_access_application.mcp) == 0 && length(cloudflare_zero_trust_access_identity_provider.email) == 0
    error_message = "Shared hosting must reuse one Access app and existing IdPs."
  }
  assert {
    condition     = output.deployment.app_hostname == output.deployment.mcp_hostname && output.deployment.browser_audience == output.deployment.mcp_audience
    error_message = "Browser and MCP must share their hostname and audience by default."
  }
  assert {
    condition     = output.deployment.database_id == "11111111-2222-3333-4444-555555555555" && output.deployment.access_team_domain == "example-team.cloudflareaccess.com"
    error_message = "Deployment must use provider results, not copied infrastructure IDs."
  }
  assert {
    condition     = cloudflare_zero_trust_access_policy.users.decision == "allow" && toset([for rule in cloudflare_zero_trust_access_policy.users.include : rule.email.email]) == toset(["owner@example.com"])
    error_message = "Only the configured users may match the allow policy."
  }
  assert {
    condition     = cloudflare_zero_trust_access_application.app.oauth_configuration.enabled && !cloudflare_zero_trust_access_application.app.oauth_configuration.dynamic_client_registration.allow_any_on_localhost && !cloudflare_zero_trust_access_application.app.oauth_configuration.dynamic_client_registration.allow_any_on_loopback
    error_message = "Managed OAuth must be enabled without implicitly allowing local callbacks."
  }
  assert {
    condition     = cloudflare_zero_trust_access_application.app.domain == "app.example.com" && cloudflare_zero_trust_access_application.app.policies[0].id == cloudflare_zero_trust_access_policy.users.id
    error_message = "The allow policy must protect the entire hostname, including OAuth discovery."
  }
}

run "explicit_shared_hostname" {
  command = plan
  variables { mcp_hostname = "app.example.com" }
  assert {
    condition     = length(cloudflare_zero_trust_access_application.mcp) == 0
    error_message = "An explicitly shared hostname must not create overlapping applications."
  }
}

run "opt_in_email_identity" {
  command = plan
  variables {
    identity_provider_ids          = []
    create_email_identity_provider = true
  }
  assert {
    condition     = length(cloudflare_zero_trust_access_identity_provider.email) == 1 && cloudflare_zero_trust_access_identity_provider.email[0].type == "onetimepin"
    error_message = "Explicit OTP opt-in must create one email identity provider."
  }
}

run "reject_empty_allowlist" {
  command = plan
  variables { allowed_emails = [] }
  expect_failures = [var.allowed_emails]
}

run "reject_missing_identity_provider" {
  command = plan
  variables { identity_provider_ids = [] }
  expect_failures = [var.identity_provider_ids]
}

run "reject_ambiguous_identity_provider" {
  command = plan
  variables { create_email_identity_provider = true }
  expect_failures = [var.identity_provider_ids]
}

run "reject_unusable_oauth" {
  command = plan
  variables { oauth_redirect_uris = [] }
  expect_failures = [var.oauth_redirect_uris]
}

run "reject_path_scoped_access" {
  command = plan
  variables { app_hostname = "app.example.com/mcp" }
  expect_failures = [var.app_hostname]
}

run "separate_mcp_application" {
  command = apply
  variables { mcp_hostname = "mcp.example.com" }
  override_resource {
    target = cloudflare_zero_trust_access_application.mcp[0]
    values = { aud = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  }
  assert {
    condition     = output.deployment.mcp_hostname == "mcp.example.com" && output.deployment.browser_audience != output.deployment.mcp_audience
    error_message = "A separate MCP hostname must receive its own Access application and audience."
  }
  assert {
    condition     = cloudflare_zero_trust_access_application.mcp[0].oauth_configuration.enabled && !cloudflare_zero_trust_access_application.app.oauth_configuration.enabled && cloudflare_zero_trust_access_application.mcp[0].policies[0].id == cloudflare_zero_trust_access_policy.users.id
    error_message = "The MCP app must own Managed OAuth and enforce the configured allow policy."
  }
}
