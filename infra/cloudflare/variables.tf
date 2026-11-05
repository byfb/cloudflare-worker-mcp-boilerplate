variable "account_id" {
  type        = string
  description = "Cloudflare account containing the Worker, D1 and Zero Trust organization."
  validation {
    condition     = can(regex("^[a-fA-F0-9]{32}$", var.account_id))
    error_message = "account_id must be a 32-character hexadecimal ID."
  }
}

variable "worker_name" {
  type        = string
  description = "Worker deployed by Wrangler; also prefixes Access resource names."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,62}$", var.worker_name))
    error_message = "worker_name must use lowercase letters, numbers or hyphens (1–63 characters)."
  }
}

variable "database_name" {
  type        = string
  default     = "app-db"
  description = "Name of the D1 database managed by this state."
  validation {
    condition     = can(regex("^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$", var.database_name))
    error_message = "database_name must use letters, numbers, underscores or hyphens (1–64 characters)."
  }
}

variable "app_hostname" {
  type        = string
  description = "Full hostname in an existing Cloudflare zone, without scheme or path."
  validation {
    condition     = length(var.app_hostname) <= 253 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.app_hostname))
    error_message = "app_hostname must be a lowercase DNS hostname, without a scheme, port, wildcard or path."
  }
}

variable "mcp_hostname" {
  type        = string
  default     = ""
  description = "Optional separate MCP hostname; empty or equal to app_hostname shares the app."
  validation {
    condition     = var.mcp_hostname == "" || (length(var.mcp_hostname) <= 253 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.mcp_hostname)))
    error_message = "mcp_hostname must be empty or a lowercase DNS hostname without scheme, port, wildcard or path."
  }
}

variable "allowed_emails" {
  type        = set(string)
  sensitive   = true
  description = "Explicit users allowed through Access. Unmatched users are denied."
  validation {
    condition     = length(var.allowed_emails) > 0 && alltrue([for email in var.allowed_emails : can(regex("^[^\\s@*]+@[^\\s@*]+\\.[^\\s@*]+$", email))])
    error_message = "allowed_emails must contain at least one explicit email address; wildcards are not allowed."
  }
}

variable "identity_provider_ids" {
  type        = set(string)
  default     = []
  description = "Existing account IdPs. Alternatively opt in to managing one email OTP IdP."
  validation {
    condition     = var.create_email_identity_provider ? length(var.identity_provider_ids) == 0 : length(var.identity_provider_ids) > 0
    error_message = "Supply existing identity_provider_ids OR set create_email_identity_provider=true, not both."
  }
  validation {
    condition     = alltrue([for id in var.identity_provider_ids : can(regex("^[a-zA-Z0-9-]+$", id))])
    error_message = "Identity provider IDs must be nonempty IDs, without whitespace."
  }
}

variable "create_email_identity_provider" {
  type        = bool
  default     = false
  description = "Manage an account-wide OTP IdP. Reuse or import an existing one instead of duplicating it."
}

variable "oauth_redirect_uris" {
  type        = list(string)
  default     = []
  description = "Explicit Managed OAuth DCR callbacks; HTTPS and native URI schemes are supported by Access."
  validation {
    condition     = length(var.oauth_redirect_uris) > 0 || var.oauth_allow_localhost || var.oauth_allow_loopback
    error_message = "Configure OAuth redirect URIs or explicitly allow localhost/loopback clients."
  }
  validation {
    condition     = alltrue([for uri in var.oauth_redirect_uris : can(regex("^[a-z][a-z0-9+.-]*:[^\\s#]+$", uri))])
    error_message = "OAuth callbacks must be URIs without whitespace or fragments."
  }
}

variable "oauth_allow_localhost" {
  type        = bool
  default     = false
  description = "Allow any DCR callback on localhost. Enable only for clients that need it."
}

variable "oauth_allow_loopback" {
  type        = bool
  default     = false
  description = "Allow any DCR callback on 127.0.0.1. Enable only for clients that need it."
}
