#!/usr/bin/env bash
# Daily copy of everything in the private Cloudflare backup bucket (the nightly encrypted
# database copies and the weekly files copy) to a SECOND provider, Backblaze B2, in an
# account the founder owns (run by .github/workflows/backup-offsite.yml).
#
# Why: if the Cloudflare account were lost or locked, the backups would go with the files.
# This keeps a copy somewhere independent.
#
# It only ever ADDS (rclone copy, never sync): nothing is deleted from the second copy by
# this job. Database copies are already encrypted before they reach the backup bucket (see
# backup-db.sh), so B2 only ever holds encrypted database data.
#
# Needs: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BACKUP_BUCKET (read the
# backup bucket) and B2_ENDPOINT, B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET (write the B2 bucket).
set -euo pipefail

: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${BACKUP_BUCKET:?}"
: "${B2_ENDPOINT:?}" "${B2_KEY_ID:?}" "${B2_APPLICATION_KEY:?}" "${B2_BUCKET:?}"

export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=Cloudflare \
  RCLONE_CONFIG_SRC_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_SRC_NO_CHECK_BUCKET=true
# B2 speaks the S3 protocol; the endpoint looks like s3.eu-central-003.backblazeb2.com
ENDPOINT="${B2_ENDPOINT#https://}"
export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Other \
  RCLONE_CONFIG_DST_ENDPOINT="https://${ENDPOINT}" \
  RCLONE_CONFIG_DST_ACCESS_KEY_ID="$B2_KEY_ID" RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
  RCLONE_CONFIG_DST_NO_CHECK_BUCKET=true

SRC="SRC:${BACKUP_BUCKET}"
DST="DST:${B2_BUCKET}"

# The job log of a public repository is public: rclone's own output lists file paths, so it is
# kept in a private temp file and only the outcome is printed.
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

echo "Copying new backups to the second provider (nothing is ever deleted there by this job)…"
if ! rclone copy "$SRC" "$DST" --transfers 4 --checkers 8 --retries 3 --log-level ERROR 2> "$LOG"; then
  echo "ERROR: the copy to the second provider failed. Reasons seen (file paths hidden):" >&2
  grep -o 'status code: [0-9]*\|AccessDenied\|NoSuchBucket\|InvalidAccessKeyId\|SignatureDoesNotMatch\|no such host' "$LOG" | sort | uniq -c >&2 || true
  exit 1
fi

echo "Checking every backup is in the second copy with the same size…"
if ! rclone check "$SRC" "$DST" --one-way --size-only --checkers 8 --log-level ERROR 2> "$LOG"; then
  echo "ERROR: some backups are missing from the second copy or differ in size (paths hidden)." >&2
  exit 1
fi
echo "Second copy is complete."
