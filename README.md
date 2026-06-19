# Imprint

**Every commit gets its own repository-aware LLM.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/imprint)

Imprint binds repository knowledge to an exact Git commit, proves the binding, and lets an LLM answer against that version of the codebase.

```ts
const repo = await imprint.open('abc123');
await repo.ask('How do sessions work?');
```

## Install

Click **Deploy to Cloudflare** above to create an Imprint Worker with Workers AI in your account.

Or install the library from GitHub:

```bash
bun add github:acoyfellow/imprint
```

Clone the source to run the executable proof:

```bash
git clone https://github.com/acoyfellow/imprint
cd imprint
bun install
bun run prove
```

The proof creates two commits with different APIs, imprints both, promotes the new one, and rolls back to the old one.

Run the same commit-bound question through real Workers AI:

```bash
bun run prove:ai
```

Use it on a repository:

```bash
bun run imprint imprint HEAD
bun run imprint ask 'How does this repository work?'
bun run imprint diff HEAD~1 HEAD
bun run imprint promote HEAD
bun run imprint rollback HEAD~1
```

`ask` uses Workers AI when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set. The production site lives at [imprint.coey.dev](https://imprint.coey.dev).

## API

```ts
import { Imprint, WorkersAiProvider } from 'imprint';

const imprint = new Imprint({
  directory: './repo',
  provider: new WorkersAiProvider({ accountId, apiToken }),
});

const release = await imprint.imprint('HEAD');
const repo = await imprint.open(release.commit);
const answer = await repo.ask('Where is authentication implemented?');

await imprint.promote(release.commit);
await imprint.rollback('HEAD~1');
```

## How it works

```text
commit
  → immutable source manifest
  → commit-bound context
  → source and context digests
  → Workers AI inference
```

A release records the repository, commit, selected files, source digest, and context digest. Promotion and rollback move the local release pointer.

`0.0.1` sends commit-bound repository context to Workers AI. It does not generate a LoRA adapter yet. The experiment was inspired by [Code2LoRA](https://arxiv.org/abs/2606.06492).

## Worker API

```bash
curl -X POST https://<your-worker>.workers.dev \
  -H 'content-type: application/json' \
  -d '{
    "repository": "acoyfellow/imprint",
    "commit": "<git-sha>",
    "question": "What command runs the proof?"
  }'
```

`0.0.1` accepts public GitHub repositories. It selects up to 40 text files and 300 KB per request, then sends that commit-bound context to Workers AI.

## Code2LoRA feasibility

The included [experiments](experiments) use the paper's public source, checkpoints, datasets, and exact Qwen base model. A generated adapter scored 4/5 exact matches where the frozen base scored 0/5 on one released benchmark slice, with no repository source in the prompt.

Workers AI does not currently expose the paper's exact base model or arbitrary adapter loading, so that inference ran locally on Apple silicon.

The deployed Cloudflare control plane stores immutable adapters in R2 and keeps candidate/active/rollback state in a Durable Object. Terraform owns the R2 bucket; the Worker upload, CAS promotion, and rollback path is captured in [E9](experiments/e9-cloudflare-lifecycle).

The [local Code2LoRA backend](experiments/code2lora-local) packages generated weights as a backend-neutral artifact (`adapter_model.safetensors`, config, manifest, and receipt) and runs exact base-vs-adapter evaluation. Library consumers can validate that directory with `openAdapterArtifact(path)`. This reference backend does not imply Cloudflare-native adapter inference.

## Cloudflare adapter artifact lifecycle

The Worker can own immutable `imprint.adapter.v1` artifacts without pretending to compile or run adapters in Workers. Files live in the `imprint-adapters` R2 bucket; one SQLite-backed Durable Object owns the candidate/active pointer, promotion history, and compare-and-swap (CAS) transitions.

Create the bucket and authentication secret before deploying (deployment is intentionally not part of local setup):

```bash
npx wrangler r2 bucket create imprint-adapters
npx wrangler secret put ADAPTER_API_TOKEN
```

All lifecycle routes require `Authorization: Bearer $ADAPTER_API_TOKEN`. For local development only, set `DEV_MODE=true` (for example, `DEV_MODE=true bun run dev`) to explicitly bypass authentication.

```bash
# Upload the four files as multipart parts. The manifest's file sizes and SHA-256s are verified.
curl -X POST "$ORIGIN/v1/adapters" -H "Authorization: Bearer $ADAPTER_API_TOKEN" \
  -F manifest=@artifact/manifest.json \
  -F adapter_model.safetensors=@artifact/adapter_model.safetensors \
  -F adapter_config.json=@artifact/adapter_config.json \
  -F receipt.json=@artifact/receipt.json

curl -H "Authorization: Bearer $ADAPTER_API_TOKEN" "$ORIGIN/v1/releases"
curl -H "Authorization: Bearer $ADAPTER_API_TOKEN" "$ORIGIN/v1/adapters/ARTIFACT_ID/manifest"
curl -X POST "$ORIGIN/v1/releases/promote" -H "Authorization: Bearer $ADAPTER_API_TOKEN" \
  -H 'content-type: application/json' -d '{"id":"ARTIFACT_ID","expectedActive":null}'
curl -X POST "$ORIGIN/v1/releases/rollback" -H "Authorization: Bearer $ADAPTER_API_TOKEN" \
  -H 'content-type: application/json' -d '{"expectedActive":"ARTIFACT_ID"}'
```

Uploads reject an artifact ID once any object exists under it. Promotion and rollback return HTTP 409 when `expectedActive` does not equal the current active ID. Upload currently accepts artifacts compiled elsewhere; there is deliberately no Workflow or fake Python/GPU compilation because Workers cannot execute the reference Code2LoRA toolchain. R2 writes are not a multi-object transaction, so interrupted uploads may leave an ID reserved and require operator cleanup before retrying.

## Status

`0.0.1`. Real Git commits, Workers AI, R2, and Durable Objects. No mock repository state.

## License

MIT
