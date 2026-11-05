locals {
  mcp_hostname = var.mcp_hostname == "" ? var.app_hostname : var.mcp_hostname
  separate_mcp = local.mcp_hostname != var.app_hostname
  identity_provider_ids = var.create_email_identity_provider ? toset([
    cloudflare_zero_trust_access_identity_provider.email[0].id
  ]) : var.identity_provider_ids
  managed_oauth = {
    enabled = true
    dynamic_client_registration = {
      enabled                = true
      allowed_uris           = var.oauth_redirect_uris
      allow_any_on_localhost = var.oauth_allow_localhost
      allow_any_on_loopback  = var.oauth_allow_loopback
    }
    grant = {
      access_token_lifetime = "15m"
      session_duration      = "24h"
    }
  }
}

# The account-wide organization is shared infrastructure, not owned by this app.
data "cloudflare_zero_trust_organization" "account" {
  account_id = var.account_id
}

resource "cloudflare_d1_database" "app" {
  account_id = var.account_id
  name       = var.database_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_identity_provider" "email" {
  count      = var.create_email_identity_provider ? 1 : 0
  account_id = var.account_id
  name       = "${var.worker_name} email OTP"
  type       = "onetimepin"
  config     = {}

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "users" {
  account_id = var.account_id
  name       = "${var.worker_name} allowed users"
  decision   = "allow"
  include    = [for email in sort(tolist(var.allowed_emails)) : { email = { email = email } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  account_id                 = var.account_id
  name                       = var.worker_name
  domain                     = var.app_hostname
  type                       = "self_hosted"
  allowed_idps               = local.identity_provider_ids
  session_duration           = "24h"
  http_only_cookie_attribute = true
  policies                   = [{ id = cloudflare_zero_trust_access_policy.users.id, precedence = 1 }]
  oauth_configuration        = merge(local.managed_oauth, { enabled = !local.separate_mcp })

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_application" "mcp" {
  count                      = local.separate_mcp ? 1 : 0
  account_id                 = var.account_id
  name                       = "${var.worker_name} MCP"
  domain                     = local.mcp_hostname
  type                       = "self_hosted"
  allowed_idps               = local.identity_provider_ids
  session_duration           = "24h"
  http_only_cookie_attribute = true
  policies                   = [{ id = cloudflare_zero_trust_access_policy.users.id, precedence = 1 }]
  oauth_configuration        = local.managed_oauth

  lifecycle {
    prevent_destroy = true
  }
}
