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

/** Field name the media forms and the JSON API both post files under. */
export const UPLOAD_FIELD = 'files';
/** How many files one request may carry. */
export const MAX_UPLOAD_FILES = 12;

/**
 * An upload the app refused on purpose.
 *
 * Carrying a 4xx status is what stops a wrong file type from surfacing as a
 * 500: the generic error handler falls back to `error.status ?? 500`, and a
 * bare `Error` has no status of its own.
 */
export class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  if (config.uploads.allowedMime.includes(file.mimetype)) return cb(null, true);
  cb(new UploadError('Only JPG, PNG, WebP, GIF or AVIF images can be uploaded.'));
}

/**
 * Translate a refused upload into something a person can act on, or null when
 * the error came from somewhere else entirely.
 *
 * Multer identifies its own failures by `name` and `code` rather than through a
 * class that survives the ESM/CJS boundary reliably, so this matches on those.
 */
export function describeUploadError(error: unknown): { status: number; message: string } | null {
  if (error instanceof UploadError) return { status: error.status, message: error.message };
  const err = error as (Error & { name?: string; code?: string }) | null;
  if (!err || err.name !== 'MulterError') return null;
  const maxMb = Math.round(config.uploads.maxBytes / (1024 * 1024));
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return { status: 413, message: `That file is larger than the ${maxMb} MB limit.` };
    case 'LIMIT_FILE_COUNT':
      return { status: 400, message: `At most ${MAX_UPLOAD_FILES} files can be uploaded at once.` };
    case 'LIMIT_UNEXPECTED_FILE':
      return { status: 400, message: `Uploads must be sent in the "${UPLOAD_FIELD}" field.` };
    default:
      return { status: 400, message: err.message || 'That upload was refused.' };
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.uploads.maxBytes, files: MAX_UPLOAD_FILES },
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
