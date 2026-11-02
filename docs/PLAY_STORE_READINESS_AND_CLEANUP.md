# The God Nation — Clean-up report and Play Store readiness check

## Decisions made by the founder (2 November 2026)

- Clean-up approved: the whole A list, the leader-recommendation feature
  (including its database table), the personal WhatsApp setting, the old
  README and acceptance-test document.
- Leaders' shared links now lead to the new sign-up (`/member/join`). The old
  `/welcome` and `/register` links stay working and lead to the same place.
- The leader self-sign-up phrase and page are removed.
- The privacy page may mention King's Tokens (done, worded as study rewards
  with no cash value).
- Payments for the first Android release: option 3. Paid books stay on the
  website; the Android app only offers books the ministry has unlocked.
  (Not built yet: it is part of the Play Store build work.)
- Store name: **The God Nation**.
- Store details (screenshots, descriptions): later, when we start that step.
- Second clean-up round approved: the Updates banner picture, the old
  three-step sign-up routes, and anything else that no longer fits the app.

## What was removed in the clean-up (done)

- Dead text, five unused functions, the unused Updates banner screen part, and
  the one-time backfill tool.
- Leader recommendations (feature and database table), the personal WhatsApp
  setting, leader self-sign-up (page, route, phrase), and the old Home,
  Welcome and Registration text editors in the admin "Website text" tab.
- The Updates banner picture (admin upload, server routes, stored settings).
- The old three-step sign-up on the server (`/signup/start`, `/check-code`,
  `/finish`), its holding table and its email. The live sign-up (email, phone,
  password, emailed link, then the details form) does everything they did:
  referral attribution, leader pairing, group placement.
- The leader dashboard's "WhatsApp clicks" number and "Joined / Not joined"
  column: nothing recorded WhatsApp clicks any more, so they always read zero.
- The admin Sign-in trouble list no longer has the "Joining not finished" row,
  which only came from the old wizard.
- `/welcome` and `/register` links still work (they lead to the new sign-up).

Left in place on purpose: the stored `WHATSAPP_CLICKED` event type and old
registration rows (history), the staff leader sign-in and invitation flow
(used by appointed leaders), and the wallpaper pickers (still shown in the app).
The old banner image file may still sit in file storage; it is no longer
reachable and can be deleted from the storage dashboard.


Written 2 November 2026. This is a report only. Nothing has been deleted or
changed. Each item says what it is, why it is not needed any more, and how
safe it is to remove. Tell me which items to go ahead with.

## The short answer

- **The app is close to Play Store ready, but not ready to submit today.** The
  big pieces are already in place: a working installable app (PWA), a privacy
  page, an account-deletion page and in-app deletion, report and block tools,
  no ads and no trackers.
- **Four things must be fixed or decided before we submit:** (1) the Digital
  Asset Links file is missing, and the server as written would not serve it
  even if we added it; (2) the way members pay for books by Mobile Money may
  clash with Google's payment rules; (3) the privacy page does not yet mention
  King's Tokens; (4) a few store details (screenshots, description, content
  rating form) have to be prepared.
- **Clean-up is small and safe.** Around 200 unused text lines, one unused
  screen component, a few unused functions, one unused database column and one
  whole abandoned feature (leader recommendations) can be removed. None of it
  is visible to members.

---

## Part 1 — Clean-up report

### A. Safe to remove (confirmed not used anywhere)

