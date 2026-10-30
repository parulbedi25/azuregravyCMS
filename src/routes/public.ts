import { Router } from 'express';
import type { Request, Response } from 'express';
import { siteBase } from '../lib/url.js';
import { postUrl } from '../lib/view.js';
import { buildPostPath, matchPostPath, postListPath, structureFrom } from '../lib/permalink.js';
import type { PermalinkMatch } from '../lib/permalink.js';
import type { Post } from '../types.js';
import { getDb } from '../db/index.js';
import { asyncRoute, clientIp, pageParam, paginate, setFlash, verifyCsrf } from '../lib/http.js';
import { renderMarkdown } from '../lib/markdown.js';
import { articleJsonLd } from '../lib/seo.js';
import { escapeHtml, formatDate, safeUrl } from '../lib/text.js';
import {
  approvedCommentsTree, addComment,
} from '../services/comments.js';
import {
  getAdjacentPosts, getArchiveMonths, getCategoryBySlug, getPostById, getPostBySlug, getRelatedPosts,
  getTagBySlug, listCategories, listPosts, listTags,
} from '../services/posts.js';
import { parsePreviewRef } from '../lib/preview.js';
import { getUser, listUsers } from '../services/users.js';
import { safeNext } from '../lib/auth.js';
import { errorPage } from './helpers.js';

const router = Router();

const pageSize = (settings: Record<string, string>) => {
  const value = Number.parseInt(settings.posts_per_page ?? '9', 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 36) : 9;
};

/** The permalink structure in force for this request. */
const structureOf = (res: Response) => structureFrom(res.locals.settings as Record<string, string>);

/** Archive index for posts, derived from the structure (e.g. `/posts`). */
const listPathOf = (res: Response) => postListPath(structureOf(res));

async function renderPostList(
  req: Parameters<Parameters<typeof router.get>[1]>[0],
  res: Parameters<Parameters<typeof router.get>[1]>[1],
  options: {
    view?: string;
    type?: 'post';
    category?: { slug: string; name: string; description?: string | null } | null;
    tag?: { slug: string; name: string; description?: string | null } | null;
    author?: { id: number; name: string; bio?: string | null; avatar?: string | null } | null;
    heading: string;
    subheading?: string;
    basePath: string;
  },
) {
  const settings = res.locals.settings as Record<string, string>;
  const page = pageParam(req.query.page);
  const perPage = pageSize(settings);
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const sort = (typeof req.query.sort === 'string' ? req.query.sort : 'newest') as 'newest' | 'oldest' | 'popular';

  const { posts, total } = await listPosts({
    type: 'post',
    statuses: ['published'],
    category: options.category?.slug,
    tag: options.tag?.slug,
    authorId: options.author?.id,
    search: search || undefined,
    page,
    perPage,
    sort,
  });

  const pagination = paginate(total, page, perPage);
  const categories = await listCategories({ withCounts: true });
  const tags = await listTags(true);

  res.render(options.view ?? 'public/post-list', {
    title: options.heading,
    pageTitle: search ? `${options.heading} — “${search}”` : options.heading,
    metaDescription: options.subheading ?? `Browse ${options.heading} on ${res.locals.siteName}`,
    heading: options.heading,
    subheading: options.subheading ?? '',
    posts,
    total,
    pagination,
    search,
    sort,
    categories,
    tags,
    category: options.category ?? null,
    tag: options.tag ?? null,
    author: options.author ?? null,
    basePath: options.basePath,
  });
}

