#!/usr/bin/env bash
# Restores a backup made by backup-db.sh.
#
#   restore-db.sh <backup> <target-database-url> [--yes]
#
# <backup> is either a file on this computer, or the backup's name in the
# bucket (db/2026/10/godnation-20261025-023700.dump.enc — see `aws s3 ls`).
# Needs BACKUP_PASSPHRASE; for a name in the bucket also R2_ACCOUNT_ID,
# R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and BACKUP_BUCKET.
#
# WARNING: this REPLACES the contents of the target database. Restore into a
# new, empty database first and look at it before pointing the app at it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"
BACKUP="${1:-}"
TARGET="$(clean_url "${2:-}")"
CONFIRM="${3:-}"
[ -n "$BACKUP" ] && [ -n "$TARGET" ] || { echo "Usage: $0 <backup-file-or-key> <target-database-url> [--yes]" >&2; exit 2; }
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

if [ "$CONFIRM" != "--yes" ]; then
  echo "This will REPLACE everything in the target database:"
  echo "  ${TARGET%%\?*}" | sed -E 's#://[^@]*@#://***@#'
  read -r -p "Type YES to continue: " answer
  [ "$answer" = "YES" ] || { echo "Cancelled."; exit 1; }
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -f "$BACKUP" ]; then
  cp "$BACKUP" "$WORK/backup.enc"
else
  : "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${BACKUP_BUCKET:?}"
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  aws s3 cp "s3://${BACKUP_BUCKET}/${BACKUP}" "$WORK/backup.enc" --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" --only-show-errors
fi

echo "Decrypting…"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$WORK/backup.enc" -out "$WORK/dump" -pass env:BACKUP_PASSPHRASE \
  || { echo "ERROR: could not decrypt — wrong BACKUP_PASSPHRASE, or the file is damaged." >&2; exit 1; }

# A wrong passphrase occasionally gets past decryption as junk: catch it here.
pg_restore --list "$WORK/dump" > /dev/null 2>&1 \
  || { echo "ERROR: could not decrypt — wrong BACKUP_PASSPHRASE, or the file is damaged." >&2; exit 1; }

echo "Restoring…"
pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error --dbname="$TARGET" "$WORK/dump"
echo "Restore done."
