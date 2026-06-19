# E7 — Evolution

Question: are the released recurrent checkpoint and commit-diff vectors structurally available for an evolutionary adapter rollout?

```bash
uv run probe.py
```

Then roll one repository through its released commit history:

```bash
uv run rollout.py
```

The rollout proves that incremental diffs produce evolving adapter state. A later experiment must compare its task quality with static regeneration.
