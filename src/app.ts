import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import expressLayouts from 'express-ejs-layouts';
import { config, PUBLIC_DIR, VIEWS_DIR } from './config.js';
import { attachUser } from './lib/auth.js';
import { clientIp, csrfProtection, flashMiddleware } from './lib/http.js';
import { MariaSessionStore } from './lib/session-store.js';
import { loadSettings } from './lib/settings.js';
import { buildHelpers } from './lib/view.js';
import { accentStylesheet } from './lib/theme.js';
import { getMenuItems, getNavCategories, getTicker } from './services/navigation.js';
import { publishDuePosts, getDb } from './db/index.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin/index.js';

let lastPublishSweep = 0;

export async function createApp() {
  const db = await getDb();
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('views', VIEWS_DIR);
  app.set('view engine', 'ejs');
  app.use(expressLayouts);
  app.set('layout', 'layouts/public');
  app.set('layout extractScripts', false);
  app.set('layout extractStyles', false);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Sandbox previews embed the site in an iframe from another origin, so dev
    // sends no framing restrictions at all (the legacy X-Frame-Options header is
    // deliberately absent — it cannot express a wildcard and blocks the pane).
    // Production deployments are same-origin only.
    if (config.isProd) {
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    }
    next();
  });

  // Browsers ask for /favicon.ico even when an SVG icon is declared.
  app.get('/favicon.ico', (_req, res) => res.redirect(301, '/assets/img/favicon.svg'));

  app.use(
    express.static(PUBLIC_DIR, {
      maxAge: config.isProd ? '7d' : 0,
      etag: true,
      setHeaders: (res, filePath) => {
        if (filePath.includes('/uploads/')) res.setHeader('Cache-Control', 'public, max-age=2592000');
      },
    }),
  );

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));

  const store = new MariaSessionStore();
  setInterval(() => void store.clearExpired().catch(() => undefined), 1000 * 60 * 30).unref();

  app.use(
    session({
      store,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      name: 'gravy.sid',
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

  app.use(flashMiddleware);

  // Shared template locals (available to every renderer, including error pages)
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Publish due stories at most once a minute rather than on every request.
      if (Date.now() - lastPublishSweep > 60_000) {
        lastPublishSweep = Date.now();
        await publishDuePosts(db);
      }
      const [settings, menus, categories, ticker] = await Promise.all([
        loadSettings(), getMenuItems(), getNavCategories(), getTicker(),
      ]);
      res.locals.settings = settings;
      res.locals.menus = {
        primary: menus.filter((item) => item.location === 'primary'),
        footer: menus.filter((item) => item.location === 'footer'),
        legal: menus.filter((item) => item.location === 'legal'),
      };
      res.locals.navCategories = categories;
      res.locals.ticker = ticker;
      res.locals.h = buildHelpers(settings);
      res.locals.currentPath = req.path;
      res.locals.query = req.query;
      res.locals.siteName = settings.site_title || 'Azure Gravy';
      res.locals.theme = settings.default_theme === 'dark' ? 'dark' : 'light';
      res.locals.pageTitle = settings.site_title ?? 'Azure Gravy';
      res.locals.accentStyles = accentStylesheet(settings.accent_color);
      res.locals.metaDescription = settings.site_description ?? '';
      res.locals.ogImage = settings.seo_default_image || '/assets/seed/misc/og-default.webp';
      res.locals.bodyClass = '';
      res.locals.isAdmin = req.path.startsWith('/admin');
      res.locals.clientIp = clientIp(req);
      res.locals.qs = (updates: Record<string, string | number | undefined>) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(req.query)) {
          if (typeof value === 'string' && value !== '') params.set(key, value);
        }
        for (const [key, value] of Object.entries(updates)) {
          if (value === undefined || value === '') params.delete(key);
          else params.set(key, String(value));
        }
        const query = params.toString();
        return query ? `?${query}` : '';
      };
      next();
    } catch (error) {
      next(error);
    }
  });

  app.use(csrfProtection);
  app.use(attachUser);

  app.use('/admin', adminRoutes);
  app.use('/', publicRoutes);

  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/admin')) {
      res.status(404).render('admin/error', {
        layout: 'layouts/admin',
        title: 'Not found',
        status: 404,
        message: `We couldn't find ${req.path}. Check the address or head back to the dashboard.`,
        page: 'error',
      });
      return;
    }
    res.status(404).render('public/error', {
      layout: 'layouts/public',
      title: 'Page not found',
      status: 404,
      message: 'The page you were looking for has moved, or never existed. Try the stories archive instead.',
    });
  });

  app.use((error: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', req.method, req.originalUrl, error);
    const status = error.status ?? 500;
    const message = config.isProd ? 'Something went wrong on our end. Please try again in a moment.' : error.message;
    if (res.headersSent) return;
    if (req.path.startsWith('/admin') && res.locals.currentUser) {
      res.status(status).render('admin/error', {
        layout: 'layouts/admin',
        title: 'Something went wrong',
        status,
        message,
        page: 'error',
      });
      return;
    }
    res.status(status).render('public/error', {
      layout: status >= 500 && !res.locals.currentUser ? 'layouts/plain' : 'layouts/public',
      title: 'Something went wrong',
      status,
      message,
    });
  });

  return app;
}
