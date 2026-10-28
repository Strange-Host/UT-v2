# Build plan: everything left, and the order to build it

Written 28 Oct 2026 from a read of `server/src/routes`, `server/README.md`, `frontend/src/api/endpoints.js` and the five existing adapters. It lists what is **not** done, in the order we should do it. For a page-by-page status table see `ROADMAP.md`.

Effort sizes are relative, not days: **S** = a few hours, **M** = about a day, **L** = several days, **XL** = a week or more. Treat them as ordering hints, not promises.

## Definition of done (applies to every item)
1. Migration (new numbered file; never edit an applied one) when the data model changes.
2. Service code in `server/src/<area>/`, with money and stock changes in one transaction.
3. A route that names its permission in `server/src/auth/permissions.ts`, plus its row in `server/tests/apiMatrix.test.ts`.
4. Tests on real PostgreSQL, including the failure cases.
5. Frontend adapter in `frontend/src/api/adapters/` (fixture + test), switched on in `endpoints.js`.
6. The page works end to end against the server, tried by hand once.
7. If it touches money, the nightly integrity check gets a rule for it.

---

## Phase 0: Housekeeping (before any feature) — S
| # | Item | Why |
|---|---|---|
| 0.1 | Push the repo, turn on CI, get it green on GitHub | Everything else relies on CI |
| 0.2 | Fix the flaky `masterDataScreens` test (the "Previous" button check does not wait for the page to update) | It failed once under load |
| 0.3 | Decide: keep or delete `server/src/integrations/stk.ts` (no importer) and `server/src/idempotency.ts` (tests only) | Dead code or a planned feature, which? STK is needed in 5.3 |
| 0.4 | Make `VITE_USE_NEW_SERVER` default to on in code (today it needs the `.env` file) | Removes a setup trap |
| 0.5 | Pick the production host and database (Railway Postgres was used before) and write the env var list | Needed for 1.x testing on a real URL |

## Phase 1: Wire pages whose server routes already exist — no server work
Each is an adapter plus a check of the page. Do them in this order (simplest and most used first).

| # | Page | Server routes to use | Size |
|---|---|---|---|
| 1.1 | **Staff** (+ Remove account, Access & permissions) | `/api/users/*` incl. reactivate, reset password, unlock, sign out everywhere, erase, delete, permissions, PIN | M |
| 1.2 | **Leads** (+ Convert lead) | `/api/leads/*` incl. convert | M |
| 1.3 | **Security** and the session guard | `/api/security`, `/api/auth/sessions`, revoke others | S |
| 1.4 | **Attendance** (clock in/out, absences) | `/api/attendance/*` | S |
| 1.5 | **Payroll** | `/api/payroll/*` (runs, approve, pay, payslip, CSV, profiles, plans, adjustments) | M |
| 1.6 | **Orders**: the adapter methods that still say "not available": `create`, `pullOnline`, `onlineSources` | `POST /api/orders`, `/api/online-orders/pull`, `/connections` | S |
| 1.7 | **Settings > Messaging** (SMS) | `/api/sms/*` (templates, outbox, retry) | M |
| 1.8 | **Payment reconciliation**: check the custody calls (`custodyApi` is not switched to the new server yet) | `/api/custody`, `/api/custody/:id/deposit` | S |

Exit test: log in as each role on a phone and on a laptop, and do that page's normal day.

## Phase 2: The selling floor — the register must work before anything else is retired
| # | Item | Needs | Size |
|---|---|---|---|
| 2.1 | **Categories**: server module and page (decide first: a table with archive/move-products, as the old app had, or just a text field) | Migration, routes, adapter | M |
| 2.2 | **Products and Inventory** page (stock list, adjust, receive, write-off, history, low stock) | Server exists; needs 2.1 for category pickers | M |
| 2.3 | **POS terminal**: products, cart, checkout, discounts with manager approval, void, refund | `/api/sales`, `/api/till/*`; adapter for `salesApi` | L |
| 2.4 | **Till / Cash sessions** page and the Shift widget (open, close, movements, sign-off) | `/api/till/*` | M |
| 2.5 | **Offline queue** for sales (`useOfflineQueue`): queued sale sends once, safe to retry | Server already replays by `clientSaleId`; adapter and hook change | M |
| 2.6 | **Sales history** | `GET /api/sales` | S |
| 2.7 | **Receipt printing** (sale receipt, order waybill already done) | New receipt read endpoint for POS sales | M |
| 2.8 | Refund **part of a price** (today refunds are by item and quantity only) | Service + UI | M |

