import { Router } from 'express';
import { asyncRoute, idParam, pageParam, paginate, setFlash } from '../../lib/http.js';
import { hashPassword, requireRole, verifyPassword } from '../../lib/auth.js';
import { str, bool } from '../helpers.js';
import { getDb } from '../../db/index.js';
import { createUser, deleteUser, getUser, getUserByEmail, listUsers, updateUser } from '../../services/users.js';
import { logActivity } from '../../services/activity.js';
import { loadSettings } from '../../lib/settings.js';
import { AI_PROVIDERS, providerForBaseUrl } from '../../services/ai.js';
import {
  approvedMemberPresets, clearAiAssignment, getAiRow, isPresetApproved, saveAiRow,
  type AiAccess, type AiRowPatch,
} from '../../services/ai-access.js';

const router = Router();

/* ----------------------------------------------------------------- users */
router.get(
  '/users',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const users = await listUsers();
    res.render('admin/users', {
      layout: 'layouts/admin',
      title: 'People',
      adminTitle: 'People',
      adminDescription: 'Writers, editors and the people who keep the lights on.',
      page: 'users',
      users,
    });
  }),
);

router.get(
  '/users/new',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    res.render('admin/user-form', {
      layout: 'layouts/admin',
      title: 'New writer',
      adminTitle: 'People',
      page: 'users',
      user: null,
      error: null,
      /*
        The same AI locals the edit route passes, even though this form renders no
        assignment section. EJS compiles inside `with(locals)`, so a local the
        template names but this route never passed is a ReferenceError rather than
        undefined — passing them here is what keeps one shared template from
        needing `typeof` guards scattered through it.

        No row exists because nobody is entitled until an administrator says so,
        which is exactly the required default: a new member of any role starts
        with no access and no model assigned.
      */
      aiRow: null,
      aiMaskedKey: '',
      providers: AI_PROVIDERS,
      approvedPresetIds: approvedMemberPresets(await loadSettings(true)).map((preset) => preset.id),
    });
  }),
);

router.get(
  '/users/:id',
  requireRole('admin'),
  asyncRoute(async (req, res, next) => {
    const user = await getUser(Number(req.params.id));
    if (!user) return next();
    /*
      The member's entitlement, if any. `aiRow` is null for somebody who was
      never granted access, which is the state every new member starts in — the
      form has to be able to render that as "no access, nothing assigned" rather
      than silently implying the site-wide provider is in use.
    */
    const settings = await loadSettings(true);
    const aiRow = await getAiRow(user.id);
    res.render('admin/user-form', {
      layout: 'layouts/admin',
      title: `Edit ${user.name}`,
      adminTitle: 'People',
      page: 'users',
      user,
      error: null,
      aiRow,
      aiMaskedKey: aiRow && aiRow.api_key.trim() ? `••••••••${aiRow.api_key.trim().slice(-4)}` : '',
      providers: AI_PROVIDERS,
      approvedPresetIds: approvedMemberPresets(settings).map((preset) => preset.id),
    });
  }),
);

router.post(
  '/users',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const name = str(req.body.name);
    const email = str(req.body.email).toLowerCase();
    const password = str(req.body.password);
    if (!name || !email || password.length < 8) {
      setFlash(req, 'error', 'Name, email and a password of at least 8 characters are required.');
      return res.redirect('/admin/users/new');
    }
    if (await getUserByEmail(email)) {
      setFlash(req, 'error', 'That email address is already in use.');
      return res.redirect('/admin/users/new');
    }
    const id = await createUser({
      name,
      email,
      password_hash: await hashPassword(password),
      role: str(req.body.role, 'author'),
      bio: str(req.body.bio) || null,
      website: str(req.body.website) || null,
      twitter: str(req.body.twitter) || null,
      linkedin: str(req.body.linkedin) || null,
      avatar: str(req.body.avatar) || null,
    });
    await logActivity(res.locals.currentUser.id, 'user:created', name);
    setFlash(req, 'success', `${name} can now sign in.`);
    res.redirect(`/admin/users/${id}`);
  }),
);

