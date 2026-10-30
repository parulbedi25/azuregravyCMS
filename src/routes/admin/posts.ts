import { Router } from 'express';
import { asyncRoute, idParam, pageParam, paginate, setFlash } from '../../lib/http.js';
import { canEditPost, roleAtLeast } from '../../lib/auth.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { parseIds, parseTags, str } from '../helpers.js';
import {
  createPost, getPostById, listPosts, permanentlyDeletePost, restorePost, saveRevision,
  setPostStatus, trashPost, updatePost,
} from '../../services/posts.js';
import { listCategories, listTags } from '../../services/posts.js';
import { listMedia } from '../../services/media.js';
import { listUsers } from '../../services/users.js';
import { logActivity } from '../../services/activity.js';
import { getDb } from '../../db/index.js';
import type { Post, PostStatus, PostType } from '../../types.js';

const router = Router();

const STATUS_TABS = [
  { key: 'all', label: 'All', statuses: undefined as PostStatus[] | undefined },
  { key: 'published', label: 'Published', statuses: ['published' as PostStatus] },
  { key: 'draft', label: 'Drafts', statuses: ['draft' as PostStatus] },
  { key: 'scheduled', label: 'Scheduled', statuses: ['scheduled' as PostStatus] },
  { key: 'trash', label: 'Trash', statuses: ['trash' as PostStatus] },
];

async function loadEditorPage(
  req: Parameters<Parameters<typeof router.get>[1]>[0],
  res: Parameters<Parameters<typeof router.get>[1]>[1],
  post: Post | null,
  type: PostType,
) {
  const [categories, tags, users, media] = await Promise.all([
    listCategories({ withCounts: true }),
    listTags(false),
    listUsers(),
    listMedia({ perPage: 48 }),
  ]);
  const revisions = post
    ? await (await getDb()).query<{ id: number; created_at: string; title: string }>(
        'SELECT id, created_at, title FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 8',
        [post.id],
      )
    : [];

  res.render('admin/editor', {
    layout: 'layouts/admin',
    title: post ? `Edit: ${post.title}` : type === 'page' ? 'New page' : 'New post',
    adminTitle: post ? 'Edit' : 'Create',
    page: 'posts',
    post,
    type,
    categories,
    tags,
    users,
    media: media.media,
    revisions,
    statusTabs: STATUS_TABS,
    // Mirrors the list route: only editors and above may erase content for good.
    canDelete: roleAtLeast(res.locals.currentUser.role, 'editor'),
  });
}

/* ------------------------------------------------------------------ list */
router.get(
  '/posts',
  asyncRoute(async (req, res) => {
    const type = (req.query.type === 'page' ? 'page' : 'post') as PostType;
    const statusKey = typeof req.query.status === 'string' ? req.query.status : 'all';
    const tab = STATUS_TABS.find((item) => item.key === statusKey) ?? STATUS_TABS[0];
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const authorId = Number.parseInt(String(req.query.author ?? ''), 10);
    const sort = (typeof req.query.sort === 'string' ? req.query.sort : 'newest') as 'newest' | 'updated' | 'popular' | 'title';
    const page = pageParam(req.query.page);

    const user = res.locals.currentUser;
    const { posts, total } = await listPosts({
      type,
      // "All" means every *active* status. Trashed content is deliberately
      // excluded here so a deleted post disappears from the list it was in
      // and can only be reached through the Trash tab.
      statuses: tab.statuses ?? ['published', 'draft', 'scheduled', 'private'],
      search: search || undefined,
      category: category || undefined,
      authorId: Number.isFinite(authorId) ? authorId : undefined,
      page,
      perPage: 20,
      sort,
    });

    const visible = roleAtLeast(user.role, 'editor') ? posts : posts.filter((post) => post.author_id === user.id);
    const pagination = paginate(total, page, 20);
    const categories = await listCategories({ withCounts: true });
    const users = await listUsers();

    const counts = await (await getDb()).query<{ status: string; total: number }>(
      'SELECT status, COUNT(*) AS total FROM posts WHERE type = ? GROUP BY status',
      [type],
    );
    const statusCounts: Record<string, number> = { all: 0 };
    for (const row of counts) {
      statusCounts[row.status] = Number(row.total);
      // Mirror the list query above: the "All" badge counts active content
      // only, so the number matches what the tab actually shows.
      if (row.status !== 'trash') statusCounts.all += Number(row.total);
    }

    res.render('admin/posts', {
      layout: 'layouts/admin',
      title: type === 'page' ? 'Pages' : 'Posts',
      adminTitle: type === 'page' ? 'Pages' : 'Posts',
      page: type === 'page' ? 'pages' : 'posts',
      type,
      posts: visible,
      total,
      pagination,
      categories,
      users,
      statusTabs: STATUS_TABS,
      statusCounts,
      activeStatus: tab.key,
      filters: { q: search, category, author: Number.isFinite(authorId) ? authorId : '', sort, status: tab.key },
      canDelete: roleAtLeast(user.role, 'editor'),
    });
  }),
);

