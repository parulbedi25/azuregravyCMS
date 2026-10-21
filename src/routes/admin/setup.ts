import { Router, type Response } from 'express';
import { z } from 'zod';
import { config, dbConfigSnapshot, describeDbTarget, type DbConfigInput } from '../../config.js';
import { asyncRoute, setFlash, verifyCsrf } from '../../lib/http.js';
import {
  clearInstallState,
  createSuperAdmin,
  ensureBootstrapped,
  ensureStarterContent,
  getInstallState,
  resetBootstrap,
  type InstallState,
} from '../../db/bootstrap.js';
import { recordInstalled, saveDbConfig } from '../../db/install.js';
import { setDbConfig, testConnection, type ConnectionTest } from '../../db/index.js';
import { logActivity } from '../../services/activity.js';
import { saveSettings } from '../../lib/settings.js';
import { invalidateNavigation } from '../../services/navigation.js';

/**
 * First-run installer — the only place a database is ever configured.
 *
 * The server starts without touching MySQL at all. The first request lands here,
 * step 1 collects the database details and *tests* them in the page (a wrong
 * password is a form error, not a crashed process), step 2 creates the
 * administrator. When both are done the details are remembered in
 * `data/install.json`, so later boots connect on their own.
 *
 * Environment variables (`DB_HOST`, `DB_USER`, …) still take precedence: when they
 * describe a reachable database, step 1 is skipped and pre-filled.
 */
const router = Router();

type Step = 'db' | 'admin';

interface DbForm {
  driver: 'mysql' | 'embedded';
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  create_database: boolean;
}

interface AdminForm {
  site_title: string;
  name: string;
  email: string;
}

interface SetupLocals {
  step: Step;
  dbForm: DbForm;
  adminForm: AdminForm;
  errors: Record<string, string>;
  state: InstallState;
  test: ConnectionTest | null;
  status?: number;
}

const MysqlForm = z
  .object({
    host: z.string().trim().min(1, 'Enter the database host — on cPanel this is `localhost`.').max(190),
    port: z.coerce
      .number({ message: 'The port must be a number.' })
      .int('The port must be a whole number.')
      .min(1, 'Enter a port between 1 and 65535.')
      .max(65535, 'Enter a port between 1 and 65535.'),
    database: z
      .string()
      .trim()
      .min(1, 'Enter the database name.')
      .max(64, 'Database names are at most 64 characters.')
      .regex(/^[A-Za-z0-9_$.\-]+$/, 'Use letters, numbers, underscore, dot or dash only.'),
    user: z.string().trim().min(1, 'Enter the database user.').max(190),
    password: z.string().max(200).optional().default(''),
  })
  .transform((value) => ({ ...value, password: value.password ?? '' }));

const EmbeddedForm = z.object({
  database: z
    .string()
    .trim()
    .max(64)
    .regex(/^$|^[A-Za-z0-9_$.\-]+$/, 'Use letters, numbers, underscore, dot or dash only.')
    .optional()
    .default('azuregravy'),
});

const AdminSchema = z
  .object({
    site_title: z.string().trim().max(120).optional(),
    name: z.string().trim().min(2, 'Please enter your name.').max(120),
    email: z.string().trim().toLowerCase().email('That does not look like an e-mail address.').max(190),
    password: z.string().min(8, 'Use at least 8 characters.').max(200),
    password_confirm: z.string(),
  })
  .refine((value) => value.password === value.password_confirm, {
    message: 'The two passwords do not match.',
    path: ['password_confirm'],
  });

const checked = (value: unknown) => value === 'on' || value === '1' || value === true || value === 'true';

/** Pre-fill from the session (step-to-step), then the running config, then defaults. */
/** What the session carries between steps — never the password. */
type SessionDb = ReturnType<typeof sessionShape>;

function dbFormFrom(_state: InstallState, stored: SessionDb | undefined): DbForm {
  const snapshot = dbConfigSnapshot();
  return {
    driver: stored?.driver ?? (snapshot.driver === 'embedded' ? 'embedded' : 'mysql'),
    host: stored?.host ?? snapshot.host ?? (config.isProd ? 'localhost' : '127.0.0.1'),
    port: String(stored?.port ?? snapshot.port ?? 3306),
    database: stored?.database ?? snapshot.database ?? 'azuregravy',
    user: stored?.user ?? snapshot.user ?? '',
    // Passwords are never kept in the session; the applied config still has it.
    password: snapshot.password ?? '',
    ssl: stored?.ssl ?? Boolean(snapshot.ssl),
    create_database: stored?.createDatabase ?? snapshot.createDatabase !== false,
  };
}

