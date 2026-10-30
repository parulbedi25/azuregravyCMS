# Deploying Azure Gravy on cPanel (Namecheap, Hostinger, GoDaddy…)

Tested against the standard **cPanel → Setup Node.js App** flow (Phusion Passenger). You need:

- a Node.js 20+ application slot in cPanel,
- one MySQL database and one MySQL user.

Total time: about ten minutes, most of it waiting for `npm install`.

**You never edit a config file and never import SQL.** The app starts without a database; the
installer in your browser collects the credentials, tests them, builds the tables and creates your
administrator account. Steps 1–3 and 5 are the only server work.

---

## 1. Create the database

**cPanel → Databases → MySQL® Databases**

1. **Create New Database** — name it, e.g. `gravy`.
   cPanel prefixes it with your account: `myaccount_gravy`. **Write down the full name.**
2. **Add New User** — choose a user name and a strong password.
   Also prefixed: `myaccount_gravy`. **Write down the full user name and the password.**
3. **Add User To Database** — select the user, select the database, **Add**, tick
   **ALL PRIVILEGES**, then **Make Changes**.

You do *not* need to create any tables. The application creates them.

> Remote MySQL is not needed. The app connects from the same server (`localhost`).

---

## 2. Upload the code

Two options.

### a) Git (if the host offers "Git™ Version Control")

Create a repository pointing at `https://github.com/parulbedi25/azuregravyCMS.git`, branch `main`,
and deploy. The application root is the directory cPanel creates for it.

### b) File Manager / SFTP

Upload the repository **without** `node_modules` and without `.git`:

```
/home/myaccount/azuregravy/         ← application root
├── app.js
├── package.json
├── src/
├── views/
├── public/
├── docs/
└── .env.example
```

`public/` must ship with the code — it holds the CSS, fonts and demo images.

---

## 3. Create the Node.js application

**cPanel → Software → Setup Node.js App → Create Application**

| Field | Value |
| --- | --- |
| Node.js version | **20** or newer |
| Application mode | **Production** |
| Application root | the folder from step 2, e.g. `azuregravy` |
| Application URL | your domain or subdomain |
| **Application startup file** | **`app.js`** |

`app.js` is a thin loader that runs the TypeScript server through tsx, so **no build step is required**
on the host. (If you would rather ship a compiled build, run `npm run build` locally, upload `dist/`,
and set the startup file to `dist/server.js`.)

Click **Create**.

---

## 4. Environment variables

Still on the application screen, open **Environment variables**. Only two are required — the database
details can be typed into the installer in step 6 instead:

| Name | Value | Required |
| --- | --- | --- |
| `NODE_ENV` | `production` | yes |
| `SESSION_SECRET` | 64+ random characters — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | yes |
| `SITE_URL` | `https://yourdomain.com` | optional — detected from the request when blank |
| `SESSION_SAMESITE` | *(leave unset)* | optional — a top-level cPanel site wants the `lax` default. Only set `none` if you embed the Studio in an iframe on another domain |
| `DB_HOST` | `localhost` | optional — the installer asks |
| `DB_PORT` | `3306` | optional |
| `DB_NAME` | `myaccount_gravy` *(full name from step 1)* | optional |
| `DB_USER` | `myaccount_gravy` *(full name from step 1)* | optional |
| `DB_PASSWORD` | the password you set | optional |

Leave `PORT` **unset**: Passenger provides it. If your host does expose one, the app accepts either a
port number or a socket path.

**Which should you use?** Set `DB_*` here when you want the deployment fully hands-off (Git-based
deploys, staging clones, containers). Otherwise skip them and type the same values into the
installer — they are stored in `data/install.json` with mode `0600`. Environment variables always win
over that file, so you can also start with the installer and move the values here later.

Prefer a file? Copy `.env.example` to `.env` in the application root and fill in the same values.

---

## 5. Install dependencies

Click **Run NPM Install** in the Node.js App screen, or from a terminal:

```bash
cd ~/azuregravy
npm install --omit=dev
```

`tsx` is a production dependency on purpose, so `npm start` works without dev dependencies.

