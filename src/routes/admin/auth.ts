import { Router } from 'express';
import { asyncRoute, clientIp, setFlash, verifyCsrf } from '../../lib/http.js';
import { safeNext, verifyPassword } from '../../lib/auth.js';
import { getUserByEmail, updateLastLogin } from '../../services/users.js';
import { logActivity } from '../../services/activity.js';
import { siteInstalled } from '../../db/bootstrap.js';

const router = Router();

/* ------------------------------------------------------------------ */
/* brute-force protection                                             */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 6;
const LOCK_MS = 15 * 60 * 1000;

interface Attempt {
  count: number;
  first: number;
  blockedUntil: number;
}

const attempts = new Map<string, Attempt>();

function attemptKey(ip: string, email: string): string {
  return `${ip}|${email}`;
}

/** Remaining lock time in minutes, or 0 when the key is free. */
function lockedFor(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  if (entry.blockedUntil > Date.now()) {
    return Math.ceil((entry.blockedUntil - Date.now()) / 60_000);
  }
  if (entry.blockedUntil && entry.blockedUntil <= Date.now()) attempts.delete(key);
  return 0;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now, blockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) entry.blockedUntil = now + LOCK_MS;
}

/** Keep the map from growing without bound on a long-lived process. */
function prune(): void {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    const stale = entry.blockedUntil ? entry.blockedUntil < now : now - entry.first > WINDOW_MS;
    if (stale) attempts.delete(key);
  }
}

/* ------------------------------------------------------------------ */

router.get(
  '/login',
  asyncRoute(async (req, res) => {
    if (res.locals.currentUser) return res.redirect(safeNext(req.query.next));
    // A brand-new install has no accounts yet: send the visitor to the wizard.
    if (!(await siteInstalled())) return res.redirect('/admin/setup');
    res.render('admin/login', {
      layout: 'layouts/auth',
      title: 'Sign in',
      bodyClass: 'admin-body',
      pageTitle: 'Studio sign in',
      next: safeNext(req.query.next),
      email: '',
    });
  }),
);

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const next = safeNext(req.body.next);

    if (!verifyCsrf(req)) {
      setFlash(req, 'error', 'Your session expired. Please try again.');
      return res.redirect('/admin/login');
    }

    const key = attemptKey(clientIp(req), email);
    const wait = lockedFor(key);
    if (wait > 0) {
      setFlash(req, 'error', `Too many sign-in attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
      return res.status(429).render('admin/login', {
        layout: 'layouts/auth',
        title: 'Sign in',
        bodyClass: 'admin-body',
        pageTitle: 'Studio sign in',
        next,
        email,
      });
    }

    const user = await getUserByEmail(email);
    const valid = user ? await verifyPassword(password, user.password_hash) : false;

    if (!user || !valid) {
      recordFailure(key);
      if (attempts.size > 500) prune();
      setFlash(req, 'error', 'Those credentials did not match. Check your email and password.');
      return res.status(401).render('admin/login', {
        layout: 'layouts/auth',
        title: 'Sign in',
        bodyClass: 'admin-body',
        pageTitle: 'Studio sign in',
        next,
        email,
      });
    }

    attempts.delete(key);

    req.session.regenerate(async (error) => {
      if (error) {
        setFlash(req, 'error', 'Could not start a session. Please try again.');
        return res.redirect('/admin/login');
      }
      req.session.userId = user.id;
      await updateLastLogin(user.id);
      await logActivity(user.id, 'login', 'Signed in to the Studio');
      setFlash(req, 'success', `Welcome back, ${user.name.split(' ')[0]}.`);
      res.redirect(next);
    });
  }),
);

export default router;
