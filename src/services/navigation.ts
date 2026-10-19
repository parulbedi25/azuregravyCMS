import { getDb } from '../db/index.js';
import type { Category, MenuItem } from '../types.js';
import { listCategories } from './posts.js';

interface CacheEntry<T> {
  value: T;
  at: number;
}

let menuCache: CacheEntry<MenuItem[]> | null = null;
let categoryCache: CacheEntry<Category[]> | null = null;
const TTL = 20_000;

export async function getMenuItems(location?: MenuItem['location']): Promise<MenuItem[]> {
  if (!menuCache || Date.now() - menuCache.at > TTL) {
    const db = await getDb();
    const items = await db.query<MenuItem>(
      'SELECT * FROM menu_items WHERE is_active = 1 ORDER BY location, sort_order, id',
    );
    menuCache = { value: items, at: Date.now() };
  }
  return location ? menuCache.value.filter((item) => item.location === location) : menuCache.value;
}

export async function getNavCategories(): Promise<Category[]> {
  if (!categoryCache || Date.now() - categoryCache.at > TTL) {
    const categories = (await listCategories({ withCounts: true })).filter((category) => (category.post_count ?? 0) > 0);
    categoryCache = { value: categories, at: Date.now() };
  }
  return categoryCache.value;
}

export function invalidateNavigation(): void {
  menuCache = null;
  categoryCache = null;
}

let tickerCache: CacheEntry<{ title: string; slug: string; category: string | null } | null> | null = null;

/** A single headline for the header ticker, cached briefly. */
export async function getTicker(): Promise<{ title: string; slug: string; category: string | null } | null> {
  if (!tickerCache || Date.now() - tickerCache.at > 60_000) {
    const db = await getDb();
    const rows = await db.query<{ title: string; slug: string; category: string | null }>(
      `SELECT p.title, p.slug,
              (SELECT c.name FROM categories c JOIN post_categories pc ON pc.category_id = c.id
                WHERE pc.post_id = p.id ORDER BY c.sort_order LIMIT 1) AS category
         FROM posts p WHERE p.type = 'post' AND p.status = 'published'
         ORDER BY p.published_at DESC LIMIT 1`,
    );
    tickerCache = { value: rows[0] ?? null, at: Date.now() };
  }
  return tickerCache.value;
}
