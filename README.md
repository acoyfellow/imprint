# Imprint

**Every commit gets a complete, queryable repo artifact.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/imprint)

Imprint indexes 100% of tracked files at an exact Git commit, classifies
`source`, `test`, `generated`, `config`, `doc`, and `binary` files with zero
silent drops, extracts an `oxc-parser` AST symbol/export/import map, and writes
a lean `.imprint/releases/<commit>.json` with no duplicated raw file blobs. File
contents are read on demand from Git by `oid` via `git cat-file --batch`.
`proof.verified` is true only when completeness, coverage, and repo-wide checks
all pass. Promote refuses an unverified release.

```ts
const repo = await imprint.open('abc123');
console.log(repo.renderMap());

const slice = await repo.slice({
  symbols: ['GlobalOutbound'],
  depsOf: 'src/index.ts',
  depth: 2,
  maxBytes: 32_000,
});
await repo.ask('How does request routing reach GlobalOutbound?');
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

The proof creates two commits with generated files, imports, and an API rename,
imprints both, verifies zero silent drops, traverses the commit's import graph
via `depsOf`, promotes the new release, and rolls back to the old one. A commit
carrying `IMPRINT_BROKEN` anywhere in non-generated tracked files gets
`proof.verified: false` (even past 400 KB of generated code). Promote throws on
that release. `mcpu` `repo.deploy` reads `.imprint/releases/<commit>.json` and
refuses unless `proof.verified` is true.

Run the same commit-bound question through real Workers AI:

```bash
bun run prove:ai
```

Use it on a repository (all local commands work offline without AI credentials):

```bash
bun run imprint imprint HEAD
bun run imprint map HEAD
bun run imprint slice HEAD --symbol GlobalOutbound --deps-of src/index.ts --depth 2 --max-bytes 32000
bun run imprint slice HEAD --path 'src/tools/*.ts' --grep 'export\s+class' --regex
bun run imprint slice HEAD --changed HEAD~1 --text
bun run imprint ask 'How does this repository work?'
bun run imprint ask --symbol createSession --deps-of createSession 'How are sessions created?'
bun run imprint diff HEAD~1 HEAD
bun run imprint promote HEAD
bun run imprint rollback HEAD~1
```

`ask` uses AI Gateway when `AI_GATEWAY_URL` + `AI_GATEWAY_TOKEN` are set, or
Workers AI when `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` are set. The
production site lives at [imprint.coey.dev](https://imprint.coey.dev).

## Verified on a 2,304-file repo

Measured via `bun proof/prove-mcp.ts` against `cloudflare/mcp` (`b8602d6d5ce5`,
2,304 tracked files / 53.0 MB, including 2,148 files under `src/generated/`):

| Metric | Result |
| --- | --- |
| Tracked / indexed files | `2,304 / 2,304` (`0` silent drops) |
| Real `src/` mapped (excl. `src/generated/`) | `60 / 60` (`100%`) |
| Generated files explicitly classified | `2,150` (`src/generated/`, `package-lock.json`, `worker-configuration.d.ts`) |
| Compact AST repo map (`map.text`) | `22.5 KB` (`127` mapped files, `350` exports, `365` local import edges, `0` parse errors) |
| Full commit imprint time | `188 ms` |
| `.imprint/releases/<commit>.json` | `551 KB` complete manifest + AST map (`0` raw source file blobs stored on disk) |

## API

```ts
import { Imprint, WorkersAiProvider } from '@acoyfellow/imprint';

const imprint = new Imprint({
  directory: './repo',
  provider: new WorkersAiProvider({ accountId, apiToken }),
});

const release = await imprint.imprint('HEAD');
const repo = await imprint.open(release.commit);

const mapText = repo.renderMap();
const file = await repo.readFile('src/index.ts');
const slice = await repo.slice({
  paths: ['src/tools/*.ts'],
  symbols: ['GlobalOutbound'],
  depsOf: 'src/index.ts',
  depth: 2,
  direction: 'deps',
  changed: 'HEAD~1',
  maxBytes: 32_000,
});

const answer = await (await imprint.open(release.commit, { symbols: ['GlobalOutbound'] })).ask(
  'How does GlobalOutbound enforce outbound policy?',
);

await imprint.promote(release.commit);
await imprint.rollback('HEAD~1');
```

## How it works

```text
commit
  complete classified manifest (git ls-tree -r -l -z, 0 silent drops)
  AST symbol + export + local import graph (oxc-parser + fallback)
  manifest + map digests + whole-repo checks -> proof.verified
  lean .imprint/releases/<commit>.json (no duplicated file blobs)
  on-demand git cat-file --batch slicing + explicit truncation reporting
  optional AI Gateway / Workers AI ask
```

A release (`imprint.release.v2`) records the repository, commit, parents,
complete classified manifest, coverage stats, structural AST map, digests, and
check results. Promotion and rollback move the local release pointer.

Local `ask` sends the commit's structural map or budgeted slice to AI Gateway or
Workers AI. It does not generate a LoRA adapter. The Code2LoRA experiment is
separate. See [Code2LoRA](https://arxiv.org/abs/2606.06492).

## Worker API

```bash
curl -X POST https://imprint-api.coey.dev \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $ASK_API_TOKEN" \
  -d '{
    "repository": "acoyfellow/imprint",
    "commit": "<git-sha>",
    "question": "What command runs the proof?",
    "grep": "optional literal"
  }'
```

The Worker accepts public GitHub repositories. Default ask selects up to 40 text
files and 300 KB. Pass `grep` or `paths` to seal a smaller slice instead of the
A–Z window.

**Auth (fail-closed).** The ask endpoint runs Workers AI on your account, so it is never anonymous. Set `ASK_API_TOKEN` (a Worker secret); every ask request must send `Authorization: Bearer $ASK_API_TOKEN`. Without the token configured the endpoint returns `503`; with a missing or wrong bearer it returns `401`. For local development, `DEV_MODE=true` bypasses the check. Put the deployed route behind Cloudflare Access and use an Access service token for agent callers.

**GitHub rate limit.** The source fetch is unauthenticated by default (~60 requests/hour, then `HTTP 403`). Set `GITHUB_TOKEN` (a Worker secret) to raise it to 5000/hour.

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

`imprint.release.v2`. Real Git commits, `oxc-parser` AST maps, on-demand blob slicing, Workers AI, R2, and Durable Objects. No mock repository state.

## License

MIT