Exit test: one full trading day on a test till, then close-out balances to the cent and the nightly integrity check passes.

## Phase 3: Back office — money in and out
| # | Item | Notes | Size |
|---|---|---|---|
| 3.1 | **Expenses** | No server module. Decide whether expenses post to the ledger (recommended: yes, new account) | M |
| 3.2 | **Requisitions** (request, approve, receive into stock) | No server module. Approval is two-person; receiving creates `receipt` stock movements | M |
| 3.3 | **Finance** page (tabs over Payments, Expenses, Reconciliation) | Composition once 3.1 is done | S |
| 3.4 | **Dashboard** and the **legacy report set** | Server has 3 reports (discounts, risky actions, trial balance). Missing: sales by day/product/staff, stock value, profit, expense summary, order funnel | L |
| 3.5 | **Payroll gaps** (from `server/README.md`): post payroll to the ledger; approval flow for advances; correct attendance after the fact; top up an organization shortfall so short parcels can earn commission | Touch locked-run rules carefully | L |
| 3.6 | **Courier gaps**: correct a paid package fee; write off an organization shortfall that will never come | Corrections must be new reversing entries | M |
| 3.7 | **Staff owes**: collect or forgive what a staff member owes | New model | M |
| 3.8 | Card money settled into the bank; carry the opening float between till sessions | | M |
| 3.9 | Post **stock value** to the ledger (needs inventory and cost-of-goods accounts) | Decide whether accounting needs this | L |

## Phase 4: Administration and system
| # | Item | Notes | Size |
|---|---|---|---|
| 4.1 | **Settings and modules** (business details, currency, shop hours, module on/off) | No server module. `useModules` already expects it | M |
| 4.2 | **Notifications** (bell, per-user read state, admin alerts for backup failure, lockouts, big refunds) | Server has nightly-integrity alerts only | M |
| 4.3 | **Activity log** page | Data is already in `audit_log`; needs a read route with filters and paging | S |
| 4.4 | **Backups** | **Decision needed.** The old system copied a SQLite file. On PostgreSQL use the host's automated backups plus an encrypted off-site `pg_dump`; the page then shows status and a trial-restore check | M |
| 4.5 | **Employee onboarding** (documents, policy signature) | No server module | M |
| 4.6 | **Telesales auto-distribution** (assign leads to staff who are clocked in) | Old logic lived in `telesalesDistribution.service.js`; port it | M |
| 4.7 | **Sign-in codes (2FA / OTP)**: the `two_factor_enabled` column exists, no flow does | Adapter says "not available yet" | M |
| 4.8 | **Income sources** page: create, edit, connect, test, delete a Shopify or WooCommerce store | `/api/integrations/*` has credentials only | M |
| 4.9 | Per-IP rate limiting beyond sign-in; security headers review | Needs the public address settled | S |

## Phase 5: Online channels and payment gateways
| # | Item | Notes | Size |
|---|---|---|---|
| 5.1 | **Shopify and WooCommerce product sync** with review queue (staged products, approve/reject, stock sync) | Server pulls **orders** only; products are missing | L |
| 5.2 | Stock for orders pulled from online stores | Decide who owns stock for online orders (legacy: the platform did) | M |
| 5.3 | **M-Pesa STK push initiation** (callbacks exist; sending the push does not) | Uses `stk_push_requests` and `stk.ts` | M |
| 5.4 | **Payment disputes** and **owner decision** on a payment (permission key exists, no code) | Adapter methods `openDispute`, `resolveDispute`, `ownerDecision`, `pendingOwnerDecision` | M |
| 5.5 | Order **courier change** after creation and the return **inspection** flow in the old shape (`setCourier`, `returnedAwaitingInspection`, `inspect`) | Check whether the new return flow already covers them, then map or drop | S |
| 5.6 | Customer SMS templates and delivery reports | Outbox exists; extend as needed | S |

