#!/usr/bin/env bash
# Luminila backup: online SQLite snapshots of the primary and tenant databases,
# plus a copy of any JSON/ZIP exports produced by the in-app /backup page.
#
# Install: sudo cp deploy/backup/backup.sh /usr/local/bin/luminila-backup
#          sudo chmod 750 /usr/local/bin/luminila-backup
set -Eeuo pipefail

PB_ROOT="${PB_ROOT:-/opt/luminila/pocketbase}"
OUT_ROOT="${OUT_ROOT:-/var/backups/luminila}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT_ROOT}/${STAMP}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$OUT"

snapshot() {
    local db="$1"
    if [ ! -f "$db" ]; then
        return 0
    fi
    local rel="${db#${PB_ROOT}/}"
    local target="${OUT}/${rel//\//_}"
    # SQLite online backup is safe while PocketBase is writing (WAL mode).
    sqlite3 "$db" ".backup '${target}'"
    echo "snapshot: $db -> $target"
}

snapshot "${PB_ROOT}/pb_data/data.db"
snapshot "${PB_ROOT}/pb_data/auxiliary.db"

# Tenant databases live under pb_tenants/<slug>/data.db
while IFS= read -r -d '' tenant_db; do
    snapshot "$tenant_db"
done < <(find "${PB_ROOT}/pb_data/pb_tenants" -maxdepth 2 -name 'data.db' -print0 2>/dev/null || true)

# In-app exports (Settings → Export snapshot, /backup page) live in the data dir.
if [ -d "${PB_ROOT}/pb_data/storage" ]; then
    cp -a "${PB_ROOT}/pb_data/storage" "${OUT}/storage"
fi

# Also keep a copy of tenant credentials, but never of the plaintext registry:
# after the S-06 re-key the registry is encrypted with TENANT_REGISTRY_KEY, which
# is intentionally NOT stored on this machine's backup volume.
if [ -f "${PB_ROOT}/pb_data/pb_tenants/registry.json" ]; then
    cp -a "${PB_ROOT}/pb_data/pb_tenants/registry.json" "${OUT}/registry.json"
fi

find "$OUT_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+${KEEP_DAYS}" -exec rm -rf {} +
echo "backup complete: ${OUT}"
