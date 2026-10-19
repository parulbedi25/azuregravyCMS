import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { PUBLIC_DIR } from '../config.js';
import type { Media } from '../types.js';

export async function listMedia(options: { page?: number; perPage?: number; search?: string; type?: string } = {}): Promise<{
  media: Media[];
  total: number;
  page: number;
  perPage: number;
}> {
  const db = await getDb();
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(120, Math.max(1, options.perPage ?? 36));
  const offset = (page - 1) * perPage;
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (options.search) {
    clauses.push('(original_name LIKE ? OR alt_text LIKE ? OR title LIKE ?)');
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  if (options.type && options.type !== 'all') {
    clauses.push('mime_type LIKE ?');
    params.push(`${options.type}/%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const count = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM media ${where}`, params);
  const media = await db.query<Media>(
    `SELECT * FROM media ${where} ORDER BY created_at DESC, id DESC LIMIT ${perPage} OFFSET ${offset}`,
    params,
  );
  return { media, total: Number(count[0]?.total ?? 0), page, perPage };
}

export async function getMedia(id: number): Promise<Media | null> {
  const db = await getDb();
  const rows = await db.query<Media>('SELECT * FROM media WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function createMedia(input: Omit<Media, 'id' | 'created_at'>): Promise<number> {
  const db = await getDb();
  return db.insert(
    `INSERT INTO media (filename, path, original_name, mime_type, size, width, height, alt_text, caption, title, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.filename, input.path, input.original_name, input.mime_type, input.size,
      input.width, input.height, input.alt_text, input.caption, input.title, input.uploaded_by,
    ],
  );
}

export async function updateMedia(
  id: number,
  fields: Partial<Pick<Media, 'alt_text' | 'caption' | 'title'>>,
): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE media SET alt_text = ?, caption = ?, title = ? WHERE id = ?', [
    fields.alt_text ?? null,
    fields.caption ?? null,
    fields.title ?? null,
    id,
  ]);
}

export async function deleteMedia(id: number): Promise<void> {
  const db = await getDb();
  const media = await getMedia(id);
  if (!media) return;
  await db.execute('UPDATE posts SET featured_image_id = NULL WHERE featured_image_id = ?', [id]);
  await db.execute('UPDATE posts SET og_image_id = NULL WHERE og_image_id = ?', [id]);
  await db.execute('DELETE FROM media WHERE id = ?', [id]);
  const absolute = path.join(PUBLIC_DIR, media.path.replace(/^\//, ''));
  if (absolute.startsWith(path.join(PUBLIC_DIR, 'uploads'))) {
    await fs.unlink(absolute).catch(() => undefined);
  }
}

export async function mediaStats(): Promise<{ total: number; bytes: number }> {
  const db = await getDb();
  const rows = await db.query<{ total: number; bytes: number | null }>('SELECT COUNT(*) AS total, SUM(size) AS bytes FROM media');
  return { total: Number(rows[0]?.total ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
}