router.post(
  '/users/:id',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await getUser(id);
    if (!existing) return res.redirect('/admin/users');
    const name = str(req.body.name, existing.name);
    const email = str(req.body.email, existing.email).toLowerCase();
    const password = str(req.body.password);
    const role = str(req.body.role, existing.role);
    if (role !== 'admin' && existing.role === 'admin') {
      const admins = await (await getDb()).query<{ total: number }>("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
      if (Number(admins[0]?.total ?? 0) <= 1) {
        setFlash(req, 'error', 'There must be at least one admin.');
        return res.redirect(`/admin/users/${id}`);
      }
    }
    await updateUser(id, {
      name,
      email,
      role,
      bio: str(req.body.bio) || null,
      website: str(req.body.website) || null,
      twitter: str(req.body.twitter) || null,
      linkedin: str(req.body.linkedin) || null,
      avatar: str(req.body.avatar) || null,
      password_hash: password.length >= 8 ? await hashPassword(password) : undefined,
    });
    await logActivity(res.locals.currentUser.id, 'user:updated', name);

    /*
      The AI section posts alongside the account fields, but only when it is
      rendered. An administrator's own record is never assigned — they always use
      the site-wide configuration — so editing one submits no AI fields at all,
      and this must not read that absence as "clear everything".
    */
    if (str(req.body.ai_assignment_form) === '1') {
      const enabled = bool(req.body.ai_enabled);
      const baseUrl = str(req.body.ai_base_url).slice(0, 300);

      const patch: AiRowPatch = {
        is_enabled: enabled,
        base_url: baseUrl,
        model: str(req.body.ai_model).slice(0, 120),
        image_model: str(req.body.ai_image_model).slice(0, 120),
        /* Recorded so the member's own picker can show which preset this is. */
        preset_id: providerForBaseUrl(baseUrl)?.id ?? '',
      };

      /*
        Same convention as the site-wide key: a blank field means "leave the saved
        key alone", because a password input never round-trips its value and every
        unrelated save would otherwise disarm the member.
      */
      const submittedKey = typeof req.body.ai_api_key === 'string' ? req.body.ai_api_key.trim() : '';
      if (bool(req.body.ai_key_clear)) {
        patch.api_key = '';
        patch.key_owner = 'admin';
      } else if (submittedKey) {
        patch.api_key = submittedKey;
        patch.key_owner = 'admin';
      }
      /* Otherwise the existing key and its owner are left untouched. */

      if (str(req.body.ai_clear_assignment) === '1') {
        /*
          Keep the access decision, drop the credentials. Turning somebody off is
          routine and reversible; deleting a saved key is not, and an
          administrator who only meant to switch a member off should not have to
          go and find the key again afterwards.
        */
        await saveAiRow(id, { is_enabled: enabled });
        await clearAiAssignment(id);
      } else {
        await saveAiRow(id, patch);
      }

      await logActivity(
        res.locals.currentUser.id,
        'ai',
        `Updated AI access for ${name}`,
        { enabled, model: patch.model ?? '', assignedByAdmin: true },
      );
    }

    setFlash(req, 'success', 'Profile updated.');
    res.redirect(`/admin/users/${id}`);
  }),
);

router.post(
  '/users/:id/delete',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (id === res.locals.currentUser.id) {
      setFlash(req, 'error', 'You cannot delete your own account.');
      return res.redirect('/admin/users');
    }
    const admins = await (await getDb()).query<{ total: number }>("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
    const target = await getUser(id);
    if (target?.role === 'admin' && Number(admins[0]?.total ?? 0) <= 1) {
      setFlash(req, 'error', 'There must be at least one admin.');
      return res.redirect('/admin/users');
    }
    await deleteUser(id);
    setFlash(req, 'success', 'Account removed. Their posts were removed with it.');
    res.redirect('/admin/users');
  }),
);

