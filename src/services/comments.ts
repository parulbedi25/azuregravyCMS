import { getDb } from '../db/index.js';
import type { Comment, CommentStatus } from '../types.js';

export interface CommentWithChildren extends Comment {
  children: CommentWithChildren[];
}

export interface AddCommentInput {
  post_id: number;
  parent_id?: number | null;
  author_name: string;
  author_email?: string | null;
  author_url?: string | null;
  content: string;
  ip_address?: string | null;
  user_agent?: string | null;
  user_id?: number | null;
}

const COMMENT_COLUMNS = `
  c.*, p.title AS post_title, p.slug AS post_slug
`;

export async function listComments(options: {
  status?: CommentStatus | 'all';
  postId?: number;
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<{ comments: Comment[]; total: number; page: number; perPage: number }> {
  const db = await getDb();
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (options.status && options.status !== 'all') {
    clauses.push('c.status = ?');
    params.push(options.status);
  }
  if (options.postId) {
    clauses.push('c.post_id = ?');
    params.push(options.postId);
  }
  if (options.search) {
    clauses.push('(c.author_name LIKE ? OR c.content LIKE ? OR c.author_email LIKE ?)');
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const count = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM comments c ${where}`, params);
  const rows = await db.query<Comment>(
    `SELECT ${COMMENT_COLUMNS} FROM comments c JOIN posts p ON p.id = c.post_id
     ${where} ORDER BY c.created_at DESC LIMIT ${perPage} OFFSET ${offset}`,
    params,
  );
  return { comments: rows, total: Number(count[0]?.total ?? 0), page, perPage };
}

export async function commentCounts(): Promise<Record<CommentStatus | 'all', number>> {
  const db = await getDb();
  const rows = await db.query<{ status: CommentStatus; total: number }>(
    'SELECT status, COUNT(*) AS total FROM comments GROUP BY status',
  );
  const counts = { pending: 0, approved: 0, spam: 0, trash: 0, all: 0 } as Record<CommentStatus | 'all', number>;
  for (const row of rows) {
    counts[row.status] = Number(row.total);
    counts.all += Number(row.total);
  }
  return counts;
}

export async function getComment(id: number): Promise<Comment | null> {
  // See getUser: a non-numeric :id must not reach the driver as NaN.
  if (!Number.isInteger(id) || id <= 0) return null;
  const db = await getDb();
  const rows = await db.query<Comment>(`SELECT ${COMMENT_COLUMNS} FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`, [id]);
  return rows[0] ?? null;
}

export async function addComment(input: AddCommentInput, autoApprove: boolean): Promise<number> {
  const db = await getDb();
  return db.insert(
    `INSERT INTO comments (post_id, parent_id, author_name, author_email, author_url, content, status, user_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.post_id,
      input.parent_id ?? null,
      input.author_name.slice(0, 120),
      input.author_email ?? null,
      input.author_url ?? null,
      input.content,
      autoApprove ? 'approved' : 'pending',
      input.user_id ?? null,
      input.ip_address ?? null,
      (input.user_agent ?? '').slice(0, 255),
    ],
  );
}

export async function moderateComment(id: number, status: CommentStatus): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) return;
  const db = await getDb();
  await db.execute('UPDATE comments SET status = ? WHERE id = ?', [status, id]);
}

export async function deleteComment(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) return;
  const db = await getDb();
  await db.execute('DELETE FROM comments WHERE id = ?', [id]);
}

/**
 * The only comment fields a public page is ever allowed to see.
 *
 * A commenter's email address, IP address and user agent are moderation data:
 * they belong to the admin queue and must never enter the scope of a public
 * template, where one stray `JSON.stringify(locals)` or locals-dumping error
 * page would publish strangers' personal data. Selecting them explicitly (rather
 * than `c.*`) makes that guarantee a property of the query, not of the view.
 */
export interface PublicComment {
  id: number;
  parent_id: number | null;
  author_name: string;
  content: string;
  created_at: string;
  children: PublicComment[];
}

export async function approvedCommentsTree(postId: number): Promise<{ comments: PublicComment[]; total: number }> {
  const db = await getDb();
  const rows = await db.query<Omit<PublicComment, 'children'>>(
    `SELECT c.id, c.parent_id, c.author_name, c.content, c.created_at FROM comments c
      WHERE c.post_id = ? AND c.status = 'approved'
      ORDER BY c.created_at ASC, c.id ASC`,
    [postId],
  );
  const map = new Map<number, PublicComment>();
  for (const row of rows) map.set(row.id, { ...row, children: [] });
  const roots: PublicComment[] = [];
  for (const comment of map.values()) {
    if (comment.parent_id && map.has(comment.parent_id)) map.get(comment.parent_id)!.children.push(comment);
    else roots.push(comment);
  }
  return { comments: roots, total: rows.length };
}

export async function recentComments(limit = 5): Promise<Comment[]> {
  const db = await getDb();
  return db.query<Comment>(
    `SELECT ${COMMENT_COLUMNS} FROM comments c JOIN posts p ON p.id = c.post_id
      ORDER BY c.created_at DESC LIMIT ${Math.max(1, limit)}`,
  );
}

/** Mark a comment as spam and every pending comment sharing its IP / email. */
export async function markSpamAndRelated(id: number): Promise<void> {
  const db = await getDb();
  const comment = await getComment(id);
  if (!comment) return;
  await db.execute(`UPDATE comments SET status = 'spam' WHERE id = ?`, [id]);
  if (comment.author_email) {
    await db.execute(`UPDATE comments SET status = 'spam' WHERE author_email = ? AND status = 'pending'`, [comment.author_email]);
  }
}