## Phase 6: Move off the old system
| # | Item | Notes | Size |
|---|---|---|---|
| 6.1 | **Data import** from the old SQLite file: users, products and stock, customers, leads, open orders, balances, payroll profiles | One script per table, run in order, safe to re-run, with a count report | XL |
| 6.2 | **Opening balances**: load them as ledger entries so books start correct | Do not write straight into ledger tables | M |
| 6.3 | **Reconciliation of the import**: stock on hand, receivables, till float, and payroll must match the old system | Written checklist, signed off by you | M |
| 6.4 | **Rehearsal** on a copy of live data, then a timed cutover plan with a rollback | Run twice | M |
| 6.5 | Production deploy, monitoring, health check alert, backup restore test | See 4.4 | M |
| 6.6 | Staff training notes and a one-page "what changed" | | S |

## Phase 7: Frontend quality (run alongside, not after)
| # | Item | Size |
|---|---|---|
| 7.1 | Refactor `Orders.jsx` (one 488-line function, complexity 94) behind the existing e2e tests, **before** adding to it | L |
| 7.2 | Replace inline label/input markup with `FormUI.jsx` as each page is touched (Products, Payments, Expenses, Couriers, Requisitions, Categories) | S each |
| 7.3 | Split `ShopifySync`, `POSTerminal`, `Products`, `SettingsMessaging`, `PaymentReconciliation` (all over 200 lines in one function) | M each |
| 7.4 | Decide on the restyle: finish `DataUI` on all pages, or stop at the 7 done. Do not leave two styles by accident | M |
| 7.5 | Dark/light theme (not built; about 10–15 components hard-code `bg-ink text-white`) | L, optional |
| 7.6 | Real phone testing of bottom sheets, keyboard, back gesture, idle lock (never tested on a phone) | S |
| 7.7 | Remove the `backend`-era wording left in comments and `client.js` | S |

---

## Dependencies at a glance
```
0 housekeeping ─► 1 wire ready pages ─► 2 selling floor ─► 3 back office ─┐
                                   └──► 4 admin/system ──────────────────┼─► 6 import ─► cutover
                      2.1 categories ─► 2.2 products        5 online ────┘
7 frontend quality: continuous
```
- 2.1 before 2.2 (category pickers). 2.3 needs 2.2 (products to sell).
- 3.1/3.2 need 4.1 only if expenses or requisitions depend on settings; otherwise independent.
- 5.3 needs the decision in 0.3.
- 6 needs every module the shop uses on day one. Anything still missing at that point must have a written manual workaround.

## Minimum set to run the shop (the cutover line)
Phases 0, 1, 2, 3.1–3.4, 4.1–4.4, and 6. Phase 5 and the rest of 3 and 4 can follow after cutover **if** the old system stays readable for the gap (or the work is done by hand meanwhile).

## Decisions I need from you
1. **Categories**: a real table with archive and move, or a simple text field?
2. **Online store stock**: does the shop or Shopify/WooCommerce own stock for online orders?
3. **Backups**: managed database backups plus an encrypted off-site copy: acceptable?
4. **Expenses and stock value**: should they post to the ledger (cleaner books, more work)?
5. **Sign-in codes (OTP)**: keep, or drop since PIN and password lockout exist?
6. **Cutover date**: is there a date the old system must stop? That sets what goes below the cutover line.
7. **Restyle**: finish it on every page, or freeze at the 7 pages done?

## Known limits of this plan
- Built from a read of the code and docs. I did not run every legacy page to list its exact behaviours, so a page may hide small features the old backend handled (check each page against `endpoints.js` when you reach it).
- The old repo is the only record of old business rules and data. Keep it until step 6.3 is signed off.
