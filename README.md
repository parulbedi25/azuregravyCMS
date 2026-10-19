# Azure Gravy CMS

**A complete, self-hosted editorial blogging CMS — Node.js + TypeScript + MariaDB.**
Magazine-style public site, full writing studio, WordPress-class publishing features, zero front-end
frameworks.

Everything is hand-built: the markup, the design system, the admin UI and the data layer. No CSS
framework, no admin theme, no client-side JS library. Fonts and demo images ship with the repository,
so the whole thing runs offline.

```
Public site   http://localhost:3000
Studio        http://localhost:3000/admin
Sign in       admin@azuregravy.local / gravy123
```

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
- [Screenshots](#screenshots)
- [Licence](#licence)

---

## Quick start

**Requirements:** Node.js 20 or newer. That's it — the default database is a real MariaDB engine
compiled to WebAssembly and embedded in the Node process, so there is no database server to install.

```bash
git clone https://github.com/parulbedi25/azuregravyCMS.git
cd azuregravyCMS

npm install
cp .env.example .env      # optional — sensible defaults are built in
npm run dev               # http://localhost:3000
```

First boot creates the schema, runs pending migrations and seeds a complete demo publication:
18 stories (16 published, 2 drafts), 4 pages, 8 categories, 22 tags, 42 images, 6 writers,
threaded comments, newsletter subscribers, contact messages, menus and redirects.

```bash
npm run build             # compile TypeScript to dist/
npm start                 # serve the compiled build (production-style)
npm run build && npm start
```

### Seeded accounts

| Role   | Email                    | Password   |
| ------ | ------------------------ | ---------- |
| Admin  | `admin@azuregravy.local` | `gravy123` |
| Editor | `rowan@azuregravy.local` | `gravy123` |
| Author | `avery@azuregravy.local` | `gravy123` |

All six demo users share the password `gravy123`. Before seeding a real installation, change
`ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` and set `SESSION_SECRET` to a long random string.

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
| Database | MariaDB — embedded (WebAssembly, zero setup) or a real server over the wire |
| Sessions | `express-session` with a custom MariaDB store |
| Markdown | `marked` + `sanitize-html` |
| Uploads | `multer` + `image-size` |
| Validation | `zod` |
| Front end | Hand-written CSS and vanilla JS — no framework, no build step |

The CSS and JavaScript are served exactly as written; `npm run build` only compiles TypeScript.

---

## Database

Two drivers, chosen with `DB_DRIVER`:

| Driver | What it does |
| --- | --- |
| `embedded` *(default)* | Runs MariaDB compiled to WebAssembly inside Node against `DB_DATA_DIR`. Zero setup, ideal for local dev and single-node demos. |
| `mysql` | Connects to an external MariaDB/MySQL server — use this for production or multiple instances. |

```bash
# external MariaDB
DB_DRIVER=mysql DB_HOST=127.0.0.1 DB_PORT=3306 \
DB_USER=azuregravy DB_PASSWORD=secret DB_NAME=azuregravy npm start
```

Both drivers sit behind one small interface (`query`, `execute`, `insert`, `transaction`), so the same
code and SQL run on either. Schema creation and versioned migrations happen automatically at startup.
`./data/` and `public/uploads/` are ignored by git.

> **Single process only for the embedded driver.** Two app instances pointed at the same data
> directory will fight over the files. For anything with more than one instance, use `DB_DRIVER=mysql`.

### Creating the database for the `mysql` driver

```sql
CREATE DATABASE azuregravy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'azuregravy'@'%' IDENTIFIED BY 'azuregravy';
GRANT ALL PRIVILEGES ON azuregravy.* TO 'azuregravy'@'%';
FLUSH PRIVILEGES;
```

Then set `DB_DRIVER=mysql` in `.env` and run `npm run db:seed` (or let the app create the schema and
seed on first boot).

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | `tsx watch src/server.ts` — hot reload on <http://localhost:3000> |
| `npm run build` | `tsc -p tsconfig.json` → `dist/` |
| `npm start` | `node dist/server.js` — serve the compiled build |
| `npm run db:seed` | Seed an empty database with the demo publication |
| `npm run db:reset` | Wipe and re-seed — **destroys all content** |
| `npm run typecheck` | `tsc --noEmit` |

---

## Configuration

Copy `.env.example` to `.env`. Everything has a working default.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port, bound to `0.0.0.0` |
| `NODE_ENV` | `development` | `production` enables long asset caching and same-origin framing |
| `SITE_URL` | `http://localhost:3000` | Canonical links, RSS and sitemap |
| `SESSION_SECRET` | dev fallback | **Set a long random string in production** |
| `DB_DRIVER` | `embedded` | `embedded` or `mysql` |
| `DB_DATA_DIR` | `./data/mariadb` | Embedded driver only |
| `DB_NAME` | `azuregravy` | Database name |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | `mysql` driver only |
| `DB_USER` / `DB_PASSWORD` | `azuregravy` / `azuregravy` | `mysql` driver only |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@azuregravy.local` / `gravy123` | Used by the seeder |

Uploads land in `public/uploads/` and are served by the app.

---

## Project layout

```
src/
  app.ts                 Express app: parsers → session → flash → locals → static → CSRF → routes
  server.ts              boot, migrate, seed-if-empty, listen
  config.ts              env-backed configuration
  db/
    index.ts             DbClient interface, embedded + mysql drivers, transactions, migrations
    schema.ts            schema DDL, migration list, default settings
    seed.ts, seed-data.ts demo publication
  lib/                   markdown, auth, settings, sessions, uploads, http helpers, icons, views
  services/              posts, comments, media, users, stats, activity, navigation
  routes/
    public.ts            home, story, page, archive, category, tag, author, search, feed, sitemap
    admin/*.ts           dashboard, auth, posts, taxonomy, media, comments, people, settings
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

- Set `NODE_ENV=production`, a strong `SESSION_SECRET` and the real `SITE_URL`.
- Run `npm run build && npm start` behind a reverse proxy (nginx, Caddy) that terminates TLS.
- Use `DB_DRIVER=mysql` for any setup with more than one app instance or a managed database.
- Back up two things: the database and `public/uploads/`.
- The app trusts one proxy hop (`trust proxy`) so client IPs are correct behind nginx/Caddy.
- In production, responses are sent with `Content-Security-Policy: frame-ancestors 'self'`;
  development deliberately omits framing headers so sandbox preview panes can embed the app.

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
