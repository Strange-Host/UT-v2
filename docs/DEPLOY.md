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

**Possible first-build failure** *(check)*: if `NODE_ENV=production` is also visible during the build, `npm ci` may skip dev dependencies and `tsc` will not be found. If the build fails with `tsc: not found`, make the build install dev dependencies (for example `npm ci --include=dev`) or set `NODE_ENV` for runtime only. The build commands above already use `--include=dev` for the staff app; use `npm ci --include=dev && npm run build` for the API too if it happens.

## 3. Staff app (React)
A second Railway service from the same repo. Settings *(check labels in the dashboard)*:
- Root directory: `frontend`
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start` (serves `frontend/dist` and sends every unknown path to `index.html`, so reloading `/orders` works)

Variables are read **when the app is built**, not when it runs, so set them before the first deploy and redeploy after changing them:
- `VITE_NEW_API_URL` = the full API address including `/api`, e.g. `https://api.yourshop.co.ke/api`. Without it the app guesses the page's own host on port 3000, which is wrong in production.

Then put this service's public address into the API's `CORS_ORIGINS` and redeploy the API.

Checked locally (production build served by `npm start`, API in production mode, real browser): sign-in, forced first password change, staying signed in after a reload, Orders. Not checked: Railway itself.

**Sign-in box:** it accepts an email **or a username**. The first admin made with `create-admin` has a username and no email, so a strict email field would have refused it.

If you would rather host `frontend/dist` on any static host, the same build command and the `VITE_NEW_API_URL` variable apply; the host must send unknown paths to `index.html`.

## Cookies and addresses (the usual reason sign-in "does not stick")
The refresh token is a cookie that the browser only sends if it considers the app and the API to be the same site.
- **Best:** one domain you own, with the app and the API as subdomains (`app.` and `api.`). Keep `REFRESH_COOKIE_SAMESITE=strict` (the default).
- **If the two are on unrelated domains** (for example two generated Railway addresses): set `REFRESH_COOKIE_SAMESITE=none`. This needs HTTPS on both. I have not checked how browsers treat Railway's generated domains, so prefer a custom domain.
- Symptom of getting this wrong: sign-in works, but every page reload signs you out. Look here first.

## 4. First start
1. Deploy the API. Open `https://<api-address>/api/health`: expect `status: ok`, `database: up`, and a migrations count that matches the files in `server/migrations`.
2. Create the first admin. **Easiest:** on the API service add three variables, then redeploy:
   - `FIRST_ADMIN_USERNAME` (e.g. `owner`)
   - `FIRST_ADMIN_PASSWORD` (a passphrase you choose: at least 12 characters, not a common password, not containing the username)
   - `FIRST_ADMIN_NAME` (optional display name)

   On start-up the server creates that admin only if there are no accounts at all, so it does nothing on later starts. You are still forced to change the password at first sign-in. **After you have signed in, delete `FIRST_ADMIN_PASSWORD`.** If the password is too weak the server refuses to start and the deploy log says why.
   Alternative from the service's shell: `npm run create-admin:prod -- --username <you> --name "<Your Name>"` (prints a one-time password once).
3. Run `npm run integrity:prod` once. It should report nothing wrong on an empty database.
4. Deploy the staff app and sign in with the admin account. Reload the page: you should stay signed in.
5. Check from a phone, not only a laptop.

## Not covered here
- Backups, a trial restore, and monitoring: plan items 4.4 and 6.5.
- Importing data from the old system: plan phase 6. Do not point real staff at this deployment before the cutover gate in the build plan passes.
