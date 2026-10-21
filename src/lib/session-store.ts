import session from 'express-session';
import { dbIsReady, getDb } from '../db/index.js';

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

/**
 * Tiny in-memory store used *only* while the installer is running.
 *
 * The database does not exist yet at that point, but the installer still needs a
 * session for its CSRF token and to carry step 1 across to step 2. Written by hand
 * (rather than express-session's MemoryStore) so production starts without the
 * "MemoryStore is not designed for a production environment" warning.
 */
export class MemorySessionStore extends session.Store {
  private readonly rows = new Map<string, { data: session.SessionData; expires: number }>();

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    const row = this.rows.get(sid);
    if (!row) return callback(null, null);
    if (row.expires < Date.now()) {
      this.rows.delete(sid);
      return callback(null, null);
    }
    callback(null, row.data);
  }

  set(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): void {
    const expires = data.cookie?.expires
      ? new Date(data.cookie.expires).getTime()
      : Date.now() + (data.cookie?.originalMaxAge ?? 1000 * 60 * 30);
    this.rows.set(sid, { data, expires });
    this.sweep();
    callback?.();
  }

  touch(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): void {
    this.set(sid, data, callback);
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.rows.delete(sid);
    callback?.();
  }

  /** Keep the map small: installer sessions are short-lived and few. */
  private sweep(): void {
    if (this.rows.size < 200) return;
    const now = Date.now();
    for (const [sid, row] of this.rows) {
      if (row.expires < now) this.rows.delete(sid);
    }
  }
}

/**
 * Routes to MariaDB once it is connected, and to memory before that.
 *
 * This is what lets the app boot with no database at all: the installer works
 * entirely in memory, and the moment the connection is established every later
 * session is persisted properly.
 */
export class HybridSessionStore extends session.Store {
  private readonly memory = new MemorySessionStore();
  private readonly maria = new MariaSessionStore();

  private backend(): session.Store {
    return dbIsReady() ? this.maria : this.memory;
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    this.backend().get(sid, callback);
  }

  set(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): void {
    this.backend().set(sid, data, callback);
  }

  touch(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): void {
    const store = this.backend();
    if (store.touch) store.touch(sid, data, callback);
    else store.set(sid, data, callback);
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.backend().destroy(sid, callback);
  }

  async clearExpired(): Promise<void> {
    if (!dbIsReady()) return;
    await this.maria.clearExpired();
  }
}
