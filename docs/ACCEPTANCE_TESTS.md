# Phase 1 Acceptance Tests

All automated tests live in `server/src/__tests__` (Vitest + Supertest,
run against a real PostgreSQL test database) and `client/src/__tests__`
(Vitest + React Testing Library).

| Spec section | Scenario | Test file |
| --- | --- | --- |
| §36 | Mary basic flow (visit → register → WhatsApp → dashboards) | `referralFlow.test.ts` |
| §37 | Mary → John, latest visit wins | `attribution.test.ts` |
| §38 | Permanent attribution is immutable | `attribution.test.ts` |
| §39 | Language switch does not change attribution | `attribution.test.ts` |
| §40 | Duplicate registration rejected | `duplicateRegistration.test.ts` |
| §41 | Concurrent duplicate registration (no 500, exactly one winner) | `duplicateRegistration.test.ts` |
| §42 | Attribution expiration (30 days) — registration still succeeds | `attribution.test.ts` |
| §43 | Referral code change preserves history | `codeChange.test.ts` |
| §44 | WhatsApp redirect authorization (missing/mismatched/matching cookie) | `whatsappAuth.test.ts` |
| §45 | Leader/Admin authorization boundaries | `authorization.test.ts` |
| §46 | Security fundamentals (hashing, CSRF, opaque sessions, cookie flags) | `authorization.test.ts` |
| §47 | Marketing attribution determinism (no fallback to older visits) | `attribution.test.ts` |

Run them with:

```bash
cd server && npm run test
cd client && npm run test
```

See the final build report (delivered in the implementation session) for
the actual pass/fail results and build verification log.
