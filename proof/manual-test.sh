#!/bin/bash
set -euo pipefail
BASE_URL="${IMPRINT_URL:-http://127.0.0.1:8787}"
REPO="${IMPRINT_TEST_REPO:-acoyfellow/imprint}"
SHA="${IMPRINT_TEST_SHA:-$(git rev-parse HEAD)}"

printf 'GET %s\n' "$BASE_URL"
curl -fsS "$BASE_URL" | tee /tmp/imprint-health.json
python3 - <<'PY'
import json
x=json.load(open('/tmp/imprint-health.json'))
assert x['name']=='imprint' and x['version']=='0.0.1'
PY

printf '\nPOST bad request\n'
status=$(curl -sS -o /tmp/imprint-bad.txt -w '%{http_code}' -X POST "$BASE_URL" -H 'content-type: application/json' --data '{}')
test "$status" = 400

printf '\nPOST %s@%s\n' "$REPO" "$SHA"
python3 - "$REPO" "$SHA" <<'PY' >/tmp/imprint-request.json
import json,sys
print(json.dumps({'repository':sys.argv[1],'commit':sys.argv[2],'question':'What command runs the local executable proof? Cite the file path.'}))
PY
curl -fsS -X POST "$BASE_URL" -H 'content-type: application/json' --data-binary @/tmp/imprint-request.json | tee /tmp/imprint-answer.json
python3 - "$SHA" <<'PY'
import json,sys
x=json.load(open('/tmp/imprint-answer.json'))
assert x['commit']==sys.argv[1]
assert any(f['path']=='README.md' for f in x['selectedFiles'])
text=json.dumps(x['result'])
assert 'bun run prove' in text and ('README.md' in text or 'package.json' in text), text
print('\n✓ commit identity, selected source, Workers AI answer, and citation verified')
PY