router.get('/pages', (req, res) => res.redirect('/admin/posts?type=page'));

/* ---------------------------------------------------------------- editor */
router.get(
  '/posts/new',
  asyncRoute(async (req, res) => {
    const type = (req.query.type === 'page' ? 'page' : 'post') as PostType;
    const from = Number.parseInt(String(req.query.from ?? ''), 10);
    let post: Post | null = null;
    if (Number.isFinite(from)) {
      const source = await getPostById(from);
      if (source && canEditPost(res.locals.currentUser, source)) {
        post = { ...source, id: 0, title: `${source.title} (copy)`, slug: '', status: 'draft' } as Post;
      }
    }
    await loadEditorPage(req, res, post, type);
  }),
);

router.post(
  '/api/preview',
  asyncRoute(async (req, res) => {
    const { html } = renderMarkdown(String(req.body.markdown ?? ''));
    res.json({ html });
  }),
);

router.post(
  '/posts',
  asyncRoute(async (req, res) => {
    const user = res.locals.currentUser;
    const type = (req.body.type === 'page' ? 'page' : 'post') as PostType;
    const title = str(req.body.title);
    if (!title) {
      setFlash(req, 'error', 'A title is required before saving.');
      return res.redirect(`/admin/posts/new?type=${type}`);
    }

    const status = normaliseStatus(str(req.body.status, 'draft'));
    const categoryIds = parseIds(req.body.categories);
    const tags = parseTags(req.body.tags);

    const id = await createPost({
      type,
      title,
      slug: str(req.body.slug) || null,
      content: String(req.body.content ?? ''),
      excerpt: str(req.body.excerpt) || null,
      status,
      author_id: Number(req.body.author_id) || user.id,
      featured_image_id: Number(req.body.featured_image_id) || null,
      og_image_id: Number(req.body.og_image_id) || null,
      is_sticky: req.body.is_sticky === 'on' || req.body.is_sticky === '1',
      allow_comments: req.body.allow_comments === 'on' || req.body.allow_comments === '1',
      seo_title: str(req.body.seo_title) || null,
      seo_description: str(req.body.seo_description) || null,
      published_at: str(req.body.published_at) || null,
      template: str(req.body.template, 'default'),
      categoryIds,
      tags,
    });

    await logActivity(user.id, 'created', `${type === 'page' ? 'Page' : 'Post'}: ${title}`);
    setFlash(req, 'success', status === 'published' ? 'Published. Nicely done.' : `Saved as ${status}.`);
    res.redirect(`/admin/posts/${id}/edit`);
  }),
);

router.get(
  '/posts/:id/edit',
  asyncRoute(async (req, res, next) => {
    const post = await getPostById(Number(req.params.id));
    if (!post) return next();
    if (!canEditPost(res.locals.currentUser, post)) {
      setFlash(req, 'error', 'You can only edit your own posts.');
      return res.redirect('/admin/posts');
    }
    await loadEditorPage(req, res, post, post.type);
  }),
);