/* ----------------------------------------------------------------- home */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const settings = res.locals.settings as Record<string, string>;
    const db = await getDb();
    const page = pageParam(req.query.page);
    const perPage = pageSize(settings);

    const featuredRows = await db.query<{ id: number }>(
      `SELECT id FROM posts WHERE type = 'post' AND status = 'published'
        ORDER BY is_sticky DESC, published_at DESC LIMIT 1`,
    );
    const featuredId = featuredRows[0]?.id;

    const latest = await listPosts({ type: 'post', page: 1, perPage: 5, sort: 'newest' });
    const featured = featuredId ? await getPostBySlug((await db.query<{ slug: string }>('SELECT slug FROM posts WHERE id = ?', [featuredId]))[0].slug) : null;

    const latestRest = latest.posts.filter((post) => post.id !== featuredId).slice(0, 4);

    const picks = await listPosts({
      type: 'post',
      page: 1,
      perPage: 12,
      sort: 'newest',
      excludeId: featuredId,
    });
    const pickPosts = picks.posts.filter((post) => !latestRest.some((item) => item.id === post.id)).slice(0, 3);

    const categories = await listCategories({ withCounts: true });
    const withCounts = categories.filter((category) => (category.post_count ?? 0) > 0);

    const mostRead = await listPosts({ type: 'post', page: 1, perPage: 5, sort: 'popular' });
    const tags = (await listTags(true)).filter((tag) => (tag.post_count ?? 0) > 0).slice(0, 14);
    const authors = (await listUsers()).filter((user) => (user.published_count ?? 0) > 0);

    const totalPosts = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM posts WHERE type = 'post' AND status = 'published'`);
    const totalComments = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM comments WHERE status = 'approved'`);
    const pagination = paginate(Number(totalPosts[0]?.total ?? 0), page, perPage);

    const grid = await listPosts({ type: 'post', page, perPage, sort: 'newest', excludeId: featuredId });

    // Topic spotlight: the chosen category, or the fullest one.
    const spotlight =
      withCounts.find((category) => category.slug === settings.spotlight_category) ??
      [...withCounts].sort((a, b) => (b.post_count ?? 0) - (a.post_count ?? 0))[0] ??
      null;
    const spotlightPosts = spotlight
      ? (await listPosts({ type: 'post', page: 1, perPage: 5, category: spotlight.slug, sort: 'newest' })).posts
      : [];

    res.render('public/home', {
      layout: 'layouts/public',
      title: 'Home',
      pageTitle: `${settings.site_title} — ${settings.site_tagline}`,
      metaDescription: settings.site_description,
      bodyClass: 'page-home',
      featured,
      latestRest,
      pickPosts,
      categories: withCounts,
      mostRead: mostRead.posts,
      spotlight,
      spotlightPosts,
      tags,
      authors,
      grid: grid.posts,
      pagination,
      stats: {
        posts: Number(totalPosts[0]?.total ?? 0),
        comments: Number(totalComments[0]?.total ?? 0),
        categories: withCounts.length,
        writers: authors.length,
      },
    });
  }),
);

/*
  The post archive and the single-post routes are not declared here. Their paths
  come from the `permalink_structure` setting, so they are resolved by
  `resolvePostRoute` further down — registered after every fixed route and
  before the page catch-all. `/search` stays fixed because its path never moves.
*/
router.get(
  '/search',
  asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.redirect(listPathOf(res));
    await renderPostList(req, res, {
      heading: q ? `Search: “${q}”` : 'Search',
      subheading: 'Matching posts from the archive.',
      basePath: '/search',
    });
  }),
);

/* -------------------------------------------------------------- article */

/**
 * Render a single post.
 *
 * Deliberately free of routing logic: the caller has already resolved the post
 * and decided it may be seen. That lets the permalink resolver, the legacy
 * `/stories/*` redirects and the signed preview route all share one renderer
 * instead of three copies that drift apart.
 */
async function renderPost(req: Request, res: Response, post: Post) {
    const db = await getDb();
    const viewed = req.session.viewedPosts ?? [];
    if (!viewed.includes(post.id)) {
      req.session.viewedPosts = [...viewed, post.id].slice(-200);
      await db.execute('UPDATE posts SET views = views + 1 WHERE id = ?', [post.id]);
      await db.execute(
        `INSERT INTO post_views (post_id, day, views) VALUES (?, UTC_DATE(), 1)
         ON DUPLICATE KEY UPDATE views = views + 1`,
        [post.id],
      );
      post.views += 1;
    }

    const [adjacent, related, comments, categories, tags] = await Promise.all([
      getAdjacentPosts(post),
      res.locals.settings.show_related_posts === '1' ? getRelatedPosts(post, 3) : Promise.resolve([]),
      approvedCommentsTree(post.id),
      listCategories({ withCounts: true }),
      listTags(true),
    ]);

    const { html, toc } = renderMarkdown(post.content);
    const allowComments = post.allow_comments === 1 && res.locals.settings.allow_comments !== '0';

    res.render('public/post', {
      layout: 'layouts/public',
      title: post.title,
      pageTitle: post.seo_title || post.title,
      metaDescription: post.seo_description || post.excerpt || '',
      ogType: 'article',
      ogImage: post.featured_image ? (post.featured_image.startsWith('http') ? post.featured_image : `${siteBase()}${post.featured_image}`) : res.locals.ogImage,
      bodyClass: 'page-post',
      post,
      contentHtml: html,
      toc,
      adjacent,
      related,
      comments: comments.comments,
      commentTotal: comments.total,
      allowComments,
      categories,
      tags,
      commentError: typeof req.query.error === 'string' ? req.query.error : null,
      commentOk: req.query.comment === '1',
      extraHead: articleJsonLd(post, {
        siteName: res.locals.siteName,
        url: `${siteBase()}${postUrl(post, structureOf(res))}`,
        logo: res.locals.settings.logo_image || undefined,
      }),
    });
}

