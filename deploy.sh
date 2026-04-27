#!/usr/bin/env bash
set -euo pipefail

if [ -z "${UNLOCK_TOKEN:-}" ]; then
  echo "Usage: UNLOCK_TOKEN=<your-token> ./deploy.sh"
  exit 1
fi

cd "$(dirname "$0")/infrastructure"

echo "▶ Installing dependencies…"
npm install --silent

echo "▶ Deploying stack…"
npx cdk deploy --all \
  --require-approval never \
  --context unlock_token="$UNLOCK_TOKEN"

BASE_URL="${BASE_URL:-https://ght.vexom.io}"
ENC="$(node -e "console.log(encodeURIComponent(process.argv[1]))" "${UNLOCK_TOKEN}")"
echo ""
echo "✓ Done. Unlock (bookmark this URL): ${BASE_URL}/?unlock=${ENC}"
