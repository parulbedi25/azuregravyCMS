import { Router } from 'express';
import { asyncRoute, idParam, setFlash } from '../../lib/http.js';
import { requireRole } from '../../lib/auth.js';
import { loadSettings, saveSettings, settingFrom } from '../../lib/settings.js';
import { invalidateNavigation } from '../../services/navigation.js';
import { listCategories } from '../../services/posts.js';
import { getDb } from '../../db/index.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { readingTime, slugify } from '../../lib/text.js';
import {
  DEFAULT_PERMALINK_STRUCTURE, PERMALINK_PRESETS, PERMALINK_TOKENS, RESERVED_SLUGS,
  buildPostPath, isReservedSlug, normalizeStructure, postListPath, structureFrom,
} from '../../lib/permalink.js';
import { str } from '../helpers.js';
import { config } from '../../config.js';
import { recentActivity } from '../../services/activity.js';
import { logActivity } from '../../services/activity.js';

const router = Router();

const SETTING_GROUPS: Record<string, string[]> = {
  general: ['site_title', 'site_tagline', 'site_description', 'site_url', 'contact_email', 'timezone', 'date_format'],
  appearance: ['logo_text', 'logo_mark', 'accent_color', 'default_theme', 'homepage_layout', 'homepage_featured_count', 'spotlight_category', 'auto_load_next', 'before_you_go'],
  reading: ['posts_per_page', 'show_reading_time', 'show_author_box', 'show_related_posts', 'show_toc'],
  discussion: ['allow_comments', 'comment_moderation', 'comment_notify_email'],
  newsletter: ['newsletter_enabled', 'newsletter_heading', 'newsletter_text'],
  seo: ['seo_default_image', 'analytics_snippet'],
  social: ['social_twitter', 'social_instagram', 'social_linkedin', 'social_youtube', 'footer_about', 'footer_copyright'],
};

router.get(
  '/settings',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const settings = await loadSettings(true);
    res.render('admin/settings', {
      layout: 'layouts/admin',
      title: 'Settings',
      adminTitle: 'Settings',
      adminDescription: 'The knobs and dials behind the publication.',
      page: 'settings',
      settings,
      tab: typeof req.query.tab === 'string' ? req.query.tab : 'general',
      groups: SETTING_GROUPS,
    });
  }),
);

router.post(
  '/settings',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const tab = str(req.body.tab, 'general');
    const keys = SETTING_GROUPS[tab] ?? SETTING_GROUPS.general;
    const values: Record<string, string> = {};
    for (const key of keys) {
      const raw = req.body[key];
      if (raw === undefined) {
        values[key] = '0';
      } else if (Array.isArray(raw)) {
        values[key] = raw.join(',');
      } else {
        values[key] = String(raw).trim();
      }
    }
    await saveSettings(values);
    invalidateNavigation();
    await logActivity(res.locals.currentUser.id, 'settings', `Updated ${tab} settings`);
    setFlash(req, 'success', 'Settings saved.');
    res.redirect(`/admin/settings?tab=${tab}`);
  }),
);

/* ------------------------------------------------------------ appearance */
router.get(
  '/appearance',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const settings = await loadSettings(true);
    res.render('admin/appearance', {
      layout: 'layouts/admin',
      title: 'Appearance',
      adminTitle: 'Appearance',
      adminDescription: 'Type, colour and the shape of the front page.',
      page: 'appearance',
      settings,
      categories: (await listCategories({ withCounts: true })).filter((category) => (category.post_count ?? 0) > 0),
      presets: [
        { name: 'Blue', value: '#206bea' },
        { name: 'Ink', value: '#1d1d1f' },
        { name: 'Sky', value: '#0a84ff' },
        { name: 'Forest', value: '#1f7a53' },
        { name: 'Plum', value: '#7c3aed' },
        { name: 'Rose', value: '#be185d' },
      ],
    });
  }),
);

