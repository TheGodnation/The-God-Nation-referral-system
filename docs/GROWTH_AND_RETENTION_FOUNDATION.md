# The God Nation — Growth and retention foundation (no app store needed)

Written 3 November 2026. Each phase is built only when the founder says to
start it. **Phase A is built (3 November 2026).** The rest is still a blueprint.

## Phase A — what was built

- **Ad and link details on every visit and sign-up:** campaign details
  (source, medium, campaign, ad name), the Facebook, TikTok and Google click
  codes, and the website the visitor came from (the website name only). First
  visits from a phone, visits that arrive through an ad or another website, and
  every referral link are recorded; a member opening the app daily is not.
- **Recorded consent:** two unticked boxes at sign-up (WhatsApp updates, email
  updates). Every choice is kept with the date and the exact sentence shown, in
  English or French, and cannot be edited, only replaced by a newer choice. Each
  member can change their choices on their Me page at any time.
- **"Stay connected" box** on the Home page and at the end of every public
  content page: name + WhatsApp number + a tick. Nothing is kept without the
  tick. If the same number later signs up, the person and their consent are
  joined up.
- **"Join us where you prefer" step** right after the details form. It offers
  every place the central admin has set up, so nobody is forced onto WhatsApp:
  WhatsApp group (English and French, the person's own language first),
  WhatsApp channel, Telegram group, Telegram channel, Messenger group and
  Facebook group, plus the pages to follow (Facebook page, Instagram, TikTok,
  YouTube). People pick one or several. Each tap is counted by place. Skipped
  automatically if nothing is set up. The same choices appear right after
  someone leaves a number in the "Stay connected" box, and on the About page.
  The links are set in Admin, Settings: "Community places" and "Follow us".
- **Growth report** (with a table of which place people chose) for the central admin (admin dashboard "Growth" tab and the
  central admin's own member profile): visitors, numbers left, joined,
  confirmed, finished profile, joined the group, wrote in a chat, took an exam,
  back after 7 and 30 days, by source and campaign, and by ambassador link.
- **Link previews:** every shared link now carries its own title, picture and
  sentence (home page, sign-up links, blog and content pages), in English or
  French (`?lang=fr`). A new 1200×630 share picture was added. Referral codes
  are never copied into the preview address.
- **Privacy page** updated for ad and link details, the stay-connected box and
  recorded consent. Deleting an account also deletes anything kept from the
  stay-connected box under that number.

## Phase B — what was built (3 November 2026)

- **Reminder emails (off until the central admin switches them on).** Four
  kinds, each sent at most once (the last once per quiet spell): "finish your
  sign-up" two hours after starting, a second one after three days, "finish
  your name and place" for people who signed in but did not finish, and
  "we miss you" for members away for a chosen number of days. English or French
  by the person's language. A daily limit (40 to begin) protects the email
  service. The central admin sees what is waiting and what went out, in the
  Growth tab, and can switch it on or off there.
- **Consent rules:** "we miss you" goes only to members who ticked the email
  box, and every such email has a one-click unsubscribe (also shown by mail apps
  as an Unsubscribe button). The sign-up reminders go only to people who
  started joining themselves, up to three, and say they can be ignored. Please
  have a Cameroonian lawyer confirm this wording.
- **Inviter's follow-up list:** "My Ambassador Dashboard" now shows how far each
  person who joined through the member's link has got (not signed in, needs to
  finish, quiet, active), a "Needs a word" filter, a message button inside the
  app, and for leaders a WhatsApp button with a first message already written in
  the person's own language. Ordinary members never see phone numbers.
- **"Open in your browser" notice** for people who arrive from an ad inside
  Facebook's, Instagram's or TikTok's built-in browser (where notifications and
  installing do not work): an "Open in Chrome" button on Android, and the Safari
  instruction on iPhone.
- **Notifications asked at a better moment:** right on the "Join us where you
  prefer" step after sign-up, with the explanation, instead of only later.

### Phase C built (ads connections)