/** JSON payload for the "up next" auto-advance used by the reading view. */
async function renderNextPost(res: Response, post: Post) {
    const { next } = await getAdjacentPosts(post);
    if (!next) return res.status(404).json({ error: 'no_next' });

    const full = await getPostBySlug(next.slug, { type: 'post' });
    if (!full) return res.status(404).json({ error: 'no_next' });

    const { html } = renderMarkdown(full.content);
    const meta = [
      full.author_name ? escapeHtml(full.author_name) : '',
      full.published_at ? escapeHtml(formatDate(full.published_at, 'long')) : '',
      `${full.reading_time} min read`,
    ].filter(Boolean).join(' <span class="dot"></span> ');

    res.json({ title: full.title, url: postUrl(full, structureOf(res)), html, meta });
}

/** Validate and store a comment, then bounce the visitor back to the post. */
async function submitComment(req: Request, res: Response, post: Post) {
    /*
      One canonical return target, built from the structure in force. Every
      branch below used to hardcode `/stories/<slug>#comments`, which is exactly
      the kind of duplicate that silently breaks when a setting changes.
    */
    const back = `${postUrl(post, structureOf(res))}#comments`;

    if (!verifyCsrf(req)) {
      setFlash(req, 'error', 'Your session expired. Please submit the comment again.');
      return res.redirect(back);
    }

    const name = String(req.body.name ?? '').trim();
    const email = String(req.body.email ?? '').trim();
    const content = String(req.body.content ?? '').trim();
    const honeypot = String(req.body.website ?? '').trim();

    const fail = (message: string) => {
      setFlash(req, 'error', message);
      res.redirect(back);
    };

    if (honeypot) return res.redirect(back);
    if (name.length < 2) return fail('Please add your name before commenting.');
    if (content.length < 4) return fail('Your comment is a little too short.');
    if (content.length > 4000) return fail('Comments are limited to 4000 characters.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('That email address does not look right.');

    const needsModeration = res.locals.settings.comment_moderation !== '0' || !res.locals.currentUser;
    const parentId = Number(req.body.parent_id);
    await addComment(
      {
        post_id: post.id,
        parent_id: Number.isFinite(parentId) && parentId > 0 ? parentId : null,
        author_name: name,
        author_email: email || null,
        author_url: safeUrl(String(req.body.url ?? '')) || null,
        content,
        ip_address: clientIp(req),
        user_agent: req.get('user-agent') ?? null,
        user_id: res.locals.currentUser?.id ?? null,
      },
      !needsModeration,
    );

    setFlash(
      req,
      'success',
      needsModeration ? 'Thanks — your comment is waiting for moderation.' : 'Your comment is live. Thanks for joining in.',
    );
    res.redirect(back);
}

/* ------------------------------------------------------------- taxonomy */
router.get(
  '/category/:slug',
  asyncRoute(async (req, res, next) => {
    const category = await getCategoryBySlug(req.params.slug);
    if (!category) return next();
    await renderPostList(req, res, {
      heading: category.name,
      subheading: category.description ?? `All posts filed under ${category.name}.`,
      category,
      basePath: `/category/${category.slug}`,
    });
  }),
);

router.get(
  '/tag/:slug',
  asyncRoute(async (req, res, next) => {
    const tag = await getTagBySlug(req.params.slug);
    if (!tag) return next();
    await renderPostList(req, res, {
      heading: `#${tag.name}`,
      subheading: tag.description ?? `Posts tagged “${tag.name}”.`,
      tag,
      basePath: `/tag/${tag.slug}`,
    });
  }),
);

router.get(
  '/author/:id',
  asyncRoute(async (req, res, next) => {
    const author = await getUser(Number(req.params.id));
    if (!author) return next();
    await renderPostList(req, res, {
      heading: author.name,
      subheading: author.bio ?? `Posts written by ${author.name}.`,
      author,
      basePath: `/author/${author.id}`,
    });
  }),
);

router.get(
  '/categories',
  asyncRoute(async (_req, res) => {
    const categories = (await listCategories({ withCounts: true })).filter((category) => (category.post_count ?? 0) > 0);
    const tags = (await listTags(true)).filter((tag) => (tag.post_count ?? 0) > 0);
    res.render('public/categories', {
      layout: 'layouts/public',
      title: 'Topics',
      pageTitle: 'Browse by topic',
      metaDescription: 'Every topic in the archive, from tech and startups to travel, sport and the creative life.',
      categories,
      tags,
    });
  }),
);

router.get(
  '/archive',
  asyncRoute(async (_req, res) => {
    const months = await getArchiveMonths();
    const perMonth = await Promise.all(
      months.map(async (month) => {
        const { posts } = await listPosts({ type: 'post', month: month.ym, perPage: 5, sort: 'newest' });
        return { ...month, posts };
      }),
    );
    res.render('public/archive', {
      layout: 'layouts/public',
      title: 'Archive',
      pageTitle: 'The archive',
      metaDescription: 'Browse every post by month.',
      months: perMonth,
    });
  }),
);

/* ------------------------------------------------------------ newsletter */
router.post(
  '/newsletter',
  asyncRoute(async (req, res) => {
    /*
      `redirect` is visitor-supplied, so it goes through the same guard as the
      login `next` field. A bare `startsWith('/')` still admits the
      protocol-relative `//evil.example` and the backslash form `/\evil.example`
      that browsers normalise into an off-site redirect — both confirmed
      reachable here before this change.
    */
    const back = safeNext(req.body.redirect, '/');
    if (!verifyCsrf(req)) {
      setFlash(req, 'error', 'Your session expired. Please try again.');
      return res.redirect(`${back}#newsletter`);
    }
    const email = String(req.body.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setFlash(req, 'error', 'Please enter a valid email address.');
      return res.redirect(`${back}#newsletter`);
    }
    const db = await getDb();
    await db.execute(
      `INSERT INTO subscribers (email, name, status, token) VALUES (?, ?, 'confirmed', ?)
       ON DUPLICATE KEY UPDATE status = 'confirmed'`,
      [email, String(req.body.name ?? '').trim() || null, crypto.randomUUID().replace(/-/g, '')],
    );
    setFlash(req, 'success', 'You are on the list. Look out for the next letter.');
    res.redirect(`${back}#newsletter`);
  }),
);

/* --------------------------------------------------------------- contact */
router.post(
  '/contact',
  asyncRoute(async (req, res) => {
    if (!verifyCsrf(req)) {
      setFlash(req, 'error', 'Your session expired. Please try again.');
      return res.redirect('/contact');
    }
    const name = String(req.body.name ?? '').trim();
    const email = String(req.body.email ?? '').trim();
    const subject = String(req.body.subject ?? '').trim();
    const message = String(req.body.message ?? '').trim();
    if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || message.length < 10) {
      setFlash(req, 'error', 'Please add your name, a valid email and a slightly longer message.');
      return res.redirect('/contact');
    }
    const db = await getDb();
    await db.execute(
      'INSERT INTO contact_messages (name, email, subject, message, ip_address) VALUES (?, ?, ?, ?, ?)',
      [name, email, subject || null, message, clientIp(req)],
    );
    setFlash(req, 'success', 'Message received. We usually reply within two working days.');
    res.redirect('/contact');
  }),
);

