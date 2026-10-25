#!/usr/bin/env bash
# Weekly copy of the app's files (photos, voice notes, videos, PDFs, covers)
# from the media bucket to the private backup bucket (run by
# .github/workflows/backup-files.yml).
#
# It only ever ADDS: files deleted from the app stay in the backup, which is
# the point — Cloudflare R2 has no "undo". Nothing is encrypted here (the
# files are already stored the same way in the media bucket); the backup
# bucket is private.
#
# Needs: R2_ACCOUNT_ID, MEDIA_BUCKET + MEDIA_ACCESS_KEY_ID/MEDIA_SECRET_ACCESS_KEY
# (read-only on the media bucket), BACKUP_BUCKET + R2_ACCESS_KEY_ID/
# R2_SECRET_ACCESS_KEY (read & write on the backup bucket).
set -euo pipefail

: "${R2_ACCOUNT_ID:?}" "${MEDIA_BUCKET:?}" "${MEDIA_ACCESS_KEY_ID:?}" "${MEDIA_SECRET_ACCESS_KEY:?}"
: "${BACKUP_BUCKET:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"

ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
# Two rclone "remotes", configured from the environment (no config file, no secrets on disk).
export RCLONE_CONFIG_MEDIA_TYPE=s3 RCLONE_CONFIG_MEDIA_PROVIDER=Cloudflare RCLONE_CONFIG_MEDIA_ENDPOINT="$ENDPOINT" \
  RCLONE_CONFIG_MEDIA_ACCESS_KEY_ID="$MEDIA_ACCESS_KEY_ID" RCLONE_CONFIG_MEDIA_SECRET_ACCESS_KEY="$MEDIA_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_MEDIA_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Cloudflare RCLONE_CONFIG_BACKUP_ENDPOINT="$ENDPOINT" \
  RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true

SRC="MEDIA:${MEDIA_BUCKET}"
DST="BACKUP:${BACKUP_BUCKET}/files"

echo "Files in the media bucket:"
rclone size "$SRC"

echo "Copying new files (nothing is ever deleted from the backup)…"
rclone copy "$SRC" "$DST" --transfers 8 --checkers 16 --retries 3 --stats-one-line --stats 30s

echo "Checking every file is in the backup with the same size…"
rclone check "$SRC" "$DST" --one-way --size-only --checkers 16
echo "Files backup done."
