# Urban Trends POS (v2)

Point of sale, orders, couriers, payments and payroll for Urban Trends. One database (PostgreSQL), one API, one web app.

| Folder | What it is |
|---|---|
| `server/` | The API. TypeScript, Express, PostgreSQL. Money rules are enforced **in the database** (balanced ledger, immutable receipts, locked payroll, no negative stock). |
| `frontend/` | The web app. React 19, Vite, Tailwind, React Query. 27 pages. |
| `docs/ROADMAP.md` | Where we are, page by page. |
| `docs/BUILD_PLAN.md` | Everything left to build, in order, with decisions needed. Start here. |
| `docs/ENVIRONMENT.md` | Every environment variable the server and the web app read, and which ones production needs. |

## Run it

### Quickest: no database to install
```bash
cd server && npm ci
npm run dev:stack        # starts a throwaway PostgreSQL and the API on http://localhost:3000
```
It prints sample sign-ins (for example `admin@shop.test` / `Admin-Dev-Passphrase-1`). Data is discarded when you stop it. Then, in a second terminal:
```bash
cd frontend && npm ci --include=dev
npm run dev              # http://localhost:5173
```

### With your own PostgreSQL
Install PostgreSQL, create an empty database (`createdb urban_trends`, or use pgAdmin), then:
```bash
cd server && npm ci
cp .env.example .env     # Windows cmd: copy .env.example .env
# edit .env: set DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/urban_trends
npm run migrate
npm run create-admin -- --username you --name "Your Name"   # prints a one-time password
npm run dev                                                 # http://localhost:3000
```
The server reads `server/.env` itself (run the commands from inside `server/`). A variable already set in the environment wins over the file, which is how Railway supplies them.

## Check it

```bash
cd server   && npm run typecheck && npm test     # tests start their own throwaway Postgres
cd frontend && npm run lint && npm test && npm run build
```

## Rules for new work
- A new feature is a migration (`server/migrations/NNNN_name.sql`, never edit an applied one), service code, a guarded route, and a test.
- A page is wired by writing an adapter in `frontend/src/api/adapters/` that returns the shapes the page already expects, with a fixture and a test. Copy `orders.js`.
- Use the shared form pieces in `frontend/src/components/FormUI.jsx` and `Sheet.jsx`; do not paste the markup again.
- `server/public/` is a small admin fallback UI that the server tests depend on. It is not the main UI.

The server's own documentation (ledger rules, order flow, payroll, till, permissions) is in `server/README.md`.
