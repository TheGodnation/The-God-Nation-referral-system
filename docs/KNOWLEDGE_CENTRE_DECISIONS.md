# Knowledge Centre — founder's decisions (3 November 2026)

Recorded from the founder's instructions on 3 November 2026. Change any line by telling the developer; this file is then updated.

## Going live

| Item | Decision |
|---|---|
| Public pages (home, Knowledge Centre, six areas, About, Contact) | **Approved to go live.** The developer may improve anything that is not professional or high-class; the founder reviews afterwards and sends corrections. The site stays "still being built". |
| French pages | **Approved to publish in the founder's name** (Evangelist Stanley A. Ndoh). This is a decision to publish, not a French-language proofreading: the founder will read the French line by line (`docs/FRENCH_REVIEW_SHEET.md`) and send corrections. Recorded in code as `FR_APPROVAL` in `server/src/lib/publicSite/content.ts`. A page's French can be taken off the public site at any time by setting its flag to false there. |
| Photographs | The founder will send one or two photos of himself and any group photo. Places are ready (`PHOTOS` in the same file); a page shows a photo only when one is set. Nothing else is shown in their place, so the site never looks unfinished. |
| Service-worker phone check | Done by the founder on his phone: offline reading and the installed app work. |
| About page extras (leadership, history) | The founder will send later. |

## Roles (built with the editing screens)

| Role | Person or body |
|---|---|
| Writer | Evangelist Stanley A. Ndoh |
| French reviewer | Evangelist Stanley A. Ndoh |
| Editor | Evangelist Stanley A. Ndoh (and The God Nation Media and Leadership Academy) |
| Publisher | The God Nation Media and Leadership Academy |

These can be changed at any time.

## Technical and policy decisions

| # | Decision | Status |
|---|---|---|
| 3 | Database reconnect reliability | Approved. A one-time retry has existed since 18 October (closed connection). Added on 3 November: when the sleeping free-plan database is unreachable, retry up to three more times with growing pauses (never for real errors, so nothing is done twice), with tests. Connection-string tuning in Render is optional and not done. |
| 4 | Billing on the Google translation key | Approved; the founder will turn it on. Instructions to be given after the other work is done. The AI assistant never uses the free key. |
| 5 | Second backup (Backblaze B2, an account the founder owns) | Approved, stage by stage. **Stage 1 built** (workflow + script, dormant until the four B2 secrets exist). Stage 2: the founder creates the account (`docs/SECOND_BACKUP_GUIDE.md`). |
| 6 | Roles | See above. |
| 7 | First real teaching for the AI test | The founder will choose when the AI phase starts. |
| 8 | Addresses `/en/…` and `/fr/…`; `/` unchanged | Approved. |
| 9 | No new paid hosting now (Render stays as is; no Cloudflare in front yet; Neon not upgraded yet) | Approved. The developer will measure speed from Cameroon after go-live and advise. |
| 10 | Crawlers and cookies: search engines and AI search tools may read public pages; private areas blocked; public pages set no cookies; analytics only after consent | Approved. Wording to be checked by a lawyer. `robots.txt` updated accordingly. |

## Book pages on the public website (4 November 2026)

- Decided by the founder: the public site shows each book's cover, description and
  **chapter summaries only**. No preview of the book's text. Readers join the community to read.
- Each book has its own page: `/en/books/<slug>/` and `/fr/livres/<slug>/`, linked from the
  book shelf and the Books and Publications area.
- Chapter summaries come from the app (Library, chapters) and are matched to the website's
  books by **title**. A book the app does not hold yet, or has no chapters for, shows no
  chapter section. A French page shows only chapters written in French.
- Book Two (The Doorway into the Kingdom) is not in the Leadership School yet, so its page
  shows no "Join to read it" button and no chapters until it is added in the app.
