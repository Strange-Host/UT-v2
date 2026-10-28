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

## Decisions taken (28 Oct 2026)
| # | Decision | What it changes in this plan |
|---|---|---|
| D1 | **Categories are a real table**, with archive and move-products-to-another-category | 2.1 is a full module, and 2.2 and 5.1 use it |
| D2 | **The shop owns stock for online orders** (the old system let Shopify/WooCommerce own it) | 5.2 is now a real build, and it adds 5.2b (push stock levels back to the stores) |
| D3 | **Managed database backups plus an encrypted off-site copy** | 4.4 is settled; details below |
| D4 | **Expenses and stock value post to the ledger** | 3.1 posts to the ledger, and stock value moves **earlier** to 2.2a, before the POS goes live |
| D5 | **Sign-in codes (OTP) are dropped.** PIN plus password lockout stay | 4.7 is removed, and 0.6 removes the leftovers |

Still open: **cutover date** and **restyle** (see the end of this file).

---

## Phase 0: Housekeeping (before any feature) — S
| # | Item | Why |
|---|---|---|
| 0.1 | Push the repo, turn on CI, get it green on GitHub | Everything else relies on CI |
| 0.2 | Fix the flaky `masterDataScreens` test (the "Previous" button check does not wait for the page to update) | It failed once under load |
| 0.3 | Decide: keep or delete `server/src/integrations/stk.ts` (no importer) and `server/src/idempotency.ts` (tests only) | Dead code or a planned feature, which? STK is needed in 5.3 |
| 0.4 | Make `VITE_USE_NEW_SERVER` default to on in code (today it needs the `.env` file) | Removes a setup trap |
| 0.5 | Pick the production host and database (Railway Postgres was used before) and write the env var list | Needed for 1.x testing on a real URL |
| 0.6 | **Remove sign-in codes (D5):** drop the `two_factor_enabled` column (new migration), remove it from `auth/service.ts` and `auth/staff.ts`, remove `verifyOtp`/`resendOtp` from the auth adapter and any code-entry step on the Login page, and fix the tests that mention it | The feature is not coming back; leaving a dead column and "not available yet" messages misleads |

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
| 2.1 | **Categories (D1)**: a `categories` table with parent/sub-category, **archive/restore** (hidden from pickers, old products untouched), and **move**: deleting shows what uses the category and moves its products, switched-off products and sub-categories to another category in one transaction. Products get a `category_id` (migrate the current text value). Page: the existing Categories page | Migration, service, routes, adapter, tests for move and archive | M |
| 2.2 | **Products and Inventory** page (stock list, adjust, receive, write-off, history, low stock) | Server exists; needs 2.1 for category pickers | M |
| 2.2a | **Stock value and cost of goods in the ledger (D4)**: new accounts `INVENTORY` and `COST_OF_GOODS`; every stock **receipt** posts Dr Inventory / Cr Cash-or-Payable at cost; every **sale, dispatch and refund restock** posts Dr Cost of goods / Cr Inventory at the product's cost; **write-offs and adjustments** post to a loss account; **void and return restock** reverse. Needs a **costing method**: I recommend **weighted average cost** (simple, no batch tracking). The nightly check gains a rule: inventory account balance equals the sum of on-hand × average cost. **Do this before 2.3**, because adding cost of goods after sales exist means re-valuing history | Migration (accounts, cost columns), changes to `stock/stock.ts` and the sale, dispatch, void, refund paths, integrity rule | L |
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
| 3.1 | **Expenses (D4)** | New server module. Each expense posts to the ledger (Dr an expense account chosen by expense category, Cr Cash/Till, M-Pesa, bank or Payable). Expenses are immutable once posted: a correction is a reversing entry with a reason, like everything else money-related. A till paid-out (already a till movement) must not be entered twice: link or block the duplicate. Needs a small `expense_categories` list | M |
| 3.2 | **Requisitions** (request, approve, receive into stock) | No server module. Approval is two-person; receiving creates `receipt` stock movements **and, with 2.2a, the inventory ledger entry** | M |
| 3.3 | **Finance** page (tabs over Payments, Expenses, Reconciliation) | Composition once 3.1 is done | S |
| 3.4 | **Dashboard** and the **legacy report set** | Server has 3 reports (discounts, risky actions, trial balance). Missing: sales by day/product/staff, stock value, profit, expense summary, order funnel | L |
| 3.5 | **Payroll gaps** (from `server/README.md`): post payroll to the ledger; approval flow for advances; correct attendance after the fact; top up an organization shortfall so short parcels can earn commission | Touch locked-run rules carefully | L |
| 3.6 | **Courier gaps**: correct a paid package fee; write off an organization shortfall that will never come | Corrections must be new reversing entries | M |
| 3.7 | **Staff owes**: collect or forgive what a staff member owes | New model | M |
| 3.8 | Card money settled into the bank; carry the opening float between till sessions | | M |
| 3.9 | ~~Post stock value to the ledger~~ | **Moved to 2.2a** (D4) | — |

