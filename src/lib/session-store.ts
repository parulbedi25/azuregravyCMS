import session from 'express-session';
import { getDb } from '../db/index.js';

/**
 * Sessions live in MariaDB so restarts (and multiple app instances) keep
 * everyone signed in, and memory doesn't grow unbounded in production.
 */
export class MariaSessionStore extends session.Store {
  async get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): Promise<void> {
    try {
      const db = await getDb();
      const rows = await db.query<{ data: string; expires: number }>(
        'SELECT data, expires FROM sessions WHERE sid = ? LIMIT 1',
        [sid],
      );
      const row = rows[0];
      if (!row || Number(row.expires) < Date.now()) {
        if (row) await db.execute('DELETE FROM sessions WHERE sid = ?', [sid]);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data) as session.SessionData);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): Promise<void> {
    try {
      const db = await getDb();
      const expires = data.cookie?.expires
        ? new Date(data.cookie.expires).getTime()
        : Date.now() + (data.cookie?.originalMaxAge ?? 1000 * 60 * 60 * 24 * 7);
      await db.execute(
        `INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), expires = VALUES(expires)`,
        [sid, JSON.stringify(data), expires],
      );
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async touch(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): Promise<void> {
    await this.set(sid, data, callback);
  }

  async destroy(sid: string, callback?: (err?: unknown) => void): Promise<void> {
    try {
      const db = await getDb();
      await db.execute('DELETE FROM sessions WHERE sid = ?', [sid]);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async clearExpired(): Promise<void> {
    const db = await getDb();
    await db.execute('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
  }
}
