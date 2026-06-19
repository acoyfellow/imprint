# E5 — Benchmark Slice

Question: does the correct generated adapter improve exact match on five released `ir_test` assertion-completion tasks, with no repository source in the prompt?

```bash
uv run run.py
```

Pass: adapted exact matches exceed the frozen base model on this predeclared five-task slice. This is feasibility evidence, not reproduction of the paper's full table.