router.post(
  '/posts/:id',
  asyncRoute(async (req, res, next) => {
    const existing = await getPostById(Number(req.params.id));
    if (!existing) return next();
    if (!canEditPost(res.locals.currentUser, existing)) {
      setFlash(req, 'error', 'You can only edit your own posts.');
      return res.redirect('/admin/posts');
    }
    const intent = str(req.body.intent, 'save');
    const status = intent === 'publish' ? 'published' : normaliseStatus(str(req.body.status, existing.status));

    await updatePost(existing.id, {
      type: existing.type,
      title: str(req.body.title, existing.title),
      slug: str(req.body.slug),
      content: String(req.body.content ?? existing.content),
      excerpt: str(req.body.excerpt) || null,
      status,
      author_id: Number(req.body.author_id) || existing.author_id,
      featured_image_id: Number(req.body.featured_image_id) || null,
      og_image_id: Number(req.body.og_image_id) || null,
      is_sticky: req.body.is_sticky === 'on' || req.body.is_sticky === '1',
      allow_comments: req.body.allow_comments === 'on' || req.body.allow_comments === '1',
      seo_title: str(req.body.seo_title) || null,
      seo_description: str(req.body.seo_description) || null,
      published_at: str(req.body.published_at) || null,
      template: str(req.body.template, existing.template),
      parent_id: existing.parent_id,
      categoryIds: parseIds(req.body.categories),
      tags: parseTags(req.body.tags),
    });

    await logActivity(res.locals.currentUser.id, 'updated', existing.title);
    setFlash(req, 'success', status === 'published' ? 'Post published.' : 'Changes saved.');
    res.redirect(`/admin/posts/${existing.id}/edit`);
  }),
);

router.post(
  '/posts/:id/status',
  asyncRoute(async (req, res) => {
    const post = await getPostById(Number(req.params.id));
    if (!post) return res.redirect('/admin/posts');
    if (!canEditPost(res.locals.currentUser, post)) {
      setFlash(req, 'error', 'You cannot change that post.');
      return res.redirect('/admin/posts');
    }
    const status = normaliseStatus(str(req.body.status, 'draft'));
    await setPostStatus(post.id, status);
    await logActivity(res.locals.currentUser.id, `status:${status}`, post.title);
    setFlash(req, 'success', `“${post.title}” is now ${status}.`);
    res.redirect(str(req.body.redirect, '/admin/posts'));
  }),
);

router.post(
  '/posts/bulk',
  asyncRoute(async (req, res) => {
    const ids = parseIds(req.body.ids);
    const action = str(req.body.action);
    if (!ids.length || !action) {
      setFlash(req, 'error', 'Select at least one post.');
      return res.redirect('/admin/posts');
    }
    const db = await getDb();
    const user = res.locals.currentUser;
    let affected = 0;

    for (const id of ids) {
      const post = await getPostById(id);
      if (!post || !canEditPost(user, post)) continue;
      affected += 1;
      switch (action) {
        case 'publish':
          await setPostStatus(id, 'published');
          break;
        case 'draft':
          await setPostStatus(id, 'draft');
          break;
        case 'trash':
          await trashPost(id);
          break;
        case 'restore':
          await restorePost(id);
          break;
        case 'sticky':
          await db.execute('UPDATE posts SET is_sticky = 1 WHERE id = ?', [id]);
          break;
        case 'unsticky':
          await db.execute('UPDATE posts SET is_sticky = 0 WHERE id = ?', [id]);
          break;
        case 'delete':
          if (!roleAtLeast(user.role, 'editor')) continue;
          await permanentlyDeletePost(id);
          break;
        default:
          break;
      }
    }
    await logActivity(user.id, `bulk:${action}`, `${affected} posts`);
    setFlash(req, 'success', `${affected} stor${affected === 1 ? 'y' : 'ies'} updated.`);
    res.redirect(str(req.body.redirect, '/admin/posts'));
  }),
);

