import { config } from '../config.js';

/**
 * The public origin used for canonical links, Open Graph URLs, RSS and the sitemap.
 *
 * Order of preference:
 *   1. `SITE_URL` from `.env` (or the `site_url` setting, which routes check first)
 *   2. the origin of the first request that arrives — correct on any hostname,
 *      including cPanel subdomains and preview URLs, with no configuration
 *   3. `http://localhost:<port>` as the last resort
 */
let runtimeBase = config.siteUrl;

/** Called once per request from the locals middleware; a no-op after the first hit. */
export function rememberRequestOrigin(protocol: string, host: string | undefined): void {
  if (runtimeBase || !host) return;

  // In production ignore loopback/internal hostnames (health checks, cron pings)
  // so they cannot bake `http://127.0.0.1:3000` into canonical links.
  if (config.isProd) {
    const hostname = host.split(':')[0].toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || !hostname.includes('.')) return;
  }
  runtimeBase = `${protocol}://${host}`;
}

export function siteBase(): string {
  return (runtimeBase || `http://localhost:${config.port}`).replace(/\/$/, '');
}

/** Absolute version of a site-relative path; passes through external URLs. */
export function absoluteUrl(pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^(https?:)?\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:') || pathOrUrl.startsWith('mailto:')) {
    return pathOrUrl;
  }
  return `${siteBase()}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
