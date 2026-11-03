# The God Nation — Institutional Website and Knowledge Centre
## Phase 1: Technical and Strategic Assessment

Prepared for Evangelist Stanley A. Ndoh · 3 November 2026
Status: **assessment only. No code written, no WordPress installed, nothing changed in the live app.** Nothing below proceeds without your approval.

---

## 0. The short version

**What exists today.** One application, built by us, runs everything at thegodnationacademy.org: the public start page, sign-up, login, the member app (installable on phones), the Leadership School, books, exams, chats, giving, the admin dashboards and the growth tools. It is not a website with an app attached; it is one system.

**The finding that matters most.** The app's public pages are *drawn inside the visitor's browser*. Google can usually cope with that. Many other readers cannot: link previews, and, as widely reported, most AI-search crawlers, receive an almost empty page. Language is also chosen inside the browser, so English and French do not have their own web addresses. For a Knowledge Centre whose whole purpose is to be *found*, this must be solved first, whichever option you pick. (Details in section A.)

**My recommendation: Option 1, an integrated publishing module inside the existing application**, producing real, fast, server-written pages at the same domain, with separate English and French addresses, in its own clearly separated area. Section C gives the reasons; the short ones are:

1. **Same address, same login, same membership system.** A WordPress site would have to live on a different address (a subdomain) because the installed app already owns the whole of the main domain. A separate address makes the "one connected ecosystem" you want harder, and gives up search strength.
2. **We can already measure what a WordPress site cannot.** Phases A to C built click-to-registration measurement. With an integrated module, we can say "this article brought 14 sign-ups," not only "this article had 900 visitors."
3. **No second system to guard.** WordPress, its database and its plugins need constant security updates and are among the most attacked software on the internet. That is a permanent cost in money and attention.
4. **The AI editor and the draft-and-approve rule can be enforced in code**, not left to staff discipline.

**The honest trade-off.** Option 1 means we *build* the editor, media library, scheduling and SEO tools instead of installing ready-made ones. It is more up-front work than WordPress, and it ties publishing to us as the developers. Section C explains why I still recommend it, how we limit that risk (clean, exportable content so you are never locked in), and when WordPress would be the better choice.

**Timeline (realistic):** first public Knowledge Centre with real articles in about **6 to 7 weeks**; the full programme in about **11 to 13 weeks**. The real bottleneck will be writing the articles, not the software (section F).

**Decisions I need from you** are listed in section I.

---

## A. Existing platform audit

*Everything in this section I checked directly in the code and the live hosting settings.*

### A1. What it is built with

| Layer | Technology | In plain words |
|---|---|---|
| Visitor's screen | React 18 + Vite + Tailwind CSS, English/French through i18next | The app you see. One codebase for the website pages and the member app. |
| Server | Node.js 22 + Express, TypeScript | The brain: sign-in, chats, books, payments, reminders, admin. |
| Database | PostgreSQL on **Neon**, accessed through Prisma. 112 data tables, 115 recorded changes (migrations) | Where members, messages, results and payments live. |
| Files | **Cloudflare R2** (photos, voice notes, PDFs, book covers) | Private storage; files are handed out through short-lived links. |
| Email | Resend | Sign-in links, reminders. |
| Notifications | Web Push (VAPID keys configured) | Phone alerts. |
| Translation | Google Gemini (free tier) for automatic EN/FR translation of teachings and chat | Already in the app. |
| Quality net | 1,736 server tests and 806 phone-screen tests, all passing; nightly encrypted database backup with a restore check | Protects against breaking things. |

### A2. Hosting and deployment

- **One web service on Render, in Frankfurt**, 0.5 CPU and 512 MB of memory, **one instance**. It serves *both* the API and the built app, from the same address.
- Every change pushed to the working branch is built and deployed automatically; database changes are applied during the build.
- The domain thegodnationacademy.org points at that service (plus one more domain name).
- The Neon database is on the **free plan** (its own history window is only 6 hours; our nightly backup covers the gap). Free Neon databases go to sleep when idle, which adds a delay to the first request after a quiet period.
- **Not yet backed up:** the uploaded files in R2 (photos, PDFs, covers). A publishing system's media library would live there, so this must be fixed *before* we rely on it (risk G6).

