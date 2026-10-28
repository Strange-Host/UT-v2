# Deploying to Railway

Decision for build plan 0.5 (29 Oct 2026): **Railway, with Railway Postgres.** Every variable is explained in `ENVIRONMENT.md`; this page is the order to do things in.
Railway-side steps marked *(check)* are written from general knowledge of Railway, not from a deploy of this repo. Confirm the label in the current dashboard the first time.

## What gets deployed

| Piece | What it is | Where it runs |
|---|---|---|
| Database | PostgreSQL | Railway Postgres |
| API | `server/`, Node 22+, TypeScript compiled by `npm run build` | Railway service, root directory `server` |
| Staff app | `frontend/`, the React app, built by `npm run build` into `frontend/dist` | A static host (second Railway service or any static host) |

**The API does not serve the React app.** `server/public/` is a separate set of plain screens at `/app/`. So the React app needs its own address, which is why cookies and CORS (below) matter.

## 1. Database
1. Add a Postgres service to the Railway project.
2. Give the API service `DATABASE_URL` as a *reference* to the database service's private URL (Railway syntax: `${{Postgres.DATABASE_URL}}`, *check*). Use the private one: it stays inside Railway's network and needs no TLS, so leave `DATABASE_SSL=false`.
3. Only if you ever connect from outside Railway (your laptop, a backup job) use the public URL, and then that connection needs `DATABASE_SSL=true`.

## 2. API service
Settings *(check)*:
- Root directory: `server`
- Build command: `npm ci && npm run build`
- Start command: `npm start` (applies pending migrations, then starts the server, so a deploy migrates by itself)
- Health check path: `/api/health` (returns 200 with `{status, database, migrations}`, or 503 when the database is unreachable)
- **One replica only.** Migrations run at start-up; two instances starting together would race.

Variables to set before the first deploy:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | reference to the Postgres service (step 1) |
| `ORDER_REF_KEY` | 48+ random characters (generator below). **Never change it afterwards.** |
| `SECRETS_KEY` | a different 48+ random characters. **Never change it afterwards.** |
| `CORS_ORIGINS` | the exact address of the staff app, e.g. `https://app.yourshop.co.ke` (no trailing slash, no wildcard) |
| `REFRESH_COOKIE_SAMESITE` | see "Cookies" below |
| `PAYMENT_WEBHOOK_SECRET` | 16+ random characters, only once M-Pesa callbacks are registered |

Leave `TRUST_PROXY_HOPS` at its default of 1 (Railway's edge is one proxy). Leave `STORE_POLL_JOB` off until the online stores are connected. `PORT` is supplied by Railway.

Generate a key: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

**Save `ORDER_REF_KEY` and `SECRETS_KEY` somewhere outside Railway as well** (a password manager). A database restore without them leaves order references and stored credentials unreadable. This is the "encrypted off-site copy" side of plan item 4.4.

**Possible first-build failure** *(check)*: if `NODE_ENV=production` is also visible during the build, `npm ci` may skip dev dependencies and `tsc` will not be found. If the build fails with `tsc: not found`, make the build install dev dependencies (for example `npm ci --include=dev`) or set `NODE_ENV` for runtime only.

## 3. Staff app (React)
Variables are read **when the app is built**, not when it runs:
- `VITE_NEW_API_URL` = the full API address including `/api`, e.g. `https://api.yourshop.co.ke/api`. Without it the app guesses the page's own host on port 3000, which is wrong in production.
- Build: `npm ci && npm run build`. Publish `frontend/dist`.
- The app uses client-side routes (`BrowserRouter`), so the static host must send every unknown path to `index.html`. Without that, reloading any page other than `/` shows "not found".

No Railway config for this service exists in the repo yet. If you want it on Railway rather than a static host, say so and I will add one.

## Cookies and addresses (the usual reason sign-in "does not stick")
The refresh token is a cookie that the browser only sends if it considers the app and the API to be the same site.
- **Best:** one domain you own, with the app and the API as subdomains (`app.` and `api.`). Keep `REFRESH_COOKIE_SAMESITE=strict` (the default).
- **If the two are on unrelated domains** (for example two generated Railway addresses): set `REFRESH_COOKIE_SAMESITE=none`. This needs HTTPS on both. I have not checked how browsers treat Railway's generated domains, so prefer a custom domain.
- Symptom of getting this wrong: sign-in works, but every page reload signs you out. Look here first.

## 4. First start
1. Deploy the API. Open `https://<api-address>/api/health`: expect `status: ok`, `database: up`, and a migrations count that matches the files in `server/migrations`.
2. Create the first admin from the service's shell *(check: Railway CLI `railway shell`/`railway ssh`, or the dashboard)*:
   `npm run create-admin:prod -- --username <you> --name "<Your Name>"`
   It prints a one-time password once. There is no default password.
3. Run `npm run integrity:prod` once. It should report nothing wrong on an empty database.
4. Deploy the staff app and sign in with the admin account. Reload the page: you should stay signed in.
5. Check from a phone, not only a laptop.

## Not covered here
- Backups, a trial restore, and monitoring: plan items 4.4 and 6.5.
- Importing data from the old system: plan phase 6. Do not point real staff at this deployment before the cutover gate in the build plan passes.
