import { getDb, formatDateTime } from '../db/index.js';
import { makeExcerpt, readingTime, slugify } from '../lib/text.js';
import { renderMarkdown } from '../lib/markdown.js';
import type { Category, Post, PostStatus, PostType, Tag } from '../types.js';

export type PostSort = 'newest' | 'oldest' | 'popular' | 'updated' | 'title';

export interface PostFilters {
  type?: PostType;
  statuses?: PostStatus[];
  category?: string;
  tag?: string;
  authorId?: number;
  search?: string;
  excludeId?: number;
  month?: string;
  page?: number;
  perPage?: number;
  sort?: PostSort;
  stickyFirst?: boolean;
}

const PUBLIC_STATUSES: PostStatus[] = ['published'];

const POST_COLUMNS = `
  p.*,
  m.path AS featured_image,
  u.name AS author_name,
  u.avatar AS author_avatar,
  u.bio AS author_bio,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') AS comment_count,
  (SELECT GROUP_CONCAT(c.name ORDER BY c.sort_order SEPARATOR '||')
     FROM categories c JOIN post_categories pc ON pc.category_id = c.id WHERE pc.post_id = p.id) AS category_names,
  (SELECT GROUP_CONCAT(c.slug ORDER BY c.sort_order SEPARATOR '||')
     FROM categories c JOIN post_categories pc ON pc.category_id = c.id WHERE pc.post_id = p.id) AS category_slugs,
  (SELECT GROUP_CONCAT(c.color ORDER BY c.sort_order SEPARATOR '||')
     FROM categories c JOIN post_categories pc ON pc.category_id = c.id WHERE pc.post_id = p.id) AS category_colors
`;

function decorate(post: Post): Post {
  if (post.category_names) {
    const names = String(post.category_names).split('||');
    const slugs = String(post.category_slugs ?? '').split('||');
    const colors = String(post.category_colors ?? '').split('||');
    post.category_name = names[0] ?? null;
    post.category_slug = slugs[0] ?? null;
    post.category_color = colors[0] ?? null;
  }
  return post;
}

function buildWhere(filters: PostFilters, params: unknown[]): string {
  const clauses: string[] = ['p.type = ?'];
  params.push(filters.type ?? 'post');

  const statuses = filters.statuses && filters.statuses.length > 0 ? filters.statuses : PUBLIC_STATUSES;
  clauses.push(`p.status IN (${statuses.map(() => '?').join(', ')})`);
  params.push(...statuses);

  if (filters.category) {
    clauses.push(`EXISTS (SELECT 1 FROM post_categories pc2 JOIN categories c2 ON c2.id = pc2.category_id
                 WHERE pc2.post_id = p.id AND c2.slug = ?)`);
    params.push(filters.category);
  }
  if (filters.tag) {
    clauses.push(`EXISTS (SELECT 1 FROM post_tags pt2 JOIN tags t2 ON t2.id = pt2.tag_id
                 WHERE pt2.post_id = p.id AND t2.slug = ?)`);
    params.push(filters.tag);
  }
  if (filters.authorId) {
    clauses.push('p.author_id = ?');
    params.push(filters.authorId);
  }
  if (filters.excludeId) {
    clauses.push('p.id <> ?');
    params.push(filters.excludeId);
  }
  if (filters.month) {
    clauses.push(`DATE_FORMAT(p.published_at, '%Y-%m') = ?`);
    params.push(filters.month);
  }
  if (filters.search) {
    const like = `%${filters.search}%`;
    clauses.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ?)');
    params.push(like, like, like);
    // When browsing published content, private posts stay hidden even if searched.
    if (!filters.statuses?.includes('private')) clauses.push(`p.status <> 'private'`);
  }
  return clauses.join(' AND ');
}

function orderBy(sort: PostSort | undefined, stickyFirst: boolean): string {
  const sticky = stickyFirst ? 'p.is_sticky DESC, ' : '';
  switch (sort) {
    case 'oldest':
      return `ORDER BY ${sticky}p.published_at ASC, p.id ASC`;
    case 'popular':
      return `ORDER BY ${sticky}p.views DESC, p.published_at DESC`;
    case 'updated':
      return 'ORDER BY p.updated_at DESC, p.id DESC';
    case 'title':
      return 'ORDER BY p.title ASC';
    case 'newest':
    default:
      return `ORDER BY ${sticky}p.published_at DESC, p.id DESC`;
  }
}

