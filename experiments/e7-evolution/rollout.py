# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface-hub", "torch", "pyarrow", "numpy"]
# ///
import hashlib,importlib.util,json,sys,tempfile,urllib.request,zipfile
from pathlib import Path
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq
import torch
ROOT=Path(__file__).parent; SOURCE='https://anonymous.4open.science/api/repo/code2lora-6857/zip'
with tempfile.TemporaryDirectory() as tmp:
 req=urllib.request.Request(SOURCE,headers={'User-Agent':'imprint/0.0.1'}); a=Path(tmp)/'s.zip'; a.write_bytes(urllib.request.urlopen(req).read()); zipfile.ZipFile(a).extractall(tmp); core=next(Path(tmp).rglob('hypernetwork/code2lora_core.py')); spec=importlib.util.spec_from_file_location('code2lora_core',core); c=importlib.util.module_from_spec(spec); sys.modules['code2lora_core']=c; spec.loader.exec_module(c)
 ck=torch.load(hf_hub_download('code2lora/code2lora-gru','code2lora_gru.pt'),map_location='cpu',weights_only=True); hc=ck['head_config']; gc=ck['gru_config']; dims={k:tuple(v) for k,v in ck['type_dims'].items()}; head=c.Code2LoRAHead(hc['input_dim'],dims,hc['hidden_dim'],hc['rank']); head.load_state_dict(ck['head_state']); head.eval(); gru=c.CommitGRU(**gc); gru.load_state_dict(ck['gru_state']); gru.eval()
 rows=pq.read_table(hf_hub_download('code2lora/code2lora-data-commits','commits/cr_val.parquet',repo_type='dataset')).to_pylist(); repo=rows[0]['repo_id']; history=sorted([r for r in rows if r['repo_id']==repo],key=lambda r:r['commit_index'])
 h=gru.init_hidden(torch.tensor(history[0]['repo_state_embedding']).float().unsqueeze(0)); digests=[]
 with torch.no_grad():
  for row in history:
   h=gru.step(torch.tensor(row['diff_embedding']).float().unsqueeze(0),h); out=head(gru.output_norm(h[-1])); raw=b''.join(v.cpu().numpy().tobytes() for side in ('A','B') for _,v in sorted(out[side].items())); digests.append(hashlib.sha256(raw).hexdigest())
 receipt={'schema':'imprint.experiment.v1','experiment':'e7-evolution-rollout','repository':repo,'commits':len(history),'firstCommit':history[0]['commit_sha'],'lastCommit':history[-1]['commit_sha'],'firstAdapterDigest':digests[0],'lastAdapterDigest':digests[-1],'uniqueAdapters':len(set(digests)),'changedAcrossHistory':digests[0]!=digests[-1]}; receipt['passed']=receipt['changedAcrossHistory'] and receipt['uniqueAdapters']>1
 print(json.dumps(receipt,indent=2)); (ROOT/'rollout-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n'); raise SystemExit(0 if receipt['passed'] else 1)
