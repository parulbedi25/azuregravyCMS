import { getDb } from '../db/index.js';
import type { ActivityEntry } from '../types.js';

export async function logActivity(
  userId: number | null,
  action: string,
  subject: string | null = null,
  meta: Record<string, unknown> | null = null,
): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('INSERT INTO activity (user_id, action, subject, meta) VALUES (?, ?, ?, ?)', [
      userId,
      action,
      subject,
      meta ? JSON.stringify(meta) : null,
    ]);
  } catch (error) {
    console.warn('[activity] failed to log', action, error);
  }
}

export async function recentActivity(limit = 12): Promise<ActivityEntry[]> {
  const db = await getDb();
  return db.query<ActivityEntry>(
    `SELECT a.*, u.name AS user_name FROM activity a
       LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${Math.max(1, limit)}`,
  );
}
