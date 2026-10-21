import { Router } from 'express';
import { requireAuth } from '../../lib/auth.js';
import { setFlash } from '../../lib/http.js';
import { getDb } from '../../db/index.js';
import authRoutes from './auth.js';
import setupRoutes from './setup.js';
import dashboardRoutes from './dashboard.js';
import postRoutes from './posts.js';
import taxonomyRoutes from './taxonomy.js';
import mediaRoutes from './media.js';
import commentRoutes from './comments.js';
import peopleRoutes from './people.js';
import settingsRoutes from './settings.js';

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

router.use(dashboardRoutes);
router.use(postRoutes);
router.use(taxonomyRoutes);
router.use(mediaRoutes);
router.use(commentRoutes);
router.use(peopleRoutes);
router.use(settingsRoutes);

router.post('/logout', (req, res) => {
  const user = res.locals.currentUser;
  req.session.destroy(() => {
    res.clearCookie('gravy.sid');
    if (user) console.log(`[auth] ${user.email} signed out`);
    void setFlash;
    res.redirect('/admin/login');
  });
});

export default router;
