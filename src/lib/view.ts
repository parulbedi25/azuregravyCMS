import { icon } from './icons.js';
import {
  colorFromSeed, escapeHtml, formatDate, formatDateTime, formatNumber, initials, isoDate,
  makeExcerpt, pluralize, readingTime, slugify, timeAgo, truncate, toLocalInput, fromLocalInput, safeUrl,
} from './text.js';
import type { SettingsMap } from '../types.js';

export const postUrl = (post: { slug: string; type?: string }) =>
  post.type === 'page' ? `/${post.slug}` : `/stories/${post.slug}`;

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
    postUrl,
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
