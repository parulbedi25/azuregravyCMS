import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Signed references for previewing stories that are not public yet.
 *
 * A preview link is a capability URL: `/preview/<id>.<signature>`. The signature
 * is an HMAC of the post id under SESSION_SECRET, so the id cannot be enumerated
 * by walking `/preview/1`, `/preview/2`, … and a leaked URL cannot be edited into
 * a different story. Rotating SESSION_SECRET invalidates every preview link at
 * once, which is what makes them "temporary" without needing a token table.
 *
 * The signature is deliberately *not* the access control. The route still
 * requires a signed-in session and still checks authorship, so the URL alone
 * grants nothing — it only stops the id space from being guessable in logs,
 * referrers and browser history.
 */
const PREFIX = 'azure-gravy:preview:v1';

/** Trimmed base64url HMAC — 22 chars is ~132 bits, ample for a capability tag. */
function sign(id: number): string {
  return createHmac('sha256', config.sessionSecret)
    .update(`${PREFIX}:${id}`)
    .digest('base64url')
    .slice(0, 22);
}

/** Site-relative preview path for a post. */
export function previewPath(post: { id: number }): string {
  return `/preview/${post.id}.${sign(post.id)}`;
}

/**
 * Validate a `/preview/:ref` parameter and return the post id, or null when the
 * reference is malformed or the signature does not match.
 *
 * Comparison is constant-time so a wrong signature cannot be narrowed down one
 * character at a time.
 */
export function parsePreviewRef(ref: unknown): number | null {
  if (typeof ref !== 'string') return null;

  const dot = ref.lastIndexOf('.');
  if (dot <= 0 || dot === ref.length - 1) return null;

  const rawId = ref.slice(0, dot);
  const token = ref.slice(dot + 1);
  if (!/^\d+$/.test(rawId)) return null;

  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const expected = Buffer.from(sign(id));
  const given = Buffer.from(token);
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  return id;
}