router.post(
  '/posts/:id/delete',
  asyncRoute(async (req, res) => {
    const post = await getPostById(Number(req.params.id));
    if (!post) return res.redirect('/admin/posts');
    if (!canEditPost(res.locals.currentUser, post)) {
      setFlash(req, 'error', 'You cannot delete that post.');
      return res.redirect('/admin/posts');
    }
    if (str(req.body.mode) === 'permanent') {
      if (!roleAtLeast(res.locals.currentUser.role, 'editor')) {
        setFlash(req, 'error', 'Only editors can permanently delete content.');
        return res.redirect('/admin/posts');
      }
      await permanentlyDeletePost(post.id);
      await logActivity(res.locals.currentUser.id, 'deleted', post.title);
      setFlash(req, 'success', `“${post.title}” was deleted permanently.`);
      // Stay on the trash for the right content type — a page must not bounce
      // back to the posts list.
      return res.redirect(
        str(req.body.redirect, `/admin/posts?type=${post.type === 'page' ? 'page' : 'post'}&status=trash`),
      );
    }
    await trashPost(post.id);
    await logActivity(res.locals.currentUser.id, 'trashed', post.title);
    setFlash(req, 'success', 'Moved to trash. You can restore it any time.');
    res.redirect(str(req.body.redirect, '/admin/posts'));
  }),
);

/* --------------------------------------------------------------- restore */
router.post(
  '/posts/:id/restore',
  asyncRoute(async (req, res) => {
    const post = await getPostById(Number(req.params.id));
    if (!post) return res.redirect('/admin/posts');
    if (!canEditPost(res.locals.currentUser, post)) {
      setFlash(req, 'error', 'You cannot restore that post.');
      return res.redirect('/admin/posts?status=trash');
    }
    const status = await restorePost(post.id);
    await logActivity(res.locals.currentUser.id, 'restored', post.title);
    setFlash(
      req,
      'success',
      `“${post.title}” was restored${status === 'draft' ? ' as a draft' : ` to ${status}`}.`,
    );
    res.redirect(
      str(req.body.redirect, `/admin/posts?type=${post.type === 'page' ? 'page' : 'post'}`),
    );
  }),
);

/* ------------------------------------------------------------ revisions */
router.get(
  '/posts/:id/revisions',
  asyncRoute(async (req, res, next) => {
    const post = await getPostById(Number(req.params.id));
    if (!post) return next();
    const revisions = await (await getDb()).query<{
      id: number; title: string; excerpt: string | null; created_at: string; author_name: string | null; content: string;
    }>(
      `SELECT r.id, r.title, r.excerpt, r.created_at, r.content, u.name AS author_name
         FROM revisions r LEFT JOIN users u ON u.id = r.author_id
        WHERE r.post_id = ? ORDER BY r.id DESC LIMIT 40`,
      [post.id],
    );
    res.render('admin/revisions', {
      layout: 'layouts/admin',
      title: `Revisions — ${post.title}`,
      adminTitle: 'Revisions',
      page: post.type === 'page' ? 'pages' : 'posts',
      post,
      revisions,
    });
  }),
);

router.post(
  '/posts/:id/revisions/:revisionId/restore',
  asyncRoute(async (req, res, next) => {
    const post = await getPostById(Number(req.params.id));
    if (!post) return next();
    if (!canEditPost(res.locals.currentUser, post)) {
      setFlash(req, 'error', 'You cannot edit that post.');
      return res.redirect('/admin/posts');
    }
    const db = await getDb();
    const rows = await db.query<{ title: string; content: string; excerpt: string | null }>(
      'SELECT title, content, excerpt FROM revisions WHERE id = ? AND post_id = ?',
      [idParam(req.params.revisionId), post.id],
    );
    if (!rows[0]) {
      setFlash(req, 'error', 'That revision no longer exists.');
      return res.redirect(`/admin/posts/${post.id}/revisions`);
    }
    const revision = rows[0];
    const { html } = renderMarkdown(revision.content);
    await db.execute('UPDATE posts SET title = ?, content = ?, content_html = ?, excerpt = ? WHERE id = ?', [
      revision.title, revision.content, html, revision.excerpt, post.id,
    ]);
    await saveRevision(post.id, revision, res.locals.currentUser.id);
    await logActivity(res.locals.currentUser.id, 'restored', post.title);
    setFlash(req, 'success', 'Revision restored.');
    res.redirect(`/admin/posts/${post.id}/edit`);
  }),
);

function normaliseStatus(value: string): PostStatus {
  const allowed: PostStatus[] = ['draft', 'published', 'scheduled', 'private', 'trash'];
  return allowed.includes(value as PostStatus) ? (value as PostStatus) : 'draft';
}

export default router;
