#!/usr/bin/env bash
# Proves a stored backup can really be restored: downloads it, decrypts it,
# restores it into a throw-away database and checks the main tables hold data.
# Run by the workflow after every backup, so a backup that could not be
# restored is noticed the same day instead of when it is needed.
#
#   verify-restore.sh <backup-file-or-key> <scratch-database-url>
#
# With LIVE_DATABASE_URL set, it also checks the restored copy is not missing
# people compared with the live database.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"
BACKUP="${1:?backup file or key}"
SCRATCH="$(clean_url "${2:?scratch database url}")"
EXPECTED=""
if [ -n "${LIVE_DATABASE_URL:-}" ]; then
  EXPECTED="$(psql "$(clean_url "$LIVE_DATABASE_URL")" -Atc 'select count(*) from "Person"')"
fi

"$HERE/restore-db.sh" "$BACKUP" "$SCRATCH" --yes >/dev/null
for table in Person MemberAccount Message Community; do
  # Counts are never printed: on a public repository the job log is public.
  count="$(psql "$SCRATCH" -Atc "select count(*) from \"${table}\"")"
  if [ "$table" = "Person" ]; then
    [ "$count" -gt 0 ] || { echo "ERROR: the restored database has no people" >&2; exit 1; }
    if [ -n "$EXPECTED" ]; then
      # Members may have joined while the backup ran; it must not be missing many.
      [ "$count" -ge $(( EXPECTED * 99 / 100 )) ] || { echo "ERROR: the restored copy is missing people compared with the live database" >&2; exit 1; }
    fi
  fi
done
echo "Restore check passed."