### A3. How sign-in works

- **Two separate session systems, deliberately isolated:**
  - Members: email and password (or an emailed one-time link), cookie `msid`, kept in the browser as "HttpOnly, SameSite=Lax", 90-day sliding sessions.
  - Admin/leader staff accounts: cookie `sid`, a different session table, different code. A member session can never satisfy an admin check (a test proves it).
- A third cookie protects every state-changing request (CSRF).
- The central admin is a member whose person is also linked to an admin account, which is why the admin tools appear inside that member's profile.
- All cookies belong to **the main domain only**. A site on a *different* subdomain would not share them. That is a feature for separation, but it means no automatic single sign-on between a subdomain and the app.

### A4. Routes and what is public

- About **50 screens**. Public: start page (`/`), `/join`, `/login`, `/privacy`, `/contact`, `/teachings`, `/announcements`, `/page/:slug` (admin-edited pages), the two guide folders. Everything under `/member/…`, `/admin/…` and `/api/…` needs a sign-in.
- The installed app's identity: `scope: "/"`, `start_url: /member/chats`. In other words **the installed app claims the whole of the domain**. This is the decisive fact for the WordPress question (section B).
- A single "catch-all" sends every unknown address to the app; the order of routes in the server matters and is covered by tests.

### A5. The data that already exists for publishing

- `ContentPage` (admin-edited pages, teachings, announcements): English and French title and body, a web address name (slug), published or not. **It has no categories, no authors, no featured image, no SEO fields, no reading time, no scheduling, no related items, and one slug for both languages.** It is a simple page store, not a publishing system.
- `LibraryBook`: the Leadership School books with private PDFs in R2. **These are members' training materials and must never be reused as the public "Publications" list.** Public publications need their own record with an explicit "public" flag.
- Already built and reusable: bilingual columns pattern, image/file storage and secure links, an audit log, role checks, the admin dashboard, the central admin's "router builder" pattern (one set of tools offered both in the admin dashboard and in the central admin's own profile), the Growth report with click-to-registration attribution, the tagged-link maker, the consent banner, Resend email, the Gemini connection.

### A6. What the app can and cannot do for search today

| Question | Today's answer | Evidence |
|---|---|---|
| Can it serve public, indexable pages? | **Partly.** It writes the right *title, description and preview picture* into the page before sending it, so WhatsApp/Facebook previews work. But the *body* of each page is built in the browser. | The page sent to a crawler contains an empty `<div id="root">`. |
| Do English and French have separate web addresses? | **No.** The language is chosen in the browser (and by `?lang=`). Google's own guidance says to give each language its own address and link them with `hreflang` tags. | Language detection is client-side. |
| Sitemap | Exists but minimal: home, join and `/page/…`. No `lastmod`, no languages. | `app.ts` |
| robots.txt | Allows everything and points to the sitemap. Private areas are protected by sign-in, but are not excluded for crawlers. | `public/robots.txt` |
| Structured data (Schema.org) | None. | — |
| Speed on weak phones | Good for the app (compressed files, long caching, an offline-capable shell). The public pages' content only appears *after* the JavaScript runs, which is slower to first read on weak phones. | |

**Bottom line of the audit:** the platform is a strong, tested home for the *private* community. For the *public* knowledge library, the foundation that matters (real server-written pages, language addresses, a proper content model) does not exist yet and has to be added, however we decide to add it.

---

## B. WordPress and PWA compatibility

**Yes, WordPress and the PWA can coexist.** They do different jobs and can be connected. The question is *how*, and the constraints below shape every answer.

### B1. The constraints that decide it