---

## 6. Restart and finish setup in the browser

Click **Restart**, then open your domain. Every URL leads to the installer until it is finished:

```
https://yourdomain.com/admin/setup
```

**Step 1 — Database.** Enter the values from step 1 of this guide:

| Field | cPanel value |
| --- | --- |
| Where is the database? | *MariaDB / MySQL server* |
| Host | `localhost` |
| Port | `3306` |
| Database name | `myaccount_gravy` (the **full** prefixed name) |
| Database user | `myaccount_gravy` (the **full** prefixed name) |
| Password | the one you set in cPanel |
| Create the database if it is missing | leave on — harmless, and it works if your user has the privilege |
| Connect over TLS | off for cPanel's `localhost` |

Press **Test connection & continue**. The connection is attempted right there:

- **Wrong password** → *"The database rejected these credentials (myaccount_gravy@localhost)"* plus
  the reminder to add the user to the database with ALL PRIVILEGES. Your values stay in the form.
- **Wrong name** → *"Connected to …, but the database `gravy` does not exist"* — use the prefixed name.
- **Wrong host/port** → *"Nothing is listening on that host/port"* — cPanel is always `localhost:3306`.

Nothing is written on failure and the app keeps running, so you can correct and resubmit as often as
you need. On success the 19 tables and default settings are created and you move to step 2.

**Step 2 — Administrator.** Publication name, your name, e-mail, password. That creates the super
admin, the starter pages (About, Contact, Privacy, Terms), the menus and one welcome post — and signs
you in. The installer then closes itself: `/admin/setup` redirects to the normal sign-in page.

**Then delete or edit the welcome post**, and replace the About/Privacy/Terms text.

### If the database settings ever break

A rotated password or a restored dump leaves the saved details stale. The site then answers with a
**503 "Database unreachable"** page that names the target and the MySQL error code, with a **Fix the
database settings** button back into step 1 — Passenger does not need to be restarted, and
`/healthz` keeps returning `200` for uptime monitors.

### Prefer to create the admin from the terminal?

Add `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` to the environment, then either restart the app
or run:

```bash
npm run db:setup
```

The wizard then reports that the site is already installed and sends you to the normal sign-in page.

---

## 7. Writable folders

Two directories must be writable by the application user:

```bash
chmod -R 775 public/uploads data
```

- `public/uploads/` — the media library. The boot log warns if it is read-only.
- `data/` — holds `install.json`, the file the installer writes in step 6 (mode `0600`, so the
  password is not world-readable). If `data/` is not writable the installer cannot remember the
  database; put the same values in the cPanel environment panel instead, which always wins.

(Some hosts need `755` with the file group set to your account — ask support if neither works.)

> **Running several workers?** Until a database is connected, installer sessions live in that
> process's memory, so run the installer with a single application instance — or skip it entirely by
> setting `DB_*` in step 4.

---

## 8. Optional: the AI drafting assistant

The assistant ships switched on but inert: the default settings point at OpenAI, which needs a key,
so nothing is sent anywhere until you configure it. Nothing else in the CMS depends on it.

Configure it in the browser under **Studio → AI assistant** (`/admin/ai`). There are no environment
variables for it: the base URL, model name, token limit and API key are stored in the `settings`
table, so they survive restarts and travel with your database backups. The key is masked in the UI
and redacted from **Tools → Export**.

### The one host requirement: outbound HTTPS

Generating a draft makes *your server* call the provider directly:

```text
POST {base_url}/chat/completions        (90 second timeout)
```

Shared hosting frequently blocks outbound requests to third parties. Check from the cPanel terminal
before you rely on it:

```bash
node -e "fetch('https://api.openai.com/v1/models').then(r => console.log('outbound OK - HTTP', r.status)).catch(e => console.log('BLOCKED:', e.message))"
```

Any HTTP status proves outbound works — `401` only means the probe sent no API key. A `BLOCKED` line
(`ENOTFOUND`, `ETIMEDOUT`, `ECONNREFUSED`) means the host will not let the app reach the provider:
ask support to allowlist the hostname, or point **Base URL** at a provider they do permit.