/* --------------------------------------------------------------- profile */
router.get('/profile', (req, res) => {
  res.render('admin/profile', {
    layout: 'layouts/admin',
    title: 'Your profile',
    adminTitle: 'Profile',
    adminDescription: 'How you appear across the publication.',
    page: 'profile',
    error: null,
  });
});

/**
 * A member's own key.
 *
 * The base URL is never read from the form. A member picks one of the presets an
 * administrator approved and this route looks the endpoint up server-side, so
 * the credential is theirs but the destination is not. Without that, anybody
 * granted access could point the CMS at an endpoint they control and read every
 * draft routed through it — the key being "their own" would be no comfort.
 *
 * `is_enabled` is deliberately absent from the patch. Entitlement is the
 * administrator's decision, and a member must not be able to grant themselves
 * access by posting to their own profile.
 */
router.post(
  '/profile/ai',
  asyncRoute(async (req, res) => {
    const user = res.locals.currentUser;
    const access = res.locals.aiAccess as AiAccess;

    if (access.isAdmin) {
      setFlash(req, 'info', 'Administrators use the site-wide provider — change it under Studio → AI assistant.');
      return res.redirect('/admin/ai');
    }
    if (!access.canSee) {
      setFlash(req, 'error', 'The AI assistant has not been enabled for your account.');
      return res.redirect('/admin/profile');
    }
    if (!access.canSelfServe) {
      setFlash(
        req,
        'error',
        access.approvedPresets.length
          ? 'Your AI configuration is managed by an administrator.'
          : 'No provider has been approved for members to use their own key with yet.',
      );
      return res.redirect('/admin/profile');
    }

    const settings = await loadSettings(true);
    const presetId = str(req.body.ai_preset).trim().toLowerCase();
    const preset = AI_PROVIDERS.find((candidate) => candidate.id === presetId);
    /* Re-checked against the live setting, not against what the form offered. */
    if (!preset || !isPresetApproved(preset.id, settings)) {
      setFlash(req, 'error', 'Choose one of the approved providers.');
      return res.redirect('/admin/profile');
    }

    const patch: AiRowPatch = {
      base_url: preset.baseUrl,
      /* The member may name a model on that provider; the preset's is the default. */
      model: str(req.body.ai_model).trim().slice(0, 120) || preset.model,
      preset_id: preset.id,
      key_owner: 'member',
    };

    /* Blank means "leave the saved key alone" — a password input never round-trips. */
    const submittedKey = typeof req.body.ai_api_key === 'string' ? req.body.ai_api_key.trim() : '';
    if (bool(req.body.ai_key_clear)) patch.api_key = '';
    else if (submittedKey) patch.api_key = submittedKey;

    await saveAiRow(user.id, patch);
    await logActivity(user.id, 'ai', `Set their own AI provider (${preset.label})`);
    setFlash(req, 'success', `Your AI provider is now ${preset.label}.`);
    res.redirect('/admin/profile');
  }),
);

router.post(
  '/profile',
  asyncRoute(async (req, res) => {
    const user = res.locals.currentUser;
    await updateUser(user.id, {
      name: str(req.body.name, user.name),
      email: str(req.body.email, user.email).toLowerCase(),
      role: user.role,
      bio: str(req.body.bio) || null,
      website: str(req.body.website) || null,
      twitter: str(req.body.twitter) || null,
      linkedin: str(req.body.linkedin) || null,
      avatar: str(req.body.avatar) || null,
    });
    setFlash(req, 'success', 'Your profile has been updated.');
    res.redirect('/admin/profile');
  }),
);

router.post(
  '/profile/password',
  asyncRoute(async (req, res) => {
    const user = res.locals.currentUser;
    const current = str(req.body.current_password);
    const next = str(req.body.new_password);
    const confirm = str(req.body.confirm_password);
    const full = await getUser(user.id);
    if (!full || !(await verifyPassword(current, full.password_hash))) {
      setFlash(req, 'error', 'Your current password is incorrect.');
      return res.redirect('/admin/profile');
    }
    if (next.length < 8) {
      setFlash(req, 'error', 'New passwords need at least 8 characters.');
      return res.redirect('/admin/profile');
    }
    if (next !== confirm) {
      setFlash(req, 'error', 'The new passwords do not match.');
      return res.redirect('/admin/profile');
    }
    await (await getDb()).execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), user.id]);
    await logActivity(user.id, 'password', 'Changed password');
    setFlash(req, 'success', 'Password changed.');
    res.redirect('/admin/profile');
  }),
);

