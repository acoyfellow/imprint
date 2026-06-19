# E0 artifact availability results

Probe time: `2026-06-18T21:29:14.908260+00:00`

## Observed

- arXiv abstract, PDF, and source endpoints returned HTTP 200. Exact response metadata and SHA-256 digests are in `receipt.json`.
- The cited 4open landing URL ended at HTTP 200; its public zip endpoint returned HTTP 200 and was a valid zip containing 80 files.
- Hugging Face exposed 2 public model repositories and 4 public dataset repositories under `code2lora`.

## Hugging Face inventory

| kind | repository | revision | files | advertised bytes | gated |
|---|---|---:|---:|---:|---:|
| model | `code2lora/code2lora-gru` | `26460cba5f0de9b708277488ae0b1a826435961e` | 4 | 2850718059 | False |
| model | `code2lora/code2lora-direct` | `2728b3136eec8a448db64cde95f5f307acba9bef` | 3 | 2716380078 | False |
| dataset | `code2lora/code2lora-data-snapshots` | `9a2b7ab8fd2bf3e7d3972c0999bbe7dd1e34c32d` | 15 | 7925122297 | False |
| dataset | `code2lora/code2lora-data-commits` | `384af4cdb3d717d263af78299c63e439f9f38af0` | 7 | 829206121 | False |
| dataset | `code2lora/code2lora-data-smartcap` | `f11cdf2bdba176363c258b988cc4c8cd89b4061f` | 4 | 6210966834 | False |
| dataset | `code2lora/code2lora-data-ood` | `d8f19d7ed7fba66f7bd634ae8c4b5566c48e432f` | 4 | 540217980 | False |

## Interpretation

Availability means anonymous HTTP metadata/resolve access at probe time. The probe validates the 4open source zip, but intentionally does not download or validate the multi-GB Hugging Face checkpoint/dataset payloads. Consequently this result does **not** establish reproducibility, checkpoint loadability, dataset semantic completeness, or correspondence between code, data, checkpoints, and paper claims.
