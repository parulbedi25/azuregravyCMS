import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import type { Post, Role, User } from '../types.js';

const scrypt = promisify(scryptCb);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

const ROLE_RANK: Record<Role, number> = { author: 1, editor: 2, admin: 3 };

export const roleAtLeast = (role: Role, minimum: Role) => ROLE_RANK[role] >= ROLE_RANK[minimum];

export async function findUserById(id: number): Promise<User | null> {
  const db = await getDb();
  const rows = await db.query<User>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

export function publicUser(user: User) {
  const { password_hash: _hash, ...rest } = user;
  return rest;
}

/** Load the signed-in user once per request. */
export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.locals.currentUser = null;
  res.locals.can = { admin: false, editor: false, author: false };
  const id = req.session.userId;
  if (!id) return next();
  try {
    const user = await findUserById(id);
    if (!user) {
      req.session.userId = undefined;
      return next();
    }
    // Strip password_hash before the record enters res.locals, so no template,
    // error page or JSON dump can ever reach a credential hash.
    res.locals.currentUser = publicUser(user);
    res.locals.can = {
      admin: user.role === 'admin',
      editor: roleAtLeast(user.role, 'editor'),
      author: roleAtLeast(user.role, 'author'),
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.currentUser) return next();
  if (req.path.startsWith('/api') || req.xhr) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const target = req.originalUrl && req.originalUrl !== '/admin/login' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  res.redirect(`/admin/login${target}`);
}

export function requireRole(minimum: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals.currentUser as User | null;
    if (!user) {
      res.redirect('/admin/login');
      return;
    }
    if (!roleAtLeast(user.role, minimum)) {
      res.status(403).render('admin/error', {
        layout: 'layouts/admin',
        title: 'Not allowed',
        status: 403,
        message: `Your role (${user.role}) does not have access to this area.`,
        page: 'error',
      });
      return;
    }
    next();
  };
}

export function canEditPost(user: User | null | undefined, post: Pick<Post, 'author_id'> | null): boolean {
  if (!user) return false;
  if (roleAtLeast(user.role, 'editor')) return true;
  return !!post && post.author_id === user.id;
}

export function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/admin';
  const next = value.trim();
  /*
    Browsers normalise a backslash to a forward slash when resolving a
    special-scheme URL, so `/\evil.example` and `/\/evil.example` both resolve
    to a protocol-relative external redirect even though neither starts with
    `//`. Rejecting any backslash outright is sturdier than enumerating the
    encodings that happen to survive today's parsers.

    `%2F` is deliberately not decoded here: a browser resolving a Location
    header treats `/%2F%2Fevil.example` as a path, not a host, so decoding it
    would only create false rejections of legitimate in-site targets.
  */
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/admin';
  return next;
}