router.post(
  '/appearance',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    await saveSettings({
      logo_text: str(req.body.logo_text, 'Gravy'),
      accent_color: str(req.body.accent_color, '#206bea'),
      default_theme: str(req.body.default_theme, 'light'),
      homepage_layout: str(req.body.homepage_layout, 'editorial'),
      homepage_featured_count: str(req.body.homepage_featured_count, '1'),
      spotlight_category: str(req.body.spotlight_category, ''),
      auto_load_next: req.body.auto_load_next ? '1' : '0',
      before_you_go: req.body.before_you_go ? '1' : '0',
      posts_per_page: str(req.body.posts_per_page, '9'),
      show_reading_time: req.body.show_reading_time ? '1' : '0',
      show_author_box: req.body.show_author_box ? '1' : '0',
      show_related_posts: req.body.show_related_posts ? '1' : '0',
      show_toc: req.body.show_toc ? '1' : '0',
    });
    invalidateNavigation();
    setFlash(req, 'success', 'Appearance updated.');
    res.redirect('/admin/appearance');
  }),
);

/* ----------------------------------------------------------------- menus */
router.get(
  '/menus',
  requireRole('editor'),
  asyncRoute(async (_req, res) => {
    const db = await getDb();
    const items = await db.query<{
      id: number; location: string; label: string; url: string; sort_order: number; is_active: number; target: string;
    }>('SELECT * FROM menu_items ORDER BY location, sort_order, id');
    res.render('admin/menus', {
      layout: 'layouts/admin',
      title: 'Navigation',
      adminTitle: 'Navigation',
      adminDescription: 'What appears in the header, footer and legal row.',
      page: 'menus',
      items,
      locations: ['primary', 'footer', 'legal'],
    });
  }),
);

router.post(
  '/menus',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    const label = str(req.body.label);
    const url = str(req.body.url, '/');
    if (!label) {
      setFlash(req, 'error', 'A menu link needs a label.');
      return res.redirect('/admin/menus');
    }
    await (await getDb()).execute(
      'INSERT INTO menu_items (location, label, url, sort_order, is_active, target) VALUES (?, ?, ?, ?, ?, ?)',
      [
        str(req.body.location, 'primary'),
        label.slice(0, 120),
        url,
        Number(req.body.sort_order) || 0,
        req.body.is_active ? 1 : 0,
        str(req.body.target, '_self'),
      ],
    );
    invalidateNavigation();
    setFlash(req, 'success', 'Link added.');
    res.redirect('/admin/menus');
  }),
);

router.post(
  '/menus/:id',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    await (await getDb()).execute(
      'UPDATE menu_items SET label = ?, url = ?, location = ?, sort_order = ?, is_active = ?, target = ? WHERE id = ?',
      [
        str(req.body.label, 'Link').slice(0, 120),
        str(req.body.url, '/'),
        str(req.body.location, 'primary'),
        Number(req.body.sort_order) || 0,
        req.body.is_active ? 1 : 0,
        str(req.body.target, '_self'),
        idParam(req.params.id),
      ],
    );
    invalidateNavigation();
    setFlash(req, 'success', 'Link updated.');
    res.redirect('/admin/menus');
  }),
);

router.post(
  '/menus/:id/delete',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    await (await getDb()).execute('DELETE FROM menu_items WHERE id = ?', [idParam(req.params.id)]);
    invalidateNavigation();
    setFlash(req, 'success', 'Link removed.');
    res.redirect('/admin/menus');
  }),
);

/* ------------------------------------------------------------- redirects */
router.get(
  '/redirects',
  requireRole('editor'),
  asyncRoute(async (_req, res) => {
    const redirects = await (await getDb()).query<{
      id: number; from_path: string; to_path: string; status_code: number; hits: number; created_at: string;
    }>('SELECT * FROM redirects ORDER BY created_at DESC LIMIT 100');
    res.render('admin/redirects', {
      layout: 'layouts/admin',
      title: 'Redirects',
      adminTitle: 'Redirects',
      adminDescription: 'Keep old links working when a post moves.',
      page: 'redirects',
      redirects,
    });
  }),
);

