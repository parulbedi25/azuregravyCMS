import { slugify } from './text.js';

/*
  Permalink structure
  -------------------
  One setting decides the shape of every post URL. The structure is a template
  of literal segments and tokens, e.g. `/posts/%slug%` or `/%year%/%month%/%slug%`.

  Two functions matter and they must stay exact inverses of each other:

    buildPostPath()  post  -> path      (used to render every link)
    matchPostPath()  path  -> identity  (used to route an incoming request)

  Everything else in the app should go through these rather than assembling
  `/posts/` + slug by hand, or the links and the router drift apart.
*/

/** What a fresh install gets, and the fallback for anything unparseable. */
export const DEFAULT_PERMALINK_STRUCTURE = '/posts/%slug%';

/** Tokens a structure may contain. Anything else is rejected as a literal. */
export const PERMALINK_TOKENS = ['%slug%', '%post_id%', '%year%', '%month%', '%day%', '%category%'] as const;

export type PermalinkToken = (typeof PERMALINK_TOKENS)[number];

/**
 * Slugs that can never resolve, because a fixed route already owns the path.
 * Only reachable when the structure has no prefix (the "short" form), but
 * checked always so the editor can warn before saving.
 *
 * Every entry must survive slugify() unchanged — a slug containing a dot is
 * impossible (slugify rewrites "." to "-"), so fixed files like /feed.xml,
 * /sitemap.xml, /robots.txt and /favicon.ico cannot be shadowed by a post and
 * are deliberately absent. Listing them would reserve nothing and imply a
 * protection that the comparison can never deliver.
 */
export const RESERVED_SLUGS = [
  'posts', 'post', 'stories', 'story', 'pages', 'page', 'archive', 'archives',
  'categories', 'category', 'tags', 'tag', 'author', 'search', 'contact',
  'about', 'admin', 'api', 'assets', 'uploads', 'preview', 'healthz',
] as const;

/** Segment used when a structure asks for %category% but the post has none. */
const NO_CATEGORY = 'uncategorised';

export interface PermalinkPreset {
  id: string;
  label: string;
  structure: string;
  /** A concrete example so the admin can see the shape before choosing it. */
  example: string;
  note: string;
}

export const PERMALINK_PRESETS: PermalinkPreset[] = [
  {
    id: 'default',
    label: 'Post name under a base',
    structure: '/posts/%slug%',
    example: '/posts/how-we-ship',
    note: 'The default. Every post lives under /posts/, so nothing can collide with a page or a fixed route.',
  },
  {
    id: 'short',
    label: 'Short — slug only',
    structure: '/%slug%',
    example: '/how-we-ship',
    note: 'The shortest possible URL. Posts share the root with pages, so reserved words like "archive" cannot be used as a slug.',
  },
  {
    id: 'date',
    label: 'Date and name',
    structure: '/posts/%year%/%month%/%slug%',
    example: '/posts/2026/10/how-we-ship',
    note: 'Groups the archive by publish date. Changing a publish date later changes the URL, so a redirect is created.',
  },
  {
    id: 'category',
    label: 'Base, category and name',
    structure: '/posts/%category%/%slug%',
    example: '/posts/engineering/how-we-ship',
    note: 'Groups posts by their first category. Posts with no category fall back to /' + NO_CATEGORY + '/.',
  },
  {
    id: 'numeric',
    label: 'Numeric with a slug',
    structure: '/posts/%post_id%/%slug%',
    example: '/posts/42/how-we-ship',
    note: 'Ids never change, so these URLs survive a rename of the slug. The slug stays at the end for readability.',
  },
];

/** Minimal shape needed to build a path — a full Post row always satisfies it. */
export interface PermalinkSource {
  slug: string;
  id?: number;
  type?: string;
  published_at?: string | null;
  created_at?: string;
  category_slug?: string | null;
}

const isToken = (segment: string): segment is PermalinkToken =>
  (PERMALINK_TOKENS as readonly string[]).includes(segment);

