# Public website foundation (Phase 2): what is built, and how it is switched on

Status on 3 November 2026: **built and tested, switched OFF.** Nothing at `/en/…` or `/fr/…` exists on the live site until the switch is turned on after the owner's approval of the real pages and the French wording.

## What is built

| Part | Where | Notes |
|---|---|---|
| Pages (English and French) | `server/src/lib/publicSite/` | Home, Knowledge Centre landing, the six knowledge areas, About, Contact, a branded 404 |
| Words | `content.ts` | English from the project brief; French drafted by the developer, marked **not reviewed** |
| Page writer | `render.ts` | Complete HTML, no JavaScript, no cookies, structured data (Organization, WebSite, BreadcrumbList), canonical address, language links only for approved pages |
| Design | `style.ts` | The approved preview's navy and gold, paper reading surface, serif headings. One small stylesheet inside each page |
| Router | `router.ts`, mounted in `app.ts` | Mounted before the cookie, session and API steps, only when `PUBLIC_SITE_ENABLED=true` |
| Addresses | See the table below | One address per page and language, closing slash, true 404 inside the area |
| Join and Sign-in | `/en/join/`, `/en/login/`, `/fr/rejoindre/`, `/fr/connexion/` | Redirect to the existing `/member/join` (tagged with where the visitor came from) and `/member/login`. No second registration or login |
| Sitemap | `/sitemap-public.xml` (only when on) | Lists only approved pages with language alternates. The existing `/sitemap.xml` is untouched until Phase 6 |
| Service worker | `client/public/sw.js` | Already live: ignores `/en/` and `/fr/` (see SERVICE_WORKER_CHANGE.md) |

| English | French |
|---|---|
| `/en/` | `/fr/` |
| `/en/knowledge/` | `/fr/connaissance/` |
| `/en/knowledge/<area>/` | `/fr/connaissance/<domaine>/` |
| `/en/about/` | `/fr/a-propos/` |
| `/en/contact/` | `/fr/contact/` |
| `/en/join/` (redirect) | `/fr/rejoindre/` (redirect) |
| `/en/login/` (redirect) | `/fr/connexion/` (redirect) |

## The rules the tests enforce

1. With the switch off, no public address exists and every existing address behaves exactly as before (41 existing addresses compared, switch off against on: identical).
2. Public pages carry no cookies; the app's own pages still set theirs.
3. Every page is complete readable HTML, with no scripts apart from structured data, and is within the weight budget (under 30 KB, under 8 KB compressed).
4. A French page is "noindex", has no language links, is left out of the sitemap, and is not offered from the English pages until `FR_REVIEWED` is set for it in `content.ts`.
5. An empty knowledge area is "noindex" and out of the sitemap until it has articles (`hasArticles`).
6. Missing pages inside the area return a real 404. Every link on every page resolves. No e-mail addresses, storage keys or tokens appear in any page.
7. The existing addresses and the installed app's identity cannot change without a test failing.

## What still needs the ministry before the switch is turned on

| Item | Who | Why |
|---|---|---|
| Approve the real pages (the preview pictures) | Evangelist Ndoh | Design and wording are shown for approval before launch |
| French review of `docs/FRENCH_REVIEW_SHEET.md` | The French reviewer (to be named) | French stays hidden until approved |
| Photography | Ministry | The pages are colour-only today. Real, dignified photography of African leadership, education, media and outreach is needed, with alt text |
| "About" extras: leadership, history | Ministry | Not invented. Add when supplied |
| Contact details to publish | Ministry | Today Contact points to the existing contact form |
| Real-phone check of the service worker | Evangelist Ndoh (guide in SERVICE_WORKER_CHANGE.md) | Condition agreed before launch |

## How to switch it on (when approved)

1. In Render, set the environment variable `PUBLIC_SITE_ENABLED` to `true` on the web service (or ask Claude to do it). The service restarts.
2. Check `/en/`, `/fr/`, `/en/about/` and the existing `/`, `/member/login`, `/member/chats`.
3. Repeat the offline sequence from SERVICE_WORKER_CHANGE.md with an article page open.

## How to switch it off again

Set `PUBLIC_SITE_ENABLED` to `false` (or remove it). Every `/en/…` and `/fr/…` address immediately returns to the app's behaviour. No data is involved.

## Still to do in Phase 2

- The second, independent backup copy and the first restore drill (waiting for the owner's choice of destination and a new account).
- Speed checks from conditions close to Cameroon once the pages are live.
