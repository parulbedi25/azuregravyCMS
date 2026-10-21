import fs from 'node:fs/promises';
import { applyDbConfig, DATA_DIR, INSTALL_FILE, type DbConfigInput, type DbConfigSource } from '../config.js';

/**
 * The installer's memory.
 *
 * `data/install.json` is the single place the database details live once the
 * browser installer has accepted them — the equivalent of WordPress writing
 * `wp-config.php`. Environment variables still win, so a cPanel deployment that
 * sets `DB_HOST` / `DB_USER` / … never depends on this file.
 */

export interface InstallRecord {
  /** Omitted when the credentials came from the environment instead of the installer. */
  db?: DbConfigInput;
  /** ISO timestamp of the moment the super admin was created. */
  installedAt?: string;
  /** Bumped if the record shape ever changes. */
  version: number;
}

export const INSTALL_VERSION = 1;

async function write(record: InstallRecord): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // 0600 — the file contains a database password.
  await fs.writeFile(INSTALL_FILE, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(INSTALL_FILE, 0o600).catch(() => undefined);
}

/**
 * Accept a tested database configuration: apply it to the running process and
 * remember it for the next boot.
 */
export async function saveDbConfig(input: DbConfigInput, source: DbConfigSource = 'installer'): Promise<void> {
  const record: InstallRecord = { db: input, version: INSTALL_VERSION };
  try {
    const existing = JSON.parse(await fs.readFile(INSTALL_FILE, 'utf8')) as InstallRecord;
    if (existing?.installedAt) record.installedAt = existing.installedAt;
  } catch {
    /* first write */
  }
  await write(record);
  applyDbConfig(input, source);
}

/** Stamp the installation as finished (super admin created). */
/**
 * Stamp the installation as finished (super admin created).
 *
 * Environment-provided credentials are *not* copied into the file — the record only
 * ever holds what the browser installer was given, plus the moment it completed.
 */
export async function recordInstalled(): Promise<void> {
  const record: InstallRecord = {
    installedAt: new Date().toISOString(),
    version: INSTALL_VERSION,
  };
  try {
    const existing = JSON.parse(await fs.readFile(INSTALL_FILE, 'utf8')) as InstallRecord;
    if (existing?.db && Object.keys(existing.db).length > 0) record.db = existing.db;
  } catch {
    /* nothing stored yet */
  }
  await write(record);
}

/** Forget the stored configuration (used by `db:reset` and the installer's "start over"). */
export async function clearDbConfig(): Promise<void> {
  await fs.rm(INSTALL_FILE, { force: true });
}

export { INSTALL_FILE };
