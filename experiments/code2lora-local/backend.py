# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface-hub", "numpy", "pyarrow", "safetensors", "sentencepiece", "torch", "transformers>=4.52"]
# ///
"""Local Apple-silicon Code2LoRA artifact builder and exact base/adapter evaluator."""
import argparse, hashlib, importlib.util, json, sys, tempfile, urllib.request, zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SOURCE = "https://anonymous.4open.science/api/repo/code2lora-6857/zip"
MODEL = "Qwen/Qwen2.5-Coder-1.5B"
MODEL_REVISION = "df3ce67c0e24480f20468b6ef2894622d69eb73b"
CHECKPOINT = "code2lora/code2lora-direct"
DATASET = "code2lora/code2lora-data-snapshots"


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def dump(path, value): path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def dependencies():
    import pyarrow.parquet as pq
    import torch
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file, save_file
    return pq, torch, hf_hub_download, load_file, save_file


def paper_core(tmp):
    request = urllib.request.Request(SOURCE, headers={"User-Agent": "imprint/0.0.1"})
    archive = Path(tmp) / "source.zip"
    archive.write_bytes(urllib.request.urlopen(request, timeout=120).read())
    zipfile.ZipFile(archive).extractall(tmp)
    path = next(Path(tmp).rglob("hypernetwork/code2lora_core.py"))
    spec = importlib.util.spec_from_file_location("code2lora_core", path)
    module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
    return module


def load_inputs(core, suite, repository, commit):
    pq, torch, hf, _, _ = dependencies()
    checkpoint_path = hf(CHECKPOINT, "code2lora_direct.pt", revision="2728b3136eec8a448db64cde95f5f307acba9bef")
    ck = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    cfg, dims = ck["config"], {k: tuple(v) for k, v in ck["type_dims"].items()}
    head = core.Code2LoRAHead(cfg["input_dim"], dims, cfg["hidden_dim"], cfg["rank"])
    head.load_state_dict(ck["state_dict"]); head.eval()
    rows = pq.read_table(hf(DATASET, f"commits/{suite}.parquet", repo_type="dataset")).to_pylist()
    row = next((r for r in rows if (not repository or r["repo_id"] == repository) and (not commit or r["commit_sha"] == commit)), None)
    if row is None: raise ValueError(f"repository/commit {repository!r}/{commit!r} is absent from {suite}")
    with torch.no_grad(): generated = head(torch.tensor(row["repo_state_embedding"]).float().unsqueeze(0))
    weights = {f"{side}.{name}": tensor[0].contiguous() for side, values in generated.items() for name, tensor in values.items()}
    return ck, cfg, dims, row, weights


def package(args):
    _, _, _, _, save_file = dependencies()
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        core = paper_core(tmp); ck, cfg, dims, row, weights = load_inputs(core, args.suite, args.repository, args.commit)
    weights_path = output / "adapter_model.safetensors"; save_file(weights, weights_path)
    alpha = int(ck.get("args", {}).get("alpha", cfg.get("alpha", 32)))
    config = {"schema": "imprint.adapter-config.v1", "format": "code2lora-direct-safetensors", "rank": int(cfg["rank"]), "alpha": alpha, "targetModules": sorted(dims), "tensorNames": sorted(weights)}
    dump(output / "adapter_config.json", config)
    receipt = {"schema": "imprint.receipt.v1", "operation": "generate", "backend": "code2lora-local-mps", "paperSource": SOURCE, "checkpoint": f"{CHECKPOINT}@2728b3136eec8a448db64cde95f5f307acba9bef", "dataset": DATASET, "suite": args.suite, "repository": row["repo_id"], "commit": row["commit_sha"], "finite": all(v.isfinite().all().item() for v in weights.values()), "tensorCount": len(weights)}
    dump(output / "receipt.json", receipt)
    manifest = {"schema": "imprint.adapter.v1", "id": "imp_adapter_" + sha(weights_path)[:20], "backend": "code2lora-local-mps", "createdAt": datetime.now(timezone.utc).isoformat(), "baseModel": {"id": MODEL, "revision": MODEL_REVISION}, "source": {"repository": row["repo_id"], "commit": row["commit_sha"]}, "adapter": {"format": config["format"], "rank": config["rank"], "alpha": alpha, "targetModules": config["targetModules"]}, "files": {}}
    for name in ("adapter_model.safetensors", "adapter_config.json", "receipt.json"):
        path = output / name; manifest["files"][name] = {"bytes": path.stat().st_size, "sha256": sha(path)}
    # A manifest cannot contain its own digest. Its size is stabilized and still checked by readers.
    manifest["files"]["manifest.json"] = {"bytes": 0, "sha256": None}
    while True:
        dump(output / "manifest.json", manifest); size = (output / "manifest.json").stat().st_size
        if manifest["files"]["manifest.json"]["bytes"] == size: break
        manifest["files"]["manifest.json"]["bytes"] = size
    print(json.dumps(manifest, indent=2)); return output