/** Date used for the %year%/%month%/%day% tokens: published when known. */
function referenceDate(post: PermalinkSource): Date {
  const raw = post.published_at || post.created_at;
  if (!raw) return new Date();
  const text = String(raw).trim();
  /*
    MySQL DATETIME columns carry no offset, so they are read as UTC — which
    matches the getUTC* accessors below. A value that already ends in an
    explicit zone is left alone; appending "Z" to one would shift it.
  */
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Validate and canonicalise a structure supplied by an administrator.
 *
 * Returns the default rather than throwing: a bad permalink setting would
 * otherwise make every post URL in the publication unbuildable, and the
 * settings form reports the rejection separately.
 */
export function normalizeStructure(raw: unknown): { structure: string; error: string | null } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { structure: DEFAULT_PERMALINK_STRUCTURE, error: null };
  }

  let value = raw.trim();

  // Reject the encodings that turn a path into an off-site redirect.
  if (value.includes('\\') || value.includes('?') || value.includes('#')) {
    return { structure: DEFAULT_PERMALINK_STRUCTURE, error: 'A URL structure cannot contain \\, ? or #.' };
  }
  if (!value.startsWith('/')) value = `/${value}`;
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  if (value.includes('//')) {
    return { structure: DEFAULT_PERMALINK_STRUCTURE, error: 'A URL structure cannot contain a double slash.' };
  }
  if (value.split('/').some((segment) => segment === '..')) {
    return { structure: DEFAULT_PERMALINK_STRUCTURE, error: 'A URL structure cannot contain "..".' };
  }
  if (value.length > 190) {
    return { structure: DEFAULT_PERMALINK_STRUCTURE, error: 'That URL structure is too long (190 characters maximum).' };
  }

  const segments = value.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { structure: DEFAULT_PERMALINK_STRUCTURE, error: 'A URL structure needs at least one segment.' };
  }

  for (const segment of segments) {
    if (isToken(segment)) continue;
    // Literals are kept boring on purpose: a segment is either a known token or
    // a plain lowercase path fragment. This also blocks %unknown% tokens, which
    // would otherwise be stored and silently render as literal text.
    if (!/^[a-z0-9][a-z0-9._-]{0,60}$/i.test(segment)) {
      return {
        structure: DEFAULT_PERMALINK_STRUCTURE,
        error: `The segment "${segment}" is not valid. Use letters, numbers, dashes, dots or underscores, or one of the tokens: ${PERMALINK_TOKENS.join(', ')}.`,
      };
    }
  }

  // Without an identity token the router could never resolve a request back to
  // a post, so the structure would build links nothing could serve.
  if (!segments.includes('%slug%') && !segments.includes('%post_id%')) {
    return {
      structure: DEFAULT_PERMALINK_STRUCTURE,
      error: 'The structure must include %slug% or %post_id% so a URL can be resolved back to its post.',
    };
  }

  /*
    %category% may not open the structure. A category slug is free text, so
    `/%category%/%slug%` would emit /tag/… or /category/… for a category named
    "tag", and those paths belong to fixed routes that are matched first — the
    post would become permanently unreachable. Later positions are safe because
    a literal base segment already distinguishes the URL.
  */
  if (segments[0] === '%category%') {
    return {
      structure: DEFAULT_PERMALINK_STRUCTURE,
      error: '%category% cannot be the first segment — a category named "tag" or "category" would collide with a built-in route. Put a base in front of it, e.g. /posts/%category%/%slug%.',
    };
  }

  return { structure: `/${segments.join('/')}`, error: null };
}

/** Read the structure out of a settings map, tolerating a missing or bad value. */
export function structureFrom(settings: Record<string, string> | null | undefined): string {
  const raw = settings?.permalink_structure;
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_PERMALINK_STRUCTURE;
  return normalizeStructure(raw).structure;
}

/** Token value for one segment of a structure. */
function segmentValue(token: PermalinkToken, post: PermalinkSource): string {
  switch (token) {
    case '%slug%':
      return post.slug;
    case '%post_id%':
      return String(post.id ?? 0);
    case '%category%': {
      const slug = post.category_slug ? slugify(String(post.category_slug)) : '';
      return slug || NO_CATEGORY;
    }
    case '%year%':
      return String(referenceDate(post).getUTCFullYear());
    case '%month%':
      return pad(referenceDate(post).getUTCMonth() + 1);
    case '%day%':
      return pad(referenceDate(post).getUTCDate());
    default:
      return post.slug;
  }
}

/**
 * Build the path for a post under a structure.
 *
 * Pages are untouched: they have always lived at the root and the permalink
 * setting describes post URLs only.
 */
export function buildPostPath(post: PermalinkSource, structure?: string): string {
  if (post.type === 'page') return `/${post.slug}`;
  const template = structure ?? DEFAULT_PERMALINK_STRUCTURE;
  const segments = template.split('/').filter(Boolean).map((segment) =>
    isToken(segment) ? encodeURIComponent(segmentValue(segment, post)) : encodeURIComponent(segment),
  );
  return `/${segments.join('/')}`;
}