If outbound is blocked, the assistant reports *"Could not reach …"* and stops there. It fails closed
— no crash, no partial draft, and the rest of the site is unaffected.

### Diagrams need the writable folder

Generated diagrams are written to `public/uploads/diagrams/`, so the `chmod -R 775 public/uploads`
from step 7 already covers them. They appear in the media library like any other upload, and are
served with a locked-down `Content-Security-Policy` plus `X-Content-Type-Options: nosniff`.

### Which provider?

Anything that speaks the OpenAI chat-completions shape. A saved key is sent as
`Authorization: Bearer`; with no key saved, no auth header is sent at all — so servers that do not
authenticate work without any workaround. The settings page has one-click presets, grouped by what
they need from you, which fill in the base URL and a current model id:

**No API key — a model server you run yourself**

| Provider | Base URL | Model | Card? |
| --- | --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | whatever you pulled | no |
| LM Studio | `http://127.0.0.1:1234/v1` | `local-model` | no |
| llama.cpp | `http://127.0.0.1:8080/v1` | fixed at server start | no |
| Jan | `http://127.0.0.1:1337/v1` | whichever is loaded | no |
| GPT4All | `http://127.0.0.1:4891/v1` | whichever is loaded | no |
| KoboldCpp | `http://127.0.0.1:5001/v1` | `local-model` | no |
| vLLM | `http://127.0.0.1:8000/v1` | must match `--served-model-name` | no |
| LocalAI | `http://127.0.0.1:8080/v1` | from its model gallery | no |
| text-generation-webui | `http://127.0.0.1:5000/v1` | `local-model` | no |

> **These will not work on shared cPanel hosting.** Every one of them expects a model server
> listening on the same machine as the CMS. A shared account has no such server and no way to start
> one, so on Namecheap-style hosting the local rows are for a VPS, a container or your own
> workstation — not for the hosted site. Use the hosted keyless row below, or a keyed provider.

**No API key — hosted**

| Provider | Base URL | Model | Card? |
| --- | --- | --- | --- |
| Pollinations | `https://text.pollinations.ai/openai` | `openai` | no |

This is the only keyless option that works on shared hosting. It is a public, unauthenticated free
endpoint: it can rate-limit, change shape or disappear without notice, and every prompt crosses the
public internet, so treat unpublished drafts as no longer private. **Press Test connection before
relying on it** — its availability is not something this CMS can promise.

**Free with a key — no credit card**

| Provider | Base URL | Free model to start with | Card? |
| --- | --- | --- | --- |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | no |
| OpenRouter | `https://openrouter.ai/api/v1` | any id ending `:free` | no |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` | no |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | no |

**Paid**

| Provider | Base URL | Free model to start with | Card? |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | *(paid only)* | yes |

Model ids rotate — free tiers retire models with little notice — so if one stops working, check the
provider's current list rather than assuming the assistant broke. On a server you run yourself, use
**Find models**: it reads the model list from that server's own `/models` endpoint and offers it in
the Model field, which is the reliable answer to "what id does it want?".

**Use the Test connection button.** It makes one eight-token request and reports what came back,
including latency, so you can confirm the base URL, key and model all work *before* saving them.
This is also the fastest way to find out whether your host blocks outbound HTTPS.

> **Where your drafts go matters.** This feature sends *unpublished* writing to a third party, so
> the free tiers are not equivalent. Groq states it does not retain inference data by default, and
> Ollama never leaves the machine. Google's free tier uses content to improve its products,
> OpenRouter's free models may be trained on by the provider behind them (there is a privacy
> setting to refuse those), and Mistral's free mode may train unless you opt out. Each preset shows
> its own note in the UI before you pick it.

> **Keyless providers need no placeholder.** Earlier builds refused to run without a saved key, so
> the convention was to type something like `ollama` and let the server ignore it. That is no longer
> necessary: leave the key field blank and the CMS sends no `Authorization` header at all, which is
> what an unauthenticated local server expects. One thing to watch when moving *from* a keyed
> provider *to* a keyless one — turn on **Remove the saved key**, otherwise the old key is still
> stored and still sent.

> **Azure OpenAI is not supported by this field.** Azure authenticates with an `api-key` header and
> requires an `api-version` query parameter, whereas the assistant sends a plain
> `Authorization: Bearer` header (or none at all when no key is saved) to
> `{base_url}/chat/completions`. Pointing Base URL at an `*.openai.azure.com` deployment will be
> rejected. Use an OpenAI-compatible gateway in front of it, or one of the providers above.

> **GitHub Models was shut down on 30 July 2026** — playground, catalog and inference API all gone.
> Many tutorials still recommend it, so it is deliberately not offered as a preset.

---

## What the first boot actually does

Before the installer has run:

```
  Azure Gravy CMS
  environment : production
  database    : not configured yet

  ✔ Listening on socket /tmp/passenger.../node.socket
    Site      /
    Studio    /admin
    Installer /admin/setup

  No database has been configured — nothing was attempted.
