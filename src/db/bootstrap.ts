import { config } from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { getDb, migrate, type DbClient } from './index.js';
import { DEFAULT_MENU } from './schema.js';

/**
 * First-run provisioning.
 *
 * Booting against an empty database should leave a *working* site rather than an
 * empty shell: tables, settings, menus, a few starter pages, a welcome story and
 * a super admin account. Demo content (18 stories, 6 writers…) stays opt-in via
 * SEED_DEMO=1 so a real installation starts clean.
 */

export interface SetupState {
  tables: number;
  users: number;
  admins: number;
  posts: number;
  pages: number;
  /** false until a super admin exists — the Studio then shows the setup wizard. */
  ready: boolean;
}

export interface BootstrapReport {
  tables: number;
  createdAdmin: string | null;
  createdContent: boolean;
  demoSeeded: boolean;
  installed: boolean;
}

const one = async (db: DbClient, sql: string, params: unknown[] = []): Promise<number> => {
  const rows = await db.query<{ total: number }>(sql, params);
  return Number(rows[0]?.total ?? 0);
};

export async function getSetupState(client?: DbClient): Promise<SetupState> {
  const db = client ?? (await getDb());
  const [tables, users, admins, posts, pages] = await Promise.all([
    one(db, `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`),
    one(db, 'SELECT COUNT(*) AS total FROM users'),
    one(db, `SELECT COUNT(*) AS total FROM users WHERE role = 'admin'`),
    one(db, `SELECT COUNT(*) AS total FROM posts WHERE type = 'post'`),
    one(db, `SELECT COUNT(*) AS total FROM posts WHERE type = 'page'`),
  ]);
  return { tables, users, admins, posts, pages, ready: admins > 0 };
}

/**
 * Cheap "is the site installed?" check for every /admin request.
 * A single indexed lookup, and once an admin has been seen it stays true for the
 * lifetime of the process — so this costs nothing after the first hit.
 */
let installedCache = false;

export async function siteInstalled(client?: DbClient): Promise<boolean> {
  if (installedCache) return true;
  const db = client ?? (await getDb());
  const rows = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows[0]) installedCache = true;
  return installedCache;
}

/** Called after the wizard creates the first admin so the cache flips immediately. */
export function markInstalled(): void {
  installedCache = true;
}

/* ------------------------------------------------------------------ */
/* super admin                                                         */
/* ------------------------------------------------------------------ */

export interface NewAdminInput {
  name: string;
  email: string;
  password: string;
}

