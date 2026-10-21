import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import { config, PUBLIC_DIR } from '../config.js';
import { closeDb, formatDate, formatDateTime, getDb, migrate } from './index.js';
import { DEFAULT_MENU } from './schema.js';
import {
  SEED_CATEGORIES, SEED_COMMENTS, SEED_MESSAGES, SEED_PAGES, SEED_POSTS, SEED_SUBSCRIBERS, SEED_TAGS, SEED_USERS,
} from './seed-data.js';
import { hashPassword } from '../lib/auth.js';
import { renderMarkdown } from '../lib/markdown.js';
import { readingTime, slugify } from '../lib/text.js';
import type { DbClient } from './index.js';

import { fileURLToPath } from 'node:url';

const daysAgo = (days: number, hour = 9, minute = 30) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
};

const dateTime = (date: Date) => formatDateTime(date);

async function clearContent(db: DbClient) {
  const tables = [
    'post_views', 'post_tags', 'post_categories', 'revisions', 'comments', 'posts',
    'media_meta', 'media', 'tags', 'categories', 'subscribers', 'contact_messages',
    'redirects', 'activity', 'menu_items', 'sessions',
  ];
  for (const table of tables) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute('DELETE FROM users');
  console.log('· cleared existing content');
}

async function seedMedia(db: DbClient): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const roots = ['covers', 'cards', 'categories', 'misc'];
  const uploader = 1;
  for (const folder of roots) {
    const dir = path.join(PUBLIC_DIR, 'assets', 'seed', folder);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((file) => /\.(webp|jpe?g|png|avif)$/i.test(file));
    for (const file of files) {
      const absolute = path.join(dir, file);
      const stat = fs.statSync(absolute);
      let width: number | null = null;
      let height: number | null = null;
      try {
        const size = imageSize(fs.readFileSync(absolute));
        width = size.width ?? null;
        height = size.height ?? null;
      } catch {
        // ignore unreadable metadata
      }
      const publicPath = `/assets/seed/${folder}/${file}`;
      const id = await db.insert(
        `INSERT INTO media (filename, path, original_name, mime_type, size, width, height, alt_text, caption, title, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          file,
          publicPath,
          file.replace(/-[a-f0-9]{8}(?=\.)/, ''),
          'image/webp',
          stat.size,
          width,
          height,
          file.replace(/\.(webp|jpe?g|png)$/i, '').replace(/-/g, ' '),
          null,
          file.replace(/\.(webp|jpe?g|png)$/i, '').replace(/-/g, ' '),
          uploader,
          dateTime(daysAgo(120)),
        ],
      );
      map.set(publicPath, id);
    }
  }
  console.log(`· ${map.size} media items`);
  return map;
}

export async function runSeed(
  options: { reset?: boolean; force?: boolean } = {},
  client?: DbClient,
): Promise<void> {
  const reset = options.reset ?? false;
  const force = options.force ?? false;
  const db = client ?? (await getDb());
  await migrate(db);

  const existing = await db.query<{ total: number }>('SELECT COUNT(*) AS total FROM users');
  if (Number(existing[0]?.total ?? 0) > 0 && !reset && !force) {
    console.log('Database already contains users — nothing to do.');
    console.log('Run `npm run db:seed -- --reset` to rebuild the demo content.');
    return;
  }
  if (reset) await clearContent(db);

  /* ---------------------------------------------------------------- users */
  const userIds = new Map<string, number>();
  for (const user of SEED_USERS) {
    const id = await db.insert(
      `INSERT INTO users (name, email, password_hash, role, bio, website, twitter, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.name,
        user.email,
        await hashPassword(user.password),
        user.role,
        user.bio,
        user.website ?? null,
        user.twitter ?? null,
        dateTime(daysAgo(300)),
        dateTime(daysAgo(Math.floor(Math.random() * 3))),
      ],
    );
    userIds.set(user.name, id);
  }
  console.log(`· ${SEED_USERS.length} users`);

  /* --------------------------------------------------------------- media */
  const media = await seedMedia(db);

  /* ---------------------------------------------------------- categories */
  const categoryIds = new Map<string, number>();
  for (const category of SEED_CATEGORIES) {
    const id = await db.insert(
      `INSERT INTO categories (name, slug, description, image, color, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [category.name, category.slug, category.description, category.image, category.color, category.sort, dateTime(daysAgo(290))],
    );
    categoryIds.set(category.name, id);
  }
  console.log(`· ${SEED_CATEGORIES.length} categories`);

  /* ---------------------------------------------------------------- tags */
  const tagIds = new Map<string, number>();
  for (const tag of SEED_TAGS) {
    const id = await db.insert('INSERT INTO tags (name, slug, created_at) VALUES (?, ?, ?)', [
      tag,
      slugify(tag),
      dateTime(daysAgo(280)),
    ]);
    tagIds.set(tag, id);
  }

  /* --------------------------------------------------------------- posts */
  const postIds = new Map<string, number>();
  for (const post of SEED_POSTS) {
    const { html } = renderMarkdown(post.content);
    const published = post.status ?? 'published';
    const authorId = userIds.get(post.author) ?? userIds.get('Avery Cole')!;
    const id = await db.insert(
      `INSERT INTO posts
        (type, title, slug, excerpt, content, content_html, featured_image_id, status, author_id, is_sticky,
         allow_comments, views, reading_time, seo_title, seo_description, published_at, created_at, updated_at)
       VALUES ('post', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        post.title,
        post.slug,
        post.excerpt,
        post.content,
        html,
        media.get(post.cover) ?? null,
        published,
        authorId,
        post.sticky ? 1 : 0,
        post.views ?? Math.floor(600 + Math.random() * 2500),
        readingTime(post.content),
        post.title,
        post.excerpt,
        dateTime(daysAgo(post.daysAgo)),
        dateTime(daysAgo(post.daysAgo, 8)),
        dateTime(daysAgo(Math.max(0, post.daysAgo - 1), 11)),
      ],
    );
    postIds.set(post.slug, id);

    const categoryId = categoryIds.get(post.category);
    if (categoryId) {
      await db.execute('INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)', [id, categoryId]);
    }
    for (const tag of post.tags) {
      const tagId = tagIds.get(tag);
      if (tagId) await db.execute('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)', [id, tagId]);
    }
    await db.execute(
      'INSERT INTO revisions (post_id, title, content, excerpt, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, post.title, post.content, post.excerpt, authorId, dateTime(daysAgo(post.daysAgo, 8))],
    );
  }

  // A couple of working drafts so the Studio looks alive on first run.
  const draftAuthor = userIds.get('Maya Ferreira')!;
  const drafts = [
    {
      title: 'The Art of the Follow-Up',
      slug: 'the-art-of-the-follow-up',
      status: 'draft',
      content: `Draft notes.\n\n## Why follow-ups fail\n\nMost follow-ups are reminders. The good ones add something: a new detail, a small piece of value, a reason to reply.\n\n- Lead with the thing you remembered\n- Keep it under 90 words\n- Always end with an easy question\n\n*To finish: interview quotes, stat about response rates, a template.*`,
      days: 1,
    },
    {
      title: 'Building a Second Brain, Honestly',
      slug: 'building-a-second-brain-honestly',
      status: 'scheduled',
      content: `Scheduled for next week.\n\n## The promise and the pile\n\nEvery note-taking system promises a second brain. Most deliver a second inbox.\n\n> A system you do not review is a museum, not a mind.\n\n## What survived\n\nAfter five years and eleven apps, exactly three things survived: a daily note, a project folder, and a weekly review. Everything else was decoration.\n\n*Needs: screenshot of the folder structure, a paragraph on capture friction.*`,
      days: -3,
    },
  ];
  for (const draft of drafts) {
    const { html } = renderMarkdown(draft.content);
    const id = await db.insert(
      `INSERT INTO posts (type, title, slug, excerpt, content, content_html, featured_image_id, status, author_id,
         reading_time, published_at, created_at, updated_at)
       VALUES ('post', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        draft.title,
        draft.slug,
        'Working draft — not published yet.',
        draft.content,
        html,
        media.get('/assets/seed/covers/useful-side-project.webp') ?? null,
        draft.status,
        draftAuthor,
        readingTime(draft.content),
        draft.status === 'scheduled' ? dateTime(daysAgo(-3, 8)) : null,
        dateTime(daysAgo(4)),
        dateTime(daysAgo(draft.days)),
      ],
    );
    postIds.set(draft.slug, id);
    await db.execute('INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)', [id, categoryIds.get('Startup')]);
  }
  console.log(`· ${SEED_POSTS.length + drafts.length} posts (${drafts.length} unfinished)`);

  /* --------------------------------------------------------------- pages */
  for (const page of SEED_PAGES) {
    const { html } = renderMarkdown(page.content);
    const id = await db.insert(
      `INSERT INTO posts
        (type, title, slug, excerpt, content, content_html, status, author_id, template, reading_time, published_at, created_at, updated_at)
       VALUES ('page', ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?)`,
      [
        page.title,
        page.slug,
        page.excerpt,
        page.content,
        html,
        userIds.get('Avery Cole')!,
        page.template ?? 'default',
        readingTime(page.content),
        dateTime(daysAgo(200)),
        dateTime(daysAgo(200)),
        dateTime(daysAgo(30)),
      ],
    );
    postIds.set(page.slug, id);
  }
  console.log(`· ${SEED_PAGES.length} pages`);

  /* ------------------------------------------------------------ comments */
  const commentIds = new Map<string, number>();
  for (const comment of SEED_COMMENTS) {
    const postId = postIds.get(comment.postSlug);
    if (!postId) continue;
    let parentId: number | null = null;
    if (comment.replyTo) {
      const parent = await db.query<{ id: number }>(
        'SELECT id FROM comments WHERE post_id = ? AND author_name = ? ORDER BY id DESC LIMIT 1',
        [postId, comment.replyTo],
      );
      parentId = parent[0]?.id ?? null;
    }
    const id = await db.insert(
      `INSERT INTO comments (post_id, parent_id, author_name, author_email, content, status, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        parentId,
        comment.author,
        comment.email,
        comment.content,
        comment.status,
        '203.0.113.' + ((comment.daysAgo % 200) + 10),
        dateTime(daysAgo(comment.daysAgo, 14, 5)),
      ],
    );
    commentIds.set(comment.author, id);
  }
  console.log(`· ${SEED_COMMENTS.length} comments`);

  /* -------------------------------------------------------------- views */
  const publishedPostIds = await db.query<{ id: number; views: number; published_at: string }>(
    `SELECT id, views, published_at FROM posts WHERE type = 'post' AND status = 'published'`,
  );
  for (const post of publishedPostIds) {
    const total = Number(post.views);
    let remaining = Math.round(total * 0.45);
    for (let i = 0; i < 30 && remaining > 0; i += 1) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - i);
      const published = new Date(`${post.published_at.replace(' ', 'T')}Z`);
      if (date < published) continue;
      const weight = 1 / (i + 1.6);
      const amount = Math.max(1, Math.round(total * 0.45 * weight * 0.32));
      const value = Math.min(amount, remaining);
      remaining -= value;
      await db.execute(
        `INSERT INTO post_views (post_id, day, views) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE views = views + VALUES(views)`,
        [post.id, formatDate(date), value],
      );
    }
  }
  console.log('· view history for the analytics chart');

  /* -------------------------------------------------- audience + inbox */
  for (const [email, name] of SEED_SUBSCRIBERS) {
    await db.execute(
      `INSERT INTO subscribers (email, name, status, token, created_at) VALUES (?, ?, 'confirmed', ?, ?)`,
      [email, name, crypto.randomUUID().replace(/-/g, ''), dateTime(daysAgo(Math.floor(Math.random() * 90)))],
    );
  }
  for (const message of SEED_MESSAGES) {
    await db.execute(
      `INSERT INTO contact_messages (name, email, subject, message, is_read, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [message.name, message.email, message.subject, message.message, message.isRead ? 1 : 0, '203.0.113.44', dateTime(daysAgo(message.daysAgo))],
    );
  }

  /* --------------------------------------------------------------- menus */
  for (const item of DEFAULT_MENU) {
    await db.execute(
      'INSERT INTO menu_items (location, label, url, sort_order) VALUES (?, ?, ?, ?)',
      [item.location, item.label, item.url, item.sort_order],
    );
  }
  console.log(`· ${DEFAULT_MENU.length} menu links`);

  /* ----------------------------------------------------------- redirects */
  await db.execute(
    `INSERT INTO redirects (from_path, to_path, status_code, hits) VALUES
      ('/stories/deep-work-field-guide', '/stories/field-guide-to-deep-work', 301, 12),
      ('/blog', '/stories', 301, 84)`,
  );

  /* ------------------------------------------------------------ activity */
  const activity: Array<[number | null, string, string, number]> = [
    [1, 'published', 'The Quiet Power of Doing One Thing at a Time', 2],
    [4, 'published', 'What Travel Teaches You About Culture and Life', 5],
    [3, 'comment', 'Replied to Daniel Osei', 1],
    [2, 'updated', 'The Art of the Follow-Up (draft)', 1],
    [1, 'media', 'Uploaded 6 images', 6],
    [1, 'settings', 'Updated site settings', 9],
    [2, 'user', 'Invited Tobias Lindqvist', 30],
  ];
  for (const [userId, action, subject, days] of activity) {
    await db.execute('INSERT INTO activity (user_id, action, subject, created_at) VALUES (?, ?, ?, ?)', [
      userId,
      action,
      subject,
      dateTime(daysAgo(days, 10, 12)),
    ]);
  }

  const counts = await db.query<{ posts: number; comments: number }>(
    `SELECT (SELECT COUNT(*) FROM posts) AS posts, (SELECT COUNT(*) FROM comments) AS comments`,
  );
  console.log('\n✔ Seed complete');
  console.log(`  posts: ${counts[0]?.posts}  ·  comments: ${counts[0]?.comments}`);
  console.log(`  database: ${config.db.driver === 'embedded' ? config.db.dataDir : `${config.db.host}:${config.db.port}/${config.db.database}`}`);
  const demoAdmin = SEED_USERS.find((user) => user.role === 'admin') ?? SEED_USERS[0];
  console.log(`\n  Studio login: ${demoAdmin?.email} / ${demoAdmin?.password}`);
  console.log('  (Every demo account uses the same password)\n');
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const args = new Set(process.argv.slice(2));
  runSeed({ reset: args.has('--reset'), force: args.has('--force') })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
