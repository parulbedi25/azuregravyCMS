import { Router, type Response } from 'express';
import { z } from 'zod';
import { asyncRoute, setFlash, verifyCsrf } from '../../lib/http.js';
import { createSuperAdmin, ensureStarterContent, getSetupState } from '../../db/bootstrap.js';
import { logActivity } from '../../services/activity.js';
import { saveSettings } from '../../lib/settings.js';
import { invalidateNavigation } from '../../services/navigation.js';

/**
 * First-run installer.
 *
 * There is no separate install script to run on the server: when the database has
 * tables but no administrator, `/admin` sends you here, you fill in three fields,
 * and the site is live. Once an admin exists the route stops existing — every
 * request is redirected to the normal sign-in page.
 */
const router = Router();

const SetupSchema = z
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

interface SetupForm {
  site_title: string;
  name: string;
  email: string;
}

function renderSetup(res: Response, form: SetupForm, errors: Record<string, string>, status = 200) {
  return res.status(status).render('admin/setup', {
    layout: 'layouts/auth',
    title: 'Set up',
    bodyClass: 'admin-body',
    pageTitle: 'Welcome to your new site',
    form,
    errors,
  });
}

router.get(
  '/setup',
  asyncRoute(async (req, res) => {
    const state = await getSetupState();
    if (state.ready) {
      setFlash(req, 'info', 'This site is already set up. Sign in to continue.');
      return res.redirect('/admin/login');
    }
    const settings = res.locals.settings as Record<string, string>;
    return renderSetup(res, { site_title: settings.site_title ?? '', name: '', email: '' }, {});
  }),
);

router.post(
  '/setup',
  asyncRoute(async (req, res) => {
    const state = await getSetupState();
    if (state.ready) return res.redirect('/admin/login');

    const form: SetupForm = {
      site_title: String(req.body.site_title ?? '').trim(),
      name: String(req.body.name ?? '').trim(),
      email: String(req.body.email ?? '').trim(),
    };

    if (!verifyCsrf(req)) {
      return renderSetup(res, form, { form: 'Your session expired. Please submit the form again.' }, 419);
    }

    const parsed = SetupSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!errors[key]) errors[key] = issue.message;
      }
      return renderSetup(res, form, errors, 422);
    }

    const { name, email, password, site_title: siteTitle } = parsed.data;

    const userId = await createSuperAdmin({ name, email, password });
    await ensureStarterContent(userId);

    if (siteTitle) {
      await saveSettings({ site_title: siteTitle, logo_text: siteTitle });
      invalidateNavigation();
    }
    await logActivity(userId, 'settings', 'Completed first-run setup');

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

export default router;
