resource "cloudflare_r2_bucket" "adapters" {
  account_id = var.account_id
  name       = "imprint-adapters"
}
