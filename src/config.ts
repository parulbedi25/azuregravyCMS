import dotenv from 'dotenv';
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

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

/**
 * Passenger (cPanel) sometimes hands the app a unix socket path in `PORT`
 * instead of a number. Keep both shapes.
 */
const rawPort = (process.env.PORT ?? '').trim();
const isSocketPort = rawPort !== '' && !/^\d+$/.test(rawPort);

/** `mysql://user:password@host:3306/database` — the usual cPanel/PaaS shape. */
function parseDatabaseUrl(raw: string): { host?: string; port?: number; user?: string; password?: string; database?: string } {
  if (!raw) return {};
  try {
    const url = new URL(raw);
    if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') return {};
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return {
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

const dbUrl = process.env.DATABASE_URL ?? process.env.MYSQL_URL ?? '';
const fromUrl = parseDatabaseUrl(dbUrl);

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  /** TCP port used when PORT is a number (default 3000). */
  port: isSocketPort ? 3000 : num(rawPort, 3000),
  /** Set when Passenger hands us a unix socket path instead of a port. */
  socketPath: isSocketPort ? rawPort : null,
  host: process.env.HOST ?? '0.0.0.0',
  siteUrl: (process.env.SITE_URL ?? '').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET ?? 'azure-gravy-development-secret-change-me',
  db: {
    /**
     * `mysql`  — any MariaDB/MySQL server (cPanel, Namecheap, RDS, PlanetScale…).
     * `embedded` — real MariaDB compiled to WebAssembly, for offline demos and tests.
     */
    driver: ((process.env.DB_DRIVER ?? 'mysql').trim().toLowerCase() === 'embedded' ? 'embedded' : 'mysql') as 'embedded' | 'mysql',
    url: dbUrl,
    database: fromUrl.database ?? process.env.DB_NAME ?? 'azuregravy',
    dataDir: path.resolve(ROOT_DIR, process.env.DB_DATA_DIR ?? './data/mariadb'),
    host: fromUrl.host ?? process.env.DB_HOST ?? '127.0.0.1',
    port: fromUrl.port ?? num(process.env.DB_PORT, 3306),
    user: fromUrl.user ?? process.env.DB_USER ?? 'root',
    password: fromUrl.password ?? process.env.DB_PASSWORD ?? '',
    /** Managed hosts often require TLS; cPanel's `localhost` does not. */
    ssl: bool(process.env.DB_SSL, false),
    connectTimeout: num(process.env.DB_CONNECT_TIMEOUT, 15_000),
  },
  setup: {
    /** Seed the full demo publication (18 stories) on an empty database. */
    seedDemo: bool(process.env.SEED_DEMO, false),
    /** Optional super admin. Leave blank to create it in the browser wizard. */
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

/** Human-readable connection target for logs and error messages. */
export function describeDbTarget(): string {
  if (config.db.driver === 'embedded') return `embedded MariaDB (${config.db.dataDir})`;
  return `${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`;
}
