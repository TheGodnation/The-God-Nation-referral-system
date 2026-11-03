# Second backup copy (Backblaze B2) — step by step

Written 3 November 2026 for the founder. **Stage 1 is built**; it waits for you to create the account. Nothing changes in the app, and until you finish these steps the nightly check simply says "not set up yet" and does nothing.

## Why

Today the database is copied every night, and the files every week, into a private Cloudflare bucket. If the Cloudflare account were ever lost, locked or hacked, the backups would disappear together with the files. A second copy in a **different company, in an account only you own**, closes that gap.

## What it does once set up

Every day at about 04:47 UTC (after the nightly database backup) it copies everything from the Cloudflare backup bucket to Backblaze, then checks every file arrived with the same size. It only **adds**: it never deletes from the second copy. The database copies are already **encrypted** before they are stored, so Backblaze only ever holds scrambled database data.

## Stage 2 — what you do (about 20 minutes)

1. Go to **backblaze.com** → *B2 Cloud Storage* → sign up. Use an email that only you control and turn on two-step sign-in. Backblaze may ask you to confirm your identity and add a payment card; the first 10 GB is free, and our backups are small, so expect cents to a few dollars a month (I could not confirm Backblaze's current prices on their own page; check theirs when you sign up).
2. In B2, click **Create a Bucket**:
   - name: something like `godnation-offsite-backup` (it must be unique worldwide; add a few random letters if it is taken);
   - **Files in bucket are: Private**;
   - **Default encryption: Enable**;
   - Object lock: leave off.
   Write down the bucket name.
3. Open **Application Keys** → **Add a New Application Key**:
   - name: `github-backup`;
   - allow access to **only that one bucket**;
   - type of access: **Read and Write**.
   Click create. Backblaze now shows two things **once only**: the **keyID** and the **applicationKey**. Copy both somewhere safe at once.
4. On the bucket's page, note its **Endpoint** (it looks like `s3.eu-central-003.backblazeb2.com`). It is shown in the bucket details under "Endpoint".
5. Open GitHub → this project → **Settings → Secrets and variables → Actions → New repository secret**, and add four secrets, one by one:

   | Name | What to paste |
   |---|---|
   | `B2_KEY_ID` | the keyID from step 3 |
   | `B2_APPLICATION_KEY` | the applicationKey from step 3 |
   | `B2_BUCKET` | the bucket name from step 2 |
   | `B2_ENDPOINT` | the endpoint from step 4 |

6. In GitHub open **Actions → "Second backup copy (Backblaze B2)" → Run workflow**. It should finish green and say "Second copy is complete." Then look in your B2 bucket: you should see `db/…` and `files/…` folders. Tell me, and I will check the run.

## One more safety step (important)

The database copies are locked with the passphrase stored in the GitHub secret `BACKUP_PASSPHRASE`. **Without that passphrase no backup can ever be opened.** Keep a copy of the passphrase **outside GitHub and outside this computer** (a password manager, or written on paper in a safe place). If you have not done that yet, do it now.

## Optional, later

- In B2, set a **lifecycle rule** on the bucket (for example "delete files after 400 days") so the second copy does not grow forever. Only do this after we agree what to keep.
- Once a year, do a **restore drill**: I will help you restore the newest copy from Backblaze into a test database to prove it works.

## What this does not cover (so you know)

- The second copy is only as fresh as the first (daily for the database, weekly for files).
- It is not yet checked by restoring *from Backblaze*; the nightly job already proves the Cloudflare copy restores. The restore drill above covers the rest.
