# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface-hub", "pyarrow", "numpy"]
# ///
import json
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq

DATASET="code2lora/code2lora-data-snapshots"
FILE="commits/train.parquet"
path=hf_hub_download(DATASET, FILE, repo_type="dataset")
table=pq.read_table(path)
row=table.slice(0,1).to_pylist()[0]
summary={k: (len(v) if isinstance(v,list) else type(v).__name__) for k,v in row.items()}
vector=next((v for v in row.values() if isinstance(v,list) and len(v)==2048), None)
receipt={"schema":"imprint.experiment.v1","experiment":"e2-repo-encoder","dataset":DATASET,"file":FILE,"columns":table.column_names,"firstRowShape":summary,"has2048DimRepositoryEmbedding":vector is not None,"finite":bool(vector) and all(abs(float(x)) < float('inf') for x in vector)}
receipt["passed"]=receipt["has2048DimRepositoryEmbedding"] and receipt["finite"]
print(json.dumps(receipt,indent=2)); open('receipt.json','w').write(json.dumps(receipt,indent=2)+'\n')
raise SystemExit(0 if receipt['passed'] else 1)
