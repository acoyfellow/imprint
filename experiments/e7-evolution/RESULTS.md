# E7 result

**Pass.** The public 2.851 GB GRU checkpoint loaded with separate GRU/head state, and the released `cr_val` data contains 8,614 commit rows with 2,048-dimensional diff and repository-state vectors.

A 144-commit `BayesWitnesses/m2cgen` rollout produced 144 distinct adapter digests; the first and last adapters differ. This proves incremental state evolution, not task-quality improvement. See `receipt.json` and `rollout-receipt.json`.
