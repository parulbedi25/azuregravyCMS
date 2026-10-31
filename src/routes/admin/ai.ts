import { Router, type NextFunction, type Request, type Response } from 'express';
import { asyncRoute, setFlash } from '../../lib/http.js';
import { requireRole, safeNext } from '../../lib/auth.js';
import { loadSettings, saveSettings } from '../../lib/settings.js';
import { logActivity } from '../../services/activity.js';
import { listUsers } from '../../services/users.js';
import {
  approvedMemberPresets, describeAiRow, listAiRows, setAiEnabled, type AiAccess,
} from '../../services/ai-access.js';
import { str, bool } from '../helpers.js';
import {
  AI_MODES, AI_PROVIDERS, AiError, composeDraft, describeAiReadiness, listProviderModels, loadAiConfig,
  maskApiKey, probeProvider, type ComposeMode,
} from '../../services/ai.js';

const router = Router();

/*
  Who may do what here.

  Configuration is administrators only: the assistant spends real money against a
  third-party API and can write into the publication, so `requireRole('admin')`
  is applied per route rather than relying on the UI hiding the panel. Hiding a
  button is not authorisation — a member who guesses the endpoint must still get
  a 403.

  Composing is the one exception, and it is granted per person rather than per
  role. See requireAiCompose below: an administrator decides who may use the
  assistant, and each of those people composes with credentials of their own.
*/

const MODE_IDS = AI_MODES.map((mode) => mode.id);

function normaliseMode(value: unknown): ComposeMode {
  const requested = str(value).toLowerCase();
  return (MODE_IDS as string[]).includes(requested) ? (requested as ComposeMode) : 'full';
}

function wantsJson(req: { xhr: boolean; get(name: string): string | undefined }): boolean {
  return req.xhr || (req.get('accept') ?? '').includes('application/json');
}

/**
 * Reduce a submitted preset list to ids that actually exist, de-duplicated and
 * lower-cased.
 *
 * Accepts the array a repeated checkbox name produces and the comma-separated
 * string a hidden field or an API caller would send. Unknown ids are dropped
 * rather than stored: the setting is later matched against AI_PROVIDERS, and a
 * hand-edited value must not be able to invent a provider.
 */
function normalisePresetList(value: unknown): string {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  const known = new Set(AI_PROVIDERS.map((preset) => preset.id));
  const picked: string[] = [];
  for (const entry of raw) {
    const id = String(entry).trim().toLowerCase();
    if (id && known.has(id) && !picked.includes(id)) picked.push(id);
  }
  return picked.join(',');
}

/**
 * Compose gate: entitled, and holding something usable to compose with.
 *
 * The two halves must not be conflated, because they fail differently:
 *
 *   - `canSee` — an administrator enabled the assistant for this account.
 *   - `canCompose` — there is a base URL, a model, and a key if the provider
 *     needs one. An entitled member with nothing assigned is stopped here rather
 *     than being allowed to fall through to the administrator's site-wide key,
 *     which would spend money on an account that is not theirs and that nobody
 *     ever explicitly agreed to.
 *
 * Refusals answer JSON for the editor's fetch and the error page for anything
 * else, so no caller can receive an HTML 200 for a denial.
 */
function requireAiCompose(req: Request, res: Response, next: NextFunction): void {
  const access = res.locals.aiAccess as AiAccess | undefined;

  const deny = (status: number, error: string, hint: string): void => {
    if (wantsJson(req)) {
      res.status(status).json({ ok: false, error, hint });
      return;
    }
    res.status(status).render('admin/error', {
      layout: 'layouts/admin',
      title: 'Not allowed',
      status,
      message: error,
      page: 'error',
    });
  };

  if (!access || !access.canSee) {
    deny(403, access?.reason || 'You do not have access to the AI assistant.', '');
    return;
  }
  if (!access.canCompose) {
    deny(
      403,
      access.reason,
      access.canSelfServe
        ? 'Choose an approved provider and add your own key under Studio → Profile.'
        : 'Ask an administrator to assign you a model.',
    );
    return;
  }
  next();
}

