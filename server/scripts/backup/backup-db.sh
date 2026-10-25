#!/usr/bin/env bash
# Daily backup of the production database (run by .github/workflows/backup.yml).
#
#   1. dumps the whole database (pg_dump, custom format, already compressed);
#   2. checks the dump is readable and really contains the main tables;
#   3. encrypts it (AES-256) with BACKUP_PASSPHRASE — the dump holds members'
#      emails, phone numbers and messages, so it is never stored in the clear;
#   4. uploads it to the private backup bucket on Cloudflare R2 and checks the
#      upload arrived whole;
#   5. deletes backups that are old enough to go (see retention.cjs).
#
# Needs: BACKUP_DATABASE_URL (the *direct* Neon address, not the pooled one),
# BACKUP_PASSPHRASE, and for the upload R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
# R2_SECRET_ACCESS_KEY, BACKUP_BUCKET. For tests, BACKUP_LOCAL_DIR stores the
# encrypted file in a folder instead of R2.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"
SOURCE_URL="$(clean_url "$BACKUP_DATABASE_URL")"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="godnation-${STAMP}.dump.enc"
KEY="db/${STAMP:0:4}/${STAMP:4:2}/${NAME}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Dumping the database…"
pg_dump --format=custom --no-owner --no-privileges --dbname="$SOURCE_URL" --file="$WORK/dump"

echo "Checking the dump…"
pg_restore --list "$WORK/dump" > "$WORK/contents.txt"
for table in Person MemberAccount Message Community; do
  grep -Eq "TABLE public \"?${table}\"? " "$WORK/contents.txt" || { echo "ERROR: table ${table} is missing from the dump" >&2; exit 1; }
done
SIZE="$(stat -c %s "$WORK/dump")"
[ "$SIZE" -gt 20000 ] || { echo "ERROR: the dump is suspiciously small (${SIZE} bytes)" >&2; exit 1; }
echo "  ${SIZE} bytes, $(wc -l < "$WORK/contents.txt") items."

echo "Encrypting…"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in "$WORK/dump" -out "$WORK/$NAME" -pass env:BACKUP_PASSPHRASE
ENC_SIZE="$(stat -c %s "$WORK/$NAME")"

if [ -n "${BACKUP_LOCAL_DIR:-}" ]; then
  mkdir -p "$BACKUP_LOCAL_DIR/$(dirname "$KEY")"
  cp "$WORK/$NAME" "$BACKUP_LOCAL_DIR/$KEY"
  echo "Stored locally: $BACKUP_LOCAL_DIR/$KEY"
  echo "$KEY" > "${BACKUP_LAST_KEY_FILE:-/dev/null}"
  exit 0
fi

: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${BACKUP_BUCKET:?}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
# Recent aws-cli versions add checksums that R2 does not accept.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
R2="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Uploading ${KEY} (${ENC_SIZE} bytes)…"
aws s3 cp "$WORK/$NAME" "s3://${BACKUP_BUCKET}/${KEY}" --endpoint-url "$R2" --only-show-errors
REMOTE_SIZE="$(aws s3api head-object --bucket "$BACKUP_BUCKET" --key "$KEY" --endpoint-url "$R2" --query ContentLength --output text)"
[ "$REMOTE_SIZE" = "$ENC_SIZE" ] || { echo "ERROR: uploaded ${REMOTE_SIZE} bytes but sent ${ENC_SIZE}" >&2; exit 1; }
echo "Upload verified."
echo "${KEY}" > "${BACKUP_LAST_KEY_FILE:-/dev/null}"

echo "Removing backups that are old enough to go…"
aws s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix db/ --endpoint-url "$R2" --query 'Contents[].Key' --output text | tr '\t' '\n' \
  | node "$HERE/retention.cjs" > "$WORK/delete.txt" || true
if grep -q . "$WORK/delete.txt"; then
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    echo "  deleting $old"
    aws s3 rm "s3://${BACKUP_BUCKET}/${old}" --endpoint-url "$R2" --only-show-errors
  done < "$WORK/delete.txt"
else
  echo "  nothing to remove."
fi
echo "Backup done."
