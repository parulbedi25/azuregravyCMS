import { getDb } from '../db/index.js';
import type { User } from '../types.js';

export interface UserWithCounts extends User {
  post_count?: number;
  published_count?: number;
}

export async function listUsers(): Promise<UserWithCounts[]> {
  const db = await getDb();
  return db.query<UserWithCounts>(
    `SELECT u.*,
       (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.status <> 'trash') AS post_count,
       (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'published') AS published_count
     FROM users u ORDER BY u.name ASC`,
  );
}

export async function getUser(id: number): Promise<User | null> {
  const db = await getDb();
  const rows = await db.query<User>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db.query<User>('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] ?? null;
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ total: number }>('SELECT COUNT(*) AS total FROM users');
  return Number(rows[0]?.total ?? 0);
}

export async function createUser(input: {
  name: string;
  email: string;
  password_hash: string;
  role: string;
  bio?: string | null;
  website?: string | null;
  twitter?: string | null;
  linkedin?: string | null;
  avatar?: string | null;
}): Promise<number> {
  const db = await getDb();
  return db.insert(
    `INSERT INTO users (name, email, password_hash, role, bio, website, twitter, linkedin, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name, input.email.toLowerCase(), input.password_hash, input.role,
      input.bio ?? null, input.website ?? null, input.twitter ?? null, input.linkedin ?? null, input.avatar ?? null,
    ],
  );
}

export async function updateUser(
  id: number,
  input: {
    name: string;
    email: string;
    role: string;
    bio?: string | null;
    website?: string | null;
    twitter?: string | null;
    linkedin?: string | null;
    avatar?: string | null;
    password_hash?: string;
  },
): Promise<void> {
  const db = await getDb();
  const sets = ['name = ?', 'email = ?', 'role = ?', 'bio = ?', 'website = ?', 'twitter = ?', 'linkedin = ?', 'avatar = ?'];
  const params: unknown[] = [
    input.name, input.email.toLowerCase(), input.role, input.bio ?? null,
    input.website ?? null, input.twitter ?? null, input.linkedin ?? null, input.avatar ?? null,
  ];
  if (input.password_hash) {
    sets.push('password_hash = ?');
    params.push(input.password_hash);
  }
  params.push(id);
  await db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteUser(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM users WHERE id = ?', [id]);
}

export async function authorBySlugOrId(idOrSlug: string): Promise<User | null> {
  const id = Number.parseInt(idOrSlug, 10);
  if (!Number.isFinite(id)) return null;
  return getUser(id);
}

export async function updateLastLogin(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [id]);
}
