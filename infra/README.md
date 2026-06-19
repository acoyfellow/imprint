# Imprint infrastructure

Terraform owns Imprint's durable adapter bucket. Worker code and bindings remain deployed by Wrangler because the Cloudflare provider does not model Workers AI, Durable Object migrations, and module uploads as one portable deploy-button unit.

```bash
cd infra
terraform init
terraform plan -var "account_id=$CLOUDFLARE_ACCOUNT_ID"
terraform apply -var "account_id=$CLOUDFLARE_ACCOUNT_ID"
```

Authentication uses `CLOUDFLARE_API_TOKEN`. State is local by default and ignored by Git; configure a remote backend before shared use.
