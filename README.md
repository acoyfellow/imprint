# Imprint

**Every commit gets its own repository-aware LLM.**

Imprint binds repository knowledge to an exact Git commit, proves the binding, and lets an LLM answer against that version of the codebase.

```ts
const repo = await imprint.open('abc123');
await repo.ask('How do sessions work?');
```

## Try it

```bash
bun install
bun run prove
```

The proof creates two commits with different APIs, imprints both, promotes the new one, and rolls back to the old one.

Use it on a repository:

```bash
bun run imprint imprint HEAD
bun run imprint ask 'How does this repository work?'
bun run imprint diff HEAD~1 HEAD
bun run imprint promote HEAD
bun run imprint rollback HEAD~1
```

`ask` uses Workers AI when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set.

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
  → repository adapter
  → proof
  → repository-aware inference
```

A release records the repository, commit, source digest, adapter digest, and proof. Promotion and rollback move the complete release pointer.

The `0.0.1` adapter is a commit-bound repository context. The interface also admits generated LoRA adapters inspired by [Code2LoRA](https://arxiv.org/abs/2606.06492).

The hosted shape composes Cloudflare Artifacts, Dynamic Workers, Workflows, Durable Objects, Workers AI, AI Gateway, R2, Vectorize, Sandbox, Gateproof, and CloudEval.

## Status

`0.0.1`. Real Git commits. Real Workers AI. No mock repository state.

## License

MIT
