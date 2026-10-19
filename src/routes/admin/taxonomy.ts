import { Router } from 'express';
import { asyncRoute, setFlash } from '../../lib/http.js';
import { requireRole } from '../../lib/auth.js';
import { slugify } from '../../lib/text.js';
import { str } from '../helpers.js';
import { getDb } from '../../db/index.js';
import { listCategories, listTags } from '../../services/posts.js';
import { invalidateNavigation } from '../../services/navigation.js';
import { logActivity } from '../../services/activity.js';

const router = Router();

/* ------------------------------------------------------------ categories */
router.get(
  '/categories',
  asyncRoute(async (_req, res) => {
    const categories = await listCategories({ withCounts: true });
    const db = await getDb();
    const options = await db.query<{ id: number; name: string }>('SELECT id, name FROM categories ORDER BY name');
    res.render('admin/categories', {
      layout: 'layouts/admin',
      title: 'Categories',
      adminTitle: 'Categories',
      adminDescription: 'Organise stories into the sections readers browse.',
      page: 'categories',
      categories,
      options,
    });
  }),
);

router.post(
  '/categories',
  asyncRoute(async (req, res) => {
    const name = str(req.body.name);
    if (!name) {
      setFlash(req, 'error', 'A category needs a name.');
      return res.redirect('/admin/categories');
    }
    const slug = slugify(str(req.body.slug) || name);
    const db = await getDb();
    await db.execute(
      `INSERT INTO categories (name, slug, description, parent_id, color, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name.slice(0, 120),
        slug,
        str(req.body.description) || null,
        Number(req.body.parent_id) || null,
        str(req.body.color, '#2f5bd7'),
        Number(req.body.sort_order) || 0,
      ],
    );
    invalidateNavigation();
    await logActivity(res.locals.currentUser.id, 'category:created', name);
    setFlash(req, 'success', 'Category created.');
    res.redirect('/admin/categories');
  }),
);

router.post(
  '/categories/:id',
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const name = str(req.body.name);
    if (!name) {
      setFlash(req, 'error', 'A category needs a name.');
      return res.redirect('/admin/categories');
    }
    const db = await getDb();
    const parentId = Number(req.body.parent_id) || null;
    await db.execute(
      `UPDATE categories SET name = ?, slug = ?, description = ?, parent_id = ?, color = ?, sort_order = ?, image = ?
       WHERE id = ?`,
      [
        name.slice(0, 120),
        slugify(str(req.body.slug) || name),
        str(req.body.description) || null,
        parentId === id ? null : parentId,
        str(req.body.color, '#2f5bd7'),
        Number(req.body.sort_order) || 0,
        str(req.body.image) || null,
        id,
      ],
    );
    invalidateNavigation();
    await logActivity(res.locals.currentUser.id, 'category:updated', name);
    setFlash(req, 'success', 'Category updated.');
    res.redirect('/admin/categories');
  }),
);

router.post(
  '/categories/:id/delete',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    const db = await getDb();
    await db.execute('DELETE FROM categories WHERE id = ?', [Number(req.params.id)]);
    invalidateNavigation();
    setFlash(req, 'success', 'Category deleted. Stories were kept.');
    res.redirect('/admin/categories');
  }),
);

/* ------------------------------------------------------------------ tags */
router.get(
  '/tags',
  asyncRoute(async (_req, res) => {
    const tags = await listTags(true);
    res.render('admin/tags', {
      layout: 'layouts/admin',
      title: 'Tags',
      adminTitle: 'Tags',
      adminDescription: 'Loose threads that tie stories together.',
      page: 'tags',
      tags,
    });
  }),
);

router.post(
  '/tags',
  asyncRoute(async (req, res) => {
    const name = str(req.body.name);
    if (!name) {
      setFlash(req, 'error', 'A tag needs a name.');
      return res.redirect('/admin/tags');
    }
    await (await getDb()).execute(
      'INSERT INTO tags (name, slug, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
      [name.slice(0, 120), slugify(str(req.body.slug) || name), str(req.body.description) || null],
    );
    setFlash(req, 'success', 'Tag created.');
    res.redirect('/admin/tags');
  }),
);

router.post(
  '/tags/:id',
  asyncRoute(async (req, res) => {
    const name = str(req.body.name);
    if (!name) {
      setFlash(req, 'error', 'A tag needs a name.');
      return res.redirect('/admin/tags');
    }
    await (await getDb()).execute('UPDATE tags SET name = ?, slug = ?, description = ? WHERE id = ?', [
      name.slice(0, 120),
      slugify(str(req.body.slug) || name),
      str(req.body.description) || null,
      Number(req.params.id),
    ]);
    setFlash(req, 'success', 'Tag updated.');
    res.redirect('/admin/tags');
  }),
);

router.post(
  '/tags/:id/delete',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    await (await getDb()).execute('DELETE FROM tags WHERE id = ?', [Number(req.params.id)]);
    setFlash(req, 'success', 'Tag deleted.');
    res.redirect('/admin/tags');
  }),
);

export default router;
