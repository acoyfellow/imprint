# E3 — Adapter Generation Checkpoint

Question: can the released source and static checkpoint generate a structurally valid repository adapter?

```bash
uv run generate.py
```

`generate.py` downloads the public source archive and checkpoint, reads one released repository embedding, and writes a gitignored adapter plus `generation-receipt.json`.
