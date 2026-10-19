import { Router } from 'express';
import { asyncRoute } from '../../lib/http.js';
import { dashboardStats } from '../../services/stats.js';
import { recentActivity } from '../../services/activity.js';
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { listTags } from '../../services/posts.js';

const router = Router();

router.get(
  '/',
  asyncRoute(async (_req, res) => {
    const [stats, activity, tags] = await Promise.all([dashboardStats(), recentActivity(8), listTags(true)]);
    const db = await getDb();
    const dbInfo = await db.query<{ version: string; database_name: string }>(
      'SELECT VERSION() AS version, DATABASE() AS database_name',
    );
    res.render('admin/dashboard', {
      layout: 'layouts/admin',
      title: 'Dashboard',
      page: 'dashboard',
      adminTitle: 'Dashboard',
      adminDescription: 'A calm overview of the publication.',
      stats,
      activity,
      tags: tags.filter((tag) => (tag.post_count ?? 0) > 0).slice(0, 10),
      dbInfo: {
        driver: config.db.driver,
        version: dbInfo[0]?.version ?? 'MariaDB',
        database: dbInfo[0]?.database_name ?? config.db.database,
        engine: config.db.driver === 'embedded' ? 'embedded (WASM)' : 'remote server',
      },
    });
  }),
);

export default router;
