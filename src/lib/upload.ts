import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import multer from 'multer';
import type { Request } from 'express';
import { UPLOADS_DIR, config } from '../config.js';
import { slugify } from './text.js';

await fs.mkdir(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const now = new Date();
    const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const target = path.join(UPLOADS_DIR, folder);
    await fs.mkdir(target, { recursive: true });
    cb(null, target);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
    const base = slugify(path.basename(file.originalname, path.extname(file.originalname))).slice(0, 60) || 'upload';
    cb(null, `${base}-${randomBytes(4).toString('hex')}${ext}`);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  if (config.uploads.allowedMime.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Only JPG, PNG, WebP, GIF or AVIF images can be uploaded.'));
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.uploads.maxBytes, files: 12 },
});

/** Turn a multer file into values for the media table. */
export function describeUpload(file: Express.Multer.File): {
  filename: string;
  path: string;
  original_name: string;
  mime_type: string;
  size: number;
} {
  const relative = path.relative(path.join(UPLOADS_DIR, '..'), file.path).split(path.sep).join('/');
  return {
    filename: file.filename,
    path: `/uploads/${relative.replace(/^uploads\//, '')}`,
    original_name: file.originalname.slice(0, 255),
    mime_type: file.mimetype,
    size: file.size,
  };
}