## Phase 4: Administration and system
| # | Item | Notes | Size |
|---|---|---|---|
| 4.1 | **Settings and modules** (business details, currency, shop hours, module on/off) | No server module. `useModules` already expects it | M |
| 4.2 | **Notifications** (bell, per-user read state, admin alerts for backup failure, lockouts, big refunds) | Server has nightly-integrity alerts only | M |
| 4.3 | **Activity log** page | Data is already in `audit_log`; needs a read route with filters and paging | S |
| 4.4 | **Backups (D3)** | Two layers. (1) The host's **managed database backups** with point-in-time recovery switched on and the retention period written down. (2) A scheduled **encrypted off-site copy**: `pg_dump` (custom format), encrypted with a passphrase that is **not stored in the database or on the same host**, sent to storage in another account or provider (S3-compatible bucket or email for small sizes), the copy decrypted and checked right after upload. The Backups page shows last success, last failure, size and age, and alerts admins in the bell when a run fails or is overdue. A **trial restore** into a scratch database is scripted and run before cutover and then every few months. Also keep the order-reference key (`ORDER_REF_KEY`) and the secrets key backed up separately: without them a restored database cannot issue or read what it needs | M |
| 4.5 | **Employee onboarding** (documents, policy signature) | No server module | M |
| 4.6 | **Telesales auto-distribution** (assign leads to staff who are clocked in) | Old logic lived in `telesalesDistribution.service.js`; port it | M |
| 4.7 | ~~Sign-in codes (2FA / OTP)~~ | **Dropped (D5).** Cleanup is item 0.6 | — |
| 4.8 | **Income sources** page: create, edit, connect, test, delete a Shopify or WooCommerce store | `/api/integrations/*` has credentials only | M |
| 4.9 | Per-IP rate limiting beyond sign-in; security headers review | Needs the public address settled | S |

## Phase 5: Online channels and payment gateways
| # | Item | Notes | Size |
|---|---|---|---|
| 5.1 | **Shopify and WooCommerce product sync** with review queue (staged products, approve/reject, price and name changes re-queued for review). With D2, store **stock counts are no longer imported**; the shop's own count wins | Server pulls **orders** only; products are missing. Uses categories from 2.1 | L |
| 5.2 | **Stock for online orders (D2): the shop owns it.** A pulled Shopify/WooCommerce order goes through the same path as a shop order: it **reserves** stock when pulled and takes it out at **dispatch**, using the existing reservation rules and locks. Cancelled or refunded online orders release the reservation. **Sub-decision needed:** when an online order arrives for stock the shop does not have, the customer has already paid. Recommended: accept the order anyway, mark it **short**, and show it on the Money at risk screen for a person to resolve (rather than refusing it silently). Requires 5.1 to map each store's product to a local product (by SKU) | L |
| 5.2b | **Push stock levels to the stores (follows from D2).** When the shop owns stock, Shopify/WooCommerce must be told the available quantity (on hand minus reserved) after every change, or they will oversell. A queued, retried job per connected store, with a "last pushed" status and failures shown in notifications. Include a manual "re-sync all" button. Without this item D2 is unsafe to go live | L |
| 5.3 | **M-Pesa STK push initiation** (callbacks exist; sending the push does not) | Uses `stk_push_requests` and `stk.ts` | M |
| 5.4 | **Payment disputes** and **owner decision** on a payment (permission key exists, no code) | Adapter methods `openDispute`, `resolveDispute`, `ownerDecision`, `pendingOwnerDecision` | M |
| 5.5 | Order **courier change** after creation and the return **inspection** flow in the old shape (`setCourier`, `returnedAwaitingInspection`, `inspect`) | Check whether the new return flow already covers them, then map or drop | S |
| 5.6 | Customer SMS templates and delivery reports | Outbox exists; extend as needed | S |

## Phase 6: Move off the old system
| # | Item | Notes | Size |
|---|---|---|---|
| 6.1 | **Data import** from the old SQLite file: users, products and stock, customers, leads, open orders, balances, payroll profiles | One script per table, run in order, safe to re-run, with a count report | XL |
| 6.2 | **Opening balances**: load them as ledger entries so books start correct. With D4 this **includes opening inventory value** (on-hand × cost per product) | Do not write straight into ledger tables | M |
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
- 2.1 before 2.2 (category pickers). **2.2a before 2.3** (cost of goods must exist before the first sale). 2.3 needs 2.2 (products to sell).
- 5.2b must ship with or before 5.2 (otherwise the stores oversell).
- 3.1 and 2.2a share the ledger-account setup: do the accounts migration once.
- 3.1/3.2 need 4.1 only if expenses or requisitions depend on settings; otherwise independent.
- 5.3 needs the decision in 0.3.
- 6 needs every module the shop uses on day one. Anything still missing at that point must have a written manual workaround.

## Minimum set to run the shop (the cutover line)
Phases 0, 1, 2 (including 2.2a), 3.1–3.4, 4.1–4.4, and 6. If online orders are part of day one, add 5.1, 5.2 and 5.2b. Phase 5 and the rest of 3 and 4 can follow after cutover **if** the old system stays readable for the gap (or the work is done by hand meanwhile).

## Still open
1. **Cutover date**: is there a date the old system must stop? That sets what goes below the cutover line. Until you give one, I assume the minimum set above.
2. **Restyle**: finish the `DataUI` look on every page, or freeze at the 7 pages done? Until you decide, new pages use `FormUI.jsx` and `Sheet.jsx`, and the 7 restyled pages are left alone.
3. **Costing method** (new, from D4): weighted average cost is recommended. Say if the accountant requires FIFO.
4. **Short online orders** (new, from D2): accept and flag as short (recommended) or refuse?

## Known limits of this plan
- Built from a read of the code and docs. I did not run every legacy page to list its exact behaviours, so a page may hide small features the old backend handled (check each page against `endpoints.js` when you reach it).
- The old repo is the only record of old business rules and data. Keep it until step 6.3 is signed off.
