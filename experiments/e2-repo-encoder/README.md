# E2 — Repository Encoder

Question: do the released snapshot artifacts contain the 2,048-dimensional repository vectors expected by Code2LoRA?

```bash
uv run probe.py
```

This probes the released training parquet without reimplementing the unavailable encoder source.
