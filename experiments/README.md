# Imprint feasibility experiments

Each directory asks one binary question about reproducing [Code2LoRA](https://arxiv.org/abs/2606.06492).

| Experiment | Result | Observation |
|---|---|---|
| E0 artifacts | Pass | Paper source, 80-file code archive, two checkpoints, and four datasets are public. |
| E1 base model | Pass | Qwen2.5-Coder-1.5B ran locally on Apple M4 Pro and completed a fixed assertion. |
| E2 repository encoder output | Pass | Released snapshot data contains finite 2,048-dimensional repository vectors. |
| E3 adapter generation | Pass | The released hypernetwork generated 14 finite rank-16 LoRA tensors from a released repository vector. |
| E4 adapter loading | Pass | Base plus generated adapter ran with zero repository source tokens; output changed. |
| E5 benchmark slice | Pass | Adapter scored 4/5 exact matches where base scored 0/5 on a released `ir_test` slice. |
| E7 evolution | Pass | A 144-commit GRU rollout produced 144 distinct repository-adapter digests. |
| E8 Cloudflare-native model path | Blocked | Workers AI lacks the exact base model and a documented arbitrary adapter upload/select API. |
| E9 Cloudflare lifecycle | Pass | Terraform + R2 + Durable Object stored two real adapters, promoted both with CAS, and rolled back. |

These are feasibility receipts, not reproduction of the paper's complete benchmark tables. E6 full evaluation and an E7 quality comparison remain.

The [local Code2LoRA backend](code2lora-local) turns the E3–E5 path into a reusable `imprint.adapter.v1` artifact and runs deterministic base-vs-adapter exact-match evaluation on Apple silicon. It is a local reference backend, not Cloudflare-native adapter inference.