function render(res: Response, locals: SetupLocals): void {
  const status = locals.status ?? 200;
  res.status(status).render('admin/setup', {
    layout: 'layouts/auth',
    title: 'Set up',
    bodyClass: 'admin-body',
    pageTitle: 'Welcome to your new site',
    step: locals.step,
    dbForm: locals.dbForm,
    adminForm: locals.adminForm,
    errors: locals.errors,
    install: locals.state,
    connectionTest: locals.test,
    dbTarget: describeDbTarget(),
    envConfigured: config.db.source !== 'none',
    dbSource: config.db.source,
  });
}

const emptyAdmin: AdminForm = { site_title: '', name: '', email: '' };

/** Everything except `/admin/setup` is gated by the app; this handles the installer itself. */
router.get(
  '/setup',
  asyncRoute(async (req, res) => {
    const state = await getInstallState();
    if (state.installed) {
      setFlash(req, 'info', 'This site is already set up. Sign in to continue.');
      return res.redirect('/admin/login');
    }

    const sessionDb = req.session.installDb as SessionDb | undefined;
    const requested = req.query.step === 'admin' || req.query.step === 'db' ? (req.query.step as Step) : null;
    // Step 2 needs a working connection; otherwise fall back to the database step.
    const step: Step = requested === 'admin' && state.connected ? 'admin' : requested ?? (state.connected ? 'admin' : 'db');

    return render(res, {
      step,
      dbForm: dbFormFrom(state, sessionDb),
      adminForm: { ...emptyAdmin, site_title: (res.locals.settings as Record<string, string>)?.site_title ?? '' },
      errors: {},
      state,
      test: null,
    });
  }),
);

