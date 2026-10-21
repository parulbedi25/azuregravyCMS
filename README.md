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
Public site   http://localhost:3000
Studio        http://localhost:3000/admin
First run     create your administrator at /admin/setup
```

MariaDB/MySQL is the only thing you have to provide — the tables, settings, starter pages and super
admin account are created automatically the first time the server connects.

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

**Requirements:** Node.js 20 or newer, and a MariaDB / MySQL database.

```bash
npm install
npm start
```

That is the whole install. `npm start` runs `app.js`, which loads the TypeScript server directly —
no build step, no compiled folder to keep in sync.

On first boot the app:

1. **connects** to the MariaDB/MySQL server in `.env` (and creates the database if the user is allowed to),
2. **creates every table**, index, foreign key and the default settings — only what is missing,
3. sends you to **`/admin/setup`** to create the super admin account, then adds starter pages
   (About, Contact, Privacy, Terms), a menu and one welcome story so the site is not empty.

Nothing to import, no SQL file to run, no install wizard to download.

```
Public site   http://localhost:3000
Studio        http://localhost:3000/admin/setup     (first run)
              http://localhost:3000/admin           (after that)
```

### Configure the database

Copy the template and fill in the values from your host:

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

### Optional: create the admin without opening a browser

```dotenv
ADMIN_NAME=Site Administrator
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=a-long-password
```

The account is created on the next `npm start` (or `npm run db:setup`), and the wizard is skipped.

### Optional: load the demo publication

```bash
SEED_DEMO=1 npm start      # 18 stories, 4 pages, 8 categories, 42 images, 6 writers
```

Demo accounts all use the password `gravy123`; the admin is `admin@azuregravy.local`.

### Local development

```bash
npm run dev        # tsx watch, reloads on change
```

If you do not want to install a database server locally, `DB_DRIVER=embedded` runs a real MariaDB
compiled to WebAssembly inside Node (optional dependency: `npm install lite4mariadb`).

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
- **Bulk actions** — publish, draft, trash and restore from the story list, plus a scheduled queue
  that publishes on the first request after the publish time.
- **Pages** — the same editor with its own templates, including a working contact page.
- **Taxonomies** — categories and tags with descriptions, colours and editable slugs; author pages.
- **Automatic 301s** — renaming a slug keeps old links alive and records the redirect.

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

- Magazine home: lead story, editor's picks, category grid, **topic spotlight**, latest stream,
  newsletter band and a "more from the journal" grid.
- Story page: table of contents, reading progress bar, sticky share rail, author card, tags,
  previous/next story, related reading and threaded comments.
- **Up next**: reaching the end of a story pulls the next piece inline with its full rendered body.
- **Before you go** bar: a dismissible next-story prompt past the halfway point, remembered per story.
- **Newsletter popup**: opens from every Subscribe button, after 18 seconds or 55 % scroll — once per
  browser, closes on ESC or backdrop.
- **Topics mega menu**: image, description and story count for each category, straight from the database.
- Story lists for archive, category, tag, author and search, with `/page/2` style pagination.
- Full-text search across titles, excerpts, bodies and tags, plus a keyboard overlay (`/` or ⌘K).
- Light / dark / system themes, remembered per browser and applied before first paint.
- Responsive from 360 px to ultrawide, with an off-canvas studio sidebar on phones.
- Thoughtful empty states: every dead end offers a search box, topic chips and a way back.

### SEO and feeds

Canonical URLs, Open Graph and Twitter cards, JSON-LD `Article` / `BreadcrumbList`, `sitemap.xml`,
`feed.xml` (RSS 2.0), `robots.txt`, per-post no-index and a configurable default social image.

### Security

- Session cookies (HTTP-only, same-site) backed by a MariaDB session store, so restarts keep logins.
- **CSRF token on every mutating request**, including uploads and API routes.
- `scrypt` password hashing with per-user salt and timing-safe comparison.
- Login throttling (six failed attempts per IP + email locks sign-in for 15 minutes), honeypot fields
  on public forms, MIME and extension checks on uploads, path normalisation for media.
- Output escaping by default (EJS `<%=`), `sanitize-html` on rendered Markdown, URL validation on
  redirects.
- Standalone 404 / 419 / 500 pages that render without leaking the admin shell.

---

## The Studio dashboard

`/admin` is a complete control panel, not a demo shell. Every section is backed by real queries and
capability checks.

| Studio section | Route | What it manages |
| --- | --- | --- |
| **Dashboard** | `/admin` | Counts, view chart, drafts, pending comments, recent activity, quick actions |
| **Stories** | `/admin/posts` | Create, edit, trash, restore, bulk publish; filters by status, author, category |
| **Pages** | `/admin/posts?type=page` | Static pages and templates |
| **Categories / Tags** | `/admin/categories`, `/admin/tags` | Names, slugs, descriptions, colours, counts |
| **Media** | `/admin/media` | Upload, browse, edit metadata, copy URLs, delete |
| **Comments** | `/admin/comments` | Moderation queue, replies, spam and trash |
| **Subscribers** | `/admin/subscribers` | Newsletter list, statuses, search, CSV export |
| **Inbox** | `/admin/messages` | Contact form messages, read/unread, reply |
| **Appearance** | `/admin/appearance` | Wordmark, accent colour, theme, homepage layout, reading options, live preview |
| **Navigation** | `/admin/menus` | Header, footer and legal menus — add, reorder, toggle, delete |
| **Redirects** | `/admin/redirects` | Review and remove the 301s created by slug changes |
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
| **Homepage** | Appearance | Editorial or grid layout, featured slots (1–3), stories per page, topic spotlight category |
| **Reading** | Appearance | Reading time, author box, related stories, table of contents — each on/off |
| **Story engagement** | Appearance | Auto-load "Up next", "Before you go" bar |
| **Header** | Navigation + Settings → Footer & social | Primary menu items, order, visibility; social icons; publication title, tagline, description |
| **Footer** | Settings → Footer & social + Navigation | Footer and legal menus, about text, copyright line (`{year}` token), social links |
| **Newsletter** | Settings → Newsletter | Enable/disable, heading and body copy |
| **Comments** | Settings → Discussion | Allow comments, pre-moderation, notification email |
| **SEO** | Settings → SEO | Default social image, analytics snippet, per-story overrides |
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

### What the first boot does

Startup is idempotent, so it is safe to restart (or deploy) as often as you like:

| Step | Detail |
| --- | --- |
| Connect | Retries transient failures; if the database is missing it tries `CREATE DATABASE` once. |
| Migrate | `CREATE TABLE IF NOT EXISTS` for all 19 tables, then records the schema version. |
| Settings | Inserts any missing setting keys; never overwrites values you have changed. |
| Super admin | Created from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, or through `/admin/setup`. |
| Starter content | Menus, About / Contact / Privacy / Terms pages, three categories, one welcome story. |
| Demo content | Only when `SEED_DEMO=1`, and only on a completely empty database. |

If the connection fails, the process stops with a specific explanation (wrong password, unknown
database, host unreachable, no privileges) instead of a stack trace, and writes nothing.

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
| `DB_DRIVER` | `mysql` | `mysql` or `embedded` |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | Database server |
| `DB_NAME` | `azuregravy` | Database name (full cPanel name) |
| `DB_USER` / `DB_PASSWORD` | `root` / *(empty)* | Database credentials |
| `DB_SSL` | `false` | `true` for hosts that require TLS |
| `DATABASE_URL` | *(empty)* | `mysql://user:pass@host:port/db` — replaces the five values above |
| `AUTO_SETUP` | `true` | Create tables and starter content on boot |
| `SEED_DEMO` | `false` | Load the demo publication on an empty database |
| `ADMIN_NAME` | `Site Administrator` | Used when creating the super admin from env |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | *(empty)* | Blank = use the `/admin/setup` wizard |
| `UPLOAD_MAX_MB` | `12` | Upload size limit |
| `DB_DATA_DIR` | `./data/mariadb` | Embedded driver only |