def evaluate(args):
    if sys.platform != "darwin": raise RuntimeError("this backend requires Apple silicon/macOS MPS")
    pq, torch, hf, load_file, _ = dependencies()
    if not torch.backends.mps.is_available(): raise RuntimeError("PyTorch MPS is unavailable")
    from transformers import AutoModelForCausalLM, AutoTokenizer
    root = Path(args.artifact); manifest = json.loads((root / "manifest.json").read_text()); config = json.loads((root / "adapter_config.json").read_text())
    with tempfile.TemporaryDirectory() as tmp: core = paper_core(tmp)
    tokenizer = AutoTokenizer.from_pretrained(manifest["baseModel"]["id"], revision=manifest["baseModel"]["revision"])
    model = AutoModelForCausalLM.from_pretrained(manifest["baseModel"]["id"], revision=manifest["baseModel"]["revision"], dtype=torch.float16).to("mps"); model.eval()
    specs = core.get_module_specs(model, config["targetModules"]); core.replace_with_lora(model, specs, config["rank"], config["alpha"])
    qnas = pq.read_table(hf(DATASET, f"qna/{args.suite}.parquet", repo_type="dataset")).to_pylist()
    tasks = [q for q in qnas if q["repo_id"] == manifest["source"]["repository"] and q["commit_sha"] == manifest["source"]["commit"] and len(q["target"]) <= args.max_target and len(q["prefix"]) <= args.max_prefix][:args.count]
    if len(tasks) < args.count: raise ValueError(f"only {len(tasks)} matching tasks found")
    def answer(prefix):
        ids = tokenizer.encode(prefix, add_special_tokens=False); ids = ([tokenizer.bos_token_id or tokenizer.eos_token_id] + ids)[-8192:]
        input_ids = torch.tensor([ids], device="mps")
        with torch.no_grad(): output = model.generate(input_ids=input_ids, attention_mask=torch.ones_like(input_ids), max_new_tokens=args.max_new_tokens, do_sample=False, pad_token_id=tokenizer.eos_token_id, eos_token_id=tokenizer.eos_token_id)
        return tokenizer.decode(output[0, len(ids):], skip_special_tokens=True)
    base = [answer(q["prefix"]) for q in tasks]
    flat = load_file(root / "adapter_model.safetensors")
    weights = {side: {key.split(".", 1)[1]: value.unsqueeze(0).to("mps") for key, value in flat.items() if key.startswith(side + ".")} for side in ("A", "B")}
    core.inject_lora_weights(model, specs, weights); adapted = [answer(q["prefix"]) for q in tasks]
    norm = lambda value: value.strip()
    rows = [{"target": q["target"], "base": b, "adapter": a, "baseExact": norm(b) == norm(q["target"]), "adapterExact": norm(a) == norm(q["target"])} for q, b, a in zip(tasks, base, adapted)]
    result = {"schema": "imprint.eval.v1", "artifactId": manifest["id"], "baseModel": manifest["baseModel"], "suite": args.suite, "repository": manifest["source"]["repository"], "commit": manifest["source"]["commit"], "decoding": {"doSample": False, "maxNewTokens": args.max_new_tokens}, "baseExact": sum(r["baseExact"] for r in rows), "adapterExact": sum(r["adapterExact"] for r in rows), "rows": rows}
    dump(Path(args.receipt), result); print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(); commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("package"); build.add_argument("output"); build.add_argument("--suite", default="ir_test"); build.add_argument("--repository", default="exercism/python"); build.add_argument("--commit", default="eb69066cde65f84b8b18055023fd87f53ac47c7c"); build.set_defaults(run=package)
    run = commands.add_parser("eval"); run.add_argument("artifact"); run.add_argument("--suite", default="ir_test"); run.add_argument("--count", type=int, default=5); run.add_argument("--max-target", type=int, default=8); run.add_argument("--max-prefix", type=int, default=3000); run.add_argument("--max-new-tokens", type=int, default=12); run.add_argument("--receipt", default="eval-receipt.json"); run.set_defaults(run=evaluate)
    args = parser.parse_args(); args.run(args)
if __name__ == "__main__": main()