1. **The installed app owns the main domain.** Its scope is `/`. If WordPress took over `thegodnationacademy.org`, we would have to move the app to another address (for example `app.thegodnationacademy.org`). That would **sign everyone out, invalidate installed home-screen apps and push-notification subscriptions, break every shared link and every printed or posted member link,** and complicate the future Play Store version. I would not do it.
2. So WordPress would have to live at **another address**: a subdomain such as `learn.thegodnationacademy.org`, or a separate domain. Or it could be served under a folder (`/knowledge/`) of the main domain by putting a routing layer in front of both (a "reverse proxy", for example Cloudflare rules). That is possible but adds a fragile moving part and needs the domain's name servers moved to Cloudflare.
3. **Cookies are per-address.** A WordPress subdomain would not know whether someone is a member. "Existing members move between site and app without confusion" would be handled by links, not by a shared login. (We must not build a second login anyway, as you instructed.)
4. **Hosting.** WordPress needs PHP and MySQL, plus a disk that keeps its uploaded files. It cannot run inside our Node server. Render can host it (the official guide uses a web service, a MySQL service and a 10 GB disk), but that is a second and third service to run, back up and update.

### B2. The ways to connect them

| Method | What it gives | Cost / risk |
|---|---|---|
| **Links only** (site links to `/member/join` and `/member/login`) | Simple, safe, nothing shared. Registration stays only in the app. | Two admin worlds. Attribution works through tagged links. |
| **Shared look** (a WordPress theme built to match the app) | One feeling. | A custom theme is real development work; "premium" cannot come from a stock template. |
| **Shared login** (single sign-on between WordPress and the app) | Seamless for members. | Custom, security-sensitive work on the system that guards private data. Not needed for a public library, and I advise against it. |
| **Content sync** (WordPress API feeds our app, or ours feeds WordPress) | Lets the app show articles inside the member area. | Works, but builds a two-way dependency. |

### B3. Can the existing app host public indexable pages and a publishing system *itself*?

**Yes.** The server already writes HTML for the start page and already serves static pages. Adding server-written public pages and a publishing area is a normal extension of the existing Express server, and the new pages would sit in their own address area, with their own tables, leaving every existing route and member record untouched. It also fits the 512 MB server *if* public pages are cached (section G).

---

## C. Architecture: the three options compared

| | **Option 1: Integrated module** | **Option 2: Separate WordPress** | **Option 3: Headless WordPress** |
|---|---|---|---|
| **What it is** | Publishing built into our app: server-written public pages + a Publishing area in the admin | WordPress as its own public site at another address, linked to the app | WordPress used only as a back-office editor; our app (or a new front end) draws the public pages from it |
| **Address** | Same domain: `/en/…`, `/fr/…` | Subdomain or separate domain (or a proxy) | Same domain possible |
| **Editor experience** | Custom, built to your workflow (we make it simple, but it is new) | Mature, familiar, huge number of helpers and people who know it | Mature editor |
| **Design** | Fully custom, one design system with the app | Custom theme needed for "premium" | Fully custom |
| **Bilingual** | Built in: separate addresses, `hreflang`, translation status | Plugin (Polylang free; WPML paid) | Plugin + our front end must output hreflang |
| **SEO tools** | We build exactly what is needed (titles, descriptions, canonical, sitemap, schema) | Strong plugins (Yoast, Rank Math) | Plugin data must be re-used by our front end |
| **AI draft workflow** | Enforced in our code (cannot publish an unreviewed AI draft) | Needs plugin or custom bridge; the rule is only as strong as the settings | Same as Option 2, plus a bridge |
| **Source preservation** | Native (database link to the teaching/book used) | Custom fields | Custom fields |
| **Registration attribution** | **Native**: the Growth report already counts sign-ups per source, campaign and landing page | By tagged links only; no sign-up-to-article link by itself | Possible, with work |
| **New systems to run** | None | WordPress + MySQL + disk + backups + updates | WordPress + MySQL + disk + our rendering layer |
| **Security upkeep** | Part of the code we already maintain | Constant: core, theme and plugin updates, a frequent attack target | Smaller attack surface than Option 2 (admin can be hidden), but still there |
| **Speed** | Fast if cached; very light pages possible | Usually slow without caching and good hosting | Fast if built well |
| **Upfront effort** | **Highest of the simple ones** (we build the editor and tools) | Moderate for install, high for a premium theme | **Highest overall** |
| **Running cost** | Lowest (no new hosting; likely one server upgrade) | Highest recurring (hosting + plugins) | Highest overall |
| **Risk to the existing app** | Low if kept in its own area and covered by tests | None to the app, but moves the public identity to another address | Low to medium |
| **Lock-in** | Content in our database. Mitigation: export to clean files | WordPress export is standard, but plugin data is sticky | Mixed |
| **Who can maintain it** | Us (a developer who knows this codebase) | Any WordPress freelancer worldwide | Needs both skill sets |

