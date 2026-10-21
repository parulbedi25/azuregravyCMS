import { Router } from 'express';
import { siteBase } from '../lib/url.js';
import { getDb } from '../db/index.js';
import { asyncRoute, clientIp, pageParam, paginate, setFlash, verifyCsrf } from '../lib/http.js';
import { renderMarkdown } from '../lib/markdown.js';
import { articleJsonLd } from '../lib/seo.js';
import { escapeHtml, formatDate, safeUrl } from '../lib/text.js';
import {
  approvedCommentsTree, addComment,
} from '../services/comments.js';
import {
  getAdjacentPosts, getArchiveMonths, getCategoryBySlug, getPostBySlug, getRelatedPosts,
  getTagBySlug, listCategories, listPosts, listTags,
} from '../services/posts.js';
import { getUser, listUsers } from '../services/users.js';
import { errorPage } from './helpers.js';

const router = Router();

const pageSize = (settings: Record<string, string>) => {
  const value = Number.parseInt(settings.posts_per_page ?? '9', 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 36) : 9;
};

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

/* --------------------------------------------------------------- stories */
router.get(
  '/stories',
  asyncRoute(async (req, res) => renderPostList(req, res, { heading: 'Stories', subheading: 'Everything we have published, newest first.', basePath: '/stories' })),
);

router.get(
  '/search',
  asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.redirect('/stories');
    await renderPostList(req, res, {
      heading: q ? `Search: “${q}”` : 'Search',
      subheading: 'Matching stories from the archive.',
      basePath: '/search',
    });
  }),
);

/* -------------------------------------------------------------- article */
router.get(
  '/stories/:slug',
  asyncRoute(async (req, res, next) => {
    const post = await getPostBySlug(req.params.slug, { type: 'post' });
    if (!post) return next();
    if (post.status === 'private' && !res.locals.currentUser) return next();

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
        url: `${siteBase()}/stories/${post.slug}`,
        logo: res.locals.settings.logo_image || undefined,
      }),
    });
  }),
);

router.get(
  '/stories/:slug/next',
  asyncRoute(async (req, res) => {
    const post = await getPostBySlug(req.params.slug, { type: 'post' });
    if (!post) return res.status(404).json({ error: 'not_found' });
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

    res.json({ title: full.title, url: `/stories/${full.slug}`, html, meta });
  }),
);

router.post(
  '/stories/:slug/comments',
  asyncRoute(async (req, res) => {
    const post = await getPostBySlug(req.params.slug, { type: 'post' });
    if (!post) return res.redirect('/stories');

    if (!verifyCsrf(req)) {
      setFlash(req, 'error', 'Your session expired. Please submit the comment again.');
      return res.redirect(`/stories/${post.slug}#comments`);
    }

    const name = String(req.body.name ?? '').trim();
    const email = String(req.body.email ?? '').trim();
    const content = String(req.body.content ?? '').trim();
    const honeypot = String(req.body.website ?? '').trim();

    const fail = (message: string) => {
      setFlash(req, 'error', message);
      res.redirect(`/stories/${post.slug}#comments`);
    };

    if (honeypot) return res.redirect(`/stories/${post.slug}#comments`);
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
    res.redirect(`/stories/${post.slug}#comments`);
  }),
);

/* ------------------------------------------------------------- taxonomy */
router.get(
  '/category/:slug',
  asyncRoute(async (req, res, next) => {
    const category = await getCategoryBySlug(req.params.slug);
    if (!category) return next();
    await renderPostList(req, res, {
      heading: category.name,
      subheading: category.description ?? `All stories filed under ${category.name}.`,
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
      subheading: tag.description ?? `Stories tagged “${tag.name}”.`,
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
      subheading: author.bio ?? `Stories written by ${author.name}.`,
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
      metaDescription: 'Browse every story by month.',
      months: perMonth,
    });
  }),
);

/* ------------------------------------------------------------ newsletter */
router.post(
  '/newsletter',
  asyncRoute(async (req, res) => {
    const back = typeof req.body.redirect === 'string' && req.body.redirect.startsWith('/') ? req.body.redirect : '/';
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
        const link = `${base}/stories/${post.slug}`;
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
    <title>${escape(settings.site_title ?? 'Azure Gravy')}</title>
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
    const posts = await db.query<{ slug: string; updated_at: string; type: string }>(
      `SELECT slug, updated_at, type FROM posts WHERE status = 'published'`,
    );
    const categories = await listCategories({ withCounts: true });
    const tags = await listTags(false);
    const urls = [
      { loc: '/', priority: '1.0' },
      { loc: '/stories', priority: '0.9' },
      { loc: '/categories', priority: '0.7' },
      { loc: '/archive', priority: '0.6' },
      ...posts.map((post) => ({
        loc: post.type === 'page' ? `/${post.slug}` : `/stories/${post.slug}`,
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
        url: `/stories/${post.slug}`,
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
    return errorPage(res, 404, 'Page not found', 'The page you were looking for has moved, or never existed. Try the stories archive instead.');
  }),
);

export default router;
