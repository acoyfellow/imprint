variable "account_id" {
  description = "Cloudflare account that owns Imprint."
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Resource suffix."
  type        = string
  default     = "prod"
}