export async function createSuperAdmin(input: NewAdminInput, client?: DbClient): Promise<number> {
  const db = client ?? (await getDb());
  const email = input.email.trim().toLowerCase();
  const existing = await db.query<{ id: number }>('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing[0]) return Number(existing[0].id);

  const id = await db.insert(
    `INSERT INTO users (name, email, password_hash, role, created_at, last_login_at)
     VALUES (?, ?, ?, 'admin', UTC_TIMESTAMP(), NULL)`,
    [input.name.trim() || 'Site Administrator', email, await hashPassword(input.password)],
  );
  markInstalled();
  return id;
}

/**
 * Creates the super admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` when both are set.
 * Returns the e-mail when an account was created, otherwise null.
 */
export async function ensureAdminFromEnv(client?: DbClient): Promise<string | null> {
  const { adminEmail, adminPassword, adminName } = config.setup;
  if (!adminEmail || !adminPassword) return null;

  const db = client ?? (await getDb());
  const users = await one(db, 'SELECT COUNT(*) AS total FROM users');
  if (users > 0) return null;

  await createSuperAdmin({ name: adminName, email: adminEmail, password: adminPassword }, db);
  return adminEmail;
}

/* ------------------------------------------------------------------ */
/* starter content                                                     */
/* ------------------------------------------------------------------ */

const STARTER_PAGES = [
  {
    title: 'About',
    slug: 'about',
    template: 'default',
    excerpt: 'What this publication is, who writes it, and why it exists.',
    content: `## Hello

This is your About page. Replace it with the story of your publication — who writes
here, what you cover, and why a reader should stay.

A few things worth telling people:

- **What you publish** and how often.
- **Who is behind it** — names, faces, a short line each.
- **How to reach you**, and what you welcome (tips, corrections, pitches).

> Edit or delete this page in Studio → Pages.`,
  },
  {
    title: 'Contact',
    slug: 'contact',
    template: 'contact',
    excerpt: 'Story tips, corrections, pitches and everything else.',
    content: `Use the form to get in touch. We read everything, even when we are slow to reply.

For press, partnerships or permissions, say so in the subject line.`,
  },
  {
    title: 'Privacy',
    slug: 'privacy',
    template: 'default',
    excerpt: 'What this site stores, and what it does not.',
    content: `## What we collect

- **Comments** store the name, e-mail and IP address you submit.
- **The newsletter** stores the e-mail address you subscribe with.
- **Analytics** are only collected if you add a snippet in Settings → SEO.

## What we do not do

We do not sell data, and we do not run third-party advertising trackers by default.

Write to us if you want your data removed.`,
  },
  {
    title: 'Terms',
    slug: 'terms',
    template: 'default',
    excerpt: 'The short version of the rules.',
    content: `## Using this site

Everything published here belongs to its author. Quote briefly with a link; ask before
republishing in full.

## Comments

Be civil. Comments may be moderated, and spam is deleted without notice.

This page is a starting point, not legal advice — replace it with your own terms.`,
  },
] as const;

const STARTER_CATEGORIES = [
  { name: 'Essays', slug: 'essays', color: '#206bea', description: 'Longer pieces with an argument.' },
  { name: 'Field Notes', slug: 'field-notes', color: '#1f7a53', description: 'Short observations from the week.' },
  { name: 'Interviews', slug: 'interviews', color: '#7c3aed', description: 'Conversations with people who make things.' },
];

/**
 * Menus, starter pages, a starter category and one welcome story.
 * Idempotent: each block only runs when that kind of content is completely absent,
 * so it never fights with real content on later boots.
 */
export async function ensureStarterContent(adminId: number, client?: DbClient): Promise<boolean> {
  const db = client ?? (await getDb());
  let created = false;

  if ((await one(db, 'SELECT COUNT(*) AS total FROM menu_items')) === 0) {
    for (const item of DEFAULT_MENU) {
      await db.execute('INSERT INTO menu_items (location, label, url, sort_order) VALUES (?, ?, ?, ?)', [
        item.location,
        item.label,
        item.url,
        item.sort_order,
      ]);
    }
    created = true;
  }

  if ((await one(db, `SELECT COUNT(*) AS total FROM posts WHERE type = 'page'`)) === 0) {
    for (const page of STARTER_PAGES) {
      await db.execute(
        `INSERT INTO posts (type, title, slug, excerpt, content, status, author_id, template, published_at, created_at, updated_at)
         VALUES ('page', ?, ?, ?, ?, 'published', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [page.title, page.slug, page.excerpt, page.content, adminId, page.template],
      );
    }
    created = true;
  }

  let categoryId: number | null = null;
  if ((await one(db, 'SELECT COUNT(*) AS total FROM categories')) === 0) {
    for (const [index, category] of STARTER_CATEGORIES.entries()) {
      const id = await db.insert(
        `INSERT INTO categories (name, slug, description, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [category.name, category.slug, category.description, category.color, index],
      );
      if (index === 0) categoryId = id;
    }
    created = true;
  }

  if ((await one(db, `SELECT COUNT(*) AS total FROM posts WHERE type = 'post'`)) === 0) {
    if (!categoryId) {
      const rows = await db.query<{ id: number }>('SELECT id FROM categories ORDER BY sort_order, id LIMIT 1');
      categoryId = rows[0] ? Number(rows[0].id) : null;
    }
    const title = 'Welcome — this is your first story';
    const slug = 'welcome';
    const excerpt = 'A first post, ready to edit. Delete it and write something better.';
    const content = [
      'This is your first story. It exists so the home page is not empty on day one — edit it, publish it, or delete it.',
      '',
      '## How publishing works',
      '',
      '- Write in **Studio → Stories** with the Markdown editor and a live preview.',
      '- Set a status: draft, scheduled, published or private.',
      '- Add categories, tags, a featured image and an excerpt.',
      '- Rename the slug and an old-link redirect is created for you.',
      '',
      '## Make it yours',
      '',
      'Everything the reader sees — the accent colour, the wordmark, the home page layout,',
      'the menus, the footer text — lives in **Studio → Appearance** and **Studio → Settings**.',
      '',
      '> Delete this post when you have something truer to say.',
    ].join('\n');

    const postId = await db.insert(
      `INSERT INTO posts (type, title, slug, excerpt, content, status, author_id, is_sticky, published_at, created_at, updated_at)
       VALUES ('post', ?, ?, ?, ?, 'published', ?, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [title, slug, excerpt, content, adminId],
    );
    if (categoryId) {
      await db.execute('INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)', [postId, categoryId]);
    }
    created = true;
  }

  return created;
}

/* ------------------------------------------------------------------ */
/* one-shot bootstrap used by the server and `npm run db:setup`        */
/* ------------------------------------------------------------------ */

export async function runBootstrap(client?: DbClient): Promise<BootstrapReport> {
  const db = client ?? (await getDb());

  // 1. Tables, settings, schema version — always idempotent.
  const { tables } = await migrate(db);

  // 2. Demo publication, if explicitly requested. It creates its own users.
  let demoSeeded = false;
  const userCount = await one(db, 'SELECT COUNT(*) AS total FROM users');
  if (config.setup.seedDemo && userCount === 0) {
    const { runSeed } = await import('./seed.js');
    await runSeed({ force: true }, db);
    demoSeeded = true;
  }

  // 3. Super admin from .env (optional — the browser wizard can do it instead).
  const createdAdmin = demoSeeded ? null : await ensureAdminFromEnv(db);

  // 4. Starter content, once there is an admin to attribute it to.
  let createdContent = false;
  const admins = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`,
  );
  if (admins[0] && !config.setup.seedDemo && !demoSeeded) {
    createdContent = await ensureStarterContent(Number(admins[0].id), db);
  }

  const state = await getSetupState(db);
  return {
    tables,
    createdAdmin,
    createdContent,
    demoSeeded,
    installed: state.ready,
  };
}