/* ------------------------------------------------------------ settings page */
router.get(
  '/ai',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const settings = await loadSettings(true);
    const config = loadAiConfig(settings);
    /*
      The whole team in one pass. listAiRows() is a single SELECT keyed by user,
      so this is two queries rather than one per member.

      Administrators are included in the list but flagged, because the page has
      to say plainly that they always have access — an administrator who could
      switch themselves off would be able to lock the only person who can switch
      them back on.
    */
    const [users, rows] = await Promise.all([listUsers(), listAiRows()]);
    const approved = approvedMemberPresets(settings);
    res.render('admin/ai', {
      layout: 'layouts/admin',
      title: 'AI assistant',
      adminTitle: 'AI assistant',
      adminDescription: 'Drafting help for whoever you grant it to, and the diagrams it draws.',
      page: 'ai',
      config,
      readiness: describeAiReadiness(config),
      maskedKey: maskApiKey(config.apiKey),
      modes: AI_MODES,
      providers: AI_PROVIDERS,
      members: users.map((user) => {
        const row = rows.get(user.id);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isAdmin: user.role === 'admin',
          enabled: Number(row?.is_enabled) === 1,
          summary: describeAiRow(row, approved),
          model: row?.model ?? '',
          baseUrl: row?.base_url ?? '',
          hasKey: !!(row?.api_key ?? '').trim(),
          keyOwner: row?.key_owner ?? 'admin',
        };
      }),
      /* Which presets members may point their own key at, as ids for the checkboxes. */
      approvedPresetIds: approved.map((preset) => preset.id),
    });
  }),
);

router.post(
  '/ai/settings',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const values: Record<string, string> = {
      ai_enabled: bool(req.body.ai_enabled) ? '1' : '0',
      ai_diagrams: bool(req.body.ai_diagrams) ? '1' : '0',
      ai_model: str(req.body.ai_model).slice(0, 120),
      ai_image_model: str(req.body.ai_image_model).slice(0, 120),
      ai_base_url: str(req.body.ai_base_url).slice(0, 300),
      /*
        `ai_member_presets` is deliberately NOT written here.

        It belongs to the "Who can use it" form, which is a separate POST. If this
        route wrote it too, then saving the provider — a form that carries no
        preset checkboxes — would silently empty the approved list and close
        self-service for every member. One setting, one owner: see /ai/members.
      */
    };

    const tokens = Number.parseInt(str(req.body.ai_max_tokens), 10);
    values.ai_max_tokens = String(Number.isFinite(tokens) && tokens > 0 ? Math.min(8000, tokens) : 1400);

    /*
      A blank key field means "leave the saved key alone", not "delete it" —
      otherwise every unrelated save would silently disarm the assistant,
      because browsers do not round-trip a password input's value.
    */
    const submittedKey = typeof req.body.ai_api_key === 'string' ? req.body.ai_api_key.trim() : '';
    if (bool(req.body.ai_api_key_clear)) {
      values.ai_api_key = '';
    } else if (submittedKey) {
      values.ai_api_key = submittedKey.slice(0, 300);
    }

    await saveSettings(values);
    await logActivity(res.locals.currentUser.id, 'ai', 'Updated AI assistant settings');

    const next = loadAiConfig(await loadSettings(true));
    setFlash(
      req,
      'success',
      next.enabled && describeAiReadiness(next).ready
        ? 'AI assistant saved and ready.'
        : 'AI assistant settings saved.',
    );
    res.redirect('/admin/ai');
  }),
);

/**
 * Who may use the assistant, and which providers they may bring their own key to.
 *
 * One form, one save, because the two halves are decided together: an
 * administrator granting access usually decides in the same moment whether that
 * person is expected to supply a key.
 *
 * Only values that actually changed are written, so a member who was never
 * granted access keeps no row at all — the absence of a row is what "never
 * entitled" means, and creating empty rows for the whole team would erase that
 * distinction.
 *
 * Administrators are skipped deliberately. They always have access and cannot be
 * switched off from here, so a stale or hand-crafted checkbox naming an admin id
 * has no effect rather than locking out the only person who could undo it.
 */