Everything below is **inert until you paste an id** in the Growth tab, "Ads
connections" card. Nothing has been tested against the live Meta, TikTok or
Google systems yet: the first connection of each must be checked with that
platform's "test events" screen.

- **Tagged link maker** (Growth tab): choose where the link goes and where you
  will put it (Facebook, Instagram, TikTok, Google, WhatsApp, Telegram, email),
  name the campaign and ad, and get a clean link plus, for ads, the "URL
  parameters" string in which Meta, TikTok or Google fill in the real campaign
  and ad names themselves. The Growth report already reads these tags.
- **Browser pixels** (Meta, TikTok, Google tag) load only after the visitor
  presses **Allow** on a small banner; **No thanks** is remembered and nothing
  loads. The banner appears only once an id has been entered. Visitors can
  change their answer at the bottom of the Privacy page and in their profile.
- **Third consent box at sign-up** (unticked): agreement to share scrambled
  (hashed) email and phone with Meta, TikTok and Google. It is recorded with the
  exact wording, like the WhatsApp and email choices, and can be withdrawn in the
  profile.
- **Server-side events:** with the box ticked, a "Lead" event (sign-up) and a
  "CompleteRegistration" event (name and place filled in) are sent from the
  server to Meta's Conversions API and TikTok's Events API, with email and phone
  SHA-256 hashed, the ad click code (fbclid / ttclid) and the same event id the
  browser pixel used, so the platform counts each sign-up once. A platform
  receives an event only if the person arrived from it. Every attempt (sent or
  failed) is listed in the card. Google receives conversions from the browser
  tag; the Google click code (gclid) is stored for later offline uploads.
- **Secret tokens** are never typed into the app or stored in the database: set
  `META_CAPI_TOKEN` and `TIKTOK_EVENTS_TOKEN` as environment variables on Render
  (and, only while testing, `META_TEST_EVENT_CODE` / `TIKTOK_TEST_EVENT_CODE`).
- **Hashed member lists** for the platforms' customer-list tools: all members who
  agreed, and members quiet for the reminder period. Only people whose latest
  choice is "yes" are included; test accounts and accounts being deleted are left
  out. Each download is written to the audit trail.
- **Privacy page** now describes ad measurement, the hashed data shared, the
  banner and how to withdraw. Please have the Cameroonian lawyer review it.

Not yet built: the blog upgrade (Phase D) and automatic WhatsApp messages
(Phase E).



## 1. The question: do we need the Play Store or the App Store?

**Not now.** The founder's model is to go out and bring people in through ads,
links, ambassadors and media, then keep them. Nobody needs to search a store
to find us. The one real reason for a store app was phone notifications and a
home-screen icon. Those can be done without a store:

- **Android:** phone notifications (web push) work from the browser, even if the
  app is not installed. They only need the person to say yes.
- **iPhone:** web push works only after the app is added to the home screen
  (iPhone with iOS 16.4 or newer). A Play Store app would not help iPhone users
  at all, and an App Store app is a separate, stricter route.
- **Everyone, on every phone:** the contact details people give us at sign-up
  (WhatsApp number and email) are a stronger way to keep them than any app icon.
  An app on a phone can be deleted or forgotten; a WhatsApp number and an email
  address stay.

With the Leadership School books hidden in an Android store app, the store app
would also be thinner than the website. Decision: **build the foundation below
first. Revisit the stores only if, later, the monthly Dominion Clinic book is
running and Google's answers on Cameroon payments are clear.**

## 2. The foundation in five layers

Capture people. Measure where they came from. Reach them again. Bring more.
Keep them.

### Layer 1 — Capture: get a way to reach every visitor

What exists today: the sign-up keeps an email and a WhatsApp number from the
very first step, even if the person never confirms the email.

