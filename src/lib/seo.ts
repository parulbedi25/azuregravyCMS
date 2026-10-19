import { config } from '../config.js';
import type { Post } from '../types.js';

/** Turn a MariaDB `DATETIME` string (or ISO string) into an ISO-8601 timestamp. */
export function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalised = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function absoluteUrl(pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${config.siteUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/** Serialise structured data safely for embedding inside a `<script>` tag. */
export function jsonLd(data: Record<string, unknown>): string {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${payload}</script>`;
}

/**
 * `BlogPosting` + `BreadcrumbList` structured data for a story.
 * Empty values are dropped so the payload stays valid.
 */
export function articleJsonLd(
  post: Post,
  options: { siteName: string; url: string; logo?: string | null },
): string {
  const url = absoluteUrl(options.url) ?? `${config.siteUrl}/stories/${post.slug}`;
  const description = post.seo_description || post.excerpt || undefined;
  const image = absoluteUrl(post.featured_image);
  const authorName = post.author_name || options.siteName;
  const section = post.category_name || undefined;

  const article: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    headline: post.title.slice(0, 110),
    description,
    image: image ? [image] : undefined,
    datePublished: isoDate(post.published_at || post.created_at),
    dateModified: isoDate(post.updated_at || post.published_at || post.created_at),
    author: { '@type': 'Person', name: authorName, url: absoluteUrl(`/author/${post.author_id}`) },
    publisher: {
      '@type': 'Organization',
      name: options.siteName,
      logo: options.logo ? { '@type': 'ImageObject', url: absoluteUrl(options.logo) } : undefined,
    },
    articleSection: section,
    keywords: (post.tags ?? []).map((tag) => tag.name).join(', ') || undefined,
    wordCount: post.content ? post.content.trim().split(/\s+/).length : undefined,
    isAccessibleForFree: post.status === 'private' ? false : true,
  };

  const trail: Array<{ name: string; item: string }> = [{ name: 'Home', item: `${config.siteUrl}/` }];
  trail.push({ name: 'Stories', item: `${config.siteUrl}/stories` });
  if (section && post.category_slug) {
    trail.push({ name: section, item: `${config.siteUrl}/category/${post.category_slug}` });
  }
  trail.push({ name: post.title, item: url });

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };

  return jsonLd(article) + jsonLd(breadcrumbs);
}