router.post(
  '/ai/members',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    /*
      Which providers a member may point their OWN key at. Reduced to real preset
      ids, because this list is the only thing standing between a member's key and
      an arbitrary endpoint they choose: their key still travels through this
      server, so the destination stays the administrator's decision even when the
      credential is not.
    */
    const presets = normalisePresetList(req.body.ai_member_presets);
    await saveSettings({ ai_member_presets: presets });

    const users = await listUsers();
    const grantable = new Set(users.filter((user) => user.role !== 'admin').map((user) => user.id));

    /* A repeated checkbox name arrives as an array; a single tick may not. */
    const submitted: unknown[] = Array.isArray(req.body.ai_member)
      ? (req.body.ai_member as unknown[])
      : req.body.ai_member === undefined
        ? []
        : [req.body.ai_member];
    const wanted = new Set(
      submitted
        .map((value: unknown) => Number(value))
        .filter((id: number) => Number.isInteger(id) && grantable.has(id)),
    );

    const rows = await listAiRows();
    let granted = 0;
    let revoked = 0;
    for (const user of users) {
      if (!grantable.has(user.id)) continue;
      const want = wanted.has(user.id);
      const have = Number(rows.get(user.id)?.is_enabled) === 1;
      if (want === have) continue;
      await setAiEnabled(user.id, want);
      if (want) granted += 1;
      else revoked += 1;
    }

    const changed = granted + revoked;
    const approvedCount = presets ? presets.split(',').length : 0;
    await logActivity(
      res.locals.currentUser.id,
      'ai',
      `Changed AI access for ${changed} member${changed === 1 ? '' : 's'}`,
      { granted, revoked, approvedPresets: approvedCount },
    );

    /*
      Report both halves. The preset list is saved even when no access changed,
      and saying "nothing to save" after an administrator approved a provider
      would read as though the click did nothing.
    */
    const parts: string[] = [];
    if (granted) parts.push(`${granted} member${granted === 1 ? '' : 's'} granted`);
    if (revoked) parts.push(`${revoked} member${revoked === 1 ? '' : 's'} revoked`);
    parts.push(
      approvedCount
        ? `${approvedCount} provider${approvedCount === 1 ? '' : 's'} approved for members' own keys`
        : 'members cannot bring their own key',
    );
    setFlash(req, changed ? 'success' : 'info', `AI access saved — ${parts.join(', ')}.`);
    res.redirect('/admin/ai');
  }),
);

/**
 * Enable or disable on demand, from the Studio sidebar.
 * Answers JSON for the sidebar switch and redirects for a no-JS fallback.
 */
router.post(
  '/ai/toggle',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const enabled = bool(req.body.enabled) ? '1' : '0';
    await saveSettings({ ai_enabled: enabled });
    await logActivity(res.locals.currentUser.id, 'ai', enabled === '1' ? 'Enabled the AI assistant' : 'Disabled the AI assistant');

    if (wantsJson(req)) {
      const config = loadAiConfig(await loadSettings(true));
      return res.json({ ok: true, enabled: enabled === '1', readiness: describeAiReadiness(config) });
    }

    setFlash(req, 'success', enabled === '1' ? 'AI assistant enabled.' : 'AI assistant disabled.');
    // safeNext rejects external and protocol-relative targets: this value comes
    // from a hidden form field, so it must not become an open redirect.
    res.redirect(safeNext(req.body.redirect));
  }),
);

  /* ------------------------------------------------------- test connection */
  /**
   * Prove the provider actually works before an admin relies on it.
   *
   * Tests the values currently in the form, falling back to the saved ones —
   * so a new provider can be tried without committing to it. The key field is
   * blank whenever a key is already stored (it is never echoed back), which is
   * why the fallback matters rather than being a convenience.
   *
   * Serves JSON to the fetch path and a flash + redirect to the no-JS path,
   * where the button posts the whole settings form via `formaction`.
   */
  router.post(
    '/ai/test',
    requireRole('admin'),
    asyncRoute(async (req, res) => {
      const saved = loadAiConfig(await loadSettings(true));
      const typedKey = str(req.body.ai_api_key).trim();

      const config = {
        ...saved,
        baseUrl: (str(req.body.ai_base_url).trim().replace(/\/+$/, '') || saved.baseUrl),
        model: str(req.body.ai_model).trim() || saved.model,
        apiKey: typedKey || saved.apiKey,
      };

      const result = await probeProvider(config);
      await logActivity(
        res.locals.currentUser.id,
        'ai',
        result.ok ? `AI connection test passed (${config.model})` : `AI connection test failed: ${result.message}`,
      );

      // `ProbeResult` already carries `ok`; spreading it again would be a
      // duplicate key, and a failed probe is still a successful test request.
      if (wantsJson(req)) return res.json(result);

      setFlash(req, result.ok ? 'success' : 'error', result.ok ? result.message : `${result.message} ${result.hint}`.trim());
      res.redirect('/admin/ai');
    }),
  );

  /* -------------------------------------------------------- model discovery */