### Recommendation: **Option 1**

**Why it is the best fit for The God Nation now:**

1. **One ecosystem for real.** Same domain, same cookies, same design, same registration. You asked for "one connected digital ecosystem." Only Option 1 delivers that without moving the app.
2. **Search strength stays in one place.** Every article strengthens the *main* domain that members and links already use.
3. **Measure what matters.** Article → sign-up is the number that tells you which Kingdom subjects *bring people in*. We already have the plumbing.
4. **Lowest long-term load for a small team.** No PHP stack, no plugin treadmill.
5. **Strict separation is easier to prove.** Public articles live in their own tables and their own address area, served through an allow-list of fields. A test can assert "nothing private can ever appear here."
6. **The AI rule is a hard rule.** The "publish" action refuses any AI-assisted item that no authorised person has reviewed and approved.

**What you give up:** off-the-shelf plugins, and the ability to hand the site to any WordPress freelancer. **How we limit that risk:**
- Content is stored in clean, structured tables with a one-click export (Markdown + JSON + images), so moving to WordPress later is possible.
- Public web addresses are permanent and independent of the technology, so a later change does not break links or rankings.
- I keep the scope narrow: articles, divisions, authors, media, translations, SEO fields, scheduling, roles. These are exactly what our stack does well. I will not turn it into a general-purpose CMS.

**When WordPress would be the better choice** (I would tell you if this became true): if you plan **several editors publishing daily** who need a very rich editing environment and want to hire from the WordPress talent pool; or if you wanted a quick stopgap site within days. In that case Option 2 on a subdomain is the safer of the two WordPress routes. I advise against Option 3: it has the most moving parts for the least gain.

**On your rule "no unnecessary expensive custom development":** I assessed what exists first (section A5). The pieces that cost the most to build elsewhere (accounts, roles, bilingual data, storage, audit, attribution, AI connection, design system) are already here. The new custom work is the editor, the public templates and SEO tooling, and a premium WordPress theme would need custom work too.

---

## D. Proposed website sitemap

**Reconciling your brief:** it lists sections C, D, E (Kingdom Education, Leadership Academy, Media and Evangelism) *and* six knowledge divisions that overlap them. Two parallel trees would split search strength and confuse visitors. I propose **the six divisions are the Knowledge Centre structure, and your sections C, D and E are the landing pages of divisions 1, 2 and 3.** (Decision I-3.)

```
/en/                         Home (institutional)
/en/knowledge/               Knowledge Centre (library, search, filters)
   /en/knowledge/kingdom-knowledge/              Division 1   (your section C: Kingdom Education)
   /en/knowledge/kingdom-leadership/             Division 2   (your section D: Leadership Academy)
   /en/knowledge/digital-media-evangelism/       Division 3   (your section E: Media and Evangelism)
   /en/knowledge/discipleship-spiritual-growth/  Division 4
   /en/knowledge/books-publications/             Division 5   (also: /en/books/)
   /en/knowledge/community-outreach/             Division 6
   /en/knowledge/{division}/{article-title}/     Each article: permanent, descriptive address
/en/books/                   Books and Publications (public catalogue)
   /en/books/{book-title}/   One page per book: cover, author, description, language, related articles, how to obtain
/en/about/                   About: identity, history, mission, vision, objectives, leadership
/en/contact/                 Contact (reuses the existing contact form)
/en/join/                    Join the Community  →  goes to the EXISTING /member/join
/en/login/                   Members: Sign in    →  goes to the EXISTING /member/login

/fr/…                        The mirror, with French words in the addresses:
/fr/connaissance/…           (for example /fr/connaissance/connaissance-du-royaume/qu-est-ce-que-le-royaume-de-dieu/)
/fr/livres/ , /fr/a-propos/ , /fr/contact/ , /fr/rejoindre/ , /fr/connexion/

/sitemap.xml  /robots.txt   (one sitemap listing both languages with hreflang)

UNCHANGED, exactly as today:
/member/**  /api/**  /admin  /login  /member/join  /member/login  /page/:slug  /privacy  /teachings  /announcements
/leader-guide/  /no-app-guide/  and everything installed phones already use
```