export async function listPosts(filters: PostFilters): Promise<{ posts: Post[]; total: number; page: number; perPage: number }> {
  const db = await getDb();
  const params: unknown[] = [];
  const where = buildWhere(filters, params);
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters.perPage ?? 9));
  const offset = (page - 1) * perPage;

  const countRows = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM posts p WHERE ${where}`, params);
  const total = Number(countRows[0]?.total ?? 0);

  const rows = await db.query<Post>(
    `SELECT ${POST_COLUMNS}
       FROM posts p
       LEFT JOIN media m ON m.id = p.featured_image_id
       LEFT JOIN users u ON u.id = p.author_id
      WHERE ${where}
      ${orderBy(filters.sort, filters.stickyFirst ?? false)}
      LIMIT ${perPage} OFFSET ${offset}`,
    params,
  );
  return { posts: rows.map(decorate), total, page, perPage };
}

export async function getPostsByIds(ids: number[]): Promise<Post[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts p
       LEFT JOIN media m ON m.id = p.featured_image_id
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.id IN (?)`,
    [ids],
  );
  const byId = new Map(rows.map((post) => [post.id, decorate(post)]));
  return ids.map((id) => byId.get(id)).filter((post): post is Post => Boolean(post));
}

export async function getPostBySlug(slug: string, options: { type?: PostType; statuses?: PostStatus[] } = {}): Promise<Post | null> {
  const db = await getDb();
  const statuses = options.statuses ?? PUBLIC_STATUSES;
  const rows = await db.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts p
       LEFT JOIN media m ON m.id = p.featured_image_id
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.slug = ? AND p.type = ? AND p.status IN (?)
      LIMIT 1`,
    [slug, options.type ?? 'post', statuses],
  );
  if (!rows[0]) return null;
  return attachTerms(decorate(rows[0]));
}

export async function getPostById(id: number): Promise<Post | null> {
  const db = await getDb();
  const rows = await db.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts p
       LEFT JOIN media m ON m.id = p.featured_image_id
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.id = ? LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  return attachTerms(decorate(rows[0]));
}

export async function attachTerms(post: Post): Promise<Post> {
  const db = await getDb();
  const [categories, tags] = await Promise.all([
    db.query<Category>(
      `SELECT c.* FROM categories c JOIN post_categories pc ON pc.category_id = c.id
        WHERE pc.post_id = ? ORDER BY c.sort_order, c.name`,
      [post.id],
    ),
    db.query<Tag>(
      `SELECT t.* FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
        WHERE pt.post_id = ? ORDER BY t.name`,
      [post.id],
    ),
  ]);
  post.categories = categories;
  post.tags = tags;
  return post;
}

export async function getAdjacentPosts(post: Post): Promise<{ previous: Post | null; next: Post | null }> {
  const db = await getDb();
  const [previous, next] = await Promise.all([
    db.query<Post>(
      `SELECT p.id, p.title, p.slug, p.featured_image_id, m.path AS featured_image
         FROM posts p LEFT JOIN media m ON m.id = p.featured_image_id
        WHERE p.type = 'post' AND p.status = 'published' AND p.published_at < ?
        ORDER BY p.published_at DESC LIMIT 1`,
      [post.published_at ?? post.created_at],
    ),
    db.query<Post>(
      `SELECT p.id, p.title, p.slug, p.featured_image_id, m.path AS featured_image
         FROM posts p LEFT JOIN media m ON m.id = p.featured_image_id
        WHERE p.type = 'post' AND p.status = 'published' AND p.published_at > ?
        ORDER BY p.published_at ASC LIMIT 1`,
      [post.published_at ?? post.created_at],
    ),
  ]);
  return { previous: previous[0] ?? null, next: next[0] ?? null };
}

export async function getRelatedPosts(post: Post, limit = 3): Promise<Post[]> {
  const db = await getDb();
  const categoryIds = (post.categories ?? []).map((c) => c.id);
  const params: unknown[] = [post.id];
  let categoryClause = '';
  if (categoryIds.length > 0) {
    categoryClause = `AND EXISTS (SELECT 1 FROM post_categories pc WHERE pc.post_id = p.id AND pc.category_id IN (?))`;
    params.push(categoryIds);
  }
  const rows = await db.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts p
       LEFT JOIN media m ON m.id = p.featured_image_id
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.type = 'post' AND p.status = 'published' AND p.id <> ? ${categoryClause}
      ORDER BY p.published_at DESC LIMIT ${Math.max(1, limit)}`,
    params,
  );
  const results = rows.map(decorate);
  if (results.length >= limit) return results;
  const fallback = await db.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts p
       LEFT JOIN media m ON m.id = p.featured_image_id
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.type = 'post' AND p.status = 'published' AND p.id <> ?
      ORDER BY p.published_at DESC LIMIT ${limit + 4}`,
    [post.id],
  );
  for (const candidate of fallback.map(decorate)) {
    if (results.length >= limit) break;
    if (!results.some((existing) => existing.id === candidate.id)) results.push(candidate);
  }
  return results.slice(0, limit);
}

/* ------------------------------- writing -------------------------------- */

export interface PostInput {
  type: PostType;
  title: string;
  slug?: string | null;
  content: string;
  excerpt?: string | null;
  status: PostStatus;
  author_id: number;
  featured_image_id?: number | null;
  og_image_id?: number | null;
  is_sticky?: boolean | number;
  allow_comments?: boolean | number;
  seo_title?: string | null;
  seo_description?: string | null;
  published_at?: string | null;
  template?: string;
  parent_id?: number | null;
  categoryIds?: number[];
  tags?: string[];
}

export async function isSlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM posts WHERE slug = ? ${excludeId ? 'AND id <> ?' : ''} LIMIT 1`,
    excludeId ? [slug, excludeId] : [slug],
  );
  return rows.length > 0;
}