/**
 * List the models a server is actually serving.
 *
 * Reads the base URL and key currently in the form, falling back to the saved
 * ones — exactly like `/ai/test`, and for the same reason: the key field is
 * blank whenever a key is already stored, so the fallback is what lets an admin
 * look up models for a provider they have not committed to yet.
 *
 * This is the half of keyless setup that presets cannot solve. A local server
 * has no documentation page listing model ids, and a wrong id answers 404 in a
 * way that reads like a broken installation rather than a typo.
 *
 * Serves JSON to the fetch path and a flash + redirect to the no-JS path, where
 * the button posts the whole settings form via `formaction`.
 */
router.post(
  '/ai/discover',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const saved = loadAiConfig(await loadSettings(true));
    const typedKey = str(req.body.ai_api_key).trim();

    const config = {
      ...saved,
      baseUrl: (str(req.body.ai_base_url).trim().replace(/\/+$/, '') || saved.baseUrl),
      model: str(req.body.ai_model).trim() || saved.model,
      apiKey: typedKey || saved.apiKey,
    };

    const result = await listProviderModels(config);
    await logActivity(
      res.locals.currentUser.id,
      'ai',
      result.ok
        ? `Listed ${result.models.length} AI model(s) from ${config.baseUrl}`
        : `AI model discovery failed: ${result.message}`,
    );

    if (wantsJson(req)) return res.json(result);

    setFlash(
      req,
      result.ok ? 'success' : 'error',
      result.ok
        ? `Models available: ${result.models.join(', ')}`.slice(0, 400)
        : `${result.message} ${result.hint}`.trim(),
    );
    res.redirect('/admin/ai');
  }),
);

  /* ----------------------------------------------------------------- compose */
/**
 * Turn a title into Markdown for the editor textarea.
 *
 * JSON only: the editor panel calls this with fetch and inserts the result,
 * so there is no redirect path and no page reload to lose unsaved writing.
 *
 * Open to whoever an administrator granted access to, not to administrators
 * alone — but always with the requester's own credentials.
 */
router.post(
  '/ai/compose',
  requireAiCompose,
  asyncRoute(async (req, res) => {
    /*
      The requester's configuration, resolved once per request by the admin
      router, never the site-wide one. An administrator composes with the site
      settings; everybody else composes with the base URL, model and key on their
      own entitlement row.

      requireAiCompose has already refused anyone entitled-but-unassigned, so
      this is always something the caller is allowed to spend. Falling back to
      the site key here would charge the administrator's account for work they
      never authorised, which is exactly the confusion per-member keys exist to
      prevent.
    */
    const config = (res.locals.aiAccess as AiAccess).config;

    const title = str(req.body.title).slice(0, 200);
    const mode = normaliseMode(req.body.mode);

    try {
      const result = await composeDraft(
        config,
        {
          title,
          mode,
          existing: str(req.body.existing).slice(0, 20_000),
          selection: str(req.body.selection).slice(0, 10_000),
          tone: str(req.body.tone).slice(0, 120),
          length: (['short', 'medium', 'long'] as const).includes(req.body.length as 'short')
            ? (req.body.length as 'short' | 'medium' | 'long')
            : 'medium',
          siteName: (await loadSettings()).site_title || 'Gravy',
        },
        { uploadedBy: res.locals.currentUser?.id ?? null },
      );

      await logActivity(res.locals.currentUser?.id ?? null, 'ai', `Drafted "${title}"`, {
        mode,
        characters: result.markdown.length,
        diagrams: result.diagramsCreated,
        /* Only ever non-zero in `article` mode; recorded so a run that produced
           no headlines is distinguishable from one that was never asked for any. */
        titleSuggestions: result.titleSuggestions.length,
      });

      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof AiError) {
        return res.status(error.status).json({ ok: false, error: error.message, hint: error.hint });
      }
      throw error;
    }
  }),
);

export default router;
