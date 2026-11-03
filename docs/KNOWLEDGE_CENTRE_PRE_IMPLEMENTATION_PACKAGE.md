# The God Nation — Knowledge Centre: Pre-Implementation Package

Phase 1 (second report) · 3 November 2026 · for Evangelist Stanley A. Ndoh

Status: **assessment, measurement and a throwaway prototype only.** The prototype ran on my own workspace, was never pushed or deployed, and has been deleted (its files are kept as evidence). Nothing in the live app was changed. Nothing below proceeds without your approval.

This answers the nine items in Section 20 of your consolidated brief, in the same order. Companion documents: *Application Map* (what exists and must be protected), the *Architecture Diagram* picture, and the *Crawler View* picture.

---

## 0. The short version

1. **Recommendation unchanged and now evidence-based: build the publishing system inside the existing application** (Option 1), serving public pages as complete HTML. I tested this on a prototype instead of asserting it. A public article reached a crawler as full readable HTML with no JavaScript, appeared in 0.3 seconds on an emulated slow phone connection (today's app pages take 1.7 to 2.2 seconds), and **all 38 existing addresses I compared behaved identically** with the prototype switched on and off.
2. **The test found a real danger I had not seen: the service worker.** Today it treats any page a person opens as the app's "offline start page". After someone reads a public article, opening the installed app without internet shows the *article* instead of the app, which would break offline reading of downloaded books. A one-line exclusion fixes it (also tested). It is the **only change to existing code** the project needs, and it touches every installed phone, so it needs your explicit approval and real-phone testing.
3. **I made a mistake in my first report and I am correcting it.** I said uploaded files in Cloudflare R2 were not backed up. They are: a weekly files backup has run successfully three times (latest 1 November) and the nightly database backup has run successfully since 26 October. What is actually missing, against the standard in your brief, is an **independent** second copy (today's backup lives in the same Cloudflare account), a **tested file restore**, a **daily** files schedule for the publishing library, and a backup of **configuration and ownership details** (section 6).
4. **No hosting upgrade and no Cloudflare are justified by measurement today.** Over the last week the server used well under 1% of its processor and about 105 to 172 MB of its 512 MB; it handled at most about fifteen requests a minute. Capacity is not the limit (section 7).
5. **Two existing-platform issues surfaced** that deserve your decision regardless of this project: the live logs show **database connections closing in bursts** (and Render counted 93 server errors in one six-hour window; I could not prove the cause), and the **translation key is on Google's free tier**, whose terms allow Google to review and use submitted text (section 7).
6. **Timeline:** about **12 to 14 weeks** for the full programme; the first real articles can be public around **week 7 to 8**. Your writing time, not the software, is the real limit.
7. **Ten decisions** are listed in section 9. The first three gate everything.

---

## 1. Recommended architecture and reasons

**Recommendation: Option 1, an integrated publishing module in the existing application, delivered as server-written HTML in its own address area.**

### 1.1 Why the evidence supports it

| Question from your brief | What I found | Evidence |
|---|---|---|
| Can public pages reach crawlers as complete HTML? | Yes. The existing Express server can write full pages, with titles, language links, structured data and no scripts | Prototype; picture "Crawler View": today's `/privacy` is blank without JavaScript, the prototype article is fully readable |
| Is it fast enough for ordinary Android phones on slow connections? | Far faster than today's app pages | Emulated "Slow 4G" with a 4x slower processor, median of 5 runs, cold cache: prototype article readable at about 0.3 s using 3 KB in 1 request; existing app pages about 1.7 to 2.2 s using 249 to 416 KB in 9 to 11 requests |
| Can it live beside the app without disturbing it? | Yes | 38 existing addresses (app pages, API, guides, manifest, service worker, sitemap, robots) compared with the prototype on and off: identical status, content and headers in all 38 |
| Can the small server carry public traffic? | Easily, if public pages are cached | Limited to about half a processor, the prototype served about 750 cached article views per second (95% under 85 ms). Real traffic today peaks at about fifteen requests a minute |
| Does it threaten the installed app? | One thing does: the service worker | Reproduced and fixed (section 3.3) |

### 1.2 Integrated module versus WordPress on a subdomain (the comparison you asked for)

| Dimension | Option 1: integrated module | Option 2: WordPress on a subdomain |
|---|---|---|
| Address and search strength | Same domain, `/en/…` and `/fr/…` | A subdomain (for example `learn.thegodnationacademy.org`). WordPress cannot sit on the main domain because the installed app owns every address on it |
| Protects the existing app | Shares its server, so it needs careful separation (done by address area, order of routes and tests); one service-worker change | Does not touch the app's server; but the app and the public site become two sites with two logins for staff |
| Hosting and upkeep | No new server. Maintenance is part of the app's existing release and test routine | A second system: PHP, MySQL, a disk, backups, core/plugin/theme updates and security patching. Render's own guide uses a web service, a MySQL service and a 10 GB disk (about 0.25 US dollars per GB per month) |
| Performance | Measured above | Not measured. I did not install WordPress (your instruction). WordPress is usually heavier unless carefully cached; I will not claim a number I did not test |
| Sign-up attribution | Native: article → Join click → sign-up → profile → first chat, using the Growth tools already built | By tagged links only; no automatic link between an article and a member |
| Editing experience | Custom editor I must build; simple, but new | Mature editor, many plugins, easy to hire help |
| Bilingual SEO | Built in (separate addresses, language links, review gate) | Plugin (for example Polylang, WPML) |
| AI draft rule | Enforced in code (the publish action refuses unreviewed AI drafts) | Depends on plugin settings and staff discipline |
| Ownership and portability | Your repository and your Postgres database; content stored in clean tables with export | WordPress exports are standard, but plugin data is sticky |
| Cost | Mostly build time; no new hosting | Hosting plus plugins (not verified; section 7) plus a custom theme for a premium look |
| Key-person risk | Code is custom: a competent Node/React developer can take over (the Application Map and a handover guide are part of the plan) | Any WordPress freelancer can help, but the integration and theme are still custom |

**Conclusion.** The evidence does not favour switching to WordPress; it favours Option 1. The honest cost of Option 1 is that **I build the editor, media library and scheduling** instead of installing them, and that publishing depends on developers who know this codebase. WordPress remains the better choice if you later need many editors publishing daily with a rich plugin ecosystem. The design keeps that door open: public addresses are permanent and independent of the technology, and content is stored in clean, exportable tables.

### 1.3 What the prototype does not prove (stated plainly)

| Limit | Why it matters | How it is handled |
|---|---|---|
| It used in-memory sample articles, not the real database | The real build reads the database, which can be asleep (section 7) | Render pages when an article is published and keep the finished HTML (section 5), so crawlers never wait for the database |
| No real images, fonts or long articles | Real pages are heavier than 3 KB | A page-weight budget (section 5.5) and measured tests in Phase 2 |
| Tested on this workspace's network, with emulated latency | Not a measurement from Cameroon | Real tests from Cameroon-like conditions once Phase 2 is live (section 7) |
| Not tested on a real installed Android app | I simulated the service worker in a desktop browser | Real-phone testing is a condition of the service-worker change |
| It was not the final design | Only layout tokens | Section 13 of your brief (design applied to the real pages) is a Phase 2 deliverable |

---

## 2. How the three parts connect

See the picture **Architecture-Diagram.png**. In words:

| Part | Responsibility | Who can reach it | New or existing |
|---|---|---|---|
| Public website | Pages at `/en/…` and `/fr/…`: home, Knowledge Centre, articles, books catalogue, about, contact. Complete HTML, no sign-in, no cookies, cached | Everyone, including crawlers | New |
| Publishing system | Draft → review → approve → schedule → publish; translations; media; SEO fields; AI assistant (drafts only); history | Staff only, through the **existing** admin dashboard and the central admin's profile. Roles are assigned to existing people; no new login | New |
| Community platform | Registration, login, profiles, Leadership School, books, exams, chats, giving, installed app | Registered members and staff | Existing, unchanged |

**The connections are deliberately narrow:**

- Public pages link to the existing `/member/join` and `/member/login`, tagged with the article they came from (for example `utm_campaign=<article>`), so the existing Growth report can count sign-ups per article.
- The publishing system writes only to public tables and the public image store. It cannot publish from any private table.
- The community platform never reads the public tables, and the public pages never read private ones (section 4).

---

## 3. Routing plan that protects existing routes and the installed app

### 3.1 Address structure

| Purpose | English | French |
|---|---|---|
| Public home | `/en/` | `/fr/` |
| Knowledge Centre | `/en/knowledge/` | `/fr/connaissance/` |
| Division page | `/en/knowledge/kingdom-knowledge/` | `/fr/connaissance/connaissance-du-royaume/` |
| Article | `/en/knowledge/kingdom-knowledge/what-is-the-kingdom-of-god/` | `/fr/connaissance/connaissance-du-royaume/…` (its own French title words) |
| Books | `/en/books/`, `/en/books/<title>/` | `/fr/livres/`, `/fr/livres/<titre>/` |
| About, contact | `/en/about/`, `/en/contact/` | `/fr/a-propos/`, `/fr/contact/` |
| Join and sign in | `/en/join/` and `/en/login/` redirect to the existing `/member/join` and `/member/login` | `/fr/rejoindre/`, `/fr/connexion/` redirect to the same |

Why prefixes and not subdomains or browser language: Google's guidance (see sources) is to give each language its own address and link them with `hreflang`; prefixes keep everything on one domain's authority and are simple to run. `/en` and `/fr` are used by nothing that exists today.

### 3.2 Rules that keep existing behaviour identical

1. **Nothing existing is renamed, moved or redirected.** `/`, `/join`, `/login`, `/member/*`, `/admin/*`, `/leader/*`, `/api/*`, `/page/:slug`, the four guide folders, `/sitemap.xml`, `/robots.txt` and the installed app's identity (`scope: /`, `start_url: /member/chats`) stay exactly as they are.
2. **The new area is registered in the server before the app's "catch-all"** (the rule that sends every unknown address to the app). Public pages therefore win only for `/en/…` and `/fr/…`.
3. **Public pages are served before the cookie steps.** Today the server sets a `visitor_id` and a `csrf_token` cookie on the first request to any address (Application Map, section 4). On public pages that would (a) make them unsafe to cache, because a cached response could hand one visitor's cookie to another, and (b) set a tracking cookie on readers who have only read an article. The public router will sit ahead of those steps and set no cookies. Attribution still works: the Join link carries the article's tag, and the existing visit tracker records it when the person lands on `/member/join`.
4. **A true 404 inside the new area.** Today unknown addresses answer "200 OK" with an empty page (a "soft 404"). The prototype returns real 404 for missing or non-public items. (Changing the old behaviour elsewhere is a separate decision, not part of this project.)
5. **A permanent regression test.** The 38-address comparison I ran becomes an automatic test that fails the build if any existing address changes.

### 3.3 The service-worker change (the one change to existing code)

| Step | Result |
|---|---|
| Today's worker saves the most recent successful page as the offline start page, whatever the page is | Confirmed in the code and by test |
| A person opens a public article online, then opens the installed app with no internet | **With today's worker the app shows the article instead of the app** (reproduced). Offline reading of downloaded books is then unreachable until the next online visit |
| Same sequence with the worker told to ignore `/en/` and `/fr/` (the same technique already used for the four guide folders) | The app opens correctly (tested) |

Conditions I propose before shipping it: (1) the change is only the added exclusion, nothing else; (2) automated test of the sequence above; (3) manual test on at least two real Android phones with the app installed, and one iPhone; (4) release by itself, not bundled with other changes; (5) a rollback plan (reverting a service worker takes effect on the next visit; I will document exactly how). The history in the Application Map is why I treat this as the riskiest line in the whole project. **This needs your approval (decision 2).**

---

## 4. Public/private content-access model

### 4.1 Principles

1. **Separate at the data level, not by hiding links.** Public content lives in its own tables and its own image store. The public pages read *only* those.
2. **Allow-list, not block-list.** Each public page type has a fixed list of fields it may output. A new private field added later can never appear by accident.
3. **Visibility is explicit, per item:** `DRAFT` (never public), `MEMBERS` (needs sign-in), `PUBLIC` (anyone). Only `PUBLIC` and *approved* items are served. A French copy is served as indexable only once marked "Reviewed".
4. **Books:** a public book page is a separate record holding only public description, cover, author, language and "how to obtain". It may point to a member resource by an internal reference, but its output never includes file names, storage keys or download links. `LibraryBook` rows (training books) are never read by the public side.
5. **robots.txt is a courtesy, not security.** Protection is sign-in, server checks and separate data. Private areas also get an `X-Robots-Tag: noindex` header as a second layer.
6. **Crawler identity is never trusted from the User-Agent alone.** No crawler receives anything a normal visitor cannot. For analytics and rate-limiting, I verify claimed crawlers by the vendors' published methods (reverse DNS for Googlebot and Bingbot; OpenAI publishes IP lists for GPTBot, OAI-SearchBot and ChatGPT-User). I could not open the vendors' own pages to confirm the current file names, so I list them in Phase 6 for verification.

### 4.2 The access table

| Content | Public | Members | Restricted to roles | Never leaves private storage |
|---|---|---|---|---|
| Approved public articles and FAQs | Yes | Yes | — | — |
| Public book descriptions, covers, approved extracts | Yes | Yes | — | — |
| Full books, downloads, Leadership School books | No | Per existing rules | — | PDFs and storage keys |
| Exams, answers, results, progress | No | Own only | Leaders/admins as today | Yes |
| Member profiles, messages, prayer requests | No | As today | As today | Yes |
| Payments, giving, referral and token records | No | Own only | Central administration | Yes |
| Drafts, unpublished manuscripts, source materials for the AI | No | No | Authors and editors | Yes |
| Admin and audit data | No | No | Admins | Yes |

### 4.3 How it is proved, not promised

- An automatic **leak test** crawls every public address and fails if any private marker, storage key, e-mail address or phone number appears.
- The prototype already showed the pattern: a members-only sample item returned 404 on both languages, and a secret marker never appeared in any page or sitemap.
- Optional hardening for later: a database user for the public pages that can read only the public tables, so even a coding mistake cannot reach private data.

---

## 5. Rendering and SEO strategy (demonstrated)

### 5.1 The problem today

The server sends the same empty shell for every page and the browser builds the content. Search engines that run JavaScript (Google) usually cope; link previews and, as widely reported, most AI-search crawlers do not run it. In the picture **Crawler-View-Today-vs-Proposed**, today's `/privacy` is a blank page without JavaScript.

### 5.2 Options compared

| Approach | Verdict |
|---|---|
| **Server-written pages from templates, saved on publish, served from cache (recommended)** | Complete HTML on the first request; no extra server; no dependence on the app bundle; fast; fits the small server |
| Server-side rendering of the React app | Works, but ties public pages to the whole app bundle, uses more memory and processor on a 512 MB server, and puts the existing client at risk |
| Static site generation at build time | Each publish would need a full rebuild and redeploy, restarting the whole service, which is the wrong trade for a site that publishes weekly |
| A pre-rendering service for the existing app | Another paid dependency, still built on pages that were never designed for crawlers |

### 5.3 The recommended pipeline

1. **On publish or update**, the server renders each language version to finished HTML and stores it with its modified time.
2. **On request**, the server answers from the stored copy: no database call, so a sleeping database cannot slow a crawler. Headers: `Cache-Control` with a short browser life, a longer shared-cache life and "serve stale while refreshing", plus `ETag` for quick "not changed" answers.
3. **On change**, the server updates the sitemap and notifies search engines (IndexNow reaches Bing and other participating engines; as far as I could verify Google does not use it, so Search Console and the sitemap carry Google).
4. **Cookie-free**, so every page can also be cached by a CDN later without risk (section 3.2).

### 5.4 What the prototype demonstrated (what a crawler receives)

| Check | Result |
|---|---|
| Complete readable text in the first response | Yes. Title, headings, paragraphs and links present; **zero scripts** |
| One address per language, linked both ways (`hreflang` pairs and `x-default`) | Yes |
| Canonical address | Yes |
| Structured data (Article, BreadcrumbList) | Present and valid JSON; describes only what the page shows |
| Language and character handling (French accents) | Correct |
| Sitemap lists only public, reviewed pages, with language alternates | Yes |
| Members-only item | 404 in both languages; marker never appeared anywhere |
| Translation gate | An unreviewed French page is served `noindex` and left out of the sitemap |

**Defects found in my own prototype**, to be fixed in the real build: an unreviewed French page still carried language links (it must carry none), and it ran after the cookie steps (it must run before, section 3.2).

### 5.4a Required SEO features and where each is delivered

| Requirement | Phase |
|---|---|
| XML sitemap with language alternates and last-modified | 6 (prototype done) |
| robots.txt (public open, private closed; per-crawler policy) | 6 |
| Canonical addresses; titles and descriptions; heading structure | 2 and 3 |
| Structured data: Organization, Article, Person, Book, BreadcrumbList, Event | 3 and 6 |
| Redirect manager (permanent redirects when a title changes) | 4 |
| Search Console and Bing verification; IndexNow | 6 |
| Image optimisation and alternative text (required field) | 4 |
| Internal links between articles, books and series (core feature) | 3 |

### 5.5 Performance budget (applies to every public page)

| Item | Budget |
|---|---|
| Page HTML, compressed | 30 KB or less for an article with no images |
| Total first view including one featured image | about 150 KB, images responsive and in modern formats |
| JavaScript on public pages | None required to read; optional small enhancements only |
| Fonts | Self-hosted, trimmed, at most two files |
| Reading start on slow 4G with a mid-range phone | 2.5 s or better |

### 5.6 Crawler policy (your decision, as stated in the brief)

You stated you are willing to allow search *and* training crawlers for approved public content. The policy will therefore allow, for the public library only: Googlebot, Bingbot, **OAI-SearchBot** (ChatGPT search), **GPTBot** (OpenAI training) and **ChatGPT-User** (user-requested visits; OpenAI notes robots rules may not apply to it). I will research and list other vendors' published crawler names and controls for your confirmation in Phase 6; I do not yet have verified current names for them. Private areas stay closed by sign-in and noindex. Allowing a crawler guarantees no indexing, citation or recommendation, and you have already accepted that removal later may not remove content from training data.

---

## 6. Backup and recovery plan

### 6.1 What exists today (verified in the repository and the GitHub run history)

| What | How | How often | Where | Evidence |
|---|---|---|---|---|
| Database (all members, articles-to-be, settings) | Full encrypted copy, then restored into a throw-away database to prove it opens | Nightly, 02:37 UTC | Private bucket in Cloudflare R2 (set up in the same Cloudflare dashboard as the live files, per the guide) | Successful runs 26 Oct to 2 Nov, latest 2 Nov |
| Uploaded files (photos, voice notes, PDFs, covers) | Copy of every file into the same private backup bucket; adds only, never deletes; checks every file arrived with the same size | Weekly | Same private bucket | Three successful runs; latest 1 Nov |
| Neon's own history | Point-in-time history | Free plan: 6 hours | Neon | From the backup guide |

### 6.2 Gaps against your brief

| Your requirement | Gap |
|---|---|
| Backups independent of the primary storage location | The backup bucket is at the **same provider, and by the guide's own steps in the same Cloudflare account**, as the live files. One account problem could lose both. (Please confirm whether it is a separate account.) |
| A restoration test | The database restore is proven nightly. **Files have never been restored**; the check only confirms the copy exists |
| Published articles, translations, book metadata, configuration | Articles and translations will live in the database (covered). **Configuration is not backed up**: hosting settings, DNS records, secrets list, who owns which account |
| Retention and frequency fit for a publishing library | Files weekly: a new image could be lost for up to 7 days |
| Documented ownership and recovery responsibility | Partly (BACKUPS.md). No single "who holds what" record |

### 6.3 Proposed plan

| Item | Proposal |
|---|---|
| Independent copy | Nightly encrypted database dump **and** daily files sync to a second provider in a separate account you own. Candidates: Backblaze B2 (about 6.95 US dollars per terabyte per month and a free first 10 GB, per third-party sources I could not confirm on Backblaze's own page) or a second Cloudflare account on a different login. I recommend B2. I write and test the job; you create the account (decision 5) |
| Frequency | Database nightly (exists). Files **daily** from the day the media library opens |
| Retention | Database: all backups for 30 days, then one a month for a year (exists; apply to both copies). Files: add-only plus a monthly manifest, so deletions are traceable |
| Configuration bundle | A list (names, not secret values) of hosting settings, DNS records, secrets and who owns each account, kept in your password manager and printed once. Updated whenever something changes |
| Restore drills | A full restore into a scratch Neon project plus a files restore into a scratch bucket, with a check that the app starts against them. First drill **before Phase 3 goes public**, then every quarter. A backup that has not been restored is not counted |
| Responsibility | You: hold the backup passphrase (in two places) and the accounts. Developer: runs and documents drills, watches the red/green status. A second trusted person: holds an emergency copy of the passphrase and account list |
| Security of the copies | Encrypted before they leave; passphrase never in the repository; write-only keys for the backup jobs; separate keys for restoring |

### 6.4 Ownership and portability checklist (to complete together)

| Asset | Where it lives | I need you to confirm |
|---|---|---|
| Source code | GitHub, organisation **TheGodnation** | Who owns the organisation login; two-factor on; a second owner added |
| Hosting | Render workspace owned by godsnationmediaministry@gmail.com | Two-factor on; billing owner |
| Database | Neon | Which account owns it; two-factor on |
| Files | Cloudflare R2 | Which account owns it; two-factor on |
| Domain and DNS | thegodnationacademy.org at the registrar | Which registrar and login; auto-renew on; recovery contacts |
| Email sending | Resend | Account owner; sending domain records |
| AI providers | To be chosen | Accounts must be yours, not a developer's |

A developer taking over would start from the Application Map, this package, the backup guide and the configuration bundle. I will add a short `HANDOVER` guide in Phase 2.

---

## 7. Costs and observed limits (infrastructure and AI)

### 7.1 What the live server actually shows (Render metrics, 27 Oct to 3 Nov)

| Measure | Observed | Limit |
|---|---|---|
| Processor | 0.0005 to 0.0022 of a processor on average (under half of one percent of the 0.5 allowed) | 0.5 |
| Memory | 105 to 172 MB | 512 MB |
| Instances | 1, always | — |
| Traffic | Roughly 600 to 5,400 requests per six hours in total (0.03 to 0.25 per second), mostly cache checks (304) and redirects | — |
| Server errors | Normally none; **93 recorded in the six-hour window starting 00:00 UTC on 3 November**. I could not find them in the finer-grained figures or request logs, so the cause is unproven | — |
| Database connection messages | Bursts of "connection closed" in the app log at 03:23, 05:00 and 05:16 UTC on 3 November (about 20 each) | — |
| Translation service | One "high demand, try later" reply from Gemini at 05:52 UTC; the app correctly fell back to the lighter model | — |

**What this means.** There is **no observed processor or memory limitation**. The one observed weakness is the **database connection closing**, which fits Neon's free plan, where the database goes to sleep after 5 minutes of inactivity and this cannot be turned off (Neon's plans page). Whether those closures caused the 93 errors is not proven. A small fix (retry once when a connection has closed, and tune the connection settings) is cheap and low-risk, but it changes existing server behaviour, so it is **decision 3**.

### 7.2 Infrastructure changes I am *not* recommending now

| Change | Problem it would solve | Observed? | Cost | Risk to the app | Verdict |
|---|---|---|---|---|---|
| Render plan upgrade (Starter 7 US dollars a month today; Standard 25 with 2 GB and 1 processor, per Render's pricing page, which also notes a plan change on 1 August 2026 I could not read) | More memory and processor | **No**: usage is a small fraction of today's limit | 18 US dollars a month more, 216 a year | Brief restart on change | **Not needed. Revisit if measured use passes about 60% of memory or processor** |
| Cloudflare in front of the domain (free plan) | Faster delivery to Africa from nearby edge locations; protection from traffic spikes; fewer requests to the server | Not yet: no public library exists to measure. Latency from Cameroon is **unmeasured** | Free plan 0; paid plans from about 20 US dollars a month (not verified) | Real: name-server change at the registrar, caching and cookies interacting with sessions, service worker and sign-in; must be tested with the app | **Defer.** First measure from Cameroon with Phase 2 pages live. If cached pages are slow there, add it then, with a written rollback |
| Neon paid plan | Stops the database sleeping; more history | **Yes**: connection closures observed | Launch plan is pay-as-you-go with a 5 US dollar minimum and from about 0.14 US dollars per compute-hour (Neon's own page and third-party pages disagree on figures; confirm before buying) | Low (a connection string change) | **Likely worth it once public traffic grows**, because the cached public pages do not need the database, but members' app does. Decide after the retry fix and a month of observation |
| Cheaper alternative that is already enough | Public pages saved and cached by the app itself (section 5) | — | 0 | Low | **Do this first** |

### 7.3 AI providers: data terms and cost

I could not open the providers' own legal pages from this workspace; findings below come from search results that quote them. Items marked ✔ rest on the provider's own page as returned by search; the rest are secondary and must be confirmed from the contract documents before any original material is sent.

| Provider | Training on your content | Retention | Notes |
|---|---|---|---|
| **Google Gemini, free tier (what the app uses today)** | **Yes: Google uses prompts and responses from unpaid services to improve its products; human reviewers may read samples** ✔ | Not stated for unpaid | Google's own guidance is not to send sensitive, confidential or personal information |
| **Google Gemini, paid (a Cloud project with billing)** | No ✔ | Logged for a limited period for abuse detection and legal needs ✔ | Becoming a "paid service" is defined by billing, so enabling billing on the key changes the terms. Gemini also gave a "high demand" reply in your live logs |
| **Anthropic Claude API (commercial terms)** | No (several sources; commercial terms) | Sources disagree between 7 and 30 days; zero retention by approval | **Disclosure: I am a Claude model made by Anthropic, so treat my view with caution and rely on the test below** |
| **OpenAI API** | No by default (secondary sources) | Up to 30 days; zero retention by approval | — |
| **Mistral (French company; EU data by default per secondary sources)** | Mistral's help centre states API data is not used for training ✔ | 30 days of logs (secondary) | Worth testing specifically for French quality; I could not find current per-token prices |

**Price I can state with confidence (Anthropic's own published list in my reference material, cached 6 October 2026):** Claude Sonnet 5.5 costs 2 US dollars per million input tokens and 10 per million output; Claude Opus 5.5 costs 4 and 20; Claude Haiku 5.5 costs 0.10 and 0.50. A long article draft (about 15,000 tokens in, 6,000 out) costs roughly 9 US cents on Sonnet 5.5 or 18 US cents on Opus 5.5. With several passes (draft, translation, SEO, social pack) that is under 1 US dollar per article, so even 12 articles a month is likely under 10 US dollars. **I have not verified current prices for the other providers**, and real usage must be measured in the test.

**Recommended process (as your brief asks):**

1. Run a **blind test** on one teaching or chapter you choose: the same job (draft, summary, FAQs, French translation) on two or three providers on their paid or business terms; outputs unlabelled; your lead author and French reviewer score for fidelity, invention, terminology and French quality.
2. Keep the winner behind a **single switch** so no provider is permanent.
3. **Do not use the free Gemini key for unpublished books or manuscripts.** For the existing translation of chat and teachings, I recommend enabling billing on that Google project (decision 4): your privacy policy already discloses Gemini, but it does not say that on the free tier Google may review submitted text.
4. Private messages, prayer requests, payments and member profiles are never sent to any AI service (the existing translation code already follows this rule).
5. No bulk generation until quality, privacy and cost are measured.

### 7.4 Other recurring costs (indicative; verify before buying)

| Item | Cost |
|---|---|
| Render web service Starter (today) | 7 US dollars a month (Render pricing page) |
| Second backup provider | Backblaze B2 about 6.95 US dollars per TB per month; first 10 GB free (third-party sources) |
| Cloudflare R2 (live files) | 10 GB free, then about 0.015 US dollars per GB per month; no download charges (third-party sources) |
| AI provider | See 7.3 |
| Analytics (GA4, Search Console, Bing) | Free |
| WordPress alternative, if ever chosen | Web service + MySQL + disk on Render, plus paid SEO/multilingual plugins and a custom theme: higher recurring cost and upkeep; not tested or priced here |

---

## 8. Phased implementation schedule

Estimates are calendar weeks if you can approve designs and answer questions within a few days. Content writing runs alongside and is the real limit.

| Phase | Deliverables | Tests that must pass before moving on | Weeks |
|---|---|---|---|
| **1. Architecture and protection (this report)** | Package, Application Map, prototype evidence, your decisions | Your approval | Done |
| **2. Public website foundation** | Design system from the preview; home, About, Contact, Join/Sign-in hand-offs; `/en` and `/fr` structure with language switch; server-written pages saved on publish; cookie-free serving; the service-worker exclusion; permanent address regression test; independent backup copy and first restore drill; `HANDOVER` guide | All 1,736 server and 806 screen tests; the 38-address comparison; the offline-reading sequence on real Android phones and an iPhone; leak test; speed budget on a slow-network emulation; real-device test from Cameroon conditions | 3 |
| **3. Knowledge Centre** | Data model and a minimal way to enter articles; six divisions and sub-categories; article and division pages; related articles and books; search; books and publications catalogue (public descriptions only); public/private controls and the leak test | As above, plus: article pages pass structured-data and `hreflang` checks; members-only items proven unreachable; search returns only public items | 4 |
| **4. Publishing administration** | Article manager; roles (author, French reviewer, editor, publisher); draft/review/approve/schedule/publish; history; translation manager with the "reviewed" gate; media library with required alt text; SEO fields; redirects; analytics view | As above, plus role-permission tests (nobody can publish without the right role), history/audit tests, media upload safety tests | 3 |
| **5. AI editorial assistant** | Provider comparison and blind test on your chosen material; controlled drafting, translation, SEO and distribution drafts; sources kept; the publish action refuses unreviewed AI items | As above, plus: a test that proves an AI draft cannot be published without a person's approval; cost report; no private data sent (test) | 3 |
| **6. Discovery, analytics, optimisation** | robots.txt and crawler policy; sitemap with languages; Search Console and Bing; IndexNow; GA4 behind consent; article → sign-up reporting; accessibility and Core Web Vitals pass; verified crawler identities | As above, plus indexing checks on real search tools and a lawyer's review of consent wording | 2 |
| **Total** | | | **about 12 to 14 weeks; first real articles public around week 7 to 8** |

After every phase I re-test the real member journeys: sign-up, sign-in, installing, offline reading of downloaded books, chats, books, exams and giving. I will say plainly if a phase fails any of them, and I will not call a prototype or preview production-ready.

---

## 9. Decisions that genuinely need your approval

| # | Decision | My recommendation |
|---|---|---|
| 1 | **Architecture:** integrated publishing module (Option 1) rather than WordPress on a subdomain | Approve Option 1 |
| 2 | **The one change to existing code:** make the service worker ignore `/en/` and `/fr/` (section 3.3), shipped alone, with real-phone testing and a rollback plan | Approve, with the conditions listed |
| 3 | **Small reliability fix** for closed database connections (retry once; tune connection settings), and watching the logs for a month | Approve (it is a small change to existing behaviour, so it needs your yes) |
| 4 | **Turn on billing for the Google translation key** so the paid terms (no use of your text to improve Google's products) apply to existing chat and teaching translation | Approve; small cost; confirm Google's current terms when you do |
| 5 | **Independent backup destination** and who creates the account | Backblaze B2 in an account you own; I write and test the job |
| 6 | **Roles:** name the lead author(s), French reviewer(s), editor(s), publisher(s) | You tell me the people; I build the roles |
| 7 | **First real teaching or book chapter** for the AI test and the first article | You choose one you are happy to see tested |
| 8 | **Addresses:** `/en/…` and `/fr/…` with French words in French addresses; `/` left exactly as it is for now | Approve; decide on `/` later |
| 9 | **Infrastructure:** no Render upgrade and no Cloudflare now; measure from Cameroon after Phase 2 | Approve deferral |
| 10 | **Crawlers and cookies:** confirm the crawler list in section 5.6; confirm public pages set no cookies and analytics wait for consent | Approve; lawyer review of wording |

### What I could not verify (stated plainly)

- The providers' own current contract pages (search results quoted them; confirm before sending original material). In particular Anthropic's retention period (7 or 30 days), and the current prices of OpenAI, Gemini and Mistral.
- Backblaze's and Cloudflare's current prices (taken from comparison sites).
- Render's plan change on 1 August 2026 and Neon's current plan figures (sources disagree).
- The vendors' exact current crawler names other than OpenAI's.
- Page speed from Cameroon itself (tests used emulated slow-network conditions).
- WordPress performance and cost (not installed or tested, by your instruction).
- The cause of the 93 server errors on 3 November.
- Behaviour of the installed app on real phones (simulated in a desktop browser; real-phone tests are a condition of Phase 2).

## Evidence kept (nothing deployed)

| File | What it shows |
|---|---|
| `publicSiteSpike.ts` | The throwaway prototype page writer |
| `sw-test3.cjs` | The offline test that exposed the service-worker risk and its fix |
| `perf.cjs`, `load.cjs` | The slow-phone and capacity measurements |
| `nojs.cjs` | The crawler-view picture |

## Sources

- OpenAI, [Overview of OpenAI crawlers](https://developers.openai.com/api/docs/bots)
- Google Search Central, [Managing multi-regional and multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)
- Google Search Central blog, [March 2024 core update and new spam policies](https://developers.google.com/search/blog/2024/03/core-update-spam-policies)
- Google, [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)
- Mistral, [Does Mistral AI exploit users' data to train its models?](https://help.mistral.ai/en/articles/156194-does-mistral-ai-exploit-users-data-to-train-its-models)
- Neon, [Plans](https://neon.com/docs/introduction/plans) and [pricing](https://neon.com/pricing)
- Render, [pricing](https://render.com/pricing) and [Deploy WordPress](https://render.com/docs/deploy-wordpress)
- WordPress.org, [Requirements](https://wordpress.org/about/requirements/)
- Anthropic's commercial terms and the retention period should be read directly at Anthropic's Trust and Privacy pages before use; secondary sources disagree.
