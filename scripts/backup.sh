#!/usr/bin/env bash
set -euo pipefail

: "${UNLOCK_TOKEN:?Set UNLOCK_TOKEN}"
BASE_URL="${BASE_URL:-https://ght.vexom.io}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
mkdir -p "$OUT_DIR"

htok=$(printf '%s' "$UNLOCK_TOKEN" | shasum -a 256 | awk '{print $1}')
stamp=$(date +%Y%m%d-%H%M%S)
file="$OUT_DIR/habit-tracker-$stamp.json"

echo "Fetching $BASE_URL/api/cycles ..."
cycles=$(curl -fsS --cookie "htok=$htok" "$BASE_URL/api/cycles")

echo "Fetching $BASE_URL/api/entries ..."
entries=$(curl -fsS --cookie "htok=$htok" "$BASE_URL/api/entries")

# Compose a single JSON file with both payloads.
python3 - "$file" <<EOF
import json, sys
cycles = json.loads('''$cycles''')
entries = json.loads('''$entries''')
payload = {
  "exportedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
  "cycles": cycles.get("cycles", []),
  "entryBounds": cycles.get("entryBounds"),
  "entries": entries.get("entries", {}),
}
with open(sys.argv[1], "w") as f:
  json.dump(payload, f, indent=2)
EOF

echo "Saved $file"
