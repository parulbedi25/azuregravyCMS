import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION, DEFAULT_SETTINGS } from './schema.js';

export type SqlParam = string | number | boolean | null | Date | undefined;

export interface ExecResult {
  affected: number;
  insertId: number;
  rows: Record<string, unknown>[];
  fields?: string[];
}

export interface DbClient {
  readonly driver: 'embedded' | 'mysql';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<ExecResult>;
  insert(sql: string, params?: unknown[]): Promise<number>;
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

/** A connection/setup failure with a human explanation and an actionable hint. */
export class DbSetupError extends Error {
  constructor(message: string, readonly hint?: string, readonly cause?: unknown) {
    super(message);
    this.name = 'DbSetupError';
  }
}

const mysqlErrorCode = (error: unknown): string => {
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' ? code : '';
};

function connectionHint(error: unknown): string {
  switch (mysqlErrorCode(error)) {
    case 'ER_ACCESS_DENIED_ERROR':
      return [
        'The database rejected these credentials.',
        'Check DB_USER / DB_PASSWORD in .env. On cPanel the user name is prefixed,',
        'e.g. `myaccount_gravy`, and the user must be added to the database in',
        'cPanel → MySQL® Databases → Add User To Database (ALL PRIVILEGES).',
      ].join('\n');
    case 'ER_BAD_DB_ERROR':
      return [
        'That database does not exist.',
        'Create it in cPanel → MySQL® Databases and use the *full* name (`myaccount_gravy`).',
        'If the database user is allowed to create databases, the app will try that automatically.',
      ].join('\n');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'DB_HOST could not be resolved. On cPanel this is almost always `localhost`.';
    case 'ECONNREFUSED':
      return 'Nothing is listening on that host/port. On cPanel use DB_HOST=localhost and leave DB_PORT empty.';
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
      return 'The server did not answer in time. Shared hosts sometimes block remote MySQL — use `localhost`, or ask the host to allow your IP.';
    case 'ER_NOT_SUPPORTED_AUTH_MODE':
      return 'The server uses an old authentication plugin. Ask the host to set the user to mysql_native_password.';
    default:
      return 'Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME in .env.';
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function toSqlValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return formatDateTime(value);
  return value;
}

/** Expand arrays into a portable `IN (?, ?, ?)` placeholder list. */
function normaliseParams(params: unknown[] = []): unknown[] {
  const out: unknown[] = [];
  for (const p of params) {
    if (Array.isArray(p)) out.push(...p.map(toSqlValue));
    else out.push(toSqlValue(p));
  }
  return out;
}

function expandPlaceholders(sql: string, params: unknown[]): { sql: string; values: unknown[] } {
  // Arrays are supported as `IN ?` in the embedded driver but not in mysql2,
  // so expand them ourselves for identical behaviour.
  if (!params.some(Array.isArray)) return { sql, values: normaliseParams(params) };
  let index = 0;
  const values: unknown[] = [];
  const expanded = sql.replace(/\?/g, () => {
    const p = params[index++];
    if (Array.isArray(p)) {
      if (p.length === 0) return 'NULL';
      values.push(...p.map(toSqlValue));
      return p.map(() => '?').join(', ');
    }
    values.push(toSqlValue(p));
    return '?';
  });
  return { sql: expanded, values };
}

export const pad = (n: number) => String(n).padStart(2, '0');

export function formatDateTime(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/* ------------------------------------------------------------------ */
/* embedded MariaDB (WASM) — offline demos and tests                   */
/* ------------------------------------------------------------------ */

interface EmbeddedEngine {
  query: (sql: string, params?: unknown[]) => unknown;
  exec: (sql: string, params?: unknown[]) => unknown;
  close: () => Promise<void>;
}

class EmbeddedDb implements DbClient {
  readonly driver = 'embedded' as const;
  constructor(private readonly engine: EmbeddedEngine) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { sql: text, values } = expandPlaceholders(sql, params);
    return this.engine.query(text, values) as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecResult> {
    const { sql: text, values } = expandPlaceholders(sql, params);
    const res = this.engine.exec(text, values) as { affected?: number; rows?: Record<string, unknown>[]; fields?: string[] } | undefined;
    return {
      affected: Number(res?.affected ?? 0),
      insertId: 0,
      rows: res?.rows ?? [],
      fields: res?.fields,
    };
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    await this.execute(sql, params);
    const rows = await this.query<{ id: number }>('SELECT LAST_INSERT_ID() AS id');
    return Number(rows[0]?.id ?? 0);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    await this.execute('START TRANSACTION');
    try {
      const result = await fn(this);
      await this.execute('COMMIT');
      return result;
    } catch (error) {
      await this.execute('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.engine.close();
  }
}

/* ------------------------------------------------------------------ */
/* mysql2 / remote MariaDB                                             */
/* ------------------------------------------------------------------ */

export class RemoteDb implements DbClient {
  readonly driver = 'mysql' as const;
  constructor(private readonly pool: mysql.Pool) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { sql: text, values } = expandPlaceholders(sql, params);
    const [rows] = await this.pool.query(text, values);
    return rows as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecResult> {
    const { sql: text, values } = expandPlaceholders(sql, params);
    const [result] = await this.pool.query(text, values);
    if (Array.isArray(result)) {
      return { affected: result.length, insertId: 0, rows: result as Record<string, unknown>[] };
    }
    const header = result as mysql.ResultSetHeader;
    return { affected: header.affectedRows ?? 0, insertId: Number(header.insertId ?? 0), rows: [] };
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.execute(sql, params);
    return result.insertId;
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    await conn.beginTransaction();
    const tx: DbClient = {
      driver: 'mysql',
      query: async <R>(sql: string, params: unknown[] = []) => {
        const { sql: text, values } = expandPlaceholders(sql, params);
        const [rows] = await conn.query(text, values);
        return rows as R[];
      },
      execute: async (sql, params = []) => {
        const { sql: text, values } = expandPlaceholders(sql, params);
        const [result] = await conn.query(text, values);
        if (Array.isArray(result)) return { affected: result.length, insertId: 0, rows: result as Record<string, unknown>[] };
        const header = result as mysql.ResultSetHeader;
        return { affected: header.affectedRows ?? 0, insertId: Number(header.insertId ?? 0), rows: [] };
      },
      insert: async (sql, params = []) => {
        const { sql: text, values } = expandPlaceholders(sql, params);
        const [result] = await conn.query(text, values);
        return Number((result as mysql.ResultSetHeader).insertId ?? 0);
      },
      transaction: async () => {
        throw new Error('Nested transactions are not supported');
      },
      close: async () => undefined,
    };
    try {
      const out = await fn(tx);
      await conn.commit();
      return out;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Exposed so tests can drive the exact production code path with a stub pool. */
export function remoteFromPool(pool: mysql.Pool): DbClient {
  return new RemoteDb(pool);
}

/* ------------------------------------------------------------------ */
/* connection                                                          */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function poolOptions(includeDatabase = true): mysql.PoolOptions {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ...(includeDatabase ? { database: config.db.database } : {}),
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 5,
    idleTimeout: 60_000,
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true,
    timezone: 'Z',
    multipleStatements: false,
    connectTimeout: config.db.connectTimeout,
    ...(config.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/**
 * Connect, creating the database first when the account is allowed to.
 * Shared hosts usually are not — in that case the error explains what to do in cPanel.
 */
async function createRemote(): Promise<DbClient> {
  const pool = mysql.createPool(poolOptions(true));

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return new RemoteDb(pool);
    } catch (error) {
      lastError = error;
      const code = mysqlErrorCode(error);

      // 1049 — the database itself is missing. Try to create it once.
      if (code === 'ER_BAD_DB_ERROR' && attempt === 1) {
        try {
          const bootstrapPool = mysql.createPool(poolOptions(false));
          await bootstrapPool.query(
            `CREATE DATABASE IF NOT EXISTS \`${config.db.database.replace(/`/g, '')}\`
             CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
          );
          await bootstrapPool.end();
          continue;
        } catch (createError) {
          await pool.end().catch(() => undefined);
          throw new DbSetupError(
            `Connected to ${config.db.host}, but the database \`${config.db.database}\` does not exist and this user cannot create it.`,
            connectionHint(error),
            createError,
          );
        }
      }

      const retryable = ['ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR'].includes(code);
      if (retryable && attempt < 3) {
        await sleep(1500 * attempt);
        continue;
      }
      break;
    }
  }

  await pool.end().catch(() => undefined);
  throw new DbSetupError(
    `Could not connect to the database at ${config.db.host}:${config.db.port} (${mysqlErrorCode(lastError) || 'unknown error'}).`,
    connectionHint(lastError),
    lastError,
  );
}

async function createEmbedded(): Promise<DbClient> {
  let Lite4MariaDB: { create(opts?: { dataDir?: string }): Promise<unknown> };
  try {
    ({ Lite4MariaDB } = (await import('lite4mariadb')) as unknown as {
      Lite4MariaDB: { create(opts?: { dataDir?: string }): Promise<unknown> };
    });
  } catch {
    throw new DbSetupError(
      'DB_DRIVER=embedded was requested but the optional `lite4mariadb` package is not installed.',
      'Run `npm install lite4mariadb`, or switch DB_DRIVER=mysql to use a real MariaDB/MySQL server.',
    );
  }
  await fs.mkdir(config.db.dataDir, { recursive: true });
  const engine = (await Lite4MariaDB.create({ dataDir: config.db.dataDir })) as EmbeddedEngine;
  await engine.exec(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\``);
  await engine.exec(`USE \`${config.db.database}\``);
  return new EmbeddedDb(engine);
}

let db: DbClient | null = null;
let initPromise: Promise<DbClient> | null = null;

export async function getDb(): Promise<DbClient> {
  if (db) return db;
  if (!initPromise) {
    initPromise = (async () => {
      const client = config.db.driver === 'mysql' ? await createRemote() : await createEmbedded();
      db = client;
      return client;
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

export function dbSync(): DbClient {
  if (!db) throw new Error('Database has not been initialised yet');
  return db;
}

/* ------------------------------------------------------------------ */
/* schema + migrations                                                 */
/* ------------------------------------------------------------------ */

/**
 * Creates every table (idempotent), records the schema version and fills in any
 * missing setting keys. Safe to run on every boot and on a brand-new database.
 */
export async function migrate(client?: DbClient): Promise<{ tables: number }> {
  const database = client ?? (await getDb());
  for (const statement of SCHEMA_STATEMENTS) {
    await database.execute(statement);
  }
  await database.execute(
    'INSERT INTO schema_migrations (version) VALUES (?) ON DUPLICATE KEY UPDATE version = VALUES(version)',
    [SCHEMA_VERSION],
  );
  // Seed any missing settings keys without clobbering customised values.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await database.execute(
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = setting_value',
      [key, value],
    );
  }
  const rows = await database.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
  );
  return { tables: Number(rows[0]?.total ?? SCHEMA_STATEMENTS.length) };
}

/** Publish posts whose scheduled time has arrived. Returns the number published. */
export async function publishDuePosts(client: DbClient): Promise<number> {
  const result = await client.execute(
    `UPDATE posts
        SET status = 'published',
            published_at = COALESCE(published_at, UTC_TIMESTAMP())
      WHERE type = 'post' AND status = 'scheduled' AND published_at IS NOT NULL AND published_at <= UTC_TIMESTAMP()`,
  );
  return result.affected;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
    initPromise = null;
  }
}
