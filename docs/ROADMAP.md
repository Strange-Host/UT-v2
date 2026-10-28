# Roadmap: where we are, what is left

The ordered build plan is in `BUILD_PLAN.md`.

Source of this table: the `update` branch of the old repo as of 28 Oct 2026, checked by reading `server/src/routes/*` and `frontend/src/api/endpoints.js`. "Server ready" means a route exists; it does **not** mean the adapter or page has been tested against it.

## Decisions taken
- **Database:** PostgreSQL only. No SQLite.
- **Categories:** a real table with archive and move (see `BUILD_PLAN.md` D1).
- **Online order stock:** the shop owns it; stores are told the available quantity (D2).
- **Backups:** managed database backups plus an encrypted off-site copy (D3).
- **Ledger:** expenses and stock value post to the ledger (D4).
- **Sign-in codes (OTP):** dropped; PIN and password lockout stay (D5).
- **Frontend:** the React app in `frontend/` (bottom-sheet style). The "restyle" components in `DataUI.jsx` are used by 7 pages; keep them there and use `FormUI.jsx`/`Sheet.jsx` for new forms. Dark/light theming is not built.

## State of each page

### Done: page talks to the new server through an adapter (has fixtures and tests)
Login, Change password, Orders, Payments, Payment reconciliation, Couriers.

### Server ready, adapter still to write
| Page | New-server routes that exist |
|---|---|
| Leads, Convert lead | `/api/leads` (list, create, messages, status, assignee, convert) |
| Staff, Remove account, Access modal | `/api/users` (create, edit, reactivate, reset password, unlock, sign out everywhere, erase, delete, permissions, PIN) |
| Products, POS terminal, Sales history | `/api/products`, stock movements, `/api/sales`, void, refund, `/api/till/*` |
| Payroll, Attendance (clock in/out) | `/api/payroll/*`, `/api/attendance/*` |
| Security | `/api/security`, `/api/auth/sessions` |
| Settings > Messaging | `/api/sms/*` |
| Dashboard | `/api/reports/*` (3 reports only: discounts, risky actions, trial balance) |
| Settings > Income sources, Shopify/Woo orders | `/api/integrations/*`, `/api/online-orders/pull`, order webhooks |

### Server not built yet (no route found)
Categories, Expenses, Requisitions, Backups, Notifications, General settings and modules (Settings, SettingsSystem), Telesales distribution, Shift widget, Employee onboarding, Activity log (staff logs), Shopify/Woo **product** sync review, receipt printing endpoint, most of the legacy report set.

### Not started
- Importing data from the old SQLite database (the original plan's "phase 8").
- Cutover rehearsal and production deploy.

## Suggested order
1. Wire the "server ready" pages, simplest first: Staff, Leads, Security, Payroll, Attendance.
2. POS terminal, Products and Sales (adds the offline queue to the new sale endpoint).
3. Build the missing server modules, each with migration, route, tests, then its adapter: Categories, Expenses, Requisitions, Settings/modules, Backups, Notifications, Activity log, Telesales.
4. Shopify/Woo product sync.
5. Data import, rehearsal, cutover.

## Known cleanups
- `server/src/integrations/stk.ts` has no importer (STK push initiation is a "later slice"). `server/src/idempotency.ts` is only used by tests. Decide whether to keep.
- `frontend/src/pages/Orders.jsx` has one 488-line function (complexity 94). Refactor behind tests before adding to it.
- Replace the remaining inline copies of the form label/input markup with `FormUI.jsx` as pages are touched (Products, Payments, Expenses, Couriers, Requisitions, Categories).
- `auth/catalog.ts` and `auth/permissions.ts` import each other (type-only, harmless).
