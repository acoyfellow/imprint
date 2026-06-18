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

## Status

`0.0.1`. Real Git commits. Real Workers AI. No mock repository state.

## License

MIT
