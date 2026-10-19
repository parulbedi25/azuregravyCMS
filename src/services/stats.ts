import { getDb, formatDate } from '../db/index.js';
import type { Post } from '../types.js';

export interface DashboardStats {
  posts: { published: number; draft: number; scheduled: number; trash: number; pages: number; total: number };
  comments: { pending: number; approved: number; total: number };
  subscribers: { confirmed: number; total: number };
  media: { total: number };
  views: { total: number; last30: number; series: Array<{ day: string; label: string; views: number }>; delta: number };
  topPosts: Post[];
  recentComments: Array<{ id: number; author_name: string; content: string; created_at: string; status: string; post_title: string; post_slug: string }>;
  recentDrafts: Post[];
  publishingStreak: number;
}

export async function dashboardStats(): Promise<DashboardStats> {
  const db = await getDb();

  const postRows = await db.query<{ status: string; type: string; total: number }>(
    'SELECT status, type, COUNT(*) AS total FROM posts GROUP BY status, type',
  );
  const posts = { published: 0, draft: 0, scheduled: 0, trash: 0, pages: 0, total: 0 };
  for (const row of postRows) {
    const total = Number(row.total);
    posts.total += total;
    if (row.type === 'page') posts.pages += total;
    if (row.status === 'published') posts.published += total;
    if (row.status === 'draft') posts.draft += total;
    if (row.status === 'scheduled') posts.scheduled += total;
    if (row.status === 'trash') posts.trash += total;
  }

  const commentRows = await db.query<{ status: string; total: number }>('SELECT status, COUNT(*) AS total FROM comments GROUP BY status');
  const comments = { pending: 0, approved: 0, total: 0 };
  for (const row of commentRows) {
    const total = Number(row.total);
    comments.total += total;
    if (row.status === 'pending') comments.pending = total;
    if (row.status === 'approved') comments.approved = total;
  }

  const subscriberRows = await db.query<{ status: string; total: number }>('SELECT status, COUNT(*) AS total FROM subscribers GROUP BY status');
  const subscribers = { confirmed: 0, total: 0 };
  for (const row of subscriberRows) {
    subscribers.total += Number(row.total);
    if (row.status === 'confirmed') subscribers.confirmed += Number(row.total);
  }

  const mediaRows = await db.query<{ total: number }>('SELECT COUNT(*) AS total FROM media');
  const totalViewsRows = await db.query<{ total: number | null }>('SELECT SUM(views) AS total FROM posts');
  const viewRows = await db.query<{ day: string; total: number }>(
    `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, SUM(views) AS total
       FROM post_views WHERE day >= DATE_SUB(UTC_DATE(), INTERVAL 29 DAY)
      GROUP BY day ORDER BY day ASC`,
  );
  const byDay = new Map(viewRows.map((row) => [row.day, Number(row.total)]));
  const series: Array<{ day: string; label: string; views: number }> = [];
  let last30 = 0;
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    const key = formatDate(date);
    const views = byDay.get(key) ?? 0;
    last30 += views;
    series.push({
      day: key,
      label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date),
      views,
    });
  }
  const half = Math.floor(series.length / 2);
  const previous = series.slice(0, half).reduce((sum, point) => sum + point.views, 0);
  const current = series.slice(half).reduce((sum, point) => sum + point.views, 0);
  const delta = previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);

  const topPosts = await db.query<Post>(
    `SELECT p.id, p.title, p.slug, p.views, p.published_at, m.path AS featured_image,
            (SELECT c.name FROM categories c JOIN post_categories pc ON pc.category_id = c.id WHERE pc.post_id = p.id LIMIT 1) AS category_name
       FROM posts p LEFT JOIN media m ON m.id = p.featured_image_id
      WHERE p.type = 'post' AND p.status = 'published'
      ORDER BY p.views DESC LIMIT 5`,
  );

  const recentComments = await db.query<{
    id: number; author_name: string; content: string; created_at: string; status: string; post_title: string; post_slug: string;
  }>(
    `SELECT c.id, c.author_name, c.content, c.created_at, c.status, p.title AS post_title, p.slug AS post_slug
       FROM comments c JOIN posts p ON p.id = c.post_id
      ORDER BY c.created_at DESC LIMIT 4`,
  );

  const recentDrafts = await db.query<Post>(
    `SELECT p.id, p.title, p.slug, p.updated_at, p.published_at, p.status, p.type FROM posts p
      WHERE p.status IN ('draft','scheduled') ORDER BY p.updated_at DESC LIMIT 4`,
  );

  const streakRows = await db.query<{ day: string }>(
    `SELECT DISTINCT DATE_FORMAT(published_at, '%Y-%m-%d') AS day FROM posts
      WHERE status = 'published' AND published_at >= DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)
      ORDER BY day DESC`,
  );
  let publishingStreak = 0;
  const days = new Set(streakRows.map((row) => row.day));
  for (let i = 0; i < 30; i += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    if (days.has(formatDate(date))) publishingStreak += 1;
    else if (i > 0) break;
  }

  return {
    posts,
    comments,
    subscribers,
    media: { total: Number(mediaRows[0]?.total ?? 0) },
    views: { total: Number(totalViewsRows[0]?.total ?? 0), last30, series, delta },
    topPosts,
    recentComments,
    recentDrafts,
    publishingStreak,
  };
}
