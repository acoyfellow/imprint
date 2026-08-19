# Field notes, August 2026

What we actually ran. Not a product plan.

## The loop

```
write
commit to Cloudflare Artifacts
imprint that sha
deploy only if .imprint/releases/<sha>.json has proof.verified true
```

Hands are mcpu. Memory is imprint. Decision showcase is airlock.

## What fired

A git push to an Artifacts repo can start a Workflow. Event type is
`cf.artifacts.repo.pushed`. The payload `after` field is the sha.

wrangler 4.123.0 accepts `triggers.events`. Older 4.102.0 does not.

The Agent Experience account already had Artifacts. A printed `wrangler whoami`
scope list is not the authorization boundary. Call the API.

## What failed, and why

Smoke tests on `*.cloudflare-support-chat.workers.dev` were the wrong host.
Personal smoke tests belong on `*.coey.dev` or `*.coy.workers.dev`.

OAuth from `wrangler login` can drive Workflows. Inside a sandbox,
`wrangler deploy` treated that token as an API token and returned 9109.

`@cloudflare/ci` always uploads a workspace snapshot after a passing step.
Placeholder R2 S3 keys make that upload HTTP 400.

`repo.commit` used LightningFS, which needs `indexedDB`. That is a browser
API. Node and Bun on a laptop throw. The Worker path still uses LightningFS.

A hardcoded preview page that prints `good verified` is not a gate. We deleted
that Worker.

`IMPRINT_BROKEN` in source is a planted check, not lint or tests. It is enough
to prove refuse. It is not a build.

`coey.dev` is at the 100 custom-domain cap. New attaches fail. Update the
existing domain binding, or deploy onto the Worker that already owns the name.

## Live as of these notes

- `https://airlock.coey.dev` serves `sha256:74879882…`
- `https://imprint.coey.dev` matches `https://imprint-dark-site.coy.workers.dev`
- Artifacts `default/mcpu-path` on the personal account
- good sha `95eb8f01…` imprinted verified, Worker `mcpu-path-slot` returns `path-ok`
- bad sha `405e963c…` imprinted unverified, deploy refused

## Do not build next

Another control plane. Another dummy host. Another loop that greps a sign
Worker. Use this on a repo you already work in, or make `repo.commit` work in
Node. Those are the two useful acts.
