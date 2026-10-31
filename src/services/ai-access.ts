import { getDb } from '../db/index.js';
import {
  AI_PROVIDERS,
  describeAiReadiness,
  loadAiConfig,
  maskApiKey,
  type AiConfig,
  type AiProviderPreset,
} from './ai.js';
import type { SettingsMap, User } from '../types.js';

/*
  Who may use the AI assistant, and with which credentials.

  Before this, access was `requireRole('admin')` and every view derived the same
  answer from the site-wide settings. That is fine while one person runs the
  site, and wrong the moment there is a team: an editor either got the
  administrator's API key spent on their behalf or got nothing.

  The rule now is explicit and per person:

    - Administrators always have access, and always use the site-wide
      configuration. They cannot be locked out of the screen that grants access.
    - Everyone else needs a `user_ai` row with `is_enabled` set. No row means no
      entitlement, so a brand-new member of any role starts with nothing — being
      promoted to editor does not hand them the assistant as a side effect.
    - An entitled member composes with the base URL, model and key on their own
      row. They never fall back to the site-wide key, because that key belongs
      to the administrator's account and spending it for somebody else was never
      an explicit decision.

  Nothing in here trusts the client: the routes decide who may write these rows,
  and a member may only ever choose from the presets an administrator approved.
*/

export interface UserAiRow {
  user_id: number;
  /** TINYINT comes back as a number; treat anything but 1 as off. */
  is_enabled: number;
  base_url: string;
  model: string;
  image_model: string;
  api_key: string;
  key_owner: 'admin' | 'member';
  preset_id: string;
  updated_at: string;
}

/** Where the effective configuration came from. Surfaced because it is not obvious. */
export type AiAccessSource = 'site' | 'assigned' | 'own' | 'none';

export interface AiAccess {
  isAdmin: boolean;
  /** Render the assistant at all — the editor card, the profile section. */
  canSee: boolean;
  /** Actually compose. False when entitled but nothing usable is assigned. */
  canCompose: boolean;
  /** The configuration compose will use. Never a member's when they have none. */
  config: AiConfig;
  /** One sentence explaining canSee/canCompose, shown verbatim in the UI. */
  reason: string;
  source: AiAccessSource;
  /** Who supplied the key. Empty when there is no key. */
  keyOwner: '' | 'admin' | 'member';
  model: string;
  baseUrl: string;
  hasKey: boolean;
  /**
   * Masked form only. The raw key never reaches a template, so it cannot be
   * echoed back into a page, a JSON response or a browser's form autofill.
   */
  maskedKey: string;
  presetId: string;
  /** May this person choose an approved preset and enter their own key? */
  canSelfServe: boolean;
  /** Presets an administrator approved for members, for the profile picker. */
  approvedPresets: AiProviderPreset[];
}

const normaliseUrl = (value: string) => (value ?? '').trim().replace(/\/+$/, '');

/* ------------------------------------------------------------------ */
/* rows                                                                */
/* ------------------------------------------------------------------ */

