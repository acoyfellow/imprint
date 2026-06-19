# Local Code2LoRA backend

This is a bounded, backend-neutral bridge from the paper's public Code2LoRA checkpoint to an Imprint adapter artifact. It runs on Apple silicon; it is **not** a Cloudflare-native adapter runtime.

## Package an adapter

Python dependencies are declared inline, so [`uv`](https://docs.astral.sh/uv/) can create an isolated environment:

```bash
uv run experiments/code2lora-local/backend.py package .imprint/adapters/exercism-python
```

The default is the exact `exercism/python` commit used by E5. `--suite`, `--repository`, and `--commit` select another released snapshot. Downloads come only from the paper's public 4open.science source and Hugging Face repositories.

The output contract is one directory containing:

- `adapter_model.safetensors`: generated tensors, named `A.<module-type>` / `B.<module-type>`;
- `adapter_config.json`: rank, alpha, tensor format, and target module types;
- `manifest.json`: backend/base/source identity and file sizes/digests;
- `receipt.json`: generation provenance and finite-tensor check.

`manifest.json` uses schema `imprint.adapter.v1`. Its own SHA-256 is `null` (a file cannot include its own digest), but its stabilized byte size is checked. All other files have SHA-256 digests. The TypeScript API can inspect any conforming backend's artifact with `openAdapterArtifact(directory)`.

## Exact base-vs-adapter evaluation

```bash
uv run experiments/code2lora-local/backend.py eval \
  .imprint/adapters/exercism-python \
  --receipt .imprint/adapters/exercism-python/eval-receipt.json
```

Both arms use the same `Qwen/Qwen2.5-Coder-1.5B` process, prompts, deterministic decoding, and token limits. The base is measured before the generated tensors are injected, then the adapter arm is measured after injection. The receipt records every target/output and whitespace-normalized exact match. Repository source is not inserted into prompts.

This requires macOS with PyTorch MPS and enough memory for the base model. It downloads a multi-GB public checkpoint/model/dataset and is intentionally not part of the fast test suite.
