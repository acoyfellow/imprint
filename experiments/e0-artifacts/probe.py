#!/usr/bin/env python3
"""Probe only the public artifacts cited by arXiv:2606.06492.

Uses Python's standard library, keeps no remote payload, and writes receipt.json and
RESULTS.md beside this script. It downloads the 4open zip (source only) to memory so
that a 200 response cannot be confused with a usable archive. It does not download
multi-GB Hugging Face LFS objects; their public metadata and resolve endpoints are
probed instead.
"""
import datetime as dt, hashlib, io, json, pathlib, urllib.error, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parent
UA = "imprint-e0-artifact-probe/1.0"

def request(url, method="GET", read=True):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read() if read else b""
            return {"requested_url": url, "effective_url": r.url, "status": r.status,
                    "content_type": r.headers.get("Content-Type"),
                    "content_length_header": r.headers.get("Content-Length"),
                    "body_bytes": len(body) if read else None}, body
    except urllib.error.HTTPError as e:
        body = e.read()
        return {"requested_url": url, "effective_url": e.url, "status": e.code,
                "content_type": e.headers.get("Content-Type"),
                "content_length_header": e.headers.get("Content-Length"),
                "body_bytes": len(body), "error_body": body[:200].decode(errors="replace")}, body

def api(url):
    meta, body = request(url)
    return meta, json.loads(body)

def main():
    out = {"schema": 1, "probe_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
           "scope": "public artifacts cited by arXiv:2606.06492", "arxiv": {}, "four_open": {},
           "hugging_face": {"namespace": "code2lora", "models": [], "datasets": []}}

    for name, url in {
        "abstract": "https://arxiv.org/abs/2606.06492",
        "pdf": "https://arxiv.org/pdf/2606.06492",
        "source": "https://arxiv.org/e-print/2606.06492",
    }.items():
        m, body = request(url)
        m["sha256"] = hashlib.sha256(body).hexdigest() if m["status"] == 200 else None
        out["arxiv"][name] = m

    landing, _ = request("https://anonymous.4open.science/r/code2lora-6857")
    zipmeta, zbody = request("https://anonymous.4open.science/api/repo/code2lora-6857/zip")
    zipmeta["sha256"] = hashlib.sha256(zbody).hexdigest() if zipmeta["status"] == 200 else None
    try:
        with zipfile.ZipFile(io.BytesIO(zbody)) as z:
            names = z.namelist()
            zipmeta.update({"valid_zip": True, "file_count": len([n for n in names if not n.endswith('/')]),
                            "top_level_entries": sorted({n.split('/')[0] for n in names})})
    except zipfile.BadZipFile:
        zipmeta["valid_zip"] = False
    out["four_open"] = {"landing": landing, "zip": zipmeta,
        "note": "The human-facing URL redirects to an API file route; landing.status records the final unauthenticated response. The cited repository's zip endpoint was probed independently."}

    for kind in ("models", "datasets"):
        listmeta, items = api(f"https://huggingface.co/api/{kind}?author=code2lora&limit=100&full=true")
        out["hugging_face"][kind + "_list_http"] = listmeta
        for item in items:
            repo_id = item["id"]
            tree_url = f"https://huggingface.co/api/{kind}/{repo_id}/tree/main?recursive=true&limit=1000"
            treemeta, tree = api(tree_url)
            files = []
            for x in tree:
                if x.get("type") == "file":
                    files.append({k: x.get(k) for k in ("path", "size", "lfs")})
            entry = {"id": repo_id, "private": item.get("private"), "gated": item.get("gated"),
                     "disabled": item.get("disabled"), "revision": item.get("sha"),
                     "tree_http": treemeta, "files": files,
                     "total_file_bytes": sum(f["size"] or 0 for f in files)}
            # Prove a tiny README is resolvable without fetching any LFS payload.
            resolve, _ = request(f"https://huggingface.co/{'datasets/' if kind == 'datasets' else ''}{repo_id}/resolve/main/README.md")
            entry["readme_resolve_http"] = resolve
            out["hugging_face"][kind].append(entry)

    (ROOT / "receipt.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    lines = ["# E0 artifact availability results", "", f"Probe time: `{out['probe_utc']}`", "",
             "## Observed", "",
             "- arXiv abstract, PDF, and source endpoints returned HTTP 200. Exact response metadata and SHA-256 digests are in `receipt.json`.",
             f"- The cited 4open landing URL ended at HTTP {landing['status']}; its public zip endpoint returned HTTP {zipmeta['status']} and {'was' if zipmeta.get('valid_zip') else 'was not'} a valid zip containing {zipmeta.get('file_count', 0)} files.",
             f"- Hugging Face exposed {len(out['hugging_face']['models'])} public model repositories and {len(out['hugging_face']['datasets'])} public dataset repositories under `code2lora`.", ""]
    lines += ["## Hugging Face inventory", "", "| kind | repository | revision | files | advertised bytes | gated |", "|---|---|---:|---:|---:|---:|"]
    for kind in ("models", "datasets"):
        for x in out["hugging_face"][kind]:
            lines.append(f"| {kind[:-1]} | `{x['id']}` | `{x['revision']}` | {len(x['files'])} | {x['total_file_bytes']} | {x['gated']} |")
    lines += ["", "## Interpretation", "", "Availability means anonymous HTTP metadata/resolve access at probe time. The probe validates the 4open source zip, but intentionally does not download or validate the multi-GB Hugging Face checkpoint/dataset payloads. Consequently this result does **not** establish reproducibility, checkpoint loadability, dataset semantic completeness, or correspondence between code, data, checkpoints, and paper claims.", ""]
    (ROOT / "RESULTS.md").write_text("\n".join(lines))
    print(json.dumps({"receipt": str(ROOT/'receipt.json'), "results": str(ROOT/'RESULTS.md'), "four_open_zip_bytes": len(zbody), "models": len(out['hugging_face']['models']), "datasets": len(out['hugging_face']['datasets'])}, indent=2))

if __name__ == "__main__": main()