export async function uniqueSlug(desired: string, excludeId?: number): Promise<string> {
  const base = slugify(desired) || `post-${Date.now()}`;
  let candidate = base;
  let suffix = 2;
  while (await isSlugTaken(candidate, excludeId)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 200) return `${base}-${Date.now()}`;
  }
  return candidate;
}

export async function createPost(input: PostInput): Promise<number> {
  const db = await getDb();
  const slug = await uniqueSlug(input.slug || input.title);
  const { html } = renderMarkdown(input.content);
  const excerpt = input.excerpt?.trim() || makeExcerpt(input.content, 190);
  const publishedAt =
    resolvePublishedAt(input.status, input.published_at) ??
    (input.status === 'published' ? formatDateTime(new Date()) : null);

  const id = await db.insert(
    `INSERT INTO posts
      (type, title, slug, excerpt, content, content_html, featured_image_id, og_image_id, status, author_id,
       parent_id, template, is_sticky, allow_comments, reading_time, seo_title, seo_description, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.type, input.title.trim(), slug, excerpt, input.content, html,
      input.featured_image_id ?? null, input.og_image_id ?? null, input.status, input.author_id,
      input.parent_id ?? null, input.template ?? 'default', input.is_sticky ? 1 : 0,
      input.allow_comments === false || input.allow_comments === 0 ? 0 : 1,
      readingTime(input.content),
      input.seo_title || null, input.seo_description || null, publishedAt,
    ],
  );
  await setPostTerms(id, input.categoryIds ?? [], input.tags ?? []);
  await saveRevision(id, { title: input.title, content: input.content, excerpt }, input.author_id);
  return id;
}

export async function updatePost(id: number, input: PostInput): Promise<{ previousSlug: string | null }> {
  const db = await getDb();
  const existing = await getPostById(id);
  if (!existing) throw new Error('Post not found');
  const slug = input.slug && input.slug !== existing.slug ? await uniqueSlug(input.slug, id) : existing.slug;
  const { html } = renderMarkdown(input.content);
  const excerpt = input.excerpt?.trim() || makeExcerpt(input.content, 190);
  const publishedAt = resolvePublishedAt(input.status, input.published_at, existing.published_at);

  await db.execute(
    `UPDATE posts SET
       title = ?, slug = ?, excerpt = ?, content = ?, content_html = ?, featured_image_id = ?, og_image_id = ?,
       status = ?, is_sticky = ?, allow_comments = ?, seo_title = ?, seo_description = ?, published_at = ?,
       template = ?, parent_id = ?, reading_time = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [
      input.title.trim(), slug, excerpt, input.content, html, input.featured_image_id ?? null,
      input.og_image_id ?? null, input.status, input.is_sticky ? 1 : 0,
      input.allow_comments === false || input.allow_comments === 0 ? 0 : 1,
      input.seo_title || null, input.seo_description || null, publishedAt,
      input.template ?? 'default', input.parent_id ?? null, readingTime(input.content), id,
    ],
  );
  await setPostTerms(id, input.categoryIds ?? [], input.tags ?? []);
  await saveRevision(id, { title: input.title, content: input.content, excerpt }, input.author_id);

  if (existing.slug !== slug && existing.status === 'published') {
    const prefix = existing.type === 'page' ? '/' : '/stories/';
    await db.execute(
      `INSERT INTO redirects (from_path, to_path, status_code)
       VALUES (?, ?, 301)
       ON DUPLICATE KEY UPDATE to_path = VALUES(to_path), status_code = 301`,
      [`${prefix}${existing.slug}`, `${prefix}${slug}`],
    );
  }
  return { previousSlug: existing.slug };
}

