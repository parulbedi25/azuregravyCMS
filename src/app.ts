import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import expressLayouts from 'express-ejs-layouts';
import { config, PUBLIC_DIR, VIEWS_DIR } from './config.js';
import { attachUser } from './lib/auth.js';
import { clientIp, csrfProtection, flashMiddleware, setFlash } from './lib/http.js';
import { HybridSessionStore } from './lib/session-store.js';
import { loadSettings } from './lib/settings.js';
import { buildHelpers } from './lib/view.js';
import { accentStylesheet } from './lib/theme.js';
import { rememberRequestOrigin } from './lib/url.js';
import { describeUploadError } from './lib/upload.js';
import { getMenuItems, getNavCategories, getTicker } from './services/navigation.js';
import { publishDuePosts, getDb, DbSetupError } from './db/index.js';
import { getInstallState, type InstallState } from './db/bootstrap.js';
import { DEFAULT_SETTINGS } from './db/schema.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin/index.js';

let lastPublishSweep = 0;

const EMPTY_INSTALL_STATE: InstallState = {
  configured: false,
  connected: false,
  installed: false,
  needsSetup: true,
  tables: 0,
  admins: 0,
  posts: 0,
  pages: 0,
  error: null,
  checkedAt: 0,
};

/** Paths that must keep working before the database exists. */
const OPEN_PATHS = ['/admin/setup', '/healthz'];
const isOpenPath = (path: string) =>
  OPEN_PATHS.includes(path) || path.startsWith('/assets/') || path === '/favicon.ico';

/**
 * Render the "we cannot reach the database" page.
 *
 * Used both by the gate and by the error handler, so a wrong password in
 * `data/install.json` produces a helpful screen with a way back into the
 * installer — never a stack trace and never a dead process.
 */
function renderDbError(req: Request, res: Response, state: InstallState | null, status = 503): void {
  if (res.headersSent) return;
  res.status(status).render('public/db-error', {
    layout: 'layouts/plain',
    title: 'Database unreachable',
    status,
    message: state?.error?.message ?? 'The database could not be reached.',
    hint: state?.error?.hint ?? '',
    code: state?.error?.code ?? '',
    target: config.db.configured ? `${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}` : '',
    path: req.originalUrl,
    siteName: 'Azure Gravy',
    settings: DEFAULT_SETTINGS as Record<string, string>,
    h: buildHelpers(DEFAULT_SETTINGS as Record<string, string>),
  });
}