What to add:
- **A light "stay connected" box** on the Home page, About page and blog:
  name + WhatsApp number + a consent tick ("Send me the weekly message on
  WhatsApp"). Much easier than a full account for people who are not ready.
- **Consent saved with every contact:** which channel (WhatsApp, email, phone
  notifications), the date and time, the wording shown, and where it came from.
  Separate ticks for separate channels; nothing pre-ticked.
- **Unfinished sign-ups are kept** and marked as "started, not finished", so the
  reminder layer can reach them.
- **After sign-up, a clear "Join our WhatsApp group" step** (English or French
  group, chosen by the person's language), also sent by email.

### Layer 2 — Measure: know which ad, link or ambassador brought each person

What exists today: each visit already records the ad campaign details (source,
medium, campaign), the landing page, the language and the inviter's code.

What to add:
- **Ad click codes:** the identifiers Facebook/Instagram, TikTok and Google add
  to ad links, saved with the visit.
- **A funnel with dates:** visited, started sign-up, confirmed email, completed
  profile, joined the WhatsApp group, opened chat, took first exam, returned in
  7 days, returned in 30 days.
- **A report in the admin** by source, campaign and ambassador: how many came,
  how many stayed, cost per member once ad spend is entered.
- **A link builder** so every ad and ambassador gets a correctly tagged link.

### Layer 3 — Reach: ways to contact people again

| Channel | How it works | Cost and limits |
|---|---|---|
| **Inviter or leader on WhatsApp** | The leader or ambassador sees "my people who have not finished or not returned" with a one-tap WhatsApp message | Free. Personal. The strongest for your culture. Needs the list (Phase B). |
| **WhatsApp Channel** | A one-way broadcast: members join by link, you post updates, no one's number is shown | Free. People must tap join; we cannot add them. |
| **WhatsApp group** | The two language groups already exist | Free. WhatsApp does not let any app add people automatically: they must tap the invite link. |
| **Automatic WhatsApp messages** | Through the WhatsApp Business Platform: an approved message template sent to people who gave their number and agreed | Costs per message; Meta reported new per-message charges starting 1 October 2026. I could not verify the Cameroon rate. Needs a verified business and an approved sender number. |
| **Click-to-WhatsApp ads** | A Facebook/Instagram ad that opens a WhatsApp chat with you | Meta gives a free messaging window of up to 72 hours for conversations started from an ad (sources disagree on exactly when it starts). You then invite the person to the group or channel. |
| **Email** | Welcome, "finish your sign-up", "we miss you", weekly message | Cheap (Resend is set up). Needs a verified sending domain and unsubscribe links. Many people check email rarely. |
| **Phone notifications (web push)** | Already built | Free. Android needs no install; iPhone needs the home-screen install. We ask permission at the right moment, not on first visit. |
| **SMS** | Reaches nearly every phone | Costs per message. Not researched for Cameroon. Later. |
| **Telegram** | A channel or a bot people start | Free. Less used than WhatsApp here. Optional. |

### Layer 4 — Bring: where new people come from

- **Ads:** Facebook/Instagram (including Click-to-WhatsApp), TikTok, Google
  (search and YouTube). Each ad goes to a correctly tagged link (Layer 2).
- **Retargeting** (ads shown again to people who left). Two kinds:
  - *Visitor audiences* from a tracking pixel: people who visited and did not
    sign up. Needs a consent banner and a privacy-policy change (the privacy page
    today says there are no ad or analytics trackers, so it must be updated first).
  - *Member-list audiences*: upload hashed emails and numbers of people who
    signed up or went quiet, so ads can find them again or find look-alike
    people. Needs the person's consent. Google's version needs the list
    cleaned and hashed in a specific way or almost nothing matches.
  - Both kinds are best fed by **server-side events** (our server tells Meta,
    TikTok and Google that a person signed up), which still works when a phone
    blocks trackers.
- **Link previews that sell:** today a shared link shows a blank, generic card
  in WhatsApp and Facebook, because the app has no link-preview tags (the
  title, picture and sentence shown when a link is shared). Ambassadors share
  links all day, so this is a high-value fix: a proper picture and sentence for
  the home page, the join links and every blog post.
- **Blog and teachings:** the app already has a public content system (pages,
  teachings, announcements, with a list page, a sitemap and English/French
  text). To bring people from Google searches it needs:
  - pages the search engine can read fully (server-rendered), with proper
    titles and descriptions;
  - categories, share buttons, a "join us" box and the "stay connected" box at
    the end of each post;
  - all posts in the sitemap, with English and French versions linked;
  - YouTube and TikTok clips placed inside posts.

### Layer 5 — Keep: reasons to come back

- **Welcome journey:** day 0 (welcome + group link), day 1 (finish your
  profile), day 3 (first Dominion Clinic exam), day 7, day 14, day 30.
- **"We miss you"** after a chosen number of quiet days, in the person's
  language, with an unsubscribe link.
- **Inviter list:** the person who brought them is the best reminder.
- **Already built and working:** Dominion Clinic exam reminders, event reminders,
  payment reminders, King's Tokens, follow-up cards for leaders.
- **Weekly message** by WhatsApp channel, email and in-app.
- **A retention report:** returned within 7 days and 30 days, by source.

## 3. Rules to follow (not optional)

- **Cameroon's personal data law** (Law No. 2024/017 of 23 December 2024):
  summaries say consent is central and that electronic prospecting by
  automated means is restricted. The implementing decree and the data authority's
  rules on cookies were not yet published when last reported, and sources
  disagree on cookies. Plan: clear opt-in wording, separate tick per channel,
  nothing pre-ticked, an easy unsubscribe, and a cookie/tracking banner before any
  ad pixel loads. Please have a Cameroonian lawyer confirm the wording.
- **Children:** the privacy page asks for a parent's permission for under 18.
  Ads and messages should be aimed at adults.
- **Ad platform rules:** Facebook, TikTok and Google each restrict how ads may
  speak about personal characteristics such as religion. Ad wording should
  invite ("Join our online community") and not say "we know you are...".
- **WhatsApp rules:** only message people who gave their number and agreed; use
  approved templates for automatic messages; never add people to a group
  without their action.
- **Privacy page:** must be updated for ads tracking, the contact lists, and
  the channels used, before any of it goes live.

## 4. Build plan, in phases

| Phase | What | What it gives you |
|---|---|---|
| **A. Foundation** | Consent boxes and saved consent; "stay connected" box; ad click codes; the funnel with dates; admin report by source and ambassador; link previews; "Join our WhatsApp group" step after sign-up | You can see what works, and every visitor can become a reachable contact |
| **B. Reminders** | "Finish your sign-up" email; "we miss you"; welcome journey; the inviter's list with one-tap WhatsApp; phone-notification permission at a good moment | People who forget are reminded, free of store apps |
| **C. Ads** | Tagged link builder; server-side events to Meta, TikTok and Google; pixels behind the consent banner; hashed member-list export; Click-to-WhatsApp landing | Retargeting and measured ad spend |
| **D. Blog** | Server-rendered posts, categories, share buttons, sitemap, French and English | People find you through search and shares |
| **E. WhatsApp automation** | WhatsApp Business Platform provider, approved templates, scheduled sends | Automatic welcome and update messages |
| **Later** | SMS, Telegram, store apps | Only if wanted |

Order matters: **A first**, because everything else depends on consent and
measurement. B and D can run in parallel after A. C needs your ad accounts. E
needs your verified business and a budget.

## 5. What the founder must provide or decide

1. Which ad platforms first (Facebook/Instagram, TikTok, Google), and a rough
   monthly ad budget.
2. A Meta Business account, a TikTok Business account and a Google Ads account
   (I will say exactly what to create and send; I never need your passwords).
3. The WhatsApp Business setup: which phone number will be the ministry's
   official sender, and whether to start with a Channel (free) before paying
   for automatic messages.
4. The consent wording in English and French (I will draft it for approval).
5. A Cameroonian lawyer's check of the consent and tracking wording.
6. How quiet someone must be before "we miss you" (for example 7 days).

## 6. What I could not verify (stated plainly)

- The WhatsApp per-message price in Cameroon and the exact start of the free
  72-hour window.
- Meta's and TikTok's current rules for uploading customer lists (only Google's
  were confirmed, from third-party summaries).
- The final text of Cameroon's data law and whether cookies need consent.
- Prices for SMS to Cameroon.

These need checking against each platform's own pages when we reach that phase.