export async function getAiRow(userId: number): Promise<UserAiRow | null> {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const db = await getDb();
  const rows = await db.query<UserAiRow>('SELECT * FROM user_ai WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] ?? null;
}

/** Every entitlement at once, keyed by user — the AI page lists the whole team. */
export async function listAiRows(): Promise<Map<number, UserAiRow>> {
  const db = await getDb();
  const rows = await db.query<UserAiRow>('SELECT * FROM user_ai');
  return new Map(rows.map((row) => [Number(row.user_id), row]));
}

export interface AiRowPatch {
  is_enabled?: boolean;
  base_url?: string;
  model?: string;
  image_model?: string;
  /**
   * `undefined` leaves the saved key alone, `''` clears it. The distinction
   * matters: a form that renders the key masked posts back the mask, and treating
   * that as "no key" would wipe a working credential on every unrelated save.
   */
  api_key?: string;
  key_owner?: 'admin' | 'member';
  preset_id?: string;
}

/** Reads the current row, applies only the keys present in the patch, upserts. */
export async function saveAiRow(userId: number, patch: AiRowPatch): Promise<UserAiRow> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('saveAiRow needs a real user id');
  const existing = await getAiRow(userId);
  const next = {
    is_enabled: existing ? Number(existing.is_enabled) === 1 : false,
    base_url: existing?.base_url ?? '',
    model: existing?.model ?? '',
    image_model: existing?.image_model ?? '',
    api_key: existing?.api_key ?? '',
    key_owner: existing?.key_owner ?? ('admin' as const),
    preset_id: existing?.preset_id ?? '',
  };

  if (patch.is_enabled !== undefined) next.is_enabled = patch.is_enabled;
  if (patch.base_url !== undefined) next.base_url = normaliseUrl(patch.base_url).slice(0, 300);
  if (patch.model !== undefined) next.model = patch.model.trim().slice(0, 120);
  if (patch.image_model !== undefined) next.image_model = patch.image_model.trim().slice(0, 120);
  if (patch.api_key !== undefined) next.api_key = patch.api_key.trim().slice(0, 300);
  if (patch.key_owner !== undefined) next.key_owner = patch.key_owner;
  if (patch.preset_id !== undefined) next.preset_id = patch.preset_id.trim().slice(0, 60);

  const db = await getDb();
  await db.execute(
    `INSERT INTO user_ai (user_id, is_enabled, base_url, model, image_model, api_key, key_owner, preset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_enabled = VALUES(is_enabled),
       base_url = VALUES(base_url),
       model = VALUES(model),
       image_model = VALUES(image_model),
       api_key = VALUES(api_key),
       key_owner = VALUES(key_owner),
       preset_id = VALUES(preset_id)`,
    [userId, next.is_enabled ? 1 : 0, next.base_url, next.model, next.image_model, next.api_key, next.key_owner, next.preset_id],
  );

  return {
    user_id: userId,
    is_enabled: next.is_enabled ? 1 : 0,
    base_url: next.base_url,
    model: next.model,
    image_model: next.image_model,
    api_key: next.api_key,
    key_owner: next.key_owner,
    preset_id: next.preset_id,
    updated_at: existing?.updated_at ?? '',
  };
}

/**
 * Turn access off without destroying the assignment.

 * Switching somebody off is a routine, reversible decision; deleting their saved
 * key is not, and an administrator who toggles a member off for a month should
 * not have to go and find the key again afterwards. `clearAiAssignment` is the
 * separate, explicit act of removing the credentials.
 */
export async function setAiEnabled(userId: number, enabled: boolean): Promise<void> {
  await saveAiRow(userId, { is_enabled: enabled });
}

/** Removes the provider, model and key but leaves the entitlement row in place. */
export async function clearAiAssignment(userId: number): Promise<void> {
  await saveAiRow(userId, { base_url: '', model: '', image_model: '', api_key: '', preset_id: '', key_owner: 'admin' });
}

/* ------------------------------------------------------------------ */
/* approved presets                                                    */
/* ------------------------------------------------------------------ */

/**
 * The provider presets an administrator has approved for members' own keys.
 *
 * Empty means closed: nobody can self-serve until an administrator picks
 * something. Unknown ids are dropped rather than trusted, so a stale or
 * hand-edited setting cannot resurrect a preset that no longer exists.
 */
