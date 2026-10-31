import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root — works from both `src/` (tsx) and `dist/` (compiled). */
export const ROOT_DIR = path.resolve(here, '..');

// Load `.env` from the project root, whatever directory the process was started in
// (cPanel/Passenger starts the app from the application root, but be forgiving).
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });
dotenv.config({ quiet: true });

export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const VIEWS_DIR = path.join(ROOT_DIR, 'views');
export const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
export const DATA_DIR = path.join(ROOT_DIR, 'data');

/**
 * Base URL of the keyless feature-image fallback, normalised to end in exactly
 * one slash so callers can append an encoded prompt directly.
 *
 * Overridable for two reasons. An install that would rather not send the subject
 * of an unpublished draft to a public, unauthenticated service can point this at
 * its own image server. And it is the only way to exercise the fallback path in
 * a test, which otherwise needs outbound internet access.
 */
export const IMAGE_FALLBACK_URL =
  (process.env.AI_IMAGE_FALLBACK_URL || 'https://image.pollinations.ai/prompt/').replace(/\/+$/, '') + '/';

/**
 * Where the installer remembers the database it was given.
 *
 * The app never needs credentials to *start*: this file (or environment
 * variables) is read on boot, but nothing is connected until the first request
 * that needs it — or until the browser installer collects the details.
 */
export const INSTALL_FILE = path.join(DATA_DIR, 'install.json');

const num = (value: string | number | undefined, fallback: number) => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | number | boolean | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

/**
 * `SameSite` attribute for the session cookie. Anything unrecognised — including
 * an unset variable — falls back to `lax`, which is the safe default for a site
 * served top-level on its own domain.
 *
 * `none` is only for embedding the Studio in an iframe on a *different* site.
 * A cross-site iframe makes every request cross-site, and browsers withhold a
 * `lax` cookie from those entirely, so the session never survives to the next
 * request and every form POST fails its CSRF check.
 */
const sameSite = (value: string | undefined): 'lax' | 'strict' | 'none' => {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'strict' || v === 'none' ? v : 'lax';
};

/**
 * Passenger (cPanel) sometimes hands the app a unix socket path in `PORT`
 * instead of a number. Keep both shapes.
 */
const rawPort = (process.env.PORT ?? '').trim();
const isSocketPort = rawPort !== '' && !/^\d+$/.test(rawPort);

/* ------------------------------------------------------------------ */
/* database configuration                                              */
/* ------------------------------------------------------------------ */

/** Everything needed to reach a database. Every field optional: we merge sources. */
export interface DbConfigInput {
  driver?: 'embedded' | 'mysql';
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  dataDir?: string;
  connectTimeout?: number;
  /** Installer-only: try `CREATE DATABASE` when the database is missing. */
  createDatabase?: boolean;
}

export type DbConfigSource = 'none' | 'env' | 'installer' | 'env+installer';

/** `mysql://user:password@host:3306/database` — the usual cPanel/PaaS shape. */
function parseDatabaseUrl(raw: string): DbConfigInput {
  if (!raw) return {};
  try {
    const url = new URL(raw);
    if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') return {};
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return {
      driver: 'mysql',
      host: url.hostname || undefined,
      port: url.port ? Number(url.port) : undefined,
      user: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      database: database || undefined,
    };
  } catch {
    return {};
  }
}

/** Credentials supplied through the environment (cPanel env vars, `.env`, CI…). */
function dbFromEnv(): DbConfigInput {
  const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL ?? process.env.MYSQL_URL ?? '');
  const rawDriver = (process.env.DB_DRIVER ?? '').trim().toLowerCase();
  const text = (value: string | undefined) => (value === undefined || value.trim() === '' ? undefined : value.trim());
  return {
    driver: rawDriver === 'embedded' ? 'embedded' : rawDriver === 'mysql' ? 'mysql' : fromUrl.driver,
    host: fromUrl.host ?? text(process.env.DB_HOST),
    port: fromUrl.port ?? num(process.env.DB_PORT, NaN),
    user: fromUrl.user ?? text(process.env.DB_USER),
    password: fromUrl.password ?? (process.env.DB_PASSWORD === undefined ? undefined : process.env.DB_PASSWORD),
    database: fromUrl.database ?? text(process.env.DB_NAME),
    ssl: process.env.DB_SSL === undefined ? undefined : bool(process.env.DB_SSL, false),
    dataDir: text(process.env.DB_DATA_DIR),
    connectTimeout: num(process.env.DB_CONNECT_TIMEOUT, NaN),
  };
}

interface InstallRecord {
  db?: DbConfigInput;
  installedAt?: string;
}