function resolvePublishedAt(status: PostStatus, requested: string | null | undefined, existing?: string | null): string | null {
  if (status === 'published') {
    if (requested) return requested;
    return existing ?? null;
  }
  if (status === 'scheduled') return requested ?? null;
  return requested || existing || null;
}

export async function setPostTerms(postId: number, categoryIds: number[], tags: string[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM post_categories WHERE post_id = ?', [postId]);
  await db.execute('DELETE FROM post_tags WHERE post_id = ?', [postId]);
  for (const categoryId of Array.from(new Set(categoryIds.filter((id) => Number.isFinite(id) && id > 0)))) {
    await db.execute('INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)', [postId, categoryId]);
  }
  const cleanTags = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 20);
  for (const name of cleanTags) {
    const slug = slugify(name);
    if (!slug) continue;
    await db.execute(
      'INSERT INTO tags (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = name',
      [name.slice(0, 120), slug],
    );
    const rows = await db.query<{ id: number }>('SELECT id FROM tags WHERE slug = ? LIMIT 1', [slug]);
    if (rows[0]) await db.execute('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, rows[0].id]);
  }
}

export async function saveRevision(
  postId: number,
  data: { title: string; content: string; excerpt: string | null },
  authorId: number | null,
): Promise<void> {
  const db = await getDb();
  const latest = await db.query<{ title: string; content: string }>(
    'SELECT title, content FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 1',
    [postId],
  );
  if (latest[0] && latest[0].title === data.title && latest[0].content === data.content) return;
  await db.execute(
    'INSERT INTO revisions (post_id, title, content, excerpt, author_id) VALUES (?, ?, ?, ?, ?)',
    [postId, data.title, data.content, data.excerpt, authorId],
  );
  // Keep history tidy: last 25 revisions per post.
  await db.execute(
    `DELETE FROM revisions WHERE post_id = ? AND id NOT IN
       (SELECT id FROM (SELECT id FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 25) AS keep)`,
    [postId, postId],
  );
}

export async function setPostStatus(id: number, status: PostStatus): Promise<void> {
  const db = await getDb();
  const publishedAt = status === 'published' ? 'COALESCE(published_at, UTC_TIMESTAMP())' : 'published_at';
  await db.execute(`UPDATE posts SET status = ?, published_at = ${publishedAt} WHERE id = ?`, [status, id]);
}

export async function permanentlyDeletePost(id: number): Promise<void> {
  const db = await getDb();
  const post = await getPostById(id);
  await db.execute('DELETE FROM posts WHERE id = ?', [id]);
  if (post?.slug) {
    const prefix = post.type === 'page' ? '/' : '/stories/';
    await db.execute('DELETE FROM redirects WHERE from_path = ?', [`${prefix}${post.slug}`]);
  }
}

/* ------------------------------ taxonomy -------------------------------- */

export async function listCategories(options: { withCounts?: boolean; publicOnly?: boolean } = {}): Promise<Category[]> {
  const db = await getDb();
  const counts = options.withCounts
    ? `, (SELECT COUNT(*) FROM post_categories pc JOIN posts p ON p.id = pc.post_id
          WHERE pc.category_id = c.id AND p.status = 'published' AND p.type = 'post') AS post_count`
    : '';
  return db.query<Category>(`SELECT c.* ${counts} FROM categories c ORDER BY c.sort_order ASC, c.name ASC`);
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const db = await getDb();
  const rows = await db.query<Category>('SELECT * FROM categories WHERE slug = ? LIMIT 1', [slug]);
  return rows[0] ?? null;
}

export async function listTags(withCounts = true): Promise<Tag[]> {
  const db = await getDb();
  const counts = withCounts
    ? `, (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id
          WHERE pt.tag_id = t.id AND p.status = 'published' AND p.type = 'post') AS post_count`
    : '';
  return db.query<Tag>(`SELECT t.* ${counts} FROM tags t ORDER BY t.name ASC`);
}

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  const db = await getDb();
  const rows = await db.query<Tag>('SELECT * FROM tags WHERE slug = ? LIMIT 1', [slug]);
  return rows[0] ?? null;
}

export async function getArchiveMonths(): Promise<Array<{ ym: string; label: string; total: number }>> {
  const db = await getDb();
  const rows = await db.query<{ ym: string; total: number }>(
    `SELECT DATE_FORMAT(published_at, '%Y-%m') AS ym, COUNT(*) AS total
       FROM posts WHERE type = 'post' AND status = 'published' AND published_at IS NOT NULL
      GROUP BY ym ORDER BY ym DESC`,
  );
  return rows.map((row) => {
    const [year, month] = row.ym.split('-');
    const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
    );
    return { ym: row.ym, label, total: Number(row.total) };
  });
}