/* ----------------------------------------------------------- subscribers */
router.get(
  '/subscribers',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const db = await getDb();
    const page = pageParam(req.query.page);
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params: unknown[] = [];
    const where = search ? 'WHERE email LIKE ? OR name LIKE ?' : '';
    if (search) params.push(`%${search}%`, `%${search}%`);
    const count = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM subscribers ${where}`, params);
    const subscribers = await db.query<{ id: number; email: string; name: string | null; status: string; created_at: string }>(
      `SELECT * FROM subscribers ${where} ORDER BY created_at DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      params,
    );
    const statusRows = await db.query<{ status: string; total: number }>('SELECT status, COUNT(*) AS total FROM subscribers GROUP BY status');
    const byStatus: Record<string, number> = {};
    for (const row of statusRows) byStatus[row.status] = Number(row.total);
    res.render('admin/subscribers', {
      layout: 'layouts/admin',
      title: 'The letter',
      adminTitle: 'Subscribers',
      adminDescription: 'People who asked to hear from you.',
      page: 'subscribers',
      subscribers,
      search,
      byStatus,
      pagination: paginate(Number(count[0]?.total ?? 0), page, 25),
    });
  }),
);

router.post(
  '/subscribers',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const email = str(req.body.email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setFlash(req, 'error', 'That does not look like an email address.');
      return res.redirect('/admin/subscribers');
    }
    await (await getDb()).execute(
      `INSERT INTO subscribers (email, name, status, token) VALUES (?, ?, 'confirmed', ?)
       ON DUPLICATE KEY UPDATE status = 'confirmed'`,
      [email, str(req.body.name) || null, crypto.randomUUID().replace(/-/g, '')],
    );
    setFlash(req, 'success', 'Subscriber added.');
    res.redirect('/admin/subscribers');
  }),
);

router.post(
  '/subscribers/:id/delete',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    await (await getDb()).execute('DELETE FROM subscribers WHERE id = ?', [idParam(req.params.id)]);
    setFlash(req, 'success', 'Subscriber removed.');
    res.redirect('/admin/subscribers');
  }),
);

router.get(
  '/subscribers/export.csv',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const rows = await (await getDb()).query<{ email: string; name: string | null; status: string; created_at: string }>(
      'SELECT email, name, status, created_at FROM subscribers ORDER BY created_at DESC',
    );
    const csv = ['email,name,status,subscribed_at']
      .concat(rows.map((row) => [row.email, row.name ?? '', row.status, row.created_at].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')))
      .join('\n');
    res.type('text/csv').attachment('subscribers.csv').send(csv);
  }),
);

/* -------------------------------------------------------------- messages */
router.get(
  '/messages',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const db = await getDb();
    const messages = await db.query<{
      id: number; name: string; email: string; subject: string | null; message: string; is_read: number; created_at: string;
    }>('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100');
    res.render('admin/messages', {
      layout: 'layouts/admin',
      title: 'Inbox',
      adminTitle: 'Inbox',
      adminDescription: 'Messages from the contact form.',
      page: 'messages',
      messages,
    });
  }),
);

router.post(
  '/messages/:id',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    await (await getDb()).execute('UPDATE contact_messages SET is_read = ? WHERE id = ?', [
      str(req.body.is_read) === '1' ? 1 : 0,
      idParam(req.params.id),
    ]);
    res.redirect('/admin/messages');
  }),
);

router.post(
  '/messages/:id/delete',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    await (await getDb()).execute('DELETE FROM contact_messages WHERE id = ?', [idParam(req.params.id)]);
    setFlash(req, 'success', 'Message deleted.');
    res.redirect('/admin/messages');
  }),
);

export default router;
