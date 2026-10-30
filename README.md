# Azure Gravy CMS

**A complete, self-hosted editorial blogging CMS — Node.js + TypeScript + MariaDB.**
Magazine-style public site, full writing studio, WordPress-class publishing features, zero front-end
frameworks.

Everything is hand-built: the markup, the design system, the admin UI and the data layer. No CSS
framework, no admin theme, no client-side JS library. Fonts and demo images ship with the repository,
so the whole thing runs offline.

```bash
npm install && npm start
```

```
Installer     http://localhost:3000/admin/setup     (first run — database + administrator)
Public site   http://localhost:3000
Studio        http://localhost:3000/admin
```

The server starts **without a database**. Open it in a browser and the installer asks for your
MariaDB/MySQL details, tests the connection right there in the page, creates every table, and then
creates your administrator account. No `.env` editing, no SQL import, no crash when the credentials
are wrong — a wrong password is a form error you can correct and resubmit.

![Azure Gravy home page](docs/screenshots/home-fold.png)

---

## Contents

- [Quick start](#quick-start)
- [What you get](#what-you-get)
- [The Studio dashboard](#the-studio-dashboard)
- [What you can customise](#what-you-can-customise)
- [Tech stack](#tech-stack)
- [Database](#database)
- [Scripts](#scripts)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Design system](#design-system)
- [Deployment notes](#deployment-notes)
- [Deploying on cPanel / Namecheap](docs/DEPLOY-CPANEL.md)
- [Screenshots](#screenshots)
- [Licence](#licence)

---

## Quick start

**Requirements:** Node.js 20 or newer. A MariaDB / MySQL database — but you do not need it to *start*
the app, only to finish the installer.

```bash
npm install
npm start
```

That is the whole install. `npm start` runs `app.js`, which loads the TypeScript server directly —
no build step, no compiled folder to keep in sync. **Nothing touches MySQL at this point**, so the
server comes up even on a host where the database does not exist yet.

Open `http://localhost:3000` and the two-step installer takes over:

| Step | What you enter | What happens |
| --- | --- | --- |
| **1 · Database** | host, port, database name, user, password — or "built-in MariaDB" for a zero-setup trial | The connection is **tested in the page**. If it fails you get a plain-English reason (`ER_ACCESS_DENIED_ERROR`, `ECONNREFUSED`, unknown database…) with the cPanel fix, and nothing is written. If it succeeds the database is created when needed and all 19 tables plus the default settings are built. |
| **2 · Administrator** | publication name, your name, e-mail, password | The super admin is created and you are signed straight into the Studio. Starter pages (About, Contact, Privacy, Terms), menus, three categories and one welcome post are added so the site is not empty. |

The database details are remembered in `data/install.json` (permissions `0600`), so later boots
connect on their own. Until an administrator exists, every URL leads back to the installer.

```
Installer     http://localhost:3000/admin/setup
Public site   http://localhost:3000
Studio        http://localhost:3000/admin
Health        http://localhost:3000/healthz        (never touches the database)
```

### Optional: configure the database with environment variables instead

If you would rather not use the installer — cPanel, Docker, CI — set the variables and the app
connects on the first request, creating the tables and (with `ADMIN_*`) the administrator for you.
Environment values always win over `data/install.json`.

```bash
cp .env.example .env
```

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_NAME=myaccount_gravy     # full cPanel name, prefixed with your account
DB_USER=myaccount_gravy
DB_PASSWORD=the-password-you-set
```

Creating the database itself is a two-minute job in any host's control panel — see
**[Deploying on cPanel / Namecheap](docs/DEPLOY-CPANEL.md)** for the exact clicks.

If the saved or supplied credentials stop working (a rotated password, a restored dump), the site
serves a **"Database unreachable"** page with the reason and a **Fix the database settings** button
that reopens the installer — the process keeps running, so you can repair it from the browser.

### Optional: create the admin without opening a browser

```dotenv
ADMIN_NAME=Site Administrator
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=a-long-password
```

The account is created on the first request (or by `npm run db:setup`), and the installer is skipped.

### Optional: load the demo publication

```bash
SEED_DEMO=1 npm start      # 18 posts, 4 pages, 8 categories, 42 images, 6 writers
```

Demo accounts all use the password `gravy123`; the admin is `admin@azuregravy.local`.

### Local development

```bash
npm run dev        # tsx watch, reloads on change
```

If you do not want to install a database server locally, pick **"Built-in MariaDB on this machine"**
in the installer (or set `DB_DRIVER=embedded`): a real MariaDB compiled to WebAssembly runs inside
Node and keeps its files under `./data` (optional dependency: `lite4mariadb`, installed by
`npm install`).

---

## What you get

### Writing and publishing

- **Split-view Markdown editor** — server-rendered live preview using the same pipeline as the front
  end, formatting toolbar, keyboard shortcuts, word count and a local autosave snapshot that
  survives a reload or a lost connection.
- **Metadata panel** — status (`draft`, `scheduled`, `published`, `private`, `trash`), publish date
  and time, author, categories, tags, featured image, excerpt, custom slug, SEO title, meta
  description, Open Graph image and a no-index toggle.
- **Revisions** — each save snapshots the previous body; the editor lists the eight most recent and
  the revisions page keeps the last 40, any of which can be restored.
- **Bulk actions** — publish, draft, trash and restore from the post list, plus a scheduled queue
  that publishes on the first request after the publish time.
- **Pages** — the same editor with its own templates, including a working contact page.
- **Taxonomies** — categories and tags with descriptions, colours and editable slugs; author pages.
- **Automatic 301s** — renaming a slug keeps old links alive and records the redirect.
- **Permalink control** — Studio → Permalinks chooses the shape of every post URL: a base plus
  slug (default `/posts/%slug%`), the shortest possible `/%slug%`, date-based
  `/posts/%year%/%month%/%slug%`, category-based, numeric, or a custom template built from the
  tokens `%slug% %post_id% %year% %month% %day% %category%`. Segments can be added or removed
  freely. Saving writes a 301 for every published post, collapses redirect chains to a single
  hop, and moves the archive menu item with it; requests that identify a post but are not its
  canonical URL (a stale date, a trailing slash, an old `/stories/…` link) are redirected rather
  than served as duplicate content. Pages are unaffected and stay at the root.

### AI drafting assistant

- **Title to draft** — administrators can turn a title into a complete post body, an outline, a
  continuation of what is already written, or a rewrite of just the highlighted passage. The result
  lands directly in the editor textarea, ready to edit and save.
- **Embedded diagrams** — the model returns a small JSON flow spec and the app draws it as a
  draw.io-style SVG (fixed palette, orthogonal routing, ranked columns), saves it to the media
  library and inserts it as an image. The model never emits markup, so a hostile label cannot become
  script.
- **Provider-agnostic** — any endpoint that speaks OpenAI's `POST {base_url}/chat/completions` with
  `Authorization: Bearer` auth. Configured under **Studio → AI assistant**, with an on/off switch in
  the sidebar. The key is stored in the database, masked in the UI and redacted from the settings
  export.
- **One-click presets, including free tiers** — the settings page offers Groq, OpenRouter, Mistral,
  Google Gemini, a local Ollama and OpenAI, each filling in its base URL and a model id that is free
  to call today. Five of the six cost nothing. Every preset also states what that provider does with
  your prompts, because drafting sends unpublished text to a third party: Groq says it does not
  retain inference data, Gemini's free tier is used to improve Google products, and a local Ollama
  never lets your draft leave the machine. Azure OpenAI is deliberately absent — it authenticates
  with an `api-key` header rather than a bearer token, so this client would be rejected.
- **Test connection** — one button probes the saved or in-progress settings with a one-token request
  and reports which model answered and how long the round trip took, so a wrong key, a retired model
  id or a host that blocks outbound requests is diagnosed before you try to draft.
- **On by default, inert until configured** — the assistant ships switched on but refuses every
  request until an API key and a model exist, so nothing is sent anywhere on a fresh install. The
  switch is enforced server-side on every request rather than merely hiding the panel, and the whole
  surface is administrator-only.

### Media

- Drag-and-drop or browse, multi-file upload, per-file validation, 12 MB limit, JPEG / PNG / WebP /
  GIF / AVIF.
- `YYYY/MM` storage, dimensions and file size read on upload, alt text, caption and title.
- Library grid with search and type filters, copy-URL and delete, and a picker modal inside the
  editor that inserts Markdown or sets the featured image without leaving the page.

### Community and newsletters

- Threaded comments with a moderation queue (`pending`, `approved`, `spam`, `trash`), reply,
  approve, mark as spam, restore and delete; author email and IP recorded.
- Public comment form with honeypot, CSRF protection, Markdown escaping and an "awaiting review"
  state.
- Newsletter subscribers with `pending` / `confirmed` / `unsubscribed` statuses, search and CSV
  export.
- Contact inbox with read/unread state and reply links.
- Activity log for every editorial action.

### Front end

- Magazine home: lead post, editor's picks, category grid, **topic spotlight**, latest stream,
  newsletter band and a "more from the journal" grid.
- Post page: table of contents, reading progress bar, sticky share rail, author card, tags,
  previous/next post, related reading and threaded comments.
- **Up next**: reaching the end of a post pulls the next piece inline with its full rendered body.
- **Before you go** bar: a dismissible next-post prompt past the halfway point, remembered per post.
- **Newsletter popup**: opens from every Subscribe button, after 18 seconds or 55 % scroll — once per
  browser, closes on ESC or backdrop.
- **Topics mega menu**: image, description and post count for each category, straight from the database.
- Post lists for archive, category, tag, author and search, with `/page/2` style pagination.
- Full-text search across titles, excerpts, bodies and tags, plus a keyboard overlay (`/` or ⌘K).
- Light / dark / system themes, remembered per browser and applied before first paint.
- Responsive from 360 px to ultrawide, with an off-canvas studio sidebar on phones.
- Thoughtful empty states: every dead end offers a search box, topic chips and a way back.

### SEO and feeds

Canonical URLs, Open Graph and Twitter cards, JSON-LD `Article` / `BreadcrumbList`, `sitemap.xml`,
`feed.xml` (RSS 2.0), `robots.txt`, per-post no-index and a configurable default social image.

### Security

- Session cookies (HTTP-only, `SameSite=Lax` by default) backed by a MariaDB session store, so restarts
  keep logins. Set `SESSION_SAMESITE=none` only if you embed the Studio in an iframe on a *different*
  domain — see the configuration table below.
- **CSRF token on every mutating request**, including uploads and API routes.
- `scrypt` password hashing with per-user salt and timing-safe comparison.
- Login throttling (six failed attempts per IP + email locks sign-in for 15 minutes), honeypot fields
  on public forms, MIME and extension checks on uploads, path normalisation for media.
- Output escaping by default (EJS `<%=`), `sanitize-html` on rendered Markdown, and one shared
  redirect guard that rejects protocol-relative (`//host`) and backslash (`/\host`) targets wherever
  a redirect is user-supplied — the login `next` field, the AI toggle and the newsletter form.
- A refused upload answers `400`/`413` with the actual reason (JSON for the API, a flash message for
  the form) rather than a `500`, and the rejection is logged as a warning instead of a stack trace.
- Standalone 404 / 419 / 500 pages that render without leaking the admin shell.

---

## The Studio dashboard

`/admin` is a complete control panel, not a demo shell. Every section is backed by real queries and
capability checks.

| Studio section | Route | What it manages |
| --- | --- | --- |
| **Dashboard** | `/admin` | Counts, view chart, drafts, pending comments, recent activity, quick actions |
| **Posts** | `/admin/posts` | Create, edit, trash, restore, bulk publish; filters by status, author, category |
| **Pages** | `/admin/posts?type=page` | Static pages and templates |
| **Categories / Tags** | `/admin/categories`, `/admin/tags` | Names, slugs, descriptions, colours, counts |
| **Media** | `/admin/media` | Upload, browse, edit metadata, copy URLs, delete |
| **Comments** | `/admin/comments` | Moderation queue, replies, spam and trash |
| **Subscribers** | `/admin/subscribers` | Newsletter list, statuses, search, CSV export |
| **Inbox** | `/admin/messages` | Contact form messages, read/unread, reply |
| **Appearance** | `/admin/appearance` | Wordmark, accent colour, theme, homepage layout, reading options, live preview |
| **Navigation** | `/admin/menus` | Header, footer and legal menus — add, reorder, toggle, delete |
| **Redirects** | `/admin/redirects` | Review and remove the 301s created by slug changes |
| **Permalinks** | `/admin/permalinks` | Post URL structure — presets, custom templates, live URL preview, reserved-slug warnings |
| **Settings** | `/admin/settings` | General, Reading, Discussion, Newsletter, SEO, Footer & social |
| **People** | `/admin/users` | Users, roles, profiles, password changes |
| **System** | `/admin/tools` | Database health, rebuild rendered HTML, generate redirects, prune sessions, JSON export, activity log |

**Roles:** `admin`, `editor`, `author` — enforced on every route. Authors only see and edit their own
drafts; editors can moderate, manage menus and redirects; only admins reach settings, appearance,
people and system tools.

---

## What you can customise

Everything below is editable from the dashboard with no code changes.

| What | Where | Options |
| --- | --- | --- |
| **Accent / theme colour** | Appearance | Colour picker plus six presets (`#206BEA`, ink, sky, forest, plum, rose). Drives links, chips, focus rings **and buttons**, expanded server-side into readable light and dark tints. |
| **Light or dark default** | Appearance | `light`, `dark`; readers can still toggle, remembered per browser |
| **Wordmark** | Appearance | Logo text used in the header, footer and studio sidebar |
| **Homepage** | Appearance | Editorial or grid layout, featured slots (1–3), posts per page, topic spotlight category |
| **Reading** | Appearance | Reading time, author box, related posts, table of contents — each on/off |
| **Post engagement** | Appearance | Auto-load "Up next", "Before you go" bar |
| **Header** | Navigation + Settings → Footer & social | Primary menu items, order, visibility; social icons; publication title, tagline, description |
| **Footer** | Settings → Footer & social + Navigation | Footer and legal menus, about text, copyright line (`{year}` token), social links |
| **Newsletter** | Settings → Newsletter | Enable/disable, heading and body copy |
| **Comments** | Settings → Discussion | Allow comments, pre-moderation, notification email |
| **Permalinks** | Permalinks | Post URL structure: presets, custom token templates, automatic 301s on change |
| **SEO** | Settings → SEO | Default social image, analytics snippet, per-post overrides |
| **General** | Settings → General | Site title, tagline, description, URL, contact email, timezone, date format |

### Not customisable in the UI (yet)

- Button colour is **derived from the accent colour** — there is no separate button / hover /
  secondary colour control, and no button-radius or size selector.
- The header CTA is fixed to "Subscribe" → newsletter popup.
- No toggle to hide the top strip (date, ticker, socials) or to turn off the sticky header.
- Footer layout is fixed (brand column, two link columns, newsletter band).
- No custom CSS / HTML escape hatch.

These are the natural next additions; the settings table and `base.css` tokens are structured to
accept them.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 20+, ES modules, TypeScript (strict) |
| Server | Express 4 |
| Views | EJS with `express-ejs-layouts` — no client-side rendering |
| Database | MariaDB / MySQL over the wire (mysql2); optional embedded MariaDB (WebAssembly) for local dev |
| Sessions | `express-session` with a custom MariaDB store |
| Markdown | `marked` + `sanitize-html` |
| Uploads | `multer` + `image-size` |
| Validation | `zod` |
| Front end | Hand-written CSS and vanilla JS — no framework, no build step |

The CSS and JavaScript are served exactly as written; `npm run build` only compiles TypeScript.

---

## Database

MariaDB or MySQL over the wire (`mysql2`) is the default and the supported production path —
cPanel, Plesk, a VPS, RDS, PlanetScale: anything that speaks the MySQL protocol.

| Driver | When to use it |
| --- | --- |
| `mysql` *(default)* | Production and anything real. Connects to a MariaDB/MySQL server. |
| `embedded` | Local development and tests with no database server: real MariaDB compiled to WebAssembly. Single process only. |

The details can come from three places, in this order of precedence:

1. **Environment variables** (`.env`, cPanel's environment panel, Docker, CI),
2. **`data/install.json`**, written by the browser installer the first time it connects,
3. **nothing at all** — the app still starts and serves the installer.

```dotenv
DB_DRIVER=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=myaccount_gravy
DB_USER=myaccount_gravy
DB_PASSWORD=secret
DB_SSL=false
```

Or a single URL instead of five values:

```dotenv
DATABASE_URL=mysql://myaccount_gravy:secret@localhost:3306/myaccount_gravy
```

### When the database work happens

`npm start` opens the HTTP listener and nothing else. The database is touched on the **first request
that needs it** — or by the installer's connection test — and every step is idempotent, so restarting
or redeploying is always safe:

| Step | When | Detail |
| --- | --- | --- |
| Configure | Installer step 1, or environment | Details are tested before they are saved; `data/install.json` is written `0600`. |
| Connect | First request / installer | Retries transient failures; if the database is missing it tries `CREATE DATABASE` once. |
| Migrate | Once per process | `CREATE TABLE IF NOT EXISTS` for all 19 tables, then records the schema version. |
| Settings | Once per process | Inserts any missing setting keys; never overwrites values you have changed. |
| Super admin | Installer step 2, or `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The installer closes itself as soon as an administrator exists. |
| Starter content | With the super admin | Menus, About / Contact / Privacy / Terms pages, three categories, one welcome post. |
| Demo content | Only when `SEED_DEMO=1` | And only on a completely empty database. |

A failed connection never stops the process. Depending on where it fails you get:

- **Installer step 1** — the reason inline in the form (`The database rejected these credentials…`,
  `Nothing is listening on that host/port…`) with the cPanel fix, your values preserved, nothing written.
- **A saved configuration that stopped working** — a `503 Database unreachable` page naming the target
  and the error code, with a button back into the installer. `/healthz` stays `200` for uptime checks.
- **No configuration at all** — every URL redirects to `/admin/setup`.

### Creating the database yourself (VPS / local)

```sql
CREATE DATABASE azuregravy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'azuregravy'@'localhost' IDENTIFIED BY 'a-strong-password';
GRANT ALL PRIVILEGES ON azuregravy.* TO 'azuregravy'@'localhost';
FLUSH PRIVILEGES;
```

On shared hosting (cPanel, Namecheap, Hostinger) the database and user are created in the panel and
are prefixed with your account name — see the [cPanel guide](docs/DEPLOY-CPANEL.md).

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | `node app.js` — what cPanel/Passenger runs. Loads the TypeScript server through tsx, so no build is needed. |
| `npm run dev` | `tsx watch src/server.ts` — hot reload on <http://localhost:3000> |
| `npm run db:setup` | Connect, create tables, starter content and the admin from `.env`, then exit |
| `npm run db:seed` | Load the demo publication into an empty database |
| `npm run db:reset` | Wipe and re-seed — **destroys all content** |
| `npm run build` | `tsc` → `dist/` (optional; for `npm run start:prod`) |
| `npm run start:prod` | `node dist/server.js` — serve a compiled build |
| `npm run typecheck` | `tsc --noEmit` |

---

## Configuration

`.env` is read from the project root. Environment variables always win, so on a host with a
"Environment variables" panel you can skip the file entirely.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. If Passenger supplies a socket path, it is used as-is. |
| `HOST` | `0.0.0.0` | Bind address for the TCP listener |
| `NODE_ENV` | `development` | `production` enables long asset caching and same-origin framing |
| `SITE_URL` | *(detected)* | Canonical links, RSS and sitemap. Blank = follow the request host |
| `SESSION_SECRET` | dev fallback | **Set a long random string in production** |
| `SESSION_SAMESITE` | `lax` | `strict`, `lax` or `none`. Set `none` **only** when the Studio is embedded in an iframe on a different domain — see the note below |
| `DB_DRIVER` | *(unset)* | `mysql` or `embedded`. Unset = the installer asks |
| `DB_HOST` / `DB_PORT` | *(unset)* / `3306` | Database server. On cPanel: `localhost` |
| `DB_NAME` | *(unset)* | Database name (full cPanel name) |
| `DB_USER` / `DB_PASSWORD` | *(unset)* | Database credentials |
| `DB_SSL` | `false` | `true` for hosts that require TLS |
| `DB_CONNECT_TIMEOUT` | `12000` | Milliseconds before a connection attempt is abandoned |
| `DATABASE_URL` | *(empty)* | `mysql://user:pass@host:port/db` — replaces the five values above |
| `SEED_DEMO` | `false` | Load the demo publication on an empty database |
| `ADMIN_NAME` | `Site Administrator` | Used when creating the super admin from env |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | *(empty)* | Blank = the installer creates the administrator |
| `UPLOAD_MAX_MB` | `12` | Upload size limit |
| `DB_DATA_DIR` | `./data/mariadb` | Embedded driver only |

**`SESSION_SAMESITE=none`** is for one situation: the Studio is embedded in an `<iframe>` served from a
*different* domain. A cross-site iframe makes every request cross-site, and browsers withhold a `lax`
cookie from those — so the session never survives to the next request and every form submit fails with
`419 Session expired`. Browsers only accept `SameSite=None` alongside `Secure`, so this mode also forces
the `Secure` flag and treats incoming requests as HTTPS; use it only behind TLS. Leave it unset for a
normal top-level site, where `lax` is the stronger default.

This mode also sets the CHIPS **`Partitioned`** attribute, which browsers that block third-party cookies
require before they will store a cross-site cookie at all.

**Treat `none` as best-effort, not a guarantee.** Whether a cross-site iframe keeps *any* cookie is
decided by the browser and the embedding host, not by this app. Measured against one real preview host,
the cookie was refused on every request even with `SameSite=None; Secure; Partitioned` — the most
permissive combination that exists — so there are hosts where no attribute setting helps. If `none` does
not clear the 419, stop tuning attributes and open the app as a top-level tab, where the cookie is
first-party. Worth understanding why this matters beyond forms: sessions carry the login, the flash
messages and the installer's step 1 → step 2 handoff, so a cookieless iframe breaks the whole Studio
rather than just its submits.

Two further consequences of `Partitioned`:

- A partitioned cookie is scoped to the *embedding* site, so opening the same URL as a top-level tab
  gets its own separate session rather than sharing the iframe's.
- Do not reach for `none` to solve a cross-site **POST** flow (a payment redirect back, say) — there
  the partitioning would silently split the session. `none` here means "embedded in an iframe".

With no `DB_*` values the app is **not** broken — it serves the installer at `/admin/setup` and waits.
`data/install.json` (written by the installer, `0600`, git-ignored) holds the same five values; delete
it to run the installer again.

Uploads land in `public/uploads/` and are served by the app.

---

## Project layout

```
src/
  app.ts                 Express app: parsers → session → flash → locals → install gate → CSRF → routes
  server.ts              boot and listen — deliberately never touches the database
  config.ts              env + install.json configuration, database target resolution
  db/
    index.ts             DbClient interface, mysql + embedded drivers, transactions, migrations,
                         connection probe used by the installer
    install.ts           `data/install.json` — the installer's memory
    bootstrap.ts         install state, lazy provisioning: tables, starter content, super admin
    setup-cli.ts         `npm run db:setup`
    schema.ts            schema DDL, migration list, default settings
    seed.ts, seed-data.ts demo publication
  lib/                   markdown, auth, settings, sessions, uploads, http helpers, icons, views
  services/              posts, comments, media, users, stats, activity, navigation
  routes/
    public.ts            home, post, page, archive, category, tag, author, search, feed, sitemap
    admin/*.ts           dashboard, setup wizard, auth, posts, taxonomy, media, comments, people, settings
views/
  layouts/               public, admin, auth, plain (standalone error pages)
  partials/              header, footer, mega menu, newsletter popup, post card, pagination, comments
  public/, admin/        page templates
public/assets/
  css/base.css site.css admin.css
  js/site.js admin.js
  fonts/, seed/          self-hosted fonts and demo images
docs/screenshots/        every screen in the README
```

---

## Design system

Laid out like a magazine, drawn with Apple-like restraint: one sans-serif display face (SF Pro on
Apple hardware, Inter elsewhere), tight optical letter-spacing, hairline rules, generous white space
and a single accent colour you can change from Appearance.

**Buttons** follow a measured contract — 8 px corners, `8px 14px` padding, 13 px medium label,
`#206BEA` fill, `#3B7DED` hover with a soft 3 px halo and a 1 px press. Every subscribe action
(header, mobile drawer, popup, newsletter band, article sidebar) uses a **32 px pill**; small buttons
drop to 6 × 12 px, large ones to 11 × 20 px. The navigation carries no pill at all — the current page
is simply accent-coloured text on a 32 px hit area. Cards and media use 10 px corners so photography
and buttons agree.

**Dark mode** is first class: the toggle cross-fades every surface over ~420 ms (instant when
`prefers-reduced-motion` is set), the choice is remembered per browser, and the accent is expanded
server-side into readable light and dark tints.

Layout inspiration came from contemporary magazine blogs such as the Recap theme; all markup, CSS,
icons and JavaScript here are original to this project.

---

## Deployment notes

- **cPanel / Namecheap:** follow the step-by-step guide in
  [`docs/DEPLOY-CPANEL.md`](docs/DEPLOY-CPANEL.md) — Node.js app, `app.js` as the startup file,
  NPM install, restart.
- Set `NODE_ENV=production`, a strong `SESSION_SECRET`, and either `SITE_URL` or a detected host.
- Run `npm start` behind the host's own web server (Passenger/nginx) or a reverse proxy that
  terminates TLS. The app trusts one proxy hop, so client IPs are correct.
- Ensure `public/uploads/` **and** `data/` are writable by the app user — `data/install.json` is how
  the installer remembers the database, and the boot log warns about uploads if they are read-only.
- Use a database user with privileges on that single database only (cPanel does this by default).
- Back up three things: the database, `public/uploads/`, and `data/install.json` (or keep the same
  values in your host's environment panel, which always takes precedence).
- Run the installer on a **single** application process: until a database exists, sessions live in
  that process's memory. Set `DB_*` in the environment instead if your host starts several workers.
- In production, responses carry `Content-Security-Policy: frame-ancestors 'self'`; development
  omits framing headers so sandbox preview panes can embed the app.

---

## Screenshots

| Public site | Studio |
| --- | --- |
| ![Home](docs/screenshots/home.png) | ![Dashboard](docs/screenshots/admin.png) |
| ![Post](docs/screenshots/article.png) | ![Editor](docs/screenshots/editor.png) |
| ![Posts archive](docs/screenshots/stories.png) | ![Appearance](docs/screenshots/appearance.png) |
| ![Topics](docs/screenshots/categories.png) | ![Settings](docs/screenshots/settings.png) |
| ![Archive](docs/screenshots/archive.png) | ![Media library](docs/screenshots/media.png) |
| ![Search](docs/screenshots/search.png) | ![Comments](docs/screenshots/comments.png) |
| ![Dark mode](docs/screenshots/dark.png) | ![Dark studio](docs/screenshots/admin-dark.png) |
| ![Mobile](docs/screenshots/mobile.png) | ![Mobile studio](docs/screenshots/admin-mobile.png) |

More in [`docs/screenshots`](docs/screenshots): sign-in, pages, people, subscribers, system, the
topics mega menu, newsletter popup and band, "up next", empty search and the theme transition.

---

## Licence

MIT.