router.post(
  '/redirects',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    const from = ensureLeadingSlash(str(req.body.from_path));
    const to = str(req.body.to_path);
    if (!from || !to) {
      setFlash(req, 'error', 'Both the old and new paths are required.');
      return res.redirect('/admin/redirects');
    }
    await (await getDb()).execute(
      `INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE to_path = VALUES(to_path), status_code = VALUES(status_code)`,
      [from, to, Number(req.body.status_code) === 302 ? 302 : 301],
    );
    setFlash(req, 'success', 'Redirect saved.');
    res.redirect('/admin/redirects');
  }),
);

router.post(
  '/redirects/:id/delete',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    await (await getDb()).execute('DELETE FROM redirects WHERE id = ?', [idParam(req.params.id)]);
    setFlash(req, 'success', 'Redirect deleted.');
    res.redirect('/admin/redirects');
  }),
);

/* ----------------------------------------------------------- permalinks */

/**
 * Move every published post's old URL to its new one when the structure changes.
 *
 * Returns the number of redirects written plus any slugs that the new structure
 * would make unreachable, so the caller can warn instead of silently stranding
 * a post. Drafts are skipped: their old URL was never public, so there is
 * nothing to preserve.
 */
async function migratePermalinks(previous: string, next: string) {
  const db = await getDb();
  const rows = await db.query<{
    id: number; slug: string; type: string; published_at: string | null;
    created_at: string; category_slugs: string | null;
  }>(
    `SELECT p.id, p.slug, p.type, p.published_at, p.created_at,
            (SELECT GROUP_CONCAT(c.slug ORDER BY c.sort_order SEPARATOR '||')
               FROM categories c JOIN post_categories pc ON pc.category_id = c.id
              WHERE pc.post_id = p.id) AS category_slugs
       FROM posts p
      WHERE p.type = 'post' AND p.status = 'published'`,
  );

  const upsert = async (from: string, to: string) => {
    await db.execute(
      `INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, 301)
       ON DUPLICATE KEY UPDATE to_path = VALUES(to_path), status_code = 301`,
      [from, to],
    );
    /*
      Collapse chains. An earlier migration may have left rows pointing *at* the
      path we are now moving, so without this a visitor who bookmarked the
      original URL follows one 301 per structure change, forever. Repointing
      them keeps it at a single hop.

      The `from_path <> ?` guard is load-bearing: without it a pre-existing row
      shaped `to -> from` would be rewritten into `to -> to`, a self-redirect
      that loops until the browser gives up.
    */
    await db.execute(
      'UPDATE redirects SET to_path = ? WHERE to_path = ? AND from_path <> ?',
      [to, from, to],
    );
  };

  let created = 0;
  const previousList = postListPath(previous);
  const nextList = postListPath(next);
  if (previousList !== nextList) {
    await upsert(previousList, nextList);
    created += 1;
  }

  const conflicts: string[] = [];
  for (const row of rows) {
    const post = { ...row, category_slug: String(row.category_slugs ?? '').split('||')[0] || null };
    const from = buildPostPath(post, previous);
    const to = buildPostPath(post, next);
    if (isReservedSlug(post.slug, next)) conflicts.push(post.slug);
    if (from === to) continue;
    await upsert(from, to);
    created += 1;
  }

  return { created, conflicts, total: rows.length };
}

