import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { applyDbConfig, config, type DbConfigInput } from '../config.js';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION, DEFAULT_SETTINGS } from './schema.js';
import { postListPath, structureFrom } from '../lib/permalink.js';

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

export const mysqlErrorCode = (error: unknown): string => {
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' ? code : '';
};

/**
 * Plain-English remedy for each MySQL failure.
 *
 * The same text is shown by the installer (where the values are form fields) and by
 * the "Database unreachable" page (where they live in .env or data/install.json), so
 * it names the *values* rather than only the environment variables.
 */
export function connectionHint(error: unknown): string {
  switch (mysqlErrorCode(error)) {
    case 'ER_ACCESS_DENIED_ERROR':
      return [
        'The user and password do not match, or the user has no rights on this database.',
        'On cPanel the user name is prefixed, e.g. `myaccount_gravy`, and the user must be',
        'added to the database in cPanel → MySQL® Databases → Add User To Database',
        'with ALL PRIVILEGES. Elsewhere, check DB_USER / DB_PASSWORD.',
      ].join('\n');
    case 'ER_DBACCESS_DENIED_ERROR':
      return [
        'The user signed in but may not use this database.',
        'In cPanel → MySQL® Databases → Add User To Database, grant ALL PRIVILEGES on it.',
      ].join('\n');
    case 'ER_BAD_DB_ERROR':
      return [
        'That database does not exist.',
        'Create it in cPanel → MySQL® Databases and use the *full* name (`myaccount_gravy`).',
        'If the database user is allowed to create databases, tick "create the database if it',
        'is missing" and the app will do it for you.',
      ].join('\n');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The host could not be resolved. On cPanel this is almost always `localhost`.';
    case 'ECONNREFUSED':
      return 'Nothing is listening on that host/port. On cPanel use host `localhost` and port 3306.';
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
      return 'The server did not answer in time. Shared hosts sometimes block remote MySQL — use `localhost`, or ask the host to allow your IP.';
    case 'ER_NOT_SUPPORTED_AUTH_MODE':
      return 'The server uses an old authentication plugin. Ask the host to set the user to mysql_native_password.';
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ECONNRESET':
      return 'The server closed the connection. Check that the host and port are right, and that the server accepts connections from this machine.';
    default:
      return 'Check the host, port, database name, user and password.';
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

const asNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

interface ConnectionTarget {
  driver: 'embedded' | 'mysql';
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  connectTimeout: number;
  dataDir: string;
  createDatabase: boolean;
}

/** Fill in the gaps so the rest of the file can work with plain strings/numbers. */
export function normaliseTarget(input: DbConfigInput = config.db): ConnectionTarget {
  return {
    driver: input.driver === 'embedded' ? 'embedded' : 'mysql',
    host: (input.host ?? '').trim() || 'localhost',
    port: asNumber(input.port, 3306),
    user: (input.user ?? '').trim(),
    password: input.password ?? '',
    database: (input.database ?? '').trim(),
    ssl: Boolean(input.ssl),
    connectTimeout: asNumber(input.connectTimeout, 12_000),
    dataDir: input.dataDir || config.db.dataDir,
    createDatabase: input.createDatabase !== false,
  };
}

function poolOptions(target: ConnectionTarget, includeDatabase = true): mysql.PoolOptions {
  return {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    ...(includeDatabase && target.database ? { database: target.database } : {}),
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 5,
    idleTimeout: 60_000,
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true,
    timezone: 'Z',
    multipleStatements: false,
    connectTimeout: target.connectTimeout,
    ...(target.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

const safeName = (name: string) => name.replace(/`/g, '');

/**
 * Connect, creating the database first when the account is allowed to.
 * Shared hosts usually are not — in that case the error explains what to do in cPanel.
 */
async function createRemote(target: ConnectionTarget): Promise<DbClient> {
  const pool = mysql.createPool(poolOptions(target, true));

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return new RemoteDb(pool);
    } catch (error) {
      lastError = error;
      const code = mysqlErrorCode(error);

      // 1049 — the database itself is missing. Try to create it once.
      if (code === 'ER_BAD_DB_ERROR' && attempt === 1 && target.createDatabase) {
        try {
          const bootstrapPool = mysql.createPool(poolOptions(target, false));
          await bootstrapPool.query(
            `CREATE DATABASE IF NOT EXISTS \`${safeName(target.database)}\`
             CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
          );
          await bootstrapPool.end();
          continue;
        } catch (createError) {
          await pool.end().catch(() => undefined);
          throw new DbSetupError(
            `Connected to ${target.host}, but the database \`${target.database}\` does not exist and this user cannot create it.`,
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
    `Could not connect to the database at ${target.host}:${target.port} (${mysqlErrorCode(lastError) || 'unknown error'}).`,
    connectionHint(lastError),
    lastError,
  );
}

async function createEmbedded(target: ConnectionTarget): Promise<DbClient> {
  let Lite4MariaDB: { create(opts?: { dataDir?: string }): Promise<unknown> };
  try {
    ({ Lite4MariaDB } = (await import('lite4mariadb')) as unknown as {
      Lite4MariaDB: { create(opts?: { dataDir?: string }): Promise<unknown> };
    });
  } catch {
    throw new DbSetupError(
      'The built-in MariaDB engine was requested but the optional `lite4mariadb` package is not installed.',
      'Run `npm install` (it is an optional dependency), or choose "MariaDB / MySQL server" in the installer.',
    );
  }
  await fs.mkdir(target.dataDir, { recursive: true });
  const engine = (await Lite4MariaDB.create({ dataDir: target.dataDir })) as EmbeddedEngine;
  await engine.exec(`CREATE DATABASE IF NOT EXISTS \`${safeName(target.database || 'gravy')}\``);
  await engine.exec(`USE \`${safeName(target.database || 'gravy')}\``);
  return new EmbeddedDb(engine);
}

async function connect(target: ConnectionTarget): Promise<DbClient> {
  return target.driver === 'mysql' ? createRemote(target) : createEmbedded(target);
}

let db: DbClient | null = null;
let initPromise: Promise<DbClient> | null = null;

/** True once a client is connected in this process. */
export function dbIsReady(): boolean {
  return db !== null;
}

/** True when we know *where* the database is (environment or installer). */
export function dbIsConfigured(): boolean {
  return config.db.configured;
}

const NOT_CONFIGURED_HINT = [
  'No database details have been given yet, so nothing was attempted.',
  'Open the installer in your browser and enter them — it tests the connection,',
  'creates the tables and creates your administrator account:',
  '',
  '    http://localhost:3000/admin/setup',
  '',
  'Alternatively set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME in .env',
  '(or as environment variables in cPanel) and restart the app.',
].join('\n');

/**
 * The connection is opened on first use, never at boot.
 *
 * Callers that run before the installer has finished get a `DbSetupError` with a
 * friendly hint; the HTTP layer turns that into the installer redirect or the
 * "database is not reachable" page instead of a stack trace or a dead process.
 */
export async function getDb(): Promise<DbClient> {
  if (db) return db;
  if (!config.db.configured) {
    throw new DbSetupError('The database has not been configured yet.', NOT_CONFIGURED_HINT);
  }
  if (!initPromise) {
    initPromise = (async () => {
      const client = await connect(normaliseTarget(config.db));
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

/**
 * Point the running app at a different database (the installer calls this after a
 * successful connection test). Drops any existing pool so the next `getDb()`
 * reconnects with the new details.
 */
export async function setDbConfig(input: DbConfigInput): Promise<void> {
  await closeDb();
  applyDbConfig(input);
}

/* ------------------------------------------------------------------ */
/* connection probe used by the installer                              */
/* ------------------------------------------------------------------ */

export interface ConnectionTest {
  ok: boolean;
  driver: 'embedded' | 'mysql';
  /** Milliseconds the probe took — shown in the installer as reassurance. */
  ms: number;
  code?: string;
  message?: string;
  hint?: string;
  server?: string;
  database?: string;
  tables?: number;
  createdDatabase?: boolean;
}

/**
 * Try a set of credentials *without* touching the app's live connection and
 * *without* throwing. The installer shows `message` / `hint` inline, so a wrong
 * password is a form error rather than a crashed process.
 */
export async function testConnection(input: DbConfigInput): Promise<ConnectionTest> {
  const target = normaliseTarget(input);
  const started = Date.now();

  if (target.driver === 'embedded') {
    try {
      const client = await createEmbedded(target);
      const version = await client.query<{ v: string }>('SELECT VERSION() AS v');
      const database = await client.query<{ d: string | null }>('SELECT DATABASE() AS d');
      const tables = await client.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
      );
      await client.close();
      return {
        ok: true,
        driver: 'embedded',
        ms: Date.now() - started,
        server: String(version[0]?.v ?? 'MariaDB'),
        database: database[0]?.d ?? target.database,
        tables: Number(tables[0]?.total ?? 0),
      };
    } catch (error) {
      return {
        ok: false,
        driver: 'embedded',
        ms: Date.now() - started,
        code: mysqlErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
        hint:
          error instanceof DbSetupError && error.hint
            ? error.hint
            : 'The built-in engine could not open its data directory. Check that ./data is writable.',
      };
    }
  }

  // One connection, one attempt, short timeout: the installer should answer fast.
  const options: mysql.ConnectionOptions = {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    connectTimeout: Math.min(target.connectTimeout, 8_000),
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true,
    timezone: 'Z',
    multipleStatements: false,
    ...(target.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };

  let createdDatabase = false;

  const probe = async (withDatabase: boolean): Promise<mysql.Connection> => {
    const connection = await mysql.createConnection(
      withDatabase && target.database ? { ...options, database: target.database } : options,
    );
    return connection;
  };

  try {
    let connection: mysql.Connection;
    try {
      connection = await probe(true);
    } catch (error) {
      if (mysqlErrorCode(error) !== 'ER_BAD_DB_ERROR' || !target.createDatabase) throw error;
      // The credentials worked, the database itself is missing — try to create it.
      connection = await probe(false);
      try {
        await connection.query(
          `CREATE DATABASE IF NOT EXISTS \`${safeName(target.database)}\`
           CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
        createdDatabase = true;
      } catch (createError) {
        await connection.end().catch(() => undefined);
        return {
          ok: false,
          driver: 'mysql',
          ms: Date.now() - started,
          code: 'ER_DBACCESS_DENIED_ERROR',
          message: `Signed in to ${target.host}, but the database \`${target.database}\` does not exist and this user may not create it.`,
          hint: [
            'Create the database in cPanel → MySQL® Databases, then add your user to it',
            'with ALL PRIVILEGES. Use the full prefixed name (for example `myaccount_gravy`).',
          ].join('\n'),
        };
      }
    }

    try {
      if (createdDatabase || !target.database) {
        await connection.query(`USE \`${safeName(target.database)}\``);
      }
      const [infoRows] = await connection.query<(mysql.RowDataPacket & { version: string; database: string | null })[]>(
        'SELECT VERSION() AS version, DATABASE() AS database',
      );
      const [countRows] = await connection.query<(mysql.RowDataPacket & { total: number })[]>(
        `SELECT COUNT(*) AS total FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
      );
      const info = infoRows[0];
      return {
        ok: true,
        driver: 'mysql',
        ms: Date.now() - started,
        server: String(info?.version ?? ''),
        database: info?.database ?? target.database,
        tables: Number(countRows[0]?.total ?? 0),
        createdDatabase,
      };
    } finally {
      await connection.end().catch(() => undefined);
    }
  } catch (error) {
    return {
      ok: false,
      driver: 'mysql',
      ms: Date.now() - started,
      code: mysqlErrorCode(error) || 'UNKNOWN',
      message:
        mysqlErrorCode(error) === 'ER_ACCESS_DENIED_ERROR'
          ? `The database rejected these credentials (${target.user}@${target.host}).`
          : `Could not connect to ${target.user ? `${target.user}@` : ''}${target.host}:${target.port} (${mysqlErrorCode(error) || 'unknown error'}).`,
      hint: connectionHint(error),
    };
  }
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

  /*
    Repoint navigation left behind by the Stories -> Posts rename.

    DEFAULT_MENU only ever reaches a *new* database: the settings and menu
    seeding above is deliberately non-destructive, so an existing install keeps
    the rows it was seeded with. Without this, an upgrade leaves the primary and
    footer menus reading "Stories" and pointing at /stories, which now answers
    with a 301 — the rename would never reach the site's own navigation, and
    every click would cost a redirect hop.

    Both statements are idempotent and match nothing once applied. Order matters:
    the label update runs first, while the url still identifies the seeded rows.

    The label update requires *both* halves of the seeded default (label
    'Stories' AND url '/stories'), so a menu item an editor renamed by hand is
    never rewritten on every subsequent boot. The url update is deliberately
    broader — anything still pointing at /stories now costs a 301 on every
    click, so it is repointed whatever its label, and follows the list path the
    current permalink structure implies.
  */
  await database.execute(
    `UPDATE menu_items SET label = 'Posts' WHERE label = 'Stories' AND url = '/stories'`,
  );
  const structureRows = await database.query<{ setting_value: string | null }>(
    'SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1',
    ['permalink_structure'],
  );
  const menuListPath = postListPath(
    structureFrom({ permalink_structure: structureRows[0]?.setting_value ?? '' }),
  );
  await database.execute('UPDATE menu_items SET url = ? WHERE url = ?', [menuListPath, '/stories']);
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
  initPromise = null;
  if (db) {
    const closing = db;
    db = null;
    await closing.close().catch(() => undefined);
  }
}
