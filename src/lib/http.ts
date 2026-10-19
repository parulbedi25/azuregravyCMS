import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wrap async route handlers so rejected promises reach Express' error handler. */
export const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function getCsrfToken(req: Request): string {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

export function verifyCsrf(req: Request): boolean {
  const submitted =
    (req.body && typeof req.body === 'object' && (req.body._csrf as string)) ||
    (req.get('x-csrf-token') ?? '') ||
    (typeof req.query._csrf === 'string' ? req.query._csrf : '');
  return !!req.session.csrfToken && typeof submitted === 'string' && submitted === req.session.csrfToken;
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  res.locals.csrfToken = getCsrfToken(req);
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const multipart = (req.get('content-type') ?? '').includes('multipart/form-data');
  if (safe || multipart) return next(); // multipart routes verify after multer parses fields
  if (verifyCsrf(req)) return next();
  if (req.path.startsWith('/api') || req.xhr || (req.get('accept') ?? '').includes('application/json')) {
    res.status(419).json({ error: 'Your session expired. Refresh the page and try again.' });
    return;
  }
  res.status(419).render('public/error', {
    layout: 'layouts/plain',
    title: 'Session expired',
    status: 419,
    message: 'Your security token expired. Please go back, refresh the page and try again.',
  });
}

export function setFlash(req: Request, type: 'success' | 'error' | 'info' | 'warning', message: string): void {
  req.session.flash = [...(req.session.flash ?? []), { type, message }];
}

export function flashMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.locals.flash = req.session.flash ?? [];
  req.session.flash = [];
  next();
}

export interface Pagination {
  page: number;
  perPage: number;
  total: number;
  pageCount: number;
  offset: number;
  hasPrev: boolean;
  hasNext: boolean;
  pages: Array<number | '…'>;
  from: number;
  to: number;
}

export function paginate(total: number, page: number, perPage: number): Pagination {
  const safePerPage = Math.max(1, perPage);
  const pageCount = Math.max(1, Math.ceil(total / safePerPage));
  const current = Math.min(Math.max(1, page), pageCount);
  const offset = (current - 1) * safePerPage;
  const pages: Array<number | '…'> = [];
  for (let i = 1; i <= pageCount; i += 1) {
    if (i === 1 || i === pageCount || Math.abs(i - current) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return {
    page: current,
    perPage: safePerPage,
    total,
    pageCount,
    offset,
    hasPrev: current > 1,
    hasNext: current < pageCount,
    pages,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + safePerPage, total),
  };
}

export function pageParam(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Build a query string preserving existing params but replacing some. */
export function withQuery(current: Record<string, unknown>, updates: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === 'string' && value !== '') params.set(key, value);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '';
}