router.get(
  '/permalinks',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const settings = await loadSettings(true);
    const structure = structureFrom(settings);
    const db = await getDb();
    /*
      Real posts rather than a made-up example: an administrator deciding
      between structures should see what happens to the URLs they already have,
      including a category segment or a publish date that a synthetic sample
      would not exercise.
    */
    const samples = await db.query<{
      id: number; slug: string; title: string; type: string; published_at: string | null;
      created_at: string; category_slugs: string | null;
    }>(
      `SELECT p.id, p.slug, p.title, p.type, p.published_at, p.created_at,
              (SELECT GROUP_CONCAT(c.slug ORDER BY c.sort_order SEPARATOR '||')
                 FROM categories c JOIN post_categories pc ON pc.category_id = c.id
                WHERE pc.post_id = p.id) AS category_slugs
         FROM posts p
        WHERE p.type = 'post' AND p.status = 'published'
        ORDER BY p.published_at DESC LIMIT 5`,
    );

    const preview = samples.map((row) => {
      const post = { ...row, category_slug: String(row.category_slugs ?? '').split('||')[0] || null };
      return {
        title: row.title,
        url: buildPostPath(post, structure),
        reserved: isReservedSlug(row.slug, structure),
      };
    });

    res.render('admin/permalinks', {
      layout: 'layouts/admin',
      title: 'Permalinks',
      adminTitle: 'Permalinks',
      adminDescription: 'The shape of every post URL — shorten it, extend it, or write your own.',
      page: 'permalinks',
      structure,
      defaultStructure: DEFAULT_PERMALINK_STRUCTURE,
      presets: PERMALINK_PRESETS,
      tokens: PERMALINK_TOKENS,
      isPreset: PERMALINK_PRESETS.some((preset) => preset.structure === structure),
      listPath: postListPath(structure),
      isShort: structure.split('/').filter(Boolean).length === 1,
      reservedSlugs: RESERVED_SLUGS,
      preview: preview.length
        ? preview
        : [{ title: 'How we ship', url: buildPostPath({ slug: 'how-we-ship', type: 'post' }, structure), reserved: false }],
      postCount: samples.length,
    });
  }),
);

router.post(
  '/permalinks',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const previous = structureFrom(await loadSettings(true));
    /*
      The preset radios submit their structure directly. "Custom" submits the
      literal word `custom` and the real template arrives in its own field, so
      the page works with JavaScript disabled — there is no client-side copying
      of one input into another to get out of sync.
    */
    const choice = typeof req.body.permalink_structure === 'string' ? req.body.permalink_structure.trim() : '';
    const submitted = choice === 'custom' ? String(req.body.custom_structure ?? '') : choice;
    const { structure, error } = normalizeStructure(submitted);

    if (error) {
      setFlash(req, 'error', error);
      return res.redirect('/admin/permalinks');
    }

    if (structure === previous) {
      setFlash(req, 'success', 'That structure was already in use — nothing changed.');
      return res.redirect('/admin/permalinks');
    }

    await saveSettings({ permalink_structure: structure });
    invalidateNavigation();
    const migration = await migratePermalinks(previous, structure);

    const user = res.locals.currentUser;
    if (user) await logActivity(user.id, 'updated', `Permalink structure: ${structure}`);

    setFlash(
      req,
      'success',
      `URL structure saved as ${structure}. ${migration.created} redirect${migration.created === 1 ? '' : 's'} created so old links keep working.`,
    );
    if (migration.conflicts.length) {
      setFlash(
        req,
        'error',
        `${migration.conflicts.length} slug${migration.conflicts.length === 1 ? '' : 's'} now sit${migration.conflicts.length === 1 ? 's' : ''} on a built-in route and cannot be reached: ${migration.conflicts.slice(0, 6).join(', ')}. Rename ${migration.conflicts.length === 1 ? 'it' : 'them'}, or use a structure with a base segment.`,
      );
    }
    res.redirect('/admin/permalinks');
  }),
);