Uploads land in `public/uploads/` and are served by the app.

---

## Project layout

```
src/
  app.ts                 Express app: parsers → session → flash → locals → static → CSRF → routes
  server.ts              boot, migrate, seed-if-empty, listen
  config.ts              env-backed configuration
  db/
    index.ts             DbClient interface, mysql + embedded drivers, transactions, migrations
    bootstrap.ts         first-run provisioning: tables, starter content, super admin
    setup-cli.ts         `npm run db:setup`
    schema.ts            schema DDL, migration list, default settings
    seed.ts, seed-data.ts demo publication
  lib/                   markdown, auth, settings, sessions, uploads, http helpers, icons, views
  services/              posts, comments, media, users, stats, activity, navigation
  routes/
    public.ts            home, story, page, archive, category, tag, author, search, feed, sitemap
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
- Ensure `public/uploads/` is writable by the app user — the boot log warns if it is not.
- Use a database user with privileges on that single database only (cPanel does this by default).
- Back up two things: the database and `public/uploads/`.
- In production, responses carry `Content-Security-Policy: frame-ancestors 'self'`; development
  omits framing headers so sandbox preview panes can embed the app.

---

## Screenshots

| Public site | Studio |
| --- | --- |
| ![Home](docs/screenshots/home.png) | ![Dashboard](docs/screenshots/admin.png) |
| ![Story](docs/screenshots/article.png) | ![Editor](docs/screenshots/editor.png) |
| ![Stories archive](docs/screenshots/stories.png) | ![Appearance](docs/screenshots/appearance.png) |
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
