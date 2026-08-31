#!/usr/bin/env bash
# Co-located pilot launcher (D3, specs/003-pilot-deployment): run the BullMQ worker and the Next.js
# web server in ONE Fly machine so they share the file secrets backend. If either process exits, tear
# down the other and exit non-zero so Fly restarts the whole machine — never a silent half-dead state
# where the web is up but sync has stopped.
set -euo pipefail

echo "[pilot] starting worker (@falcon/worker) + web (@falcon/web)"

# Ensure the persistent file-secrets-store dir exists (Fly volume mounted at /data; see fly.pilot.toml).
mkdir -p "$(dirname "${SECRETS_FILE_PATH:-/data/secrets/store.enc.json}")"

pnpm --filter @falcon/worker start &
worker_pid=$!

pnpm --filter @falcon/web start &
web_pid=$!

# Wait for whichever child exits first.
wait -n
code=$?
echo "[pilot] a process exited (code=${code}); stopping the other so Fly restarts the machine"
kill "${worker_pid}" "${web_pid}" 2>/dev/null || true
exit "${code}"
