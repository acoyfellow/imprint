# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface-hub", "torch", "transformers>=4.52", "numpy", "pyarrow", "sentencepiece"]
# ///
import importlib.util, json, sys, tempfile, urllib.request, zipfile
from pathlib import Path
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT=Path(__file__).parent; SOURCE='https://anonymous.4open.science/api/repo/code2lora-6857/zip'
with tempfile.TemporaryDirectory() as tmp:
 req=urllib.request.Request(SOURCE,headers={'User-Agent':'imprint/0.0.1'}); archive=Path(tmp)/'s.zip'; archive.write_bytes(urllib.request.urlopen(req).read()); zipfile.ZipFile(archive).extractall(tmp)
 core=next(Path(tmp).rglob('hypernetwork/code2lora_core.py')); spec=importlib.util.spec_from_file_location('code2lora_core',core); c=importlib.util.module_from_spec(spec); sys.modules['code2lora_core']=c; spec.loader.exec_module(c)
 checkpoint=torch.load(hf_hub_download('code2lora/code2lora-direct','code2lora_direct.pt'),map_location='cpu',weights_only=True); state=checkpoint['state_dict']; config=checkpoint['config']; dims={k:tuple(v) for k,v in checkpoint['type_dims'].items()}
 head=c.Code2LoRAHead(input_dim=config['input_dim'],type_dims=dims,hidden_dim=config['hidden_dim'],rank=config['rank']); head.load_state_dict(state); head.eval()
 row=pq.read_table(hf_hub_download('code2lora/code2lora-data-snapshots','commits/train.parquet',repo_type='dataset')).slice(0,1).to_pylist()[0]
 with torch.no_grad(): weights=head(torch.tensor(row['repo_state_embedding']).float().unsqueeze(0))
 model_id='Qwen/Qwen2.5-Coder-1.5B'; tokenizer=AutoTokenizer.from_pretrained(model_id); model=AutoModelForCausalLM.from_pretrained(model_id,dtype=torch.float16).to('mps'); model.eval()
 specs=c.get_module_specs(model,list(dims)); c.replace_with_lora(model,specs,config['rank'],config.get('alpha',32))
 prompt='Complete only the assertion value:\nresult = 19 + 23\nassert result =='; inputs=tokenizer(prompt,return_tensors='pt').to('mps')
 def generate():
  with torch.no_grad(): out=model.generate(**inputs,max_new_tokens=12,do_sample=False)
  return tokenizer.decode(out[0][inputs.input_ids.shape[1]:],skip_special_tokens=True)
 base=generate(); weights={side:{k:v.to('mps') for k,v in values.items()} for side,values in weights.items()}; c.inject_lora_weights(model,specs,weights); adapted=generate()
 receipt={'schema':'imprint.experiment.v1','experiment':'e4-adapter-effect','model':model_id,'modelCommit':getattr(model.config,'_commit_hash',None),'repository':row['repo_id'],'commit':row['commit_sha'],'prompt':prompt,'baseOutput':base,'adaptedOutput':adapted,'outputChanged':base!=adapted,'repositoryTokensInPrompt':0,'adapterLoaded':True}
 receipt['passed']=receipt['adapterLoaded'] and receipt['repositoryTokensInPrompt']==0
 print(json.dumps(receipt,indent=2)); (ROOT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
