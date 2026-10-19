import { getDb } from '../db/index.js';
import type { SettingsMap } from '../types.js';

let cache: SettingsMap | null = null;
let cachedAt = 0;
const TTL = 15_000;

export async function loadSettings(force = false): Promise<SettingsMap> {
  if (!force && cache && Date.now() - cachedAt < TTL) return cache;
  const db = await getDb();
  const rows = await db.query<{ setting_key: string; setting_value: string | null }>('SELECT setting_key, setting_value FROM settings');
  cache = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value ?? '']));
  cachedAt = Date.now();
  return cache;
}

export function invalidateSettings(): void {
  cache = null;
  cachedAt = 0;
}

export async function saveSettings(values: Record<string, string | number | boolean | null | undefined>): Promise<void> {
  const db = await getDb();
  for (const [key, raw] of Object.entries(values)) {
    const value = raw === null || raw === undefined ? '' : String(raw);
    await db.execute(
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [key, value],
    );
  }
  invalidateSettings();
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const settings = await loadSettings();
  return settings[key] ?? fallback;
}

export function settingFrom(settings: SettingsMap, key: string, fallback = ''): string {
  const value = settings[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

export function truthy(value: string | undefined | null): boolean {
  return value === '1' || value === 'true' || value === 'on';
}