export async function createApp() {
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

  // Liveness probe that never touches the database — handy on cPanel.
  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

  // Browsers ask for /favicon.ico even when an SVG icon is declared.
  app.get('/favicon.ico', (_req, res) => res.redirect(301, '/assets/img/favicon.svg'));

  app.use(
    express.static(PUBLIC_DIR, {
      maxAge: config.isProd ? '7d' : 0,
      etag: true,
      setHeaders: (res, filePath) => {
        if (filePath.includes('/uploads/')) res.setHeader('Cache-Control', 'public, max-age=2592000');
        /*
          Generated diagrams are SVG. Referenced from an <img> they are inert,
          but navigating straight to one renders it as a document, where a
          <script> or onload handler would run in this origin. These files are
          drawn by services/diagram.ts from a validated spec with every label
          XML-escaped, so none can contain a handler — this is defence in depth,
          pinning the risk to zero even if that renderer is later changed.
          `sandbox` gives the document a unique origin; default-src 'none'
          blocks script, fetch and navigation outright.
        */
        if (filePath.includes('/uploads/diagrams/')) {
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
          res.setHeader('X-Content-Type-Options', 'nosniff');
        }
      },
    }),
  );

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));

  // Memory-backed until the installer connects a database, then MariaDB-backed.
  const store = new HybridSessionStore();
  setInterval(() => void store.clearExpired().catch(() => undefined), 1000 * 60 * 30).unref();

  /*
    `SameSite=None` is only honoured by browsers over HTTPS, so opting into it is
    itself an assertion that TLS terminates upstream. But express-session decides
    whether to emit a Secure cookie from `req.secure`, which in turn depends on
    the proxy forwarding `X-Forwarded-Proto`. A proxy that omits that header — or
    forwards it as `http` — makes express-session silently DROP the cookie
    (`index.js`: "only send secure cookies via https"), which would reintroduce
    the exact sessionless-419 this mode exists to fix.

    So when the operator has asserted HTTPS via SESSION_SAMESITE=none, hold the
    proxy to it rather than depending on a header we cannot verify from here.
    Scoped strictly to that opt-in: the default `lax` path is untouched.

    Side benefit: `rememberRequestOrigin(req.protocol, ...)` below then builds
    canonical/OG/RSS URLs as https://, which is correct for such a deployment.
  */
  if (config.sessionSameSite === 'none') {
    let warned = false;
    app.use((req, _res, next) => {
      const proto = req.headers['x-forwarded-proto'];
      if (proto !== 'https') {
        if (!warned) {
          warned = true;
          console.warn(
            `  SESSION_SAMESITE=none: treating requests as HTTPS (x-forwarded-proto was ${
              proto === undefined ? 'absent' : `"${proto}"`
            }). Unset SESSION_SAMESITE if this site is really served over plain HTTP.`,
          );
        }
        req.headers['x-forwarded-proto'] = 'https';
      }
      next();
    });
  }

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
        sameSite: config.sessionSameSite,
        /*
          `auto` = secure whenever the request itself is HTTPS (works behind
          cPanel/Passenger's proxy), plain HTTP keeps working in development.

          `SameSite=None` is the one combination that cannot use `auto`: browsers
          discard a `None` cookie that lacks `Secure`, and behind a terminating
          proxy the app may see plain HTTP even though the browser is on HTTPS.
          So when the operator has opted into `none` (cross-site iframe hosting),
          force the flag instead of leaving it to request sniffing.
        */
        secure: config.sessionSameSite === 'none' ? true : 'auto',
        /*
          CHIPS. `SameSite=None; Secure` is necessary but not sufficient for a
          cross-site iframe: Safari's ITP blocks unpartitioned third-party cookies
          outright, and Chrome/Firefox are partitioning them too. `Partitioned`
          scopes the cookie to the embedding top-level site, which is precisely
          the embedded-Studio case `none` already declares.

          Tied to `none` rather than a separate knob because it is only valid
          alongside `Secure` + `SameSite=None`, and it degrades gracefully —
          browsers that do not implement CHIPS ignore the attribute per RFC 6265
          and keep the unpartitioned cookie.
        */
        partitioned: config.sessionSameSite === 'none',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

  app.use(flashMiddleware);

  // Shared template locals (available to every renderer, including error pages).
  // Nothing here may throw when the database is missing: the installer has to be
  // reachable on a machine with no MySQL at all.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Canonical/OG/RSS URLs follow the real host when SITE_URL is not configured.
      rememberRequestOrigin(req.protocol, req.get('host'));

      const state = await getInstallState();
      res.locals.install = state;

      let settings: Record<string, string>;
      if (state.connected) {
        // Publish due posts at most once a minute rather than on every request.
        if (Date.now() - lastPublishSweep > 60_000) {
          lastPublishSweep = Date.now();
          await publishDuePosts(await getDb());
        }
        const [loaded, menus, categories, ticker] = await Promise.all([
          loadSettings(), getMenuItems(), getNavCategories(), getTicker(),
        ]);
        settings = loaded as Record<string, string>;
        res.locals.menus = {
          primary: menus.filter((item) => item.location === 'primary'),
          footer: menus.filter((item) => item.location === 'footer'),
          legal: menus.filter((item) => item.location === 'legal'),
        };
        res.locals.navCategories = categories;
        res.locals.ticker = ticker;
      } else {
        // Pre-install: render from the built-in defaults so the installer and the
        // error pages look like the real site.
        settings = DEFAULT_SETTINGS as Record<string, string>;
        res.locals.menus = { primary: [], footer: [], legal: [] };
        res.locals.navCategories = [];
        res.locals.ticker = null;
      }

      res.locals.settings = settings;
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

  /**
   * Installation gate.
   *
   * Until a database is connected *and* a super admin exists, every URL leads to
   * the installer; a configured-but-unreachable database gets the friendly
   * "database unreachable" page with a link back into the installer.
   */
  app.use((req: Request, res: Response, next: NextFunction) => {
    const state = res.locals.install as InstallState | undefined;
    if (!state || isOpenPath(req.path)) return next();

    if (state.configured && !state.connected) return renderDbError(req, res, state);
    if (!state.installed) return res.redirect('/admin/setup');
    return next();
  });

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
      message: 'The page you were looking for has moved, or never existed. Try the posts archive instead.',
    });
  });

  app.use((error: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;

    // A database problem is a configuration problem, not a 500: explain it and
    // offer the installer. Never exit the process over it.
    if (error instanceof DbSetupError) {
      const dbError = error as DbSetupError;
      console.warn(`[db] ${req.method} ${req.originalUrl} — ${dbError.message}`);
      const state = (res.locals.install as InstallState | undefined) ?? null;
      const withError = { ...(state ?? EMPTY_INSTALL_STATE), error: { message: dbError.message, hint: dbError.hint, code: '' } };
      return renderDbError(req, res, withError);
    }

    // A refused upload is the visitor's mistake, not a server fault: answer with
    // the reason instead of a 500 and a stack trace in the log.
    const uploadProblem = describeUploadError(error);
    if (uploadProblem) {
      console.warn(`[upload] ${req.method} ${req.originalUrl} — ${uploadProblem.message}`);
      /*
        The media library posts to /admin/api/media/upload with plain `fetch`,
        which sends neither X-Requested-With nor an Accept header, so the path
        is the only dependable signal that JSON is wanted here.
      */
      if (req.path.includes('/api/') || req.xhr || (req.get('accept') ?? '').includes('application/json')) {
        res.status(uploadProblem.status).json({ error: uploadProblem.message });
        return;
      }
      setFlash(req, 'error', uploadProblem.message);
      res.redirect(req.path.startsWith('/admin') ? '/admin/media' : '/');
      return;
    }

    console.error('[error]', req.method, req.originalUrl, error);
    const status = error.status ?? 500;
    const message = config.isProd ? 'Something went wrong on our end. Please try again in a moment.' : error.message;
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
