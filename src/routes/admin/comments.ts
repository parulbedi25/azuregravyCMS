import { Router } from 'express';
import { asyncRoute, pageParam, paginate, setFlash } from '../../lib/http.js';
import { requireRole } from '../../lib/auth.js';
import { str } from '../helpers.js';
import {
  commentCounts, deleteComment, listComments, markSpamAndRelated, moderateComment, getComment,
} from '../../services/comments.js';
import { logActivity } from '../../services/activity.js';
import type { CommentStatus } from '../../types.js';

const router = Router();

router.get(
  '/comments',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    const status = (typeof req.query.status === 'string' ? req.query.status : 'pending') as CommentStatus | 'all';
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = pageParam(req.query.page);
    const [{ comments, total }, counts] = await Promise.all([
      listComments({ status, search: search || undefined, page, perPage: 20 }),
      commentCounts(),
    ]);
    res.render('admin/comments', {
      layout: 'layouts/admin',
      title: 'Comments',
      adminTitle: 'Comments',
      adminDescription: 'Moderate the conversation around your stories.',
      page: 'comments',
      comments,
      counts,
      status,
      search,
      pagination: paginate(total, page, 20),
    });
  }),
);

router.post(
  '/comments/:id/status',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    const status = str(req.body.status) as CommentStatus;
    if (!['approved', 'pending', 'spam', 'trash'].includes(status)) {
      setFlash(req, 'error', 'Unknown moderation action.');
      return res.redirect(str(req.body.redirect, '/admin/comments'));
    }
    const comment = await getComment(Number(req.params.id));
    if (status === 'spam') await markSpamAndRelated(Number(req.params.id));
    else await moderateComment(Number(req.params.id), status);
    if (comment) await logActivity(res.locals.currentUser.id, `comment:${status}`, comment.author_name);
    setFlash(req, 'success', `Comment marked ${status}.`);
    res.redirect(str(req.body.redirect, '/admin/comments'));
  }),
);

router.post(
  '/comments/:id/delete',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    await deleteComment(Number(req.params.id));
    setFlash(req, 'success', 'Comment deleted.');
    res.redirect(str(req.body.redirect, '/admin/comments?status=all'));
  }),
);

export default router;