/* ------------------------------------------------------------ feeds / seo */
router.get(
  '/feed.xml',
  asyncRoute(async (_req, res) => {
    const settings = res.locals.settings as Record<string, string>;
    const { posts } = await listPosts({ type: 'post', perPage: 20, sort: 'newest' });
    const base = (settings.site_url || siteBase()).replace(/\/$/, '');
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const items = posts
      .map((post) => {
        const link = `${base}${postUrl(post, structureOf(res))}`;
        const date = new Date(`${(post.published_at ?? post.created_at).replace(' ', 'T')}Z`).toUTCString();
        return `    <item>
      <title>${escape(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${date}</pubDate>
      <description>${escape(post.excerpt ?? '')}</description>
      ${post.category_name ? `<category>${escape(post.category_name)}</category>` : ''}
    </item>`;
      })
      .join('\n');
    res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(settings.site_title ?? 'Gravy')}</title>
    <link>${base}</link>
    <description>${escape(settings.site_description ?? '')}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`);
  }),
);

router.get(
  '/sitemap.xml',
  asyncRoute(async (_req, res) => {
    const settings = res.locals.settings as Record<string, string>;
    const base = (settings.site_url || siteBase()).replace(/\/$/, '');
    const db = await getDb();
    /*
      Selected through the same GROUP_CONCAT shape POST_COLUMNS uses, then split
      on '||' exactly as decorate() does. The permalink structure may contain
      %year% or %category%, so buildPostPath needs the real publish date and the
      same first-category slug the article route resolves — a subtly different
      ordering here would emit sitemap URLs that immediately 301.
    */
    const posts = await db.query<{
      id: number; slug: string; updated_at: string; type: string;
      published_at: string | null; created_at: string; category_slugs: string | null;
    }>(
      `SELECT p.id, p.slug, p.updated_at, p.type, p.published_at, p.created_at,
              (SELECT GROUP_CONCAT(c.slug ORDER BY c.sort_order SEPARATOR '||')
                 FROM categories c JOIN post_categories pc ON pc.category_id = c.id
                WHERE pc.post_id = p.id) AS category_slugs
         FROM posts p
        WHERE p.status = 'published'`,
    );
    const structure = structureOf(res);
    const categories = await listCategories({ withCounts: true });
    const tags = await listTags(false);
    const urls = [
      { loc: '/', priority: '1.0' },
      { loc: postListPath(structure), priority: '0.9' },
      { loc: '/categories', priority: '0.7' },
      { loc: '/archive', priority: '0.6' },
      ...posts.map((post) => ({
        loc: buildPostPath(
          { ...post, category_slug: String(post.category_slugs ?? '').split('||')[0] || null },
          structure,
        ),
        lastmod: new Date(`${post.updated_at.replace(' ', 'T')}Z`).toISOString(),
        priority: post.type === 'page' ? '0.6' : '0.8',
      })),
      ...categories.map((category) => ({ loc: `/category/${category.slug}`, priority: '0.5' })),
      ...tags.map((tag) => ({ loc: `/tag/${tag.slug}`, priority: '0.4' })),
    ];
    const body = urls
      .map(
        (url) => `  <url><loc>${base}${url.loc}</loc>${'lastmod' in url ? `<lastmod>${url.lastmod}</lastmod>` : ''}<priority>${url.priority}</priority></url>`,
      )
      .join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`);
  }),
);