**How it connects to the community platform**
- Every "Join" button on every public page goes to the existing `/member/join`, tagged with where the visitor came from (`utm_source=site&utm_campaign=<article>`), so the Growth report can show which article brought which sign-up.
- "Members: Sign in" goes to the existing `/member/login`. Signed-in members visiting a public page see a small "Open the app" link instead of "Join."
- No new login, no new registration page, no duplicate.
- Private material (member teachings, exams, books' PDFs, dashboards) is *not reachable* from the public area, in code or in the sitemap. Public book pages describe a book and say how to obtain it; they never serve the file.

**The home address `/`** is today the app's start page. Phase 2 does not change it. Later you can choose to make `/` the institutional home that detects the visitor's language (Decision I-2). The installed app starts at `/member/chats` and is not affected either way.

---

## E. Design proposal

**Open the companion file** `The-God-Nation-Website-Design-Preview.html` (sent with this document): phone-sized and desktop-sized mock-ups of the Home page, Knowledge Centre and an article page. The sample text in them is placeholder layout text, not real content.

**Direction in one sentence:** *a premium academic-press feel in The God Nation's own navy and gold: confident serif headlines, generous white space, large readable text and quiet motion, closer to a respected publishing institution than to a church flyer or a blog.*

| Element | Proposal |
|---|---|
| Colours | The app's navy (`#0f2260`) and gold (`#e0b027`) as the institutional pair, warm off-white for reading pages, deep navy for hero sections. Same colour values as the app, so both feel like one house. |
| Type | A refined serif for headlines and article titles (candidate: *Source Serif 4* or *Fraunces*), Inter (already in the app) for body and navigation. Self-hosted and trimmed to the needed characters (French accents included) so type adds little weight. |
| Layout | Mobile-first at 360 px. Single reading column of about 65 characters; wide, calm margins on desktop. Division pages use a clear "start here" featured item, then a list. |
| Images | Real photography and honest storytelling, not stock clichés; African identity through people, places and craft, not symbols or stereotypes. Every image gets alt text. Automatically resized and served in modern formats. |
| Navigation | One short top bar: Knowledge · Books · About · Join, with the **EN / FR** switch always visible and keeping you on the same article's counterpart when one exists. A bottom "Join the community" band on every page. |
| Article page | Title, summary, author with photo, date and "updated" date, reading time, contents list for long pieces, scripture references styled distinctively, FAQs where useful, "Related articles" and "Related books", share buttons (WhatsApp first), a quiet "Continue in the community" call to action. |
| Speed budget | Public pages are plain, server-written HTML with almost no JavaScript. Target: readable within about 2.5 seconds on a mid-range Android on slow 4G; first page under ~150 KB. |
| Admin dashboard | Calm, task-first: "Write", "Review", "Scheduled", "Published", a calendar view, and a clear status chip on every item (Draft → In review → Approved → Scheduled → Published). |

Once you approve the direction, I will produce full-fidelity designs for the remaining pages you listed (category landing, Books and Publications, About, language navigation, the publishing dashboard) *before* building them.

---

## F. Development plan

### F1. Phases (adjusted from your roadmap)

| Phase | What gets built | Depends on | Estimate* |
|---|---|---|---|
| **1. Audit and architecture** | This document; your decisions | Your approval | Done on approval |
| **2. Public foundation** | Server-written public pages; `/en` and `/fr` structure; language switch; Home, About, Contact, Join/Login hand-offs; navigation and the design system; safe routing beside the app; page caching; service worker adjusted for the new area; media storage backup | Phase 1 decisions; brand photos and About text | 2.5 to 3 weeks |
| **3. Publishing engine** | Article model; six divisions; authors; media library; revisions; draft → review → approve → schedule → publish; EN/FR counterparts with translation status; SEO fields; related articles and books; publishing roles; Publishing area in the admin dashboard and in the central admin's profile; Books and Publications catalogue | Phase 2 | 3.5 to 4 weeks |
| **4. Search and discoverability** | Language-aware sitemap with `hreflang`; robots rules (public open, private closed); canonical addresses; Schema.org (Organization, Article, Person, Book, BreadcrumbList, Event); redirects tool; Search Console and Bing verification; crawler permissions (section F4); speed checks | Phase 3 (articles exist to test) | 1.5 to 2 weeks (some overlap with Phase 3) |
| **5. AI editor, analytics, first content** | AI editorial assistant with the draft-and-review rule and source records; terminology glossary for translations; distribution drafts (Facebook, WhatsApp, captions, scripts); Google Analytics 4 behind the consent banner; Search Console figures in the dashboard; article-to-registration reports; first articles prepared from your books and teachings | Phase 3; AI provider decision; your material | 3 weeks, then ongoing |

\*Calendar weeks, assuming you can approve designs and answer questions within a few days. **First public Knowledge Centre with real articles: about 6 to 7 weeks. Full programme: about 11 to 13 weeks.** I have not built a bilingual publishing engine on this codebase before, so I would hold the estimate loosely until Phase 2 is finished and then re-state it.

### F2. Features of the publishing engine (Phase 3 detail)

- **Roles** (reusing existing logins, no new login): *Author* (writes, submits), *Editor* (edits, reviews), *Publisher* (approves and publishes), plus the existing central admin who can do everything. Roles are assigned to people already in the system.
- **Workflow:** Draft → In review → Approved → Scheduled → Published; Unpublish and Update at any time with a visible "last updated." Every step is written to the audit log.
- **Bilingual:** an article and its counterpart are linked. The French page carries its own title, summary, address and SEO text. **A French page is only shown to search engines once marked "Reviewed"**; until then it is hidden (not indexed), which prevents poor translations from ever being the public face of the institution.
- **Content format:** clean structured text (headings, scripture quotes, FAQ blocks, images), not arbitrary pasted code, so pages stay fast, safe and consistent.
- **Media library:** images with alt text, automatically resized; stored in R2.

### F3. The AI editorial assistant (design)

- **What it does:** from a supplied teaching, book excerpt, transcript or notes: suggest topics and outlines, draft an article, summaries, FAQs, SEO title/description/address, internal links, English→French translation, and distribution drafts.
- **What it can never do:** publish. Every AI output is saved as a *draft* labelled "AI-assisted." The publish action **refuses** an AI-assisted item until a person with the Publisher role has opened, edited and approved it. The approver and time are recorded.
- **Sources preserved:** each article stores *which teaching, book or transcript* it was made from (and which passages). You can always trace and verify.
- **No invention:** the assistant is instructed to use only the supplied source plus references that a human then checks; scripture references and quotations are shown in a "verify" list for the reviewer. It cannot be trusted to guarantee this, so the rule is *human review*, not machine promises.
- **Terminology:** a glossary of The God Nation's terms (for example the exact French rendering of "Kingdom ambassador," "dominion," "restoration") is fed into every translation and shown to the reviewer.
- **Which AI:** the app already uses Google Gemini for chat translation. I recommend we **test two or three providers on a sample of your own teaching** and keep the one that preserves meaning best, behind a single switch so we can change later. One important point: **the current Gemini key is on the free tier. Free tiers typically allow the provider to use submitted text to improve their products** (I have not re-checked the current terms). For your unpublished books and teachings, you should use a *paid* tier whose terms say it does not train on your content, to protect your intellectual property. Private messages, prayer requests and member data are never sent to the assistant (the existing translation code already follows that rule).
- **Scale warning (relevant to Google):** Google's spam rules target *large numbers of pages made mainly to rank*, whether written by AI or people. Your plan (two substantial articles a week from your own teachings) is the opposite. I would build **no bulk-generate feature** on purpose.

### F4. Search and AI discoverability (design)

- **Server-written pages** with correct headings, one language per page, canonical address and `hreflang` pairs (including an `x-default`), plus Schema.org data that only describes what is visible on the page.
- **Crawler permissions, kept separate** (as you asked, and as OpenAI's own documentation describes): *OAI-SearchBot* (ChatGPT search) allowed on the public library; *GPTBot* (model training) is a **separate choice for you**; *ChatGPT-User* is user-initiated and may not follow robots.txt. Similar split exists for other companies' crawlers (for example Google's separate control for Gemini training, Anthropic's several crawlers); I will confirm each vendor's current names on their own pages in Phase 4 and present the list for your decision. Private areas get a robots exclusion *and* an HTTP "noindex" header *and* are behind sign-in.
- **What I cannot promise:** rankings or AI recommendations. What we can do is make pages crawlable, fast, well-structured, original and authoritative.
- Search Console and Bing Webmaster verification need *you* (or me with your delegated access) to confirm ownership of the domain.

### F5. Analytics

- Google Analytics 4 loaded only after the visitor allows it (we already built that banner in Phase C), plus Search Console (queries, impressions, clicks) and Bing.
- **Our own, privacy-friendly numbers** from the Growth report: article → "Join" click → sign-up → profile completed → first chat, by article, division and language. This is the figure GA4 cannot give you alone.
- AI-search referrals: where the visitor's referrer says so (for example from ChatGPT), they are labelled; many are not identifiable, so expect gaps.

### F6. Maintenance after launch

- Code and dependency updates: already part of how we run the app.
- Content: Editor/Publisher time; a weekly review of what is read and what brings sign-ups; quarterly refresh of top articles (the "updated" date matters).
- Backups: database nightly (exists); **files backup to be added** (Phase 2).
- Monitoring: uptime and errors (to set up), Search Console crawl errors checked weekly at first.

---

## G. Risk assessment

| # | Risk | Likelihood / impact | How I handle it |
|---|---|---|---|
| G1 | **Breaking the existing app** by adding routes (the app has a catch-all that sends every unknown address to the screens) | Medium / High | New public area under its own `/en` and `/fr` prefixes registered *before* the catch-all; tests that every current address still behaves exactly as today; staged deploys. |
| G2 | **Installed phones' service worker** (the offline helper) serving a stale or wrong page for the new area | Medium / Medium | Exclude the public area from its page cache (same technique used for the guide folders); test with an installed app. |
| G3 | **Private content leaking** into public pages or the sitemap | Low / Very high | Separate tables; field allow-lists; never reusing `LibraryBook`; automated test that crawls the public area and fails if any private marker appears; `noindex` headers on private routes. |
| G4 | **Server too small** (0.5 CPU, 512 MB, one instance): a viral article could slow the *member app* | Medium / High | Cache public pages in memory and at a free CDN (Cloudflare) so most requests never reach the server; likely upgrade of the Render plan (indicative extra cost below). |
| G5 | **Sleeping free database** adds delay to the first visit after quiet periods; crawlers dislike slow pages | Medium / Medium | Cached pages; consider upgrading Neon when traffic grows; keep public pages independent of live database calls where possible. |
| G6 | **Media files not backed up** (R2) | High today / Medium | Add file backup before the media library opens (Phase 2). |
| G7 | **Poor French translations** damaging credibility | Medium / High | Glossary; "Reviewed" gate before a French page is indexed; reviewer sees both versions side by side. |
| G8 | **AI-generated errors** (wrong scripture, invented facts) | Medium / High | No auto-publish (enforced); source preserved; verify-list for references; human approver recorded. |
| G9 | **Google judging the site as thin or mass-produced** | Low if the plan is followed | Low volume, original, substantial content; no bulk generator; clear authorship. |
| G10 | **Cookies and tracking law** (Cameroon's 2024 data law is still being implemented; cookie rules unclear) | Medium / Medium | Analytics and ad tools only after consent (banner already built); privacy page updated; lawyer review (already recommended). |
| G11 | **Key-person dependence**: publishing tied to developers | Medium / Medium | Clean export, documented code, simple admin so editors work without us; a handover document. |
| G12 | **Editors' content security** (pasted scripts, malicious uploads) | Low / High | Structured content only, sanitised; image-only uploads with size and type checks; roles; audit log. |
| G13 | **Hosting dependence on one region/instance**; every deploy briefly restarts the site | Certain / Low | Cached pages continue to be served by the CDN during restarts. |
| G14 | **Domain moves** (if Cloudflare is added: name servers change at the registrar) | Low / High if done wrong | Done carefully, with the old records copied first; I will give you a step-by-step and we do it together. |
| G15 | **The real bottleneck is writing**, not code | High / High for the vision | Plan content production: one author calendar; start with a few excellent pieces rather than many. |

---

## H. Cost and maintenance implications

*All prices below are indicative, from my general knowledge, **not verified against current price lists.** I will confirm each on the provider's page before you commit to anything.*

| Item | Option 1 (recommended) | Option 2 (separate WordPress) |
|---|---|---|
| New hosting | None at first. Likely a Render plan upgrade (more memory) as traffic grows: roughly tens of US dollars a month | Web service + MySQL + disk on Render, or managed WordPress hosting: roughly 15 to 40 US dollars a month, plus the existing app's hosting |
| Domain | Existing | Existing (a subdomain costs nothing) |
| CDN | Cloudflare free plan (requires moving the domain's name servers) | Same, or the host's own |
| Software licences | None | Typically paid SEO and multilingual plugins, roughly 100 to 300 US dollars a year |
| Design | Custom, built once | Custom theme needed for "premium" (the larger cost) |
| AI services | A *paid* API tier (needed to protect your IP). At three articles a week, probably a few US dollars a month; I will measure real usage in Phase 5 and give you a cap | Same |
| Analytics | GA4, Search Console, Bing: free | Same |
| Files (images) | R2: very small, within free allowances at first | Host's disk |
| Ongoing maintenance | Included in our normal app upkeep | Plugin/core updates, security scanning, backups: a regular task or a paid service |
| One-off setup | Mostly my development time | Install is quick; theme, multilingual set-up and integration are the work |

---

## I. Decisions I need from you

1. **Architecture:** do you approve **Option 1** (integrated module), or do you prefer Option 2 (WordPress on a subdomain)? I do not recommend Option 3.
2. **The home address `/`:** keep the app's start page as is for now (my recommendation), and launch the institutional home at `/en/` and `/fr/`; decide later whether `/` becomes the institutional home.
3. **Structure:** confirm the six divisions as the Knowledge Centre structure, with your sections C, D and E as the landing pages of divisions 1, 2 and 3 (section D above).
4. **Language addresses:** approve English addresses under `/en/…` and French under `/fr/…`, with French words in French addresses.
5. **Design direction:** approve (or correct) the visual direction in the preview file; tell me anything that looks wrong, especially photography and tone.
6. **AI:** agree that we (a) use a **paid** AI tier for your own material, (b) test providers on a sample teaching before choosing, (c) build **no bulk generation**.
7. **AI crawlers:** I recommend allowing search crawlers (including OAI-SearchBot) on the public library. Whether to also allow *training* crawlers such as GPTBot is your choice; you can decide at Phase 4.
8. **Content owner:** who will be the lead author and who the French reviewer? The plan needs a named person for each.
9. **Sample material:** please choose **one teaching or book chapter** I can use as the test piece for the AI assistant and the first article.
10. **Server and CDN:** I may recommend a Render plan upgrade and adding Cloudflare in front of the domain once Phase 2 is built. Do you agree in principle?

## What I could not verify (stated plainly)

- Current prices of Render, Neon, Cloudflare, WordPress plugins and the AI providers.
- That AI-search crawlers do not run JavaScript. This is widely reported, and the safe design (server-written pages) does not depend on it.
- The current names and rules of every AI crawler other than OpenAI's (which I checked in OpenAI's documentation: OAI-SearchBot for search, GPTBot for training, ChatGPT-User for user-requested visits, each controlled separately).
- The exact current wording of Google's spam-policy page (a 2024 Google post defines "scaled content abuse"; the current wording should be read directly).
- Whether free-tier AI terms allow training on your text; verify before sending any original book content.
- Cameroon's cookie and data-protection requirements for analytics (lawyer).
- My timeline: it is an estimate, to be restated after Phase 2.

## Sources

- OpenAI, [Overview of OpenAI crawlers](https://developers.openai.com/api/docs/bots)
- Google Search Central, [Managing multi-regional and multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)
- Google Search Central blog, [March 2024 core update and new spam policies](https://developers.google.com/search/blog/2024/03/core-update-spam-policies)
- WordPress.org, [Requirements](https://wordpress.org/about/requirements/)
- Render, [Deploy WordPress](https://render.com/docs/deploy-wordpress)
