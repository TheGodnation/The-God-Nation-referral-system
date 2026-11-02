# Phase 5 — King's Token: what is built, and what is left

Written 2 November 2026 so nothing is lost. The decisions below come from the
founder's conversations and White Paper Draft 8. Nothing under "Left to build"
has been started. Build each part only when the founder says to start it.

## Built and live

**5a — Ledger and earning** (migration `20261112090000_king_token`)
- Permanent ledger (`TokenEntry`): entries are only ever added, never edited.
- Earned tokens from Dominion Clinic exams: 8 per correct answer, halving every
  4 years down to 1, then 1 for ever. First try only. Only exams taken on or
  after the start day.
- Foundation share: 30 tokens for every 70 earned, locked 4 years
  (`lockedUntil`; the public release schedule is not built yet).
- "Start counting now" button, or a chosen day, in the central admin's panel
  (admin dashboard and the admin's own member profile). Locked once the day
  has arrived.
- Member page `/member/tokens`: balance, history, rate now, next halving,
  schedule, the foundation's balance. Tokens earned show after each exam.
- Code: `server/src/lib/tokens.ts`, `routes/adminTokens.ts`, `routes/memberTokens.ts`,
  `client/src/pages/MemberTokensPage.tsx`, `components/admin/TokensCard.tsx`.

**5c (earned-token part) — Spending toward a book** (migration `20261113090000_token_spend`)
- Off until the central admin switches it on (`Settings.tokenSpendEnabled`).
- Earned tokens can pay up to 30% of a leadership book (`tokenSpendMaxPercent`);
  1 token = 1 franc by default (`tokenValueFcfa`). Both adjustable.
- Tokens are held when the member says "I have paid", settled when confirmed
  (half to the foundation treasury, half burned), released if rejected.
  Works for direct claims, several books at once, and agent orders.
- Not used with the automatic "Pay now" provider path.
- Code: `server/src/lib/tokenSpend.ts`, hooks in `lib/bookPayments.ts`,
  `routes/examWorld.ts`, `routes/paymentOrders.ts`; client `components/learn/UseTokens.tsx`.

## Left to build

### 5b — Situation books shelf (the books are not ready yet)
- A separate shelf, apart from the Leadership School. Paid books by the
  Evangelist (about six a year), standalone, available at any time.
- Earn 16 tokens per correct answer (halving every 4 years down to 2), **once
  per person per book**, first try only, only after payment is confirmed, with
  a minimum score of 50% (proposed).
- The inviter commission does not apply to situation books.
- The earning rate function already exists (`rateAt('BOOK', ...)` in `lib/tokens.ts`).

### 5d — Extras
- Lock tokens for a bigger marketplace discount (longer lock, bigger discount).
- Bonus for consecutive months of study, paid in locked tokens (size set by the admin).
- Yearly review that can lower future rewards: announced in advance (6 months
  proposed), never applied to tokens already earned.
- Public supply page: issued, burned, locked, circulating.
- Public release schedule for the foundation's locked tokens (no more than
  about 2% a month, after the 4-year lock).
- Monthly fingerprint of the ledger, optionally published on a public blockchain.
- Rule that earned tokens leave the community only 12 months after they were
  earned, then are released monthly over 12 months (matters only if a real token exists).
- One verified account per person; clawback for cheaters.

### Bought tokens, gifts between members, care fund (wait for the Google billing decision)
- Bought tokens: paid with money at a fixed price set by the foundation;
  spend-only, never convertible to a real token, never cashed out.
  Selling a virtual currency inside the Android app requires Google Play
  billing. No token is sold until a legal review confirms it is allowed as
  prepaid community credit, country by country.
- Gifts: Bought tokens only, between verified members, with daily and monthly
  limits, every gift in the ledger. Earned tokens cannot be gifted.
- Care fund for members in need (Bought tokens), with a yearly public report
  that names nobody.
- Buying a book or item as a gift for another member.
- Earned tokens may pay up to 30% of any price; the rest in money or Bought tokens.

### Later, with legal and tokenomics advice (only if the foundation decides)
- Layer 2, the real token: fixed total supply, built only from Earned tokens,
  released through a yearly conversion window with a fixed declining budget
  shared in proportion to what members convert; converted tokens locked 12
  months then released over 12 months.
- Staged exchange listing only where legal. No promise of value, price or profit.

## Open decisions for the founder
- Price of a Bought token (the "100 tokens = US$1" in the paper was only an
  example; at 1 token = 1 franc a full-marks member earns about 240 FCFA a month).
- Minimum score for situation books (50% proposed).
- Size of the consecutive-month bonus and the lock-for-discount terms.
- Whether book payments by Mobile Money are acceptable to Google Play (check
  before the Play Store submission; independent of tokens).
- The Dominion Clinic start date: press "Start counting now" that day (or set the day).