/** The record the browser installer wrote on a previous run, if any. */
function readInstallRecord(): InstallRecord {
  try {
    const raw = fs.readFileSync(INSTALL_FILE, 'utf8');
    const parsed = JSON.parse(raw) as InstallRecord;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const installRecord = readInstallRecord();
const envDb = dbFromEnv();
const storedDb = installRecord.db ?? {};

/**
 * Do we know *where* the database is?
 *
 * Deliberately strict: with nothing configured the app still starts and serves
 * the installer instead of guessing `root@127.0.0.1/gravy` and failing.
 */
function isConfigured(input: DbConfigInput): boolean {
  if (input.driver === 'embedded') return true;
  if (input.driver !== 'mysql') return false;
  return Boolean(input.host && input.user && input.database);
}

function mergeDb(): DbConfigInput {
  const merged: DbConfigInput = { ...storedDb };
  for (const [key, value] of Object.entries(envDb) as [keyof DbConfigInput, unknown][]) {
    if (value !== undefined && value !== null && !(typeof value === 'number' && Number.isNaN(value))) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/** Did the environment actually say anything about the database? (NaN = "unset") */
function hasEnvDb(): boolean {
  return Object.values(envDb).some(
    (value) => value !== undefined && !(typeof value === 'number' && Number.isNaN(value)),
  );
}

const hasStoredDb = Object.keys(storedDb).length > 0;
const initialDb = mergeDb();

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  /** TCP port used when PORT is a number (default 3000). */
  port: isSocketPort ? 3000 : num(rawPort, 3000),
  /** Set when Passenger hands us a unix socket path instead of a port. */
  socketPath: isSocketPort ? rawPort : null,
  host: process.env.HOST ?? '0.0.0.0',
  siteUrl: (process.env.SITE_URL ?? '').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET ?? 'gravy-development-secret-change-me',
  /** See `sameSite()` above — `none` is only for cross-site iframe hosting. */
  sessionSameSite: sameSite(process.env.SESSION_SAMESITE),
  db: {
    /**
     * `mysql`    — any MariaDB/MySQL server (cPanel, Namecheap, RDS, PlanetScale…).
     * `embedded` — real MariaDB compiled to WebAssembly, for offline demos and tests.
     */
    driver: (initialDb.driver === 'embedded' ? 'embedded' : 'mysql') as 'embedded' | 'mysql',
    /** False until the installer (or environment) tells us where the database is. */
    configured: isConfigured(initialDb),
    source: (
      isConfigured(initialDb)
        ? hasStoredDb && hasEnvDb()
          ? 'env+installer'
          : hasStoredDb
            ? 'installer'
            : 'env'
        : 'none'
    ) as DbConfigSource,
    database: initialDb.database ?? '',
    dataDir: path.resolve(ROOT_DIR, initialDb.dataDir ?? './data/mariadb'),
    host: initialDb.host ?? '',
    port: Number.isFinite(initialDb.port as number) ? (initialDb.port as number) : 3306,
    user: initialDb.user ?? '',
    password: initialDb.password ?? '',
    /** Managed hosts often require TLS; cPanel's `localhost` does not. */
    ssl: bool(initialDb.ssl, false),
    connectTimeout: Number.isFinite(initialDb.connectTimeout as number) ? (initialDb.connectTimeout as number) : 12_000,
    /** Installer-only flag: attempt `CREATE DATABASE` when it is missing. */
    createDatabase: bool(initialDb.createDatabase, true),
  },
  setup: {
    /** Seed the full demo publication (18 posts) on an empty database. */
    seedDemo: bool(process.env.SEED_DEMO, false),
    /** Optional super admin. Leave blank to create it in the browser installer. */
    adminName: (process.env.ADMIN_NAME ?? 'Site Administrator').trim(),
    adminEmail: (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD ?? '',
  },
  uploads: {
    maxBytes: num(process.env.UPLOAD_MAX_MB, 12) * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  },
};

export type Config = typeof config;

/**
 * Point the running app at a different database — used by the browser installer
 * after a successful connection test. Mutates `config.db` in place so every
 * existing consumer (logs, Studio screens, seed scripts) sees the new target.
 */
export function applyDbConfig(input: DbConfigInput, source: DbConfigSource = 'installer'): void {
  const next = { ...config.db, ...stripUndefined(input) } as typeof config.db;
  config.db.driver = next.driver === 'embedded' ? 'embedded' : 'mysql';
  config.db.host = String(next.host ?? '');
  config.db.port = num(next.port, 3306);
  config.db.user = String(next.user ?? '');
  config.db.password = String(next.password ?? '');
  config.db.database = String(next.database ?? '');
  config.db.ssl = bool(next.ssl, false);
  config.db.connectTimeout = num(next.connectTimeout, 12_000);
  if (next.createDatabase !== undefined) config.db.createDatabase = bool(next.createDatabase, true);
  if (next.dataDir) config.db.dataDir = path.resolve(ROOT_DIR, next.dataDir);
  config.db.configured = isConfigured(config.db);
  config.db.source = config.db.configured ? source : 'none';
}

function stripUndefined(input: DbConfigInput): DbConfigInput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && !(typeof value === 'number' && Number.isNaN(value))) out[key] = value;
  }
  return out as DbConfigInput;
}

/** The database details to hand to the installer form as pre-filled values. */
export function dbConfigSnapshot(): DbConfigInput {
  return {
    driver: config.db.driver,
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
    dataDir: config.db.dataDir,
    connectTimeout: config.db.connectTimeout,
    createDatabase: config.db.createDatabase,
  };
}

/** Human-readable connection target for logs, the Studio and error messages. */
export function describeDbTarget(): string {
  if (!config.db.configured) return 'not configured yet';
  if (config.db.driver === 'embedded') return `embedded MariaDB (${config.db.dataDir})`;
  return `${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`;
}

/** When the installer finished, if it did. */
export function installedAt(): string | null {
  return installRecord.installedAt ?? null;
}
