# E4 — Adapter Effect

Question: can the generated repository adapter load onto the paper's base model and run inference without repository source in the prompt?

```bash
uv run run.py
```

Pass proves loading and inference. `outputChanged` records whether this neutral smoke prompt changes; semantic improvement requires E5/E6 benchmark tasks.