/** Escape a literal for use in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a structure into a matcher.
 *
 * Capture groups are named, so the caller reads `match.groups?.slug` rather
 * than depending on token order.
 */
function compileStructure(structure: string): RegExp | null {
  const segments = structure.split('/').filter(Boolean);
  if (!segments.length) return null;
  const pattern = segments
    .map((segment) => {
      switch (segment) {
        case '%slug%':
          return '(?<slug>[^/]+)';
        case '%post_id%':
          return '(?<postId>\\d+)';
        case '%category%':
          return '[^/]+';
        case '%year%':
          return '\\d{4}';
        case '%month%':
        case '%day%':
          return '\\d{2}';
        default:
          return escapeRegExp(segment);
      }
    })
    .join('/');
  try {
    return new RegExp(`^/${pattern}/?$`);
  } catch {
    return null;
  }
}

export interface PermalinkMatch {
  slug: string | null;
  postId: number | null;
}

/**
 * Resolve an incoming path against the structure.
 *
 * Returns null when the path is not a post URL at all, so the caller can fall
 * through to the page route and then to the 404 handler. A structure that
 * carries only %post_id% still resolves, with `slug` null.
 */
export function matchPostPath(path: string, structure: string): PermalinkMatch | null {
  const regex = compileStructure(structure);
  if (!regex) return null;
  const match = regex.exec(path);
  if (!match?.groups) return null;
  const slug = match.groups.slug ? decodeURIComponent(match.groups.slug) : null;
  const postId = match.groups.postId ? Number.parseInt(match.groups.postId, 10) : null;
  if (!slug && !Number.isFinite(postId as number)) return null;
  return { slug, postId: Number.isFinite(postId as number) ? (postId as number) : null };
}

/**
 * The archive/list path implied by a structure: its literal prefix.
 *
 * `/posts/%year%/%slug%` -> `/posts`. A structure with no literal prefix (the
 * short form) has no natural home, so the archive stays at `/posts` — a fixed
 * route that a bare slug can never shadow, since reserved slugs are blocked.
 */
export function postListPath(structure: string): string {
  const prefix: string[] = [];
  for (const segment of structure.split('/').filter(Boolean)) {
    if (isToken(segment)) break;
    prefix.push(segment);
  }
  return prefix.length ? `/${prefix.join('/')}` : '/posts';
}

/**
 * True when a slug could never be reached, because a fixed route owns the path.
 *
 * This only bites for a single-segment structure (`/%slug%`), which puts post
 * URLs at the root alongside `/archive`, `/categories`, `/search` and friends.
 * Any structure with two or more segments — or with a literal base such as
 * `/posts/…` — cannot collide with a one-segment fixed route, so nothing is
 * reserved and the editor should not nag.
 */
export function isReservedSlug(slug: string, structure: string): boolean {
  const normalised = slugify(slug);
  if (!normalised) return true;
  if (structure.split('/').filter(Boolean).length !== 1) return false;
  return (RESERVED_SLUGS as readonly string[]).includes(normalised.toLowerCase());
}

/** Tokens present in a structure, for the settings UI. */
export function tokensIn(structure: string): PermalinkToken[] {
  return structure.split('/').filter(Boolean).filter(isToken);
}

/**
 * Placeholder used to locate the slug inside a built path. Underscores are
 * unreserved in URIs, so encodeURIComponent leaves it byte-identical and it can
 * be found again with a plain indexOf.
 */
const SLUG_SENTINEL = '__AG_SLUG__';

/**
 * Split a post's URL into the parts on either side of its slug.
 *
 * The editor renders a live SEO preview: `…/posts/<input>/…`, updating as the
 * author types. With a fixed base that was a string concatenation,
 * but a structure can put segments *after* the slug too (`/%slug%/amp`), so the
 * suffix matters as much as the prefix.
 *
 * A structure with no %slug% token (id-only) yields the whole path as the
 * prefix and an empty suffix — the preview then shows a URL the slug cannot
 * affect, which is the truth.
 */
export function splitAroundSlug(post: PermalinkSource, structure?: string): { prefix: string; suffix: string } {
  const full = buildPostPath({ ...post, slug: SLUG_SENTINEL }, structure);
  const at = full.indexOf(SLUG_SENTINEL);
  if (at === -1) return { prefix: full, suffix: '' };
  return { prefix: full.slice(0, at), suffix: full.slice(at + SLUG_SENTINEL.length) };
}