export function approvedMemberPresets(settings: SettingsMap): AiProviderPreset[] {
  const wanted = (settings.ai_member_presets ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return [];
  return AI_PROVIDERS.filter((preset) => wanted.includes(preset.id));
}

export function isPresetApproved(presetId: string, settings: SettingsMap): boolean {
  const id = (presetId ?? '').trim().toLowerCase();
  if (!id) return false;
  return approvedMemberPresets(settings).some((preset) => preset.id === id);
}

/* ------------------------------------------------------------------ */
/* resolution                                                          */
/* ------------------------------------------------------------------ */

function blankConfig(site: AiConfig): AiConfig {
  return {
    enabled: site.enabled,
    baseUrl: '',
    apiKey: '',
    model: '',
    imageModel: '',
    /* Budget and rendering stay the administrator's decision, not a member's. */
    maxTokens: site.maxTokens,
    diagrams: site.diagrams,
    timeoutMs: site.timeoutMs,
  };
}

function shape(partial: Partial<AiAccess>, site: AiConfig, approved: AiProviderPreset[]): AiAccess {
  return {
    isAdmin: false,
    canSee: false,
    canCompose: false,
    config: blankConfig(site),
    reason: '',
    source: 'none',
    keyOwner: '',
    model: '',
    baseUrl: '',
    hasKey: false,
    maskedKey: '',
    presetId: '',
    canSelfServe: false,
    approvedPresets: approved,
    ...partial,
  };
}

/**
 * The one function every gate should call: the editor card, the compose
 * endpoint, the sidebar badge and the profile section.

 * Deriving this per view is how the codebase already got burned once — three
 * views re-implemented readiness and two of them demanded an API key, which
 * silently disabled every keyless provider. There is now one answer.
 */
export async function resolveAiAccess(user: User | null, settings: SettingsMap): Promise<AiAccess> {
  const site = loadAiConfig(settings);
  const approved = approvedMemberPresets(settings);

  if (!user) {
    return shape({ reason: 'Sign in to use the AI assistant.' }, site, approved);
  }
  if (!site.enabled) {
    return shape({ isAdmin: user.role === 'admin', reason: 'The AI assistant is switched off.' }, site, approved);
  }

  /* Administrators use the site-wide configuration and are never locked out. */
  if (user.role === 'admin') {
    const readiness = describeAiReadiness(site);
    return shape(
      {
        isAdmin: true,
        canSee: true,
        canCompose: readiness.ready,
        config: site,
        reason: readiness.reason,
        source: 'site',
        keyOwner: site.apiKey ? 'admin' : '',
        model: site.model,
        baseUrl: site.baseUrl,
        hasKey: !!site.apiKey,
        maskedKey: maskApiKey(site.apiKey),
      },
      site,
      approved,
    );
  }

  const row = await getAiRow(user.id);
  if (!row || Number(row.is_enabled) !== 1) {
    return shape(
      {
        reason: 'An administrator has not enabled the AI assistant for your account.',
        /* Knowing which presets exist is harmless and the profile page needs it. */
        canSelfServe: false,
      },
      site,
      approved,
    );
  }

  const baseUrl = normaliseUrl(row.base_url);
  const model = row.model.trim();
  const apiKey = row.api_key.trim();
  const owner = row.key_owner === 'member' ? 'member' : 'admin';

  /*
    A member may look after their own key only when an administrator has approved
    at least one preset AND has not assigned the configuration themselves. An
    admin-assigned setup stays admin-owned: the member can use it, not rewrite
    it. An entitled member with nothing assigned yet is free to pick.
  */
  const canSelfServe = approved.length > 0 && (owner === 'member' || !baseUrl);

  if (!baseUrl || !model) {
    return shape(
      {
        canSee: true,
        canCompose: false,
        reason: canSelfServe
          ? 'No model has been assigned to you yet. Choose an approved provider and add your own key on your profile, or ask an administrator to assign one.'
          : 'No model has been assigned to you yet. Ask an administrator to assign one.',
        source: 'none',
        keyOwner: '',
        presetId: row.preset_id,
        canSelfServe,
      },
      site,
      approved,
    );
  }

  const config: AiConfig = {
    enabled: true,
    baseUrl,
    apiKey,
    model,
    imageModel: row.image_model.trim(),
    maxTokens: site.maxTokens,
    diagrams: site.diagrams,
    timeoutMs: site.timeoutMs,
  };
  const readiness = describeAiReadiness(config);

  return shape(
    {
      canSee: true,
      canCompose: readiness.ready,
      config,
      reason: readiness.reason,
      source: owner === 'member' ? 'own' : 'assigned',
      keyOwner: apiKey ? owner : '',
      model,
      baseUrl,
      hasKey: !!apiKey,
      maskedKey: maskApiKey(apiKey),
      presetId: row.preset_id,
      canSelfServe,
    },
    site,
    approved,
  );
}

/**
 * Fail-safe answer for when the entitlement cannot be read at all.
 *
 * The assistant is an optional feature and the rest of the Studio is not, so a
 * problem here must degrade to "no access" rather than take the dashboard down
 * with it. Denying is the safe direction: the worst outcome is an editor who
 * cannot draft for a moment, never an editor silently spending somebody else's
 * API key.
 */
export function unavailableAiAccess(settings: SettingsMap, reason: string): AiAccess {
  return shape({ reason }, loadAiConfig(settings), approvedMemberPresets(settings));
}

/**
 * One-line description of a member's entitlement for the administrator's list.
 * Deliberately never includes the key, only whether one exists and whose it is.
 */
export function describeAiRow(row: UserAiRow | undefined, approved: AiProviderPreset[]): string {
  if (!row || Number(row.is_enabled) !== 1) return 'No access';
  const preset = approved.find((p) => p.id === row.preset_id);
  if (!row.base_url.trim() || !row.model.trim()) {
    return 'Access · no model assigned';
  }
  const who = row.key_owner === 'member' ? 'their own key' : row.api_key.trim() ? 'admin key' : 'no key needed';
  const provider = preset?.label ?? row.base_url.trim().replace(/^https?:\/\//, '');
  return `${provider} · ${row.model.trim()} · ${who}`;
}
