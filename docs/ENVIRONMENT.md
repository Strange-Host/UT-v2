# Environment variables

Host-neutral list of every setting the server and the web app read, taken from `server/src/config.ts` and `frontend/src/api/`.
Which host runs them (build plan item 0.5) is a separate decision; this list does not change with it.

## Server (`server/`)

Set in the host's environment. Locally, copy `server/.env.example` to `.env`. `npm start` applies migrations and then starts the server, so a deploy
migrates the database by itself.

| Variable | Needed in production? | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | **Yes: `production`** | `development` | Turns on `Secure` cookies. Without it, sign-in cookies are not marked secure. |
| `DATABASE_URL` | **Yes** | none (server refuses to start) | PostgreSQL connection string. |
| `DATABASE_SSL` | If the connection string is public | `false` | `true` for a public connection; a private network usually needs no TLS. |
| `ORDER_REF_KEY` | **Yes** | none | 32+ random characters. Scrambles order references (`UT-XXXXXXXX`). **Never change it once references exist.** Optional in the schema, but orders cannot get a reference without it. Back it up separately from the database (plan 4.4). |
| `SECRETS_KEY` | **Yes** once store, SMS or payment credentials are saved | none | 32+ random characters. Opens credentials stored encrypted in the database. **Never change it once secrets are stored.** Back it up separately from the database (plan 4.4). |
| `CORS_ORIGINS` | **Yes** if the web app is on a different origin than the API | empty (no cross-origin calls) | Comma-separated exact origins, e.g. `https://pos.example.com`. No wildcard. |
| `REFRESH_COOKIE_SAMESITE` | Check | `strict` | `strict` when the app and the API share a site (e.g. `app.example.com` + `api.example.com`). `none` only for unrelated domains, and then needs HTTPS. If every reload signs you out, look here first. |
| `TRUST_PROXY_HOPS` | Check | `1` | Number of proxies in front of the server. Wrong value makes every visitor share one sign-in allowance, or makes audit rows show the proxy's address. |
| `PAYMENT_WEBHOOK_SECRET` | **Yes** if M-Pesa callbacks are used | none | 16+ characters; the secret inside the callback URL registered with Safaricom. |
| `PORT` | Usually set by the host | `3000` | |
| `INTEGRITY_JOB` | No | `true` | Nightly integrity check. Set `false` only on a staging copy. |
| `INTEGRITY_HOUR` | No | `2` | Hour of the nightly check, shop time (East Africa Time). |
| `STORE_POLL_JOB` | When online stores are connected | `false` | Safety-net poll of Shopify/WooCommerce. Needs `ORDER_REF_KEY`. Leave off on a staging copy so it does not import a real store's orders. |
| `SMS_WORKER` | No | `true` | `false` stops this server sending queued texts (use on a staging copy). Nothing is sent until `sms_enabled` is switched on in settings. |
| `ZETTATEL_USER_ID`, `ZETTATEL_PASSWORD`, `ZETTATEL_SENDER_ID`, `ZETTATEL_SEND_URL` | No | none | SMS gateway credentials. Credentials saved in Settings > Messaging (encrypted, needs `SECRETS_KEY`) win over these. |
| `SESSION_HOURS` | No | `12` | Length of a login. |
| `ACCESS_TOKEN_MINUTES` | No | `15` | |
| `REFRESH_TOKEN_DAYS` | No | `30` | |
| `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MINUTES` | No | `20`, `15` | Sign-in attempts per address per window; the per-account lockout applies on top. |
| `LOG_LEVEL` | No | `info` | |

Generate a key with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

First admin account on a new database: `npm run create-admin:prod -- --username you --name "Your Name"` (prints a one-time password).

## Web app (`frontend/`)

These are read **when the app is built**, not when it runs. Set them in the build step.

| Variable | Needed in production? | Default | Notes |
|---|---|---|---|
| `VITE_NEW_API_URL` | **Yes**, unless the API is on the same host at port 3000 | `<page host>:3000/api` | Full API address including `/api`, e.g. `https://api.example.com/api`. Without it a hosted build guesses the wrong address. |
| `VITE_USE_NEW_SERVER` | No | on | The app uses the new server by default. Set `false` only to point it back at the legacy backend. |
| `VITE_API_URL` | No | | Legacy backend address; only read when `VITE_USE_NEW_SERVER=false`. |

Test-only: `VITE_E2E_NEW_SERVER=true` is set by `npm run test:e2e-new-server` to switch on the tests that need a running server.
