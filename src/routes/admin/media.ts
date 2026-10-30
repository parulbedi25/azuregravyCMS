import { Router } from 'express';
import fs from 'node:fs';
import { imageSize } from 'image-size';
import { asyncRoute, pageParam, paginate, setFlash, verifyCsrf } from '../../lib/http.js';
import { requireRole } from '../../lib/auth.js';
import { describeUpload, MAX_UPLOAD_FILES, UPLOAD_FIELD, upload } from '../../lib/upload.js';
import { str } from '../helpers.js';
import { createMedia, deleteMedia, listMedia, mediaStats, updateMedia, getMedia } from '../../services/media.js';
import { logActivity } from '../../services/activity.js';

const router = Router();

async function storeFile(file: Express.Multer.File, userId: number | null): Promise<number> {
  const described = describeUpload(file);
  let width: number | null = null;
  let height: number | null = null;
  try {
    const size = imageSize(fs.readFileSync(file.path));
    width = size.width ?? null;
    height = size.height ?? null;
  } catch {
    // not fatal
  }
  return createMedia({
    ...described,
    width,
    height,
    alt_text: str(file.originalname.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')),
    caption: null,
    title: file.originalname.replace(/\.[^.]+$/, ''),
    uploaded_by: userId,
  });
}

router.get(
  '/media',
  asyncRoute(async (req, res) => {
    const page = pageParam(req.query.page);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type : 'all';
    const { media, total } = await listMedia({ page, perPage: 36, search, type });
    const stats = await mediaStats();
    res.render('admin/media', {
      layout: 'layouts/admin',
      title: 'Media',
      adminTitle: 'Media library',
      adminDescription: 'Every image uploaded to the publication.',
      page: 'media',
      media,
      pagination: paginate(total, page, 36),
      search,
      type,
      stats,
    });
  }),
);

router.get(
  '/api/media',
  asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const { media } = await listMedia({ perPage: 60, search });
    res.json({ media });
  }),
);

router.post(
  '/media',
  upload.array(UPLOAD_FIELD, MAX_UPLOAD_FILES),
  asyncRoute(async (req, res) => {
    if (!verifyCsrf(req)) {
      setFlash(req, 'error', 'Your session expired. Please try again.');
      return res.redirect('/admin/media');
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      setFlash(req, 'error', 'Choose at least one image to upload.');
      return res.redirect('/admin/media');
    }
    for (const file of files) {
      await storeFile(file, res.locals.currentUser.id);
    }
    await logActivity(res.locals.currentUser.id, 'media', `Uploaded ${files.length} image${files.length === 1 ? '' : 's'}`);
    setFlash(req, 'success', `${files.length} image${files.length === 1 ? '' : 's'} uploaded.`);
    res.redirect('/admin/media');
  }),
);

router.post(
  '/api/media/upload',
  upload.array(UPLOAD_FIELD, MAX_UPLOAD_FILES),
  asyncRoute(async (req, res) => {
    if (!verifyCsrf(req)) return res.status(419).json({ error: 'Session expired' });
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) return res.status(400).json({ error: 'No files received' });
    const created = [];
    for (const file of files) {
      const id = await storeFile(file, res.locals.currentUser.id);
      created.push(await getMedia(id));
    }
    res.json({ media: created.filter(Boolean) });
  }),
);

router.post(
  '/media/:id',
  asyncRoute(async (req, res) => {
    await updateMedia(Number(req.params.id), {
      alt_text: str(req.body.alt_text) || null,
      caption: str(req.body.caption) || null,
      title: str(req.body.title) || null,
    });
    setFlash(req, 'success', 'Image details saved.');
    res.redirect(str(req.body.redirect, '/admin/media'));
  }),
);

router.post(
  '/media/:id/delete',
  requireRole('editor'),
  asyncRoute(async (req, res) => {
    await deleteMedia(Number(req.params.id));
    await logActivity(res.locals.currentUser.id, 'media:deleted', `Media #${req.params.id}`);
    setFlash(req, 'success', 'Image removed.');
    res.redirect(str(req.body.redirect, '/admin/media'));
  }),
);

export default router;