| # | What | Why it is not needed | Risk if removed |
|---|------|----------------------|-----------------|
| A1 | **Old Home page words**: 25 text keys beginning `home.` (hero_title, vision_title, vision_body, how_1…3, training_*, discover_* …), in English and French | The Home page was redesigned; none of these lines is shown any more | None |
| A2 | **Leader-recommendation feature, text**: 44 text keys (`admin.organizationalLeadershipRecommendations.*`, `leader.organizationalLeadershipRecommendations.*`) | The feature was removed in Phase 1b ("Ready to lead" replaced it); only the words are left | None |
| A3 | **Leader-recommendation feature, database**: table `OrganizationalLeadershipRecommendation`, its status list and its links from Person, User and Community | Nothing in the app reads or writes it any more (only a code comment mentions it) | Low. Needs one migration that drops the table. I would first check the table is empty on production |
| A4 | **Old follow-up chat words**: 16 text keys (`followUpConversation.*`, `memberFollowUps.*`) | Replaced by the follow-up card and private-chat flow in Phase 2 | None |
| A5 | **Updates banner screen part** (`UpdatesBanner.tsx`) | Not placed on any page now; only a test uses it. Its text (Mission / Vision / Purpose boxes) is also out of date against the new motto | None. Remove the file and its test |
| A6 | **Unused small functions (client)**: `FormIcon`, `CrossIcon`, `disablePushNotifications`, `canRecord`, `clearDraft` | Written, never called | None |
| A7 | **`WhatsApp contact` setting** (`Settings.whatsappContactUrl`, and its field in the admin and public settings answers) | We removed the personal WhatsApp contact from Home and About. Nothing on the app reads it. The old number is still stored in the database | Low. Remove the field, then a migration drops the column (this also deletes the stored personal number, which is good) |
| A8 | **`personBackfill.ts`** (server) | A one-time tool from Phase 3 that linked old registrations to people. It is only run by its own test | None |
| A9 | **`robots.txt`** points to `/sitemap.xml` with no domain | Google wants the full web address, `https://thegodnationacademy.org/sitemap.xml`. The sitemap itself exists | None, this is a one-line fix |
| A10 | **Old manifest and page description**: "Be Equipped. Be Transformed. Be Sent. Register and join our WhatsApp community." (manifest.webmanifest and index.html) | Out of date; it is the first thing Google and the Play Store show | None. Replace with the new description (see Part 2) |

### B. Probably not needed, but I need your decision

| # | What | Question |
|---|------|----------|
| B1 | **Two sign-up doors.** `/member/join` is the one used by every button in the app. `/register` and `/welcome` are an older door that leaders' shared links (the "second pair of links") still point to | Do you want leaders' links to use the new door too? If yes, `/register`, `/welcome`, their text and the "second pair of links" can go. If leaders already shared those links, we must keep them working (redirect) |
| B2 | **`ParticipationEvent` table.** It is written when people finish things, but nothing reads it | It may be meant for a later feature (Phase 5d "months of study"). Keep, unless you say it is not needed |
| B3 | **Leader self-signup page** (`/leader-signup` and the access phrase) | Leaders are now appointed from the member side. Do you still want leaders to sign themselves up with a phrase? If not, the page, the phrase and the route can go |
| B4 | **Automatic payments "ready" code** (`registerPaymentProvider`, `automaticPaymentsEnabled`) | It is waiting for an online payment company. Keep until you decide on that (this also touches the Google rules in Part 2) |
| B5 | About 390 more text lines look unused when searched by name, but may be built up in code. I did not touch these | Safe to leave. If you want them removed I would check each group with a test run |

### C. Papers and files that are out of date

| # | What | Suggestion |
|---|------|------------|
| C1 | **README.md** (367 lines) still describes "Phase 1 — Referral MVP", with the old vision/mission/purpose and "Native Android/iOS apps — out of scope" | Rewrite to describe the app as it is now |
| C2 | **docs/ACCEPTANCE_TESTS.md** covers Phase 1 only | Rewrite or retire |
| C3 | **Scheduled reminder** `trig_01352sbiu4G47rFquJyxKkp8` still holds an old phase plan | Update or delete |
| C4 | **`test-results/` and `e2e/`** at the top of the project | `test-results/` is not saved to GitHub (already ignored), so only local. `e2e/` browser tests exist but I have not seen them run lately; run them once, or retire them |
| C5 | Several `export`s on the server that only tests use (about 100, harmless) | Leave |

### D. Things I checked and found tidy

- No unused screens (every page is on a route).
- No unused packages in the app's package lists.
- No leftover references to removed features in the code, apart from the items above.
- English and French have exactly the same keys (3,541 each).
- Database matches the migrations (no drift).

---

## Part 2 — Play Store readiness check

The usual road for an app like ours is a **Trusted Web Activity**: Google Play
opens our website inside a thin Android shell. It needs no rewrite. It does
need the items below.

### Traffic lights

