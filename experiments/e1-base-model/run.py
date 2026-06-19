# /// script
# requires-python = ">=3.11"
# dependencies = ["torch>=2.7", "transformers>=4.52", "safetensors", "sentencepiece"]
# ///
import json, os, platform, time
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen2.5-Coder-1.5B"
REVISION = os.getenv("IMPRINT_MODEL_REVISION", "main")
PROMPT = "Complete only the assertion value:\nresult = 19 + 23\nassert result =="
device = "mps" if torch.backends.mps.is_available() else "cpu"
started = time.time()
tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
model = AutoModelForCausalLM.from_pretrained(MODEL, revision=REVISION, torch_dtype=torch.float16 if device == "mps" else torch.float32).to(device)
loaded = time.time()
inputs = tokenizer(PROMPT, return_tensors="pt").to(device)
with torch.no_grad():
    output = model.generate(**inputs, max_new_tokens=12, do_sample=False)
text = tokenizer.decode(output[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
receipt = {
    "schema": "imprint.experiment.v1", "experiment": "e1-base-model", "model": MODEL,
    "requestedRevision": REVISION, "resolvedCommit": getattr(model.config, "_commit_hash", None),
    "device": device, "platform": platform.platform(), "prompt": PROMPT, "output": text,
    "inputTokens": int(inputs.input_ids.shape[1]), "loadSeconds": round(loaded-started, 3),
    "inferenceSeconds": round(time.time()-loaded, 3), "passed": "42" in text,
}
print(json.dumps(receipt, indent=2))
open("receipt.json", "w").write(json.dumps(receipt, indent=2)+"\n")
raise SystemExit(0 if receipt["passed"] else 1)
