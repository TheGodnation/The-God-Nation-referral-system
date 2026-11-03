# Service worker change for the public website (approved 3 November 2026)

## What changed

One addition to `client/public/sw.js`: page loads under `/en/` and `/fr/` (and `/en`, `/fr` themselves) are left entirely to the browser, the same way the four guide folders already are. Nothing else in the worker changed.

## Why it is needed

The worker saves the most recent successful page as the app's "offline start page". Once public articles exist, an article opened online would replace that saved page, and opening the installed app with no internet would show the article instead of the app (and downloaded books could not be reached). This was reproduced on a prototype and is now guarded by automatic tests that fail on the old worker and pass on the new one.

## What it does not change

- Sign-in, sign-up, sessions, cookies, the API, the four guide folders, push notifications, share-into-app, the installed app's identity (`id`, `scope`, `start_url`) and offline reading of downloaded books.
- No public page exists yet. Until the public website is switched on, this change has no visible effect at all. It is shipped first on purpose so that phones receive it before any public page appears.

## Automatic tests (run on every release)

- `serviceWorkerPublicArea.test.ts` runs the real worker file in a sandbox: public paths are not handled; app pages still are; a public page never replaces the saved start page; offline an app page still comes from the saved start page; the API and guides are still ignored; the exact failing sequence (read an article online, then open the app offline) passes.
- `existingAddressesContract.test.ts` (screens) and `existingApiContract.test.ts` (server): every existing address and API area must still exist, nothing in the app may use `/en` or `/fr`, and the installed app's identity must not change.

## Real-phone check (please do this once, about 5 minutes)

On an Android phone with the app installed (and, if possible, one iPhone with the app on the Home Screen), a day or so after this is live, so the phone has picked up the new worker:

1. Open the installed app normally. Sign in. Confirm chats, Learn and the School open.
2. Open a downloaded book while connected. Then turn on airplane mode, close the app completely, open it again and open the same downloaded book. It must open.
3. Open the app with airplane mode on from a cold start. The app's start screen must appear (not a browser error page and not a blank page).
4. Turn airplane mode off. Confirm everything loads again.
5. Tell me anything that looks different from before.

Later, when the public pages are switched on, repeat the sequence with an article: read one article, close the app, turn on airplane mode, open the app: the app must appear, not the article.

## Rollback

If anything looks wrong after release:

1. Revert the commit that contains this change (`git revert <commit>`), push, and let the automatic deploy finish.
2. Phones fetch `sw.js` fresh on their next visit (the server sends it with `Cache-Control: no-cache`), so the old worker returns without any action by members.
3. Because no public page exists while the public site is off, reverting has no other effect.