| Area | Status | Notes |
|------|--------|-------|
| Installable web app (manifest, icons, service worker, HTTPS) | Green | Name, id, start page `/member/chats`, standalone, portrait, 192/512 icons and a maskable 512 icon all present |
| Digital Asset Links (`/.well-known/assetlinks.json`) | **Red** | File missing. Also, the server's static handler ignores folders starting with a dot, so the file would not be found even if added. Needs a small server change |
| Privacy policy page | Amber | Page exists (/privacy) and is thorough. It does not mention King's Tokens, the token ledger or spending tokens. "Last updated" must change |
| Account deletion (Google requires both) | Green | In app (Me → Edit profile → Delete my account) and on the web at /delete-account; 30-day cancel; explained in the privacy page |
| User-generated content rules | Green | Report (posts and people), block, leaders and admin review reports, central admin can oversee chats |
| Payments policy (books and tokens) | **Red / decision** | See below |
| Content rating | To do | Questionnaire in Play Console. Likely "everyone / teen" with user-to-user chat; must answer honestly about chat and sharing |
| Data safety form | To do | Information is ready: see list below |
| Store listing (text, icon, graphics, screenshots) | To do | Not prepared yet |
| Permissions | Green | Notifications, microphone (voice notes), camera (video notes), all asked only when used |
| Performance | Amber | Main script is 662 KB (202 KB zipped); the admin dashboard another 265 KB. Works, but slower on weak phones. Can be improved later |
| Developer account and app signing | To do | Needs your Google Play developer account (one-time US$25 fee, identity check) |
| Target audience | To do | Declare adults, 18+ recommended; the privacy page says under-age use needs a parent's permission, which should be aligned |

### The payments question (most important)

Google Play requires that **digital goods sold inside an app** (ebooks,
in-app currency) are paid through **Google Play billing**. Google keeps a
share (15% to 30%). In our app members pay for leadership books by Mobile Money
to a number or a payment agent, and can lower the price with earned tokens.

What is clear:

- **Giving, tithes and offerings:** allowed, they are donations, not sales.
- **Earned tokens used to lower a book price:** allowed on their own. They are
  rewards, not sold.
- **Selling tokens for money:** not allowed without Google billing. We have not
  built this, and Phase 5 already waits for this decision.

What is not clear and must be settled before submission:

- **Books paid by Mobile Money inside the app.** Google may treat this as a
  payment outside Google billing. The rules differ by country, and Cameroon
  and many African countries have special local-payment programs. I could not
  confirm how it applies to an app opened through a Trusted Web Activity.

The safest choices, for you to decide:

1. **Pay outside the app.** In the Android app, the "Pay for a book" button
   shows how to pay and says "continue on our website". Google may still object.
2. **Ask Google for an exception or use a local payment program** for your
   country (to be checked in Play Console before submitting).
3. **Launch the Android app with the books unlocked by the ministry**
   (Dominion Clinic is free through the monthly book) and keep paid books on the
   website until we have an answer.

My recommendation: do 3 for the first release, and ask Google (Play Console
support) about 2 in parallel, so a payments rejection does not delay launch.

### What the data safety form will say (ready from the privacy page)

- Collected: name, email, phone (WhatsApp) number, address (location region),
  photos and files, voice and video notes, messages, in-app activity
  (training progress, exam results), payment info (order records only; we never
  see a PIN), notifications code.
- Shared with others: Gemini translation receives group text and group voice
  notes; Cloudflare R2, Render and Resend process data for us.
- No ads, no tracking, no data sold.
- Encrypted in transit (HTTPS). Deletion available in app and on the web.

### Work list to reach the Play Store

I would do these in this order. None is started.

1. **Server:** serve `/.well-known/assetlinks.json` (allow dot-folders for that
   one path). Fill it after the app is signed (needs the signing fingerprint).
2. **Manifest:** new description, add `categories`, add 4 to 8 screenshots,
   add shortcuts (Chats, Learn, Tokens). Keep the 512 maskable icon.
3. **Privacy page:** add King's Tokens (earning, ledger, spending, burning),
   Dominion Clinic exams, and the giving statement; change the date.
4. **Clean-up:** items in Part 1, A-list.
5. **Payments decision** above.
6. **Store listing:** short description (80 characters), full description in
   English and French, icon 512×512, feature graphic 1024×500, at least 2
   phone screenshots (I can prepare them from the real app).
7. **Build the Android package** (Bubblewrap) and sign it. This needs a
   computer with Android tools or a build service; I can prepare the settings
   and the exact commands.
8. **Play Console:** create the app, fill the content rating, data safety,
   target audience, financial features and ads declarations, upload to
   **Internal testing** first (no review wait), then Closed testing. New
   personal developer accounts must run a closed test with at least 12 testers
   for 14 days before production; plan for that. Organisation accounts do not
   have this rule, so register as an organisation if you can.
9. **Production release** after the testing period.

### Decisions I need from you

1. Approve the Part 1 clean-up (A items, and which of B you want).
2. Payments: option 1, 2 or 3 above, for the first Android release.
3. Developer account: personal or organisation (the ministry)?
4. Do you want the Play Store name to be **The God Nation**?
5. Anything you want to say in the store description (I will draft it in
   English and French for your approval).
