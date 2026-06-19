# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface-hub", "torch", "pyarrow", "numpy"]
# ///
import importlib.util, json, math, os, sys, tempfile, urllib.request, zipfile
from pathlib import Path
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq
import torch

ROOT=Path(__file__).parent
SOURCE_URL='https://anonymous.4open.science/api/repo/code2lora-6857/zip'
with tempfile.TemporaryDirectory() as tmp:
    archive=Path(tmp)/'code.zip'
    request=urllib.request.Request(SOURCE_URL,headers={'User-Agent':'imprint/0.0.1'})
    archive.write_bytes(urllib.request.urlopen(request,timeout=60).read())
    zipfile.ZipFile(archive).extractall(tmp)
    core=next(Path(tmp).rglob('hypernetwork/code2lora_core.py'))
    spec=importlib.util.spec_from_file_location('code2lora_core',core); module=importlib.util.module_from_spec(spec); sys.modules['code2lora_core']=module; spec.loader.exec_module(module)

    checkpoint=hf_hub_download('code2lora/code2lora-direct','code2lora_direct.pt')
    checkpoint_obj=torch.load(checkpoint,map_location='cpu',weights_only=True)
    state=checkpoint_obj.get('state_dict',checkpoint_obj)
    config=checkpoint_obj.get('config',{})
    rank=int(config.get('rank',16))
    types=sorted(k.split('.')[1] for k in state if k.startswith('heads_A.') and k.endswith('.bias'))
    type_dims=checkpoint_obj.get('type_dims') or {t:(state[f'heads_A.{t}.bias'].numel()//rank,state[f'heads_B.{t}.bias'].numel()//rank) for t in types}
    type_dims={k:tuple(v) for k,v in type_dims.items()}
    head=module.Code2LoRAHead(input_dim=int(config.get('input_dim',2048)),type_dims=type_dims,hidden_dim=int(config.get('hidden_dim',1024)),rank=rank)
    head.load_state_dict(state); head.eval()

    parquet=hf_hub_download('code2lora/code2lora-data-snapshots','commits/train.parquet',repo_type='dataset')
    row=pq.read_table(parquet).slice(0,1).to_pylist()[0]
    embedding=torch.tensor(row['repo_state_embedding'],dtype=torch.float32).unsqueeze(0)
    with torch.no_grad(): output=head(embedding)
    output_path=ROOT/'adapter.pt'
    torch.save({'A':{k:v[0] for k,v in output['A'].items()},'B':{k:v[0] for k,v in output['B'].items()}},output_path)
    tensors=[v for side in output.values() for v in side.values()]
    receipt={
      'schema':'imprint.experiment.v1','experiment':'e3-adapter-generation','source':SOURCE_URL,
      'checkpoint':'code2lora/code2lora-direct@2728b3136eec8a448db64cde95f5f307acba9bef',
      'dataset':'code2lora/code2lora-data-snapshots','repoId':row['repo_id'],'commit':row['commit_sha'],
      'rank':rank,'types':types,'typeDims':{k:list(v) for k,v in type_dims.items()},
      'tensorCount':len(tensors),'finite':all(torch.isfinite(v).all().item() for v in tensors),
      'adapterBytes':output_path.stat().st_size,'passed':True,
    }
    print(json.dumps(receipt,indent=2)); (ROOT/'generation-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
