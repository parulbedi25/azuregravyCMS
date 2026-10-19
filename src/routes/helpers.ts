import type { Response } from 'express';

/** Render the public error/status page with the right layout. */
export function errorPage(res: Response, status: number, title: string, message: string): void {
  res.status(status).render('public/error', {
    layout: 'layouts/public',
    title,
    pageTitle: title,
    status,
    message,
  });
}

/** Render an admin error page. */
export function adminError(res: Response, status: number, title: string, message: string): void {
  res.status(status).render('admin/error', {
    layout: 'layouts/admin',
    title,
    status,
    message,
    page: 'error',
  });
}

/** Split comma separated ids. */
export function parseIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return list
    .map((item) => Number.parseInt(String(item).trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);
}

export function parseTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export function bool(value: unknown): boolean {
  return value === '1' || value === 'on' || value === 'true' || value === true;
}

export function int(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
