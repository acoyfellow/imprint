#!/bin/bash
set -euo pipefail
mkdir -p .tmp
wrangler ai models --json > .tmp/models.json
python3 - <<'PY'
import json
models=json.load(open('.tmp/models.json'))
if isinstance(models,dict): models=models.get('result') or models.get('models') or []
names=[m.get('name') or m.get('id') for m in models]
qwen=[n for n in names if n and 'qwen2.5-coder-1.5' in n.lower()]
lora=[n for n in names if n and 'lora' in n.lower()]
r={"schema":"imprint.experiment.v1","experiment":"e8-cloudflare-compute","catalogModelCount":len(names),"exactPaperBaseModels":qwen,"loraCatalogModels":lora,"arbitraryAdapterUploadApiDocumented":False,"hypernetworkGpuJobDocumented":False}
r["passed"]=bool(qwen) and r["arbitraryAdapterUploadApiDocumented"]
open('receipt.json','w').write(json.dumps(r,indent=2)+'\n'); print(json.dumps(r,indent=2))
PY
rm -rf .tmp
