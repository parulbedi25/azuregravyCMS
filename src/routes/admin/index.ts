import { Router } from 'express';
import { requireAuth } from '../../lib/auth.js';
import { setFlash } from '../../lib/http.js';
import { getDb } from '../../db/index.js';
import { DEFAULT_SETTINGS } from '../../db/schema.js';
import { resolveAiAccess, unavailableAiAccess } from '../../services/ai-access.js';
import type { SettingsMap, User } from '../../types.js';
import authRoutes from './auth.js';
import setupRoutes from './setup.js';
import dashboardRoutes from './dashboard.js';
import postRoutes from './posts.js';
import taxonomyRoutes from './taxonomy.js';
import mediaRoutes from './media.js';
import commentRoutes from './comments.js';
import peopleRoutes from './people.js';
import settingsRoutes from './settings.js';
import aiRoutes from './ai.js';

const router = Router();

router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  res.locals.bodyClass = 'admin-body';
  res.locals.page = 'dashboard';
  res.locals.adminTitle = 'Studio';
  res.locals.isAdmin = true;
  res.locals.navCounts = { pending: 0, drafts: 0, unread: 0, pendingComments: 0 };
  res.locals.adminDescription = '';
  res.locals.sidebarCollapsed = false;
  next();
});

// First-run installer — only reachable while the site has no administrator.
router.use(setupRoutes);
router.use(authRoutes);

router.use(async (req, res, next) => {
  if (!res.locals.currentUser) return next();
  try {
    const db = await getDb();
    const rows = await db.query<{ pending: number; drafts: number; unread: number; scheduled: number }>(
      `SELECT
         (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS pending,
         (SELECT COUNT(*) FROM posts WHERE status = 'draft') AS drafts,
         (SELECT COUNT(*) FROM contact_messages WHERE is_read = 0) AS unread,
         (SELECT COUNT(*) FROM posts WHERE status = 'scheduled') AS scheduled`,
    );
    res.locals.navCounts = {
      pending: Number(rows[0]?.pending ?? 0),
      pendingComments: Number(rows[0]?.pending ?? 0),
      drafts: Number(rows[0]?.drafts ?? 0),
      unread: Number(rows[0]?.unread ?? 0),
      scheduled: Number(rows[0]?.scheduled ?? 0),
    };
    next();
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);

/*
  Per-member AI entitlement, resolved once per authenticated admin request.

  Two reasons this lives here rather than in `h` (the view helpers):

    - `buildHelpers` runs in app.ts *before* attachUser, so the helpers are built
      without knowing who is asking. Reordering that middleware would put the
      session-dependent user lookup ahead of the flash and CSRF handling, for no
      benefit beyond convenience here.
    - `h.aiStatus` stays the site-wide truth, which is what the settings page and
      the public error pages want. Who *this* person may do is a separate answer.

  Mounted after requireAuth, so currentUser always exists, and after the app-level
  locals middleware, so res.locals.settings is already loaded and this costs one
  indexed primary-key lookup rather than a second settings read.

  A failure degrades to "no access" instead of propagating: the assistant is
  optional and the rest of the Studio is not, so an unreadable entitlement table
  must not take the dashboard down with it. Denying is the safe direction.
*/
router.use(async (req, res, next) => {
  const user = (res.locals.currentUser as User | null) ?? null;
  const settings = (res.locals.settings as SettingsMap | undefined) ?? (DEFAULT_SETTINGS as SettingsMap);
  try {
    res.locals.aiAccess = await resolveAiAccess(user, settings);
    next();
  } catch (error) {
    console.error('[ai] could not resolve AI access; denying rather than failing the request', error);
    res.locals.aiAccess = unavailableAiAccess(settings, 'The AI assistant is unavailable right now.');
    next();
  }
});

router.use(dashboardRoutes);
router.use(postRoutes);
router.use(taxonomyRoutes);
router.use(mediaRoutes);
router.use(commentRoutes);
router.use(peopleRoutes);
router.use(settingsRoutes);
router.use(aiRoutes);

router.post('/logout', (req, res) => {
  const user = res.locals.currentUser;
  req.session.destroy(() => {
    res.clearCookie('gravy.sid');
    if (user) console.log(`[auth] user ${user.id} signed out`);
    void setFlash;
    res.redirect('/admin/login');
  });
});

export default router;
