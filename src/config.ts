import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root — works from both `src/` (tsx) and `dist/` (compiled). */
export const ROOT_DIR = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const VIEWS_DIR = path.join(ROOT_DIR, 'views');
export const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 3000),
  siteUrl: (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET ?? 'azure-gravy-development-secret-change-me',
  db: {
    driver: (process.env.DB_DRIVER ?? 'embedded') as 'embedded' | 'mysql',
    database: process.env.DB_NAME ?? 'azuregravy',
    dataDir: path.resolve(ROOT_DIR, process.env.DB_DATA_DIR ?? './data/mariadb'),
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
  },
  admin: {
    email: process.env.ADMIN_EMAIL ?? 'admin@azuregravy.local',
    password: process.env.ADMIN_PASSWORD ?? 'gravy123',
  },
  uploads: {
    maxBytes: 12 * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  },
};

export type Config = typeof config;