```

After it (or with `DB_*` environment variables set):

```
  Azure Gravy CMS
  environment : production
  database    : myaccount_gravy@localhost:3306/myaccount_gravy
  settings from: data/install.json

  ✔ Listening on socket /tmp/passenger.../node.socket
```

Note what is *not* there: no connection attempt, no migration, no failure that can stop Passenger
from starting the app. The database is opened on the first request that needs it, tables are created
only when missing, and settings you have changed are never overwritten. Restart as often as you like.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Installer says *"The database rejected these credentials"* (`ER_ACCESS_DENIED_ERROR`) | Wrong user/password, or the user was never added to the database. Re-check step 1.3 (`ALL PRIVILEGES`), then resubmit the form. |
| *"…the database `gravy` does not exist and this user cannot create it"* | Use the **full** prefixed name (`myaccount_gravy`) in the installer / `DB_NAME`. |
| *"Nothing is listening on that host/port"* (`ECONNREFUSED` / `ETIMEDOUT`) | Host is wrong. On cPanel it is always `localhost`, port `3306`. |
| Every page redirects to `/admin/setup` | Nothing is configured yet — that is step 6. Or the installer was interrupted before an administrator existed. |
| `503 Database unreachable` on every page | Saved details went stale (password rotated, database renamed). Click **Fix the database settings**. |
| `500` with *"the tables could not be created"* | The user lacks DDL rights. Grant ALL PRIVILEGES (step 1.3) and resubmit. |
| The site shows a Passenger error page | Check the application's **stderr log** in cPanel. Database problems no longer appear there — they are reported in the browser. |
| `Dependencies are missing` | **Run NPM Install** again, or `npm install --omit=dev`. |
| Blank page, assets 404 | `public/` was not uploaded, or the application root is one level too deep. |
| Uploads fail | `public/uploads` is not writable (step 7). |
| Logged out on every restart | `SESSION_SECRET` changes between restarts, or the `sessions` table is missing (restart once after the DB is reachable). Sessions live in memory only until the installer connects a database. |
| `419 Session expired` on every form submit | The session cookie is not coming back, so the CSRF token in the page can never match. On a normal top-level cPanel site this means `SESSION_SECRET` changed between restarts, or the browser is blocking cookies. If you embed the Studio in an iframe on a **different** domain, the browser withholds a `SameSite=Lax` cookie from every cross-site request; `SESSION_SAMESITE=none` (HTTPS only) asks it not to — but this is **best effort**, since whether an iframe keeps any cookie is the host's and browser's decision, not the app's. If it still fails, open the site as a top-level tab. |
| Want to run the installer again | Delete `data/install.json` (and clear `DB_*` from the environment) and restart. |
| 502 / app keeps restarting | Node version below 20, or `app.js` is not the startup file. |

---

## Updating

```bash
cd ~/azuregravy
git pull            # or re-upload the changed files
npm install --omit=dev
# then Restart in the Node.js App screen
```

Any new tables or settings are created automatically on the next start. Back up the database and
`public/uploads/` first.
