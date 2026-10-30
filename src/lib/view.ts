import { icon } from './icons.js';
import {
  colorFromSeed, escapeHtml, formatDate, formatDateTime, formatNumber, initials, isoDate,
  makeExcerpt, pluralize, readingTime, slugify, timeAgo, truncate, toLocalInput, fromLocalInput, safeUrl,
} from './text.js';
import { previewPath } from './preview.js';
import { buildPostPath, postListPath, splitAroundSlug, structureFrom } from './permalink.js';
import type { PermalinkSource } from './permalink.js';
import type { SettingsMap } from '../types.js';

/**
 * Canonical URL for a post or page.
 *
 * Posts honour the `permalink_structure` setting; pages have always lived at
 * the root and are deliberately unaffected by it. `structure` is optional so
 * callers outside a request (seeding, CLI scripts) still get the default shape.
 */
export const postUrl = (post: PermalinkSource, structure?: string) => buildPostPath(post, structure);

/** Signed preview link for a post that is not public yet. See lib/preview.ts. */
export const previewUrl = (post: { id: number }) => previewPath(post);

export const categoryUrl = (slug: string) => `/category/${slug}`;
export const tagUrl = (slug: string) => `/tag/${slug}`;
export const authorUrl = (id: number) => `/author/${id}`;

export function mediaUrl(path: string | null | undefined, fallback = ''): string {
  if (!path) return fallback;
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

/** Cover image for a post, with a graceful gradient fallback. */
export function coverUrl(post: { featured_image?: string | null; slug?: string } | null | undefined): string | null {
  if (!post?.featured_image) return null;
  return mediaUrl(post.featured_image);
}

export function excerptOf(post: { excerpt?: string | null; content?: string }, length = 160): string {
  if (post.excerpt) return truncate(post.excerpt, length);
  return makeExcerpt(post.content ?? '', length);
}

export function settingOf(settings: SettingsMap, key: string, fallback = ''): string {
  const value = settings[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

export function buildHelpers(settings: SettingsMap) {
  /*
    Resolved once per render rather than per link: every card on a listing page
    calls postUrl, and re-parsing the structure each time would be pure waste.
  */
  const structure = structureFrom(settings);
  return {
    icon,
    formatDate: (value: string | null | undefined, style?: 'long' | 'medium' | 'short') =>
      formatDate(value, style ?? ((settingOf(settings, 'date_format', 'long') as 'long' | 'short') ?? 'long')),
    formatDateTime,
    formatNumber,
    timeAgo,
    isoDate,
    initials,
    pluralize,
    truncate,
    escapeHtml,
    safeUrl,
    readingTime,
    slugify,
    toLocalInput,
    fromLocalInput,
    colorFromSeed,
    postUrl: (post: PermalinkSource) => buildPostPath(post, structure),
    /** Archive index for posts, derived from the permalink structure. */
    postListUrl: postListPath(structure),
    /** The structure in force, for admin UIs that render live URL previews. */
    permalinkStructure: structure,
    /** Path split around the slug, so the editor can preview a URL live. */
    permalinkAffixes: (post: PermalinkSource) => splitAroundSlug(post, structure),
    previewUrl,
    categoryUrl,
    tagUrl,
    authorUrl,
    mediaUrl,
    coverUrl,
    excerptOf,
    setting: (key: string, fallback = '') => settingOf(settings, key, fallback),
    year: new Date().getFullYear(),
  };
}

export type ViewHelpers = ReturnType<typeof buildHelpers>;