router.post(
  '/setup',
  asyncRoute(async (req, res) => {
    const step: Step = req.body.step === 'admin' ? 'admin' : 'db';
    const sessionDb = req.session.installDb as SessionDb | undefined;
    const dbForm = dbFormFrom(await getInstallState(), sessionDb);
    const state = await getInstallState();

    if (state.installed) return res.redirect('/admin/login');

    const submittedDb: DbForm = {
      driver: req.body.driver === 'embedded' ? 'embedded' : 'mysql',
      host: String(req.body.host ?? '').trim(),
      port: String(req.body.port ?? '').trim(),
      database: String(req.body.database ?? '').trim(),
      user: String(req.body.user ?? '').trim(),
      password: String(req.body.password ?? ''),
      ssl: checked(req.body.ssl),
      create_database: checked(req.body.create_database),
    };

    const adminForm: AdminForm = {
      site_title: String(req.body.site_title ?? '').trim(),
      name: String(req.body.name ?? '').trim(),
      email: String(req.body.email ?? '').trim(),
    };

    if (!verifyCsrf(req)) {
      return render(res, {
        step,
        dbForm: step === 'db' ? submittedDb : dbForm,
        adminForm: step === 'admin' ? adminForm : emptyAdmin,
        errors: { form: 'Your session expired. Please submit the form again.' },
        state,
        test: null,
        status: 419,
      });
    }

    /* ---------------------------------------------------------- step 1: database */
    if (step === 'db') {
      let candidate: DbConfigInput;

      if (submittedDb.driver === 'embedded') {
        const parsed = EmbeddedForm.safeParse({ database: submittedDb.database || 'azuregravy' });
        if (!parsed.success) {
          return render(res, {
            step,
            dbForm: submittedDb,
            adminForm: emptyAdmin,
            errors: issuesToErrors(parsed.error),
            state,
            test: null,
            status: 422,
          });
        }
        candidate = {
          driver: 'embedded',
          database: parsed.data.database || 'azuregravy',
          dataDir: config.db.dataDir,
        };
      } else {
        const parsed = MysqlForm.safeParse({
          host: submittedDb.host,
          port: submittedDb.port === '' ? 3306 : submittedDb.port,
          database: submittedDb.database,
          user: submittedDb.user,
          password: submittedDb.password,
        });
        if (!parsed.success) {
          return render(res, {
            step,
            dbForm: submittedDb,
            adminForm: emptyAdmin,
            errors: issuesToErrors(parsed.error),
            state,
            test: null,
            status: 422,
          });
        }
        candidate = {
          driver: 'mysql',
          host: parsed.data.host,
          port: parsed.data.port,
          database: parsed.data.database,
          user: parsed.data.user,
          password: parsed.data.password,
          ssl: submittedDb.ssl,
          createDatabase: submittedDb.create_database,
          connectTimeout: config.db.connectTimeout,
        };
      }

      // Test the credentials *before* anything is saved or applied.
      const test = await testConnection(candidate);

      if (!test.ok) {
        req.session.installDb = sessionShape(submittedDb);
        return render(res, {
          step,
          dbForm: submittedDb,
          adminForm: emptyAdmin,
          errors: {
            db: test.message ?? 'The connection failed.',
            db_hint: test.hint ?? '',
            db_code: test.code ?? '',
          },
          state,
          test,
          status: 422,
        });
      }

      // Connection works: remember it, drop any stale pool, create the schema.
      try {
        await saveDbConfig(candidate);
        await setDbConfig(candidate);
        resetBootstrap();
        clearInstallState();
        const report = await ensureBootstrapped();

        req.session.installDb = { ...sessionShape(submittedDb), server: test.server, tables: report.tables, ms: test.ms };
        const fresh = await getInstallState(true);

        // Repair, not re-install: when the database we just reached already has an
        // administrator, the site was installed before. Send the visitor to the
        // sign-in page instead of offering to create a second super admin.
        if (fresh.installed) {
          req.session.installDb = undefined;
          setFlash(
            req,
            'success',
            `Database reconnected — ${fresh.tables} tables, ${fresh.admins} administrator account${fresh.admins === 1 ? '' : 's'}. Sign in to continue.`,
          );
          return res.redirect('/admin/login');
        }

        setFlash(
          req,
          'success',
          test.createdDatabase
            ? `Connected, and the database \`${test.database ?? candidate.database}\` was created for you.`
            : `Connected to ${test.server ?? 'the database'} — ${report.tables} tables ready.`,
        );
        return render(res, {
          step: 'admin',
          dbForm: submittedDb,
          adminForm: { ...emptyAdmin, site_title: adminForm.site_title },
          errors: {},
          state: fresh,
          test,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return render(res, {
          step,
          dbForm: submittedDb,
          adminForm: emptyAdmin,
          errors: {
            db: `Connected, but the tables could not be created: ${message}`,
            db_hint:
              'The database user needs CREATE, ALTER, INDEX, REFERENCES and DROP privileges.\n' +
              'In cPanel → MySQL® Databases → Add User To Database, tick ALL PRIVILEGES.',
          },
          state,
          test,
          status: 422,
        });
      }
    }

    /* ----------------------------------------------------- step 2: administrator */
    if (!state.connected) {
      setFlash(req, 'info', 'Connect the database first.');
      return res.redirect('/admin/setup?step=db');
    }

    const parsed = AdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return render(res, {
        step,
        dbForm,
        adminForm,
        errors: issuesToErrors(parsed.error),
        state,
        test: null,
        status: 422,
      });
    }

    const { name, email, password, site_title: siteTitle } = parsed.data;

    await ensureBootstrapped();
    const userId = await createSuperAdmin({ name, email, password });
    await ensureStarterContent(userId);

    if (siteTitle) {
      await saveSettings({ site_title: siteTitle, logo_text: siteTitle });
      invalidateNavigation();
    }
    await logActivity(userId, 'settings', 'Completed first-run setup');
    await recordInstalled().catch(() => undefined);
    clearInstallState();

    req.session.regenerate((error) => {
      if (error) {
        setFlash(req, 'success', 'Your account is ready. Please sign in.');
        return res.redirect('/admin/login');
      }
      req.session.userId = userId;
      setFlash(req, 'success', `Welcome, ${name.split(' ')[0]}. This is your Studio.`);
      res.redirect('/admin');
    });
  }),
);

function sessionShape(form: DbForm) {
  return {
    driver: form.driver,
    host: form.host,
    port: Number(form.port) || 3306,
    database: form.database,
    user: form.user,
    ssl: form.ssl,
    createDatabase: form.create_database,
  };
}

function issuesToErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export default router;
