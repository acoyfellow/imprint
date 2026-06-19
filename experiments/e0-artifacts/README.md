# E0 — cited artifact availability

This experiment records whether the public artifacts cited by **Code2LoRA: Hypernetwork-Generated Adapters for Code Language Models under Software Evolution** ([arXiv:2606.06492](https://arxiv.org/abs/2606.06492)) are anonymously reachable. It checks only:

- the arXiv abstract, PDF, and source endpoints;
- the paper's cited anonymous 4open.science repository (`code2lora-6857`), including validation of its downloadable zip;
- public model and dataset repositories in the cited Hugging Face `code2lora` namespace, including recursive file metadata and README resolution.

## Run

```sh
cd experiments/e0-artifacts
python3 probe.py
```

Requirements: Python 3 standard library and outbound HTTPS. The run overwrites `receipt.json` and `RESULTS.md`. It downloads the 4open source zip into memory for archive validation, but does not retain it. It does not download Hugging Face LFS payloads (several are multi-GB).

## Outputs

- `receipt.json`: machine-readable URLs, HTTP observations, revisions, file paths, sizes, LFS OIDs, and response hashes where bodies were downloaded.
- `RESULTS.md`: concise generated interpretation.

This is an availability probe, not a reproduction. HTTP success and repository metadata do not prove that checkpoints load, datasets are semantically complete, licenses permit every use, or paper results reproduce.
