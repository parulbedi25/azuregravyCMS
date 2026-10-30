import { Router } from 'express';
import { asyncRoute, setFlash } from '../../lib/http.js';
import { requireRole, safeNext } from '../../lib/auth.js';
import { loadSettings, saveSettings } from '../../lib/settings.js';
import { logActivity } from '../../services/activity.js';
import { str, bool } from '../helpers.js';
import {
  AI_MODES, AI_PROVIDERS, AiError, composeDraft, describeAiReadiness, listProviderModels, loadAiConfig,
  maskApiKey, probeProvider, type ComposeMode,
} from '../../services/ai.js';

const router = Router();

/*
  Every route here is administrators only.

  The assistant spends real money against a third-party API and can write into
  the publication, so `requireRole('admin')` is applied per route rather than
  relying on the UI hiding the panel. Hiding a button is not authorisation: an
  editor who can guess the endpoint must still get a 403.
*/

const MODE_IDS = AI_MODES.map((mode) => mode.id);

function normaliseMode(value: unknown): ComposeMode {
  const requested = str(value).toLowerCase();
  return (MODE_IDS as string[]).includes(requested) ? (requested as ComposeMode) : 'full';
}

function wantsJson(req: { xhr: boolean; get(name: string): string | undefined }): boolean {
  return req.xhr || (req.get('accept') ?? '').includes('application/json');
}

/* ------------------------------------------------------------ settings page */
router.get(
  '/ai',
  requireRole('admin'),
  asyncRoute(async (_req, res) => {
    const settings = await loadSettings(true);
    const config = loadAiConfig(settings);
    res.render('admin/ai', {
      layout: 'layouts/admin',
      title: 'AI assistant',
      adminTitle: 'AI assistant',
      adminDescription: 'Drafting help for administrators, and the diagrams it draws.',
      page: 'ai',
      config,
      readiness: describeAiReadiness(config),
      maskedKey: maskApiKey(config.apiKey),
      modes: AI_MODES,
      providers: AI_PROVIDERS,
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
      ai_base_url: str(req.body.ai_base_url).slice(0, 300),
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
 */
router.post(
  '/ai/compose',
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const config = loadAiConfig(await loadSettings());
    const readiness = describeAiReadiness(config);
    if (!readiness.ready) {
      return res.status(400).json({
        ok: false,
        error: readiness.reason,
        hint: 'Configure the assistant under Studio → AI assistant.',
      });
    }

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
