# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface-hub", "torch", "pyarrow", "numpy"]
# ///
import json, os
from pathlib import Path
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq
import torch
ROOT=Path(__file__).parent
checkpoint=hf_hub_download('code2lora/code2lora-gru','code2lora_gru.pt')
obj=torch.load(checkpoint,map_location='cpu',weights_only=True)
dataset=hf_hub_download('code2lora/code2lora-data-commits','commits/cr_val.parquet',repo_type='dataset')
table=pq.read_table(dataset); row=table.slice(0,1).to_pylist()[0]
shapes={k:len(v) for k,v in row.items() if isinstance(v,list)}
state_keys={k:len(v) if isinstance(v,dict) else type(v).__name__ for k,v in obj.items()} if isinstance(obj,dict) else {}
receipt={'schema':'imprint.experiment.v1','experiment':'e7-evolution','checkpointBytes':os.path.getsize(checkpoint),'checkpointKeys':state_keys,'datasetColumns':table.column_names,'firstRowVectorShapes':shapes,'rows':table.num_rows,'hasDiffEmbedding':shapes.get('diff_embedding')==2048,'hasRepositoryState':shapes.get('repo_state_embedding')==2048}
receipt['passed']=receipt['hasDiffEmbedding'] and bool(state_keys)
print(json.dumps(receipt,indent=2)); (ROOT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n'); raise SystemExit(0 if receipt['passed'] else 1)