/* ----------------------------------------------------------------- tools */
router.get(
  '/tools',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const db = await getDb();
    const counts = await db.query<{
      posts: number; pages: number; comments: number; media: number; users: number; subscribers: number; sessions: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM posts WHERE type = 'post') AS posts,
        (SELECT COUNT(*) FROM posts WHERE type = 'page') AS pages,
        (SELECT COUNT(*) FROM comments) AS comments,
        (SELECT COUNT(*) FROM media) AS media,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM subscribers) AS subscribers,
        (SELECT COUNT(*) FROM sessions) AS sessions`,
    );
    const version = await db.query<{ version: string; database_name: string }>('SELECT VERSION() AS version, DATABASE() AS database_name');
    const activity = await recentActivity(20);
    res.render('admin/tools', {
      layout: 'layouts/admin',
      title: 'System',
      adminTitle: 'System',
      adminDescription: 'Database, housekeeping and the activity log.',
      page: 'tools',
      counts: counts[0] ?? {},
      dbInfo: {
        driver: config.db.driver,
        version: version[0]?.version ?? 'MariaDB',
        database: version[0]?.database_name ?? config.db.database,
        location: config.db.driver === 'embedded' ? config.db.dataDir : `${config.db.host}:${config.db.port}`,
        engine: config.db.driver === 'embedded' ? 'Embedded MariaDB (WebAssembly)' : 'MariaDB server (mysql protocol)',
      },
      activity,
    });
  }),
);

router.post(
  '/tools/prune-sessions',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const result = await (await getDb()).execute('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
    setFlash(req, 'success', `${result.affected} expired session${result.affected === 1 ? '' : 's'} cleared.`);
    res.redirect('/admin/tools');
  }),
);

router.post(
  '/tools/rebuild-content',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const db = await getDb();
    const posts = await db.query<{ id: number; content: string }>('SELECT id, content FROM posts');
    for (const post of posts) {
      const { html } = renderMarkdown(post.content);
      await db.execute('UPDATE posts SET content_html = ?, reading_time = ? WHERE id = ?', [
        html, readingTime(post.content), post.id,
      ]);
    }
    setFlash(req, 'success', `Rebuilt rendered HTML for ${posts.length} entries.`);
    res.redirect('/admin/tools');
  }),
);

router.post(
  '/tools/auto-redirects',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const db = await getDb();
    /*
      Selects the fields buildPostPath needs, not just the slug: under a
      date- or category-based structure the old and new URLs both carry those
      segments, and a row without them would produce a `from_path` that never
      matched a real request.
    */
    const structure = structureFrom(await loadSettings(true));
    const posts = await db.query<{
      id: number; slug: string; title: string; type: string;
      published_at: string | null; created_at: string; category_slugs: string | null;
    }>(
      `SELECT p.id, p.slug, p.title, p.type, p.published_at, p.created_at,
              (SELECT GROUP_CONCAT(c.slug ORDER BY c.sort_order SEPARATOR '||')
                 FROM categories c JOIN post_categories pc ON pc.category_id = c.id
                WHERE pc.post_id = p.id) AS category_slugs
         FROM posts p`,
    );
    let created = 0;
    for (const row of posts) {
      const desired = slugify(row.title);
      if (desired && desired !== row.slug) {
        const post = { ...row, category_slug: String(row.category_slugs ?? '').split('||')[0] || null };
        const from = buildPostPath(post, structure);
        const to = buildPostPath({ ...post, slug: desired }, structure);
        const exists = await db.query<{ id: number }>('SELECT id FROM redirects WHERE from_path = ?', [from]);
        if (!exists.length) {
          await db.execute('INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, 301)', [from, to]);
          created += 1;
        }
      }
    }
    setFlash(req, 'success', created ? `${created} redirect${created === 1 ? '' : 's'} created from titles.` : 'No redirects were needed.');
    res.redirect('/admin/tools');
  }),
);

router.post(
  '/tools/export',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const db = await getDb();
    /*
      The export is a plain JSON download that leaves the server, so the AI
      provider key is replaced rather than copied. Every other setting is
      needed to restore a site; a secret is not, and re-entering one key is
      a far smaller cost than leaking it into someone's downloads folder.
    */
    const allSettings = await loadSettings(true);
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: { ...allSettings, ai_api_key: allSettings.ai_api_key ? '[redacted]' : '' },
      users: (await db.query('SELECT id, name, email, role, bio, created_at FROM users')).map((row) => row),
      categories: await db.query('SELECT * FROM categories'),
      tags: await db.query('SELECT * FROM tags'),
      posts: await db.query(
        `SELECT p.*, GROUP_CONCAT(DISTINCT pc.category_id) AS category_ids
           FROM posts p LEFT JOIN post_categories pc ON pc.post_id = p.id
          GROUP BY p.id`,
      ),
      comments: await db.query('SELECT * FROM comments'),
      media: await db.query('SELECT * FROM media'),
      subscribers: await db.query('SELECT email, name, status, created_at FROM subscribers'),
    };
    res.type('application/json').attachment(`gravy-export-${new Date().toISOString().slice(0, 10)}.json`).send(JSON.stringify(payload, null, 2));
  }),
);

function ensureLeadingSlash(value: string): string {
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

/* Keep the unused import honest for TypeScript. */
void settingFrom;

export default router;