router.get('/robots.txt', (req, res) => {
  const settings = req.app.locals.settings ?? {};
  const base = (settings.site_url || siteBase()).replace(/\/$/, '');
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /uploads/tmp\n\nSitemap: ${base}/sitemap.xml\n`);
});

/* ----------------------------------------------------------------- api */
router.get(
  '/api/search',
  asyncRoute(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2) return res.json({ results: [] });
    const { posts } = await listPosts({ type: 'post', perPage: 6, search: query });
    res.json({
      results: posts.map((post) => ({
        title: post.title,
        url: postUrl(post, structureOf(res)),
        excerpt: h_excerpt(post.excerpt ?? ''),
        image: post.featured_image ?? null,
        category: post.category_name ?? null,
      })),
    });
  }),
);

function h_excerpt(value: string): string {
  return value.length > 96 ? `${value.slice(0, 96).trim()}…` : value;
}

/* ------------------------------------------------------- staff-only preview */
/**
 * Render a post that is not public yet, for its author or a super admin.
 *
 * Registered above the `/:slug` catch-all on purpose: `/preview` is a single
 * path segment and would otherwise be matched as a page slug.
 *
 * Deliberate differences from the public article route:
 *  - no view counting, so an author refreshing a draft does not inflate analytics;
 *  - no comments, related posts or share affordances, which would all point at
 *    a URL visitors cannot reach;
 *  - `noindex` plus `X-Robots-Tag` and `no-store`, so a preview can never be
 *    indexed or cached;
 *  - no canonical/og:url (suppressed in the layout) and no JSON-LD, so the draft
 *    is never advertised to crawlers or social scrapers.
 *
 * Unauthorised callers get 404 rather than 403, so the route never confirms that
 * another author's draft exists.
 */
router.get(
  '/preview/:ref',
  asyncRoute(async (req, res) => {
    const id = parsePreviewRef(req.params.ref);
    if (id === null) {
      return errorPage(res, 404, 'Preview not found', 'This preview link is invalid or has expired.');
    }

    const user = res.locals.currentUser as { id: number; role: string } | null;
    if (!user) {
      return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    }

    const post = await getPostById(id);
    if (!post || post.status === 'trash') {
      return errorPage(res, 404, 'Preview not found', 'This post no longer exists.');
    }
    if (post.author_id !== user.id && user.role !== 'admin') {
      return errorPage(res, 404, 'Preview not found', 'You can only preview your own posts.');
    }

    const { html, toc } = renderMarkdown(post.content);

    res.set('Cache-Control', 'no-store, private');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

    const noindex = '<meta name="robots" content="noindex, nofollow">';

    // Pages have their own templates; rendering one through the post view would
    // silently drop the page layout (and the contact template's form).
    if (post.type === 'page') {
      return res.render(post.template === 'contact' ? 'public/page-contact' : 'public/page', {
        layout: 'layouts/public',
        title: post.title,
        pageTitle: post.seo_title || post.title,
        metaDescription: post.seo_description || post.excerpt || '',
        ogImage: post.featured_image ? `${siteBase()}${post.featured_image}` : res.locals.ogImage,
        post,
        contentHtml: html,
        toc,
        previewMode: true,
        extraHead: noindex,
      });
    }

    const [adjacent, categories, tags] = await Promise.all([
      getAdjacentPosts(post),
      listCategories({ withCounts: true }),
      listTags(true),
    ]);

    res.render('public/post', {
      layout: 'layouts/public',
      title: post.title,
      pageTitle: post.seo_title || post.title,
      metaDescription: post.seo_description || post.excerpt || '',
      ogType: 'article',
      ogImage: post.featured_image
        ? (post.featured_image.startsWith('http') ? post.featured_image : `${siteBase()}${post.featured_image}`)
        : res.locals.ogImage,
      bodyClass: 'page-post page-post--preview',
      post,
      contentHtml: html,
      toc,
      adjacent,
      related: [],
      comments: [],
      commentTotal: 0,
      allowComments: false,
      categories,
      tags,
      commentError: null,
      commentOk: false,
      previewMode: true,
      extraHead: noindex,
    });
  }),
);

/* ------------------------------------------------- permalink-driven posts */

/**
 * Load the post a matched permalink refers to.
 *
 * The two lookups are not interchangeable and the difference matters:
 *
 *  - `getPostBySlug` defaults to published posts of the requested type, so it
 *    is already safe to call with untrusted input;
 *  - `getPostById` applies *no* status and *no* type filter — it is the admin
 *    lookup. Used raw behind a numeric permalink it would happily serve a
 *    draft, a trashed post, or a page to an anonymous visitor.
 *
 * So the id path is filtered here, explicitly, rather than trusting the caller.
 * Slug is tried first: when a structure carries both tokens and the slug is
 * stale, the id still resolves the post and the canonical redirect repairs the
 * URL.
 */
async function resolvePost(match: PermalinkMatch): Promise<Post | null> {
  if (match.slug) {
    const bySlug = await getPostBySlug(match.slug, { type: 'post' });
    if (bySlug) return bySlug;
  }
  if (match.postId) {
    const byId = await getPostById(match.postId);
    if (byId && byId.type === 'post' && byId.status === 'published') return byId;
  }
  return null;
}

/**
 * Resolve an incoming path to a post under the permalink structure in force.
 *
 * Registered *after* every fixed route and *before* the page catch-all, so the
 * precedence is deliberate and worth stating:
 *
 *   1. fixed routes (/search, /category/:slug, /archive, /feed.xml, …) always
 *      win — they are declared earlier, and Express matches in order;
 *   2. the archive index implied by the structure (e.g. /posts);
 *   3. legacy /stories URLs, which 301 to their canonical replacement;
 *   4. a path shaped by the structure, resolved to a post;
 *   5. otherwise next(), so pages and the 404 handler still see the request.
 *
 * Under the short structure (/%slug%) posts and pages share the root. Posts are
 * looked up first and the request falls through to the page route when no post
 * matches, which is why RESERVED_SLUGS exists: it stops an author creating a
 * post whose slug would sit on top of /archive or /categories and never resolve.
 */
router.get(
  '*',
  asyncRoute(async (req, res, next) => {
    const structure = structureOf(res);
    const listPath = postListPath(structure);
    const path = req.path;
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

    /* 2. archive index */
    if (path === listPath || path === `${listPath}/`) {
      return renderPostList(req, res, {
        heading: 'Posts',
        subheading: 'Everything we have published, newest first.',
        basePath: listPath,
      });
    }

    /* 3. legacy /stories archive */
    if (path === '/stories' || path === '/stories/') {
      return res.redirect(301, `${listPath}${query}`);
    }

    /* 4. structure-driven, with an optional /next suffix */
    const wantsNext = path.endsWith('/next');
    const candidate = wantsNext ? path.slice(0, -'/next'.length) : path;

    let match = matchPostPath(candidate, structure);
    let legacy = false;
    if (!match) {
      /*
        Matched against `candidate`, not `path`, so a legacy `/stories/x/next`
        still resolves: the suffix has already been stripped. Matching the full
        path here would drop those through to the 404 handler.
      */
      const old = /^\/stories\/([^/]+)\/?$/.exec(candidate);
      if (old) {
        match = { slug: decodeURIComponent(old[1]), postId: null };
        legacy = true;
      }
    }
    if (!match) return next();

    const post = await resolvePost(match);
    if (!post) return next();
    if (post.status === 'private' && !res.locals.currentUser) return next();

    const canonical = buildPostPath(post, structure);

    /*
      Anything that identifies the post but is not its canonical URL gets a 301.
      That covers legacy /stories/<slug>, a stale date segment left over from an
      earlier structure, and a trailing slash — all of which would otherwise be
      served as duplicate content.
    */
    if (legacy || candidate !== canonical) {
      return res.redirect(301, `${canonical}${wantsNext ? '/next' : ''}${query}`);
    }

    if (wantsNext) return renderNextPost(res, post);
    return renderPost(req, res, post);
  }),
);

/**
 * POST counterpart: a comment submission arrives at `<post path>/comments`.
 * Legacy /stories/<slug>/comments is still accepted rather than redirected,
 * because a 301 on a POST risks the browser replaying it as a GET.
 */
router.post(
  '*',
  asyncRoute(async (req, res, next) => {
    const path = req.path;
    if (!path.endsWith('/comments')) return next();

    const structure = structureOf(res);
    const candidate = path.slice(0, -'/comments'.length);
    const match = matchPostPath(candidate, structure)
      ?? (() => {
        const old = /^\/stories\/([^/]+)\/?$/.exec(candidate);
        return old ? { slug: decodeURIComponent(old[1]), postId: null } : null;
      })();
    if (!match) return next();

    const post = await resolvePost(match);
    if (!post) {
      setFlash(req, 'error', 'That post no longer accepts comments.');
      return res.redirect(postListPath(structure));
    }
    return submitComment(req, res, post);
  }),
);

/* --------------------------------------------------------------- pages */
router.get(
  '/:slug',
  asyncRoute(async (req, res, next) => {
    const post = await getPostBySlug(req.params.slug, { type: 'page' });
    if (!post) return next();
    if (post.status === 'private' && !res.locals.currentUser) return next();
    const { html, toc } = renderMarkdown(post.content);
    res.render(post.template === 'contact' ? 'public/page-contact' : 'public/page', {
      layout: 'layouts/public',
      title: post.title,
      pageTitle: post.seo_title || post.title,
      metaDescription: post.seo_description || post.excerpt || '',
      ogImage: post.featured_image ? `${siteBase()}${post.featured_image}` : res.locals.ogImage,
      post,
      contentHtml: html,
      toc,
    });
  }),
);

/* ----------------------------------------------- redirects + soft errors */
router.get(
  '*',
  asyncRoute(async (req, res) => {
    const db = await getDb();
    const rows = await db.query<{ to_path: string; status_code: number }>(
      'SELECT to_path, status_code FROM redirects WHERE from_path = ? LIMIT 1',
      [req.path],
    );
    if (rows[0]) {
      await db.execute('UPDATE redirects SET hits = hits + 1 WHERE from_path = ?', [req.path]);
      return res.redirect(rows[0].status_code, rows[0].to_path);
    }
    return errorPage(res, 404, 'Page not found', 'The page you were looking for has moved, or never existed. Try the posts archive instead.');
  }),
);

export default router;
