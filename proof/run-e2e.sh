#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${IMPRINT_PROOF_PORT:-8796}"
LOG="$(mktemp)"
cleanup() { kill "${PID:-}" 2>/dev/null || true; rm -f "$LOG"; }
trap cleanup EXIT

cd "$ROOT"
bun src/cli.ts imprint HEAD > /tmp/imprint-proof-release.json
bunx wrangler dev --config proof/wrangler.jsonc --port "$PORT" --ip 127.0.0.1 >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 60); do
  curl -sS "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || { cat "$LOG" >&2; exit 1; }
  sleep 1
done
python3 - <<'PY' >/tmp/imprint-proof-request.json
import json
r=json.load(open('/tmp/imprint-proof-release.json'))
print(json.dumps({
  'repository':r['repository'], 'commit':r['commit'], 'context':r['adapter']['text'],
  'question':'What is Imprint and what exact command runs its executable proof? Cite file paths.'
}))
PY
curl -fsS -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' --data-binary @/tmp/imprint-proof-request.json | tee /tmp/imprint-workers-ai-proof.json
python3 - <<'PY'
import json
x=json.load(open('/tmp/imprint-workers-ai-proof.json'))
text=x.get('response') or x.get('choices', [{}])[0].get('message', {}).get('content', '')
assert 'bun run prove' in text and 'README.md' in text, text
print('\n✓ real Workers AI answer is commit-bound and cites README.md')
PY
