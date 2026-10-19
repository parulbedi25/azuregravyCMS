import { Router } from 'express';
import { asyncRoute, setFlash } from '../../lib/http.js';
import { requireRole } from '../../lib/auth.js';
import { loadSettings, saveSettings, settingFrom } from '../../lib/settings.js';
import { invalidateNavigation } from '../../services/navigation.js';
import { getDb } from '../../db/index.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { readingTime, slugify } from '../../lib/text.js';
import { str } from '../helpers.js';
import { config } from '../../config.js';
import { recentActivity } from '../../services/activity.js';
import { logActivity } from '../../services/activity.js';

const router = Router();

const SETTING_GROUPS: Record<string, string[]> = {
  general: ['site_title', 'site_tagline', 'site_description', 'site_url', 'contact_email', 'timezone', 'date_format'],
  appearance: ['logo_text', 'logo_mark', 'accent_color', 'default_theme', 'homepage_layout', 'homepage_featured_count'],
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
      presets: [
        { name: 'Blue', value: '#0071e3' },
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
      logo_text: str(req.body.logo_text, 'Azure Gravy'),
      accent_color: str(req.body.accent_color, '#0071e3'),
      default_theme: str(req.body.default_theme, 'light'),
      homepage_layout: str(req.body.homepage_layout, 'editorial'),
      homepage_featured_count: str(req.body.homepage_featured_count, '1'),
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
        Number(req.params.id),
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
    await (await getDb()).execute('DELETE FROM menu_items WHERE id = ?', [Number(req.params.id)]);
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
      adminDescription: 'Keep old links working when a story moves.',
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
    await (await getDb()).execute('DELETE FROM redirects WHERE id = ?', [Number(req.params.id)]);
    setFlash(req, 'success', 'Redirect deleted.');
    res.redirect('/admin/redirects');
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
    const posts = await db.query<{ slug: string; title: string; type: string }>('SELECT slug, title, type FROM posts');
    let created = 0;
    for (const post of posts) {
      const desired = slugify(post.title);
      if (desired && desired !== post.slug) {
        const from = post.type === 'page' ? `/${post.slug}` : `/stories/${post.slug}`;
        const to = post.type === 'page' ? `/${desired}` : `/stories/${desired}`;
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
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: await loadSettings(true),
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
