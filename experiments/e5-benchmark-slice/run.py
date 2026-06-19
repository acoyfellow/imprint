# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface-hub", "torch", "transformers>=4.52", "numpy", "pyarrow", "sentencepiece"]
# ///
import importlib.util,json,sys,tempfile,urllib.request,zipfile
from pathlib import Path
from collections import defaultdict
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq
import torch
from transformers import AutoModelForCausalLM,AutoTokenizer
ROOT=Path(__file__).parent; SOURCE='https://anonymous.4open.science/api/repo/code2lora-6857/zip'
with tempfile.TemporaryDirectory() as tmp:
 req=urllib.request.Request(SOURCE,headers={'User-Agent':'imprint/0.0.1'}); a=Path(tmp)/'s.zip'; a.write_bytes(urllib.request.urlopen(req).read()); zipfile.ZipFile(a).extractall(tmp); core=next(Path(tmp).rglob('hypernetwork/code2lora_core.py')); spec=importlib.util.spec_from_file_location('code2lora_core',core); c=importlib.util.module_from_spec(spec); sys.modules['code2lora_core']=c; spec.loader.exec_module(c)
 ck=torch.load(hf_hub_download('code2lora/code2lora-direct','code2lora_direct.pt'),map_location='cpu',weights_only=True); cfg=ck['config']; dims={k:tuple(v) for k,v in ck['type_dims'].items()}; head=c.Code2LoRAHead(cfg['input_dim'],dims,cfg['hidden_dim'],cfg['rank']); head.load_state_dict(ck['state_dict']); head.eval()
 commits=pq.read_table(hf_hub_download('code2lora/code2lora-data-snapshots','commits/ir_test.parquet',repo_type='dataset')).to_pylist(); qnas=pq.read_table(hf_hub_download('code2lora/code2lora-data-snapshots','qna/ir_test.parquet',repo_type='dataset')).to_pylist(); emap={(r['repo_id'],r['commit_sha']):r['repo_state_embedding'] for r in commits}; groups=defaultdict(list)
 for q in qnas:
  key=(q['repo_id'],q['commit_sha'])
  if key in emap: groups[key].append(q)
 candidates={k:[q for q in v if len(q['target'])<=8 and len(q['prefix'])<=3000] for k,v in groups.items()}; key=next(k for k,v in candidates.items() if k[0]=='exercism/python' and len(v)>=5); tasks=candidates[key][:5]
 tok=AutoTokenizer.from_pretrained('Qwen/Qwen2.5-Coder-1.5B'); model=AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-Coder-1.5B',dtype=torch.float16).to('mps'); model.eval(); specs=c.get_module_specs(model,list(dims)); c.replace_with_lora(model,specs,cfg['rank'],ck.get('args',{}).get('alpha',32))
 def answer(prefix):
  ids=tok.encode(prefix,add_special_tokens=False); bos=tok.bos_token_id or tok.eos_token_id; ids=([bos]+ids)[-8192:]; input_ids=torch.tensor([ids],device='mps')
  attention_mask=torch.ones_like(input_ids)
  with torch.no_grad(): out=model.generate(input_ids=input_ids,attention_mask=attention_mask,max_new_tokens=12,do_sample=False,pad_token_id=tok.eos_token_id,eos_token_id=tok.eos_token_id,use_cache=True)
  return tok.decode(out[0,len(ids):],skip_special_tokens=True)
 base=[answer(q['prefix']) for q in tasks]
 with torch.no_grad(): weights=head(torch.tensor(emap[key]).float().unsqueeze(0)); weights={s:{k:v.to('mps') for k,v in x.items()} for s,x in weights.items()}; c.inject_lora_weights(model,specs,weights)
 adapted=[answer(q['prefix']) for q in tasks]
 norm=lambda s:s.strip()
 rows=[{'prefix':q['prefix'],'target':q['target'],'base':b,'adapted':a,'baseExact':norm(b)==norm(q['target']),'adaptedExact':norm(a)==norm(q['target'])} for q,b,a in zip(tasks,base,adapted)]
 be=sum(r['baseExact'] for r in rows); ae=sum(r['adaptedExact'] for r in rows); receipt={'schema':'imprint.experiment.v1','experiment':'e5-benchmark-slice','suite':'ir_test','repository':key[0],'commit':key[1],'tasks':len(rows),'baseExact':be,'adaptedExact':ae,'delta':ae-be,'repositoryTokensInPrompt':0,'rows':rows,'passed':ae>be}
 print(json.dumps(receipt,indent=2)); (ROOT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n'); raise SystemExit(0 if receipt['passed'] else 1)
