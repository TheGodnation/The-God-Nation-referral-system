# Backups

## What is protected, and what is not yet

| What | Where it lives | Protected by |
|---|---|---|
| Members, messages, quizzes, teachings, payments… (the database) | Neon | **Nightly encrypted backup** to a private Cloudflare R2 bucket (this guide) |
| Photos, voice notes, videos, PDFs, book covers | Cloudflare R2 | Not backed up yet (see "Files" at the end) |

Neon's own safety net on the free plan is only a **6-hour** history
(<https://neon.com/docs/introduction/history-window>): enough to undo a
mistake made this morning, not one found next week. The nightly backup is
what covers that.

## How it works

Every night at about 02:37 UTC, the "Database backup" job on GitHub
(`.github/workflows/backup.yml`):

1. makes a full copy of the database;
2. checks the copy is readable and really holds the main tables;
3. **encrypts it** (members' emails, phone numbers and messages are in it, so
   it is never stored in the clear);
4. uploads it to a **private** R2 bucket and checks it arrived whole;
5. **restores it into a throw-away database** and checks the data is there —
   so a backup that could not be restored is noticed the same day;
6. deletes old copies: it keeps every backup of the last 30 days, then the
   newest of each month for a year (and always at least the newest 3).

If any step fails the job turns red and GitHub emails you. Until the secrets
below are added, the job only shows a yellow warning and does nothing.

## Setting it up (once, about 15 minutes, best on a computer)

### 1. A private bucket on Cloudflare

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**.
2. Name it `godnation-backups`. Leave it **private** (do not turn on any public
   access). This must be a *different* bucket from the one that holds photos.
3. On the R2 page, note your **Account ID** (shown on the right).
4. **R2 → Manage R2 API Tokens → Create API token**:
   - Permission: **Object Read & Write**;
   - Apply to specific bucket: **godnation-backups** only;
   - Create, then copy the **Access Key ID** and **Secret Access Key** (the
     secret is shown only once).

### 2. The database address

Use the same address the app already uses (the `DATABASE_URL` in Render). The
backup tool fixes the pooler part and the extra settings by itself.

*Optional, safer:* in Neon create a second user that can only read, and use
its address here.

### 3. A passphrase

Make up a long passphrase (for example five unrelated words). **Keep it in a
safe place outside GitHub — in your password manager and written on paper.
If it is lost, the backups cannot be opened by anyone, including us.**

### 4. Give GitHub the six secrets

GitHub → the repository → **Settings → Secrets and variables → Actions →
New repository secret**. Add these six (name exactly as written):

| Name | Value |
|---|---|
| `BACKUP_DATABASE_URL` | the database address from step 2 |
| `BACKUP_PASSPHRASE` | the passphrase from step 3 |
| `R2_ACCOUNT_ID` | the Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | from the API token |
| `R2_SECRET_ACCESS_KEY` | from the API token |
| `BACKUP_BUCKET` | `godnation-backups` (optional: used by default if not added) |

### 5. Try it now

GitHub → **Actions** → **Database backup** → **Run workflow**. After a few
minutes it should turn green, and a file such as
`db/2026/10/godnation-20261025-023700.dump.enc` appears in the bucket. Look at
the job's log: the last lines say "Upload verified" and "Restore check passed."

Also check **GitHub → Settings → Notifications → Actions** so failed runs email you.

## Restoring (if something goes wrong)

**Never restore straight over the live database.** Restore into a new, empty
database, look at it, then switch the app to it.

1. In Neon, create a new empty database (or a new project) and copy its address.
2. On a computer with PostgreSQL tools (`pg_restore`), `openssl` and the AWS
   command line, from this repository:

   ```bash
   export BACKUP_PASSPHRASE='…your passphrase…'
   export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… BACKUP_BUCKET=godnation-backups
   # see what exists:
   AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
     aws s3 ls s3://$BACKUP_BUCKET/db/ --recursive --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
   # restore one:
   server/scripts/backup/restore-db.sh db/2026/10/godnation-20261025-023700.dump.enc 'postgresql://…new empty database…'
   ```
3. Check the data, then change `DATABASE_URL` (and `DIRECT_URL`) in Render to the
   new database address and let the app restart.

You can also just tell Claude "restore the backup from <date>" and give it the
passphrase and the new database address.

## Files (photos, voice notes, videos, PDFs)

These are in Cloudflare R2, which keeps several copies inside Cloudflare, but
R2 has no "undo": a deleted file is gone. So every Sunday the "Files backup"
job (`.github/workflows/backup-files.yml`) copies them into the same private
backup bucket, under `files/`. It **only adds**: a file deleted from the app
stays in the backup. It then checks every file is there with the same size.

Extra setup (after the database backup works), once:

1. Cloudflare → R2 → **Manage R2 API Tokens → Create API token**:
   permission **Object Read only**, applied to the **photos bucket only**
   (the one the app uses — its name is `R2_BUCKET_NAME` in Render). Copy the
   Access Key ID and Secret.
2. GitHub → Settings → Secrets and variables → Actions → add three secrets:

   | Name | Value |
   |---|---|
   | `MEDIA_BUCKET` | the photos bucket's name |
   | `MEDIA_ACCESS_KEY_ID` | from the read-only token |
   | `MEDIA_SECRET_ACCESS_KEY` | from the read-only token |

3. GitHub → Actions → **Files backup** → **Run workflow** to try it. The first
   run copies everything, so it can take a while; later runs only copy what is new.

The backup grows over time because nothing is ever removed from it. Cloudflare
charges a small amount per GB beyond the free 10 GB.

## Cost

The database: practically nothing — each backup is a few megabytes and about 45
are kept (far below R2's free 10 GB). The files copy grows with your photos and
videos (R2 charges a small amount per GB above the free 10 GB). The jobs run a
few minutes on GitHub.
