import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { IMAGE_FALLBACK_URL, UPLOADS_DIR } from '../config.js';
import { createMedia } from './media.js';
import { parseDiagramSpec, renderDiagram, type DiagramSpec } from './diagram.js';
import { imageSize } from 'image-size';
import { slugify } from '../lib/text.js';
import { truthy } from '../lib/settings.js';
import type { SettingsMap } from '../types.js';

/**
 * Admin-only drafting assistant.
 *
 * The provider is any OpenAI-compatible `POST {baseUrl}/chat/completions`
 * endpoint, so the same code drives OpenAI, Azure OpenAI, Groq, OpenRouter,
 * Together and a local Ollama/LM Studio server — the admin supplies a base URL,
 * key and model, and nothing here is tied to one vendor.
 *
 * Diagrams are never taken from the model as markup. The model is asked for a
 * small JSON spec in a ```diagram fence; `services/diagram.ts` validates it and
 * draws the SVG. See the header comment there for why that split matters.
 */

export type ComposeMode =
  | 'title'
  | 'full'
  | 'image'
  | 'title_post_image'
  | 'continue'
  | 'selection'
  | 'outline';

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Model used for `{baseUrl}/images/generations`, which is a different
   * capability from the chat model above — `gpt-4o-mini` cannot draw.
   *
   * Blank means "no image-capable provider is configured", so feature images go
   * straight to the keyless fallback instead of paying a round trip for a
   * rejection that is certain.
   */
  imageModel: string;
  maxTokens: number;
  diagrams: boolean;
  timeoutMs: number;
}

export interface ComposeRequest {
  title: string;
  mode: ComposeMode;
  existing?: string;
  selection?: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  siteName?: string;
}

export interface ComposeResult {
  markdown: string;
  diagramsCreated: number;
  diagramsSkipped: number;
  model: string;
  /**
   * Headlines offered by the `title` and `title_post_image` modes, in the order
   * the model gave them.
   *
   * Empty for every other mode, and empty rather than an error when the model
   * ignored the instruction — a draft with no headline choice is still a draft.
   */
  titleSuggestions: string[];
  /**
   * The generated feature image, for the `image` and `title_post_image` modes.
   *
   * Already saved to the media library, so `mediaId` is what the editor's
   * `featured_image_id` field wants. Null in every other mode, and null rather
   * than thrown when a combined mode could not get a picture — see `imageNote`.
   */
  image: GeneratedImage | null;
  /**
   * Why there is no image, in words an administrator can act on.
   *
   * Only ever set alongside a usable draft: losing the article because the
   * picture failed would be the worse outcome, so the two are reported
   * separately. Empty when an image succeeded or was not asked for.
   */
  imageNote: string;
}

/** An error with a message safe to show an administrator. */
export class AiError extends Error {
  constructor(message: string, readonly hint = '', readonly status = 502) {
    super(message);
    this.name = 'AiError';
  }
}

/*
  Order and wording match the editor's "How much should it write?" dropdown
  exactly, because this array is also what Studio → AI assistant renders as the
  list of things the assistant can do.
*/
export const AI_MODES: Array<{ id: ComposeMode; label: string; help: string }> = [
  { id: 'title', label: 'Title', help: 'Proposes five headlines for your subject and changes nothing else. The one you pick fills the Title field, where it stays editable.' },
  { id: 'full', label: 'Post', help: 'Replaces the body with a complete draft built from your title.' },
  { id: 'image', label: 'Feature Image', help: 'Draws a cover image for your subject, saves it to the media library and sets it as the featured image. Leaves your text alone.' },
  { id: 'title_post_image', label: 'Title + Post + Feature Image', help: 'The whole package in one go: five headlines to choose from, a complete draft in the editor, and a generated feature image.' },
  { id: 'continue', label: 'Continue from where I am', help: 'Keeps what you have written and carries on from the end of it.' },
  { id: 'selection', label: 'Rewrite my selection', help: 'Expands or improves only the text you have highlighted.' },
  { id: 'outline', label: 'An outline only', help: 'Headings and one-line beats, so you can fill in the detail yourself.' },
];

export interface AiProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  free: boolean;
  /**
   * Whether this provider refuses to answer without a key.
   *
   * Advisory — it drives the settings copy and nothing else. The runtime rule
   * is narrower and deliberately provider-agnostic: a blank key means "send no
   * Authorization header", so any OpenAI-compatible server works whether or not
   * it appears in this list. A provider that genuinely needs a key answers 401
   * and the administrator sees that, instead of the assistant refusing to try.
   */
  requiresKey: boolean;
  /** `local` runs on the same machine as the CMS; `hosted` is a remote service. */
  kind: 'local' | 'hosted';
  keyHint: string;
  privacy: string;
}

/*
  Provider presets offered in the settings UI.

  Ordered by what they cost the administrator to start with: no key at all
  first, then free-with-a-key, then paid.

  Two kinds of keyless provider, and the difference matters more than the price:

    - `kind: 'local'` — a model server the administrator runs themselves
      (Ollama, LM Studio, llama.cpp and the rest). Each speaks the OpenAI
      chat-completions shape on localhost and none authenticates. These are the
      only option where an unpublished draft never leaves the building, and the
      only one that works with no internet access at all.

      They are also the ones that will NOT work on shared hosting. A cPanel
      account has no local model server to talk to, and cannot start one; on
      that hosting a keyless setup needs the hosted option below.

    - `kind: 'hosted'` with `requiresKey: false` — a public endpoint that
      answers without credentials. Convenient, but it is somebody else's free
      tier: it can rate-limit, change shape or vanish without notice, and every
      prompt crosses the public internet. Each entry's `privacy` line says so.

  Verification status, stated plainly because it should govern how much anyone
  trusts this list:

    - The keyless code path IS tested. With no key saved, no Authorization
      header is sent and readiness does not demand one; a mock OpenAI-compatible
      server on localhost exercises compose end to end.
    - The ports and URL shapes below are each project's documented defaults.
      Nothing checks them at build time and nothing can: the CMS never contacts
      a provider until an administrator presses "Test connection".
    - No hosted keyless endpoint was reachable from the environment where this
      list was written, so its present availability is unconfirmed. Test it
      before depending on it.

  Model ids for a local server are whatever that administrator downloaded, so
  the values here are examples rather than promises. "Find models" reads the
  real list from the server's own `/models` endpoint, which is why it exists.

  Two deliberate omissions, both of which still bite:

    - Azure OpenAI authenticates with an `api-key` header and requires an
      `api-version` query parameter, so it cannot work through this client.
    - GitHub Models was shut down on 30 July 2026, despite still being
      recommended across many tutorials.
*/
export const AI_PROVIDERS: AiProviderPreset[] = [
  /* ------------------------------------------------ no key: your own machine */
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key and no account. The model id is whatever you pulled — `ollama list` shows them, or press "Find models" to read the list from the server.',
    privacy: 'Nothing leaves the machine. The strongest privacy option for unpublished drafts, at the cost of your own hardware.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key. Start the local server first (Developer tab → Start server). It accepts "local-model" for whichever model is currently loaded.',
    privacy: 'Nothing leaves the machine.',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'local-model',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key. Run its `server` binary; 8080 is the default port. The model is fixed by the -m flag the server started with.',
    privacy: 'Nothing leaves the machine.',
  },
  {
    id: 'jan',
    label: 'Jan',
    baseUrl: 'http://127.0.0.1:1337/v1',
    model: 'llama3.2',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key. Turn on the local API server in Jan’s settings; it prints the port it chose.',
    privacy: 'Nothing leaves the machine.',
  },
  {
    id: 'gpt4all',
    label: 'GPT4All',
    baseUrl: 'http://127.0.0.1:4891/v1',
    model: 'gpt4all',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key. Enable the local server under Settings → Application. 4891 is its default port.',
    privacy: 'Nothing leaves the machine.',
  },
  {
    id: 'koboldcpp',
    label: 'KoboldCpp',
    baseUrl: 'http://127.0.0.1:5001/v1',
    model: 'local-model',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key. Its OpenAI-compatible endpoint is on by default; the model field is largely ignored because one model is loaded at startup.',
    privacy: 'Nothing leaves the machine.',
  },
  {
    id: 'vllm',
    label: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'meta-llama/Llama-3.2-1B-Instruct',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key by default. The model id must match the --served-model-name exactly — "Find models" will read it back rather than leaving you to guess.',
    privacy: 'Nothing leaves the machine. Usually run on a GPU box you control.',
  },
  {
    id: 'localai',
    label: 'LocalAI',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'phi-2',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key. Shares port 8080 with llama.cpp, so only one of the two can run at a time unless you change a port.',
    privacy: 'Nothing leaves the machine. Self-hosted, open source.',
  },
  {
    id: 'textgenwebui',
    label: 'text-generation-webui',
    baseUrl: 'http://127.0.0.1:5000/v1',
    model: 'local-model',
    free: true,
    requiresKey: false,
    kind: 'local',
    keyHint: 'No key. Start it with the --api flag, otherwise the OpenAI-compatible endpoint is not served at all.',
    privacy: 'Nothing leaves the machine.',
  },

  /* --------------------------------------------------- no key: hosted, public */
  {
    id: 'pollinations',
    label: 'Pollinations',
    baseUrl: 'https://text.pollinations.ai/openai',
    model: 'openai',
    free: true,
    requiresKey: false,
    kind: 'hosted',
    keyHint: 'No key and no account — the only keyless option that works on shared hosting, where there is no local server to talk to. Press "Test connection" first: a free public endpoint can rate-limit or change without notice.',
    privacy: 'Public and unauthenticated. Assume every prompt is visible to a third party and may be logged or used for training — do not send unpublished work you need kept private.',
  },

  /* ------------------------------------------------------- free, needs a key */
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    free: true,
    requiresKey: true,
    kind: 'hosted',
    keyHint: 'console.groq.com/keys — email only, no card. About 30 requests a minute and 1,000 a day.',
    privacy: 'Groq states it does not retain inference data by default. The safest keyed free option for unpublished drafts.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemma-4-31b-it:free',
    free: true,
    requiresKey: true,
    kind: 'hosted',
    keyHint: 'openrouter.ai/keys — no card. Any model id ending in ":free" costs nothing; about 20 requests a minute and 50 a day.',
    privacy: 'The provider behind a free model may train on your prompts. OpenRouter has a privacy setting to refuse those — turn it on before drafting here.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    free: true,
    requiresKey: true,
    kind: 'hosted',
    keyHint: 'console.mistral.ai/api-keys — no card. Free mode has monthly usage shown on your Limits page.',
    privacy: 'Free-mode prompts may be used for training unless you opt out in the console. European provider, open-weight models.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    free: true,
    requiresKey: true,
    kind: 'hosted',
    keyHint: 'aistudio.google.com — no card for the free tier. Limits are per project and shown in AI Studio.',
    privacy: 'Free-tier content is used to improve Google products. Not recommended for unpublished work you need kept private.',
  },

  /* --------------------------------------------------------------------- paid */
  {
    id: 'openai',
    label: 'OpenAI (paid)',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    free: false,
    requiresKey: true,
    kind: 'hosted',
    keyHint: 'platform.openai.com/api-keys — requires billing. No free tier for chat models.',
    privacy: 'API traffic is not used for training by default. Check your organisation settings.',
  },
];

/** Presets that need nothing but a running server: no account, no key. */
export const KEYLESS_PROVIDERS = AI_PROVIDERS.filter((provider) => !provider.requiresKey);

/** Normalise a base URL so a saved value can be matched against a preset. */
function normaliseBaseUrl(value: string): string {
  return (value ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * The preset a saved base URL points at, if any.
 *
 * Used only to improve messages — "Groq needs a key" beats "not ready". An
 * unknown URL returns null and is treated as possibly keyless, which is right:
 * the administrator who typed it knows what they pointed at.
 */
export function providerForBaseUrl(baseUrl: string): AiProviderPreset | null {
  const target = normaliseBaseUrl(baseUrl);
  if (!target) return null;
  return AI_PROVIDERS.find((provider) => normaliseBaseUrl(provider.baseUrl) === target) ?? null;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export function loadAiConfig(settings: SettingsMap): AiConfig {
  const rawBase = (settings.ai_base_url ?? '').trim().replace(/\/+$/, '');
  const tokens = Number.parseInt(settings.ai_max_tokens ?? '', 10);

  return {
    enabled: truthy(settings.ai_enabled),
    baseUrl: rawBase || DEFAULT_BASE_URL,
    apiKey: (settings.ai_api_key ?? '').trim(),
    model: (settings.ai_model ?? '').trim(),
    imageModel: (settings.ai_image_model ?? '').trim(),
    maxTokens: Number.isFinite(tokens) && tokens > 0 ? Math.min(8000, tokens) : 1400,
    diagrams: truthy(settings.ai_diagrams),
    timeoutMs: 90_000,
  };
}

/**
 * Explain what is missing before an admin hits a confusing failure.
 * `ready` is what the editor panel and the sidebar badge both key off.
 */
export interface AiReadiness {
  ready: boolean;
  reason: string;
  /** True when no key is saved, so requests go out unauthenticated. */
  keyless: boolean;
  /** The preset this base URL matches, or null when the admin typed their own. */
  provider: AiProviderPreset | null;
}

/**
 * Explain what is missing before an admin hits a confusing failure.
 * `ready` is what the editor panel and the sidebar badge both key off.
 *
 * A missing key is NOT by itself a failure. Plenty of OpenAI-compatible servers
 * — every local runtime, and a few public ones — do not authenticate at all, so
 * demanding a key would break exactly the setups that need no account. The rule
 * is narrower: a missing key only blocks when the base URL matches a preset that
 * is known to require one, which turns "not ready" into "Groq needs an API key".
 * An unrecognised URL is assumed to be the administrator's own business.
 */
export function describeAiReadiness(config: AiConfig): AiReadiness {
  const provider = providerForBaseUrl(config.baseUrl);
  const keyless = !config.apiKey;
  const base = { keyless, provider };

  if (!config.enabled) return { ...base, ready: false, reason: 'The AI assistant is switched off.' };
  if (!config.baseUrl) return { ...base, ready: false, reason: 'No base URL saved yet.' };
  if (!config.model) return { ...base, ready: false, reason: 'No model name saved yet.' };

  if (keyless && provider?.requiresKey) {
    return {
      ...base,
      ready: false,
      reason: `${provider.label} needs an API key and none is saved. Add one, or pick a provider that works without a key.`,
    };
  }

  return {
    ...base,
    ready: true,
    reason: keyless ? `Ready — ${config.model}, no key needed` : `Ready — ${config.model}`,
  };
}

/** Last four characters only, so the settings form can confirm a key without echoing it. */
export function maskApiKey(key: string): string {
  const trimmed = (key ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  return `••••••••${trimmed.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* prompts                                                            */
/* ------------------------------------------------------------------ */

const DIAGRAM_SCHEMA = [
  '```diagram',
  '{',
  '  "title": "Short caption for the picture",',
  '  "nodes": [',
  '    { "id": "a", "label": "Node text", "kind": "start" },',
  '    { "id": "b", "label": "Node text", "kind": "process" },',
  '    { "id": "c", "label": "A yes/no question?", "kind": "decision" }',
  '  ],',
  '  "edges": [ { "from": "a", "to": "b", "label": "optional" } ]',
  '}',
  '```',
].join('\n');

function systemPrompt(config: AiConfig, siteName: string): string {
  const lines = [
    `You are a staff writer for ${siteName || 'an independent publication'}.`,
    'Return clean GitHub-flavoured Markdown only: no preamble, no closing remarks, no outer code fence.',
    'Use ## for sections, plain paragraphs, and - for lists. Do not invent facts, statistics, quotes or sources.',
    'Do not include a top-level # heading; the publication supplies the title separately.',
    'Write in a warm, concrete, magazine voice. Prefer short paragraphs.',
  ];

  if (config.diagrams) {
    lines.push(
      '',
      'Where a process, architecture or decision flow would genuinely help the reader, insert ONE diagram',
      'as a fenced block labelled diagram containing only JSON in exactly this shape:',
      '',
      DIAGRAM_SCHEMA,
      '',
      'Diagram rules: 3 to 9 nodes; every "id" unique and referenced consistently by "edges";',
      '"kind" must be one of start, end, process, decision, data, note;',
      'labels must be short (under 60 characters); the block must contain nothing but valid JSON.',
      'Only add a diagram when the subject is actually structural — never to decorate an opinion piece.',
    );
  }

  return lines.join('\n');
}

/*
  Shared by the two headline modes, so "Title" and "Title + Post + Feature
  Image" cannot drift apart in what they ask for.
*/
const TITLES_INSTRUCTION =
  'ONE fenced block labelled titles, holding exactly five alternative headlines for an article ' +
  'on that subject: one per line, plain text, no numbering, no quotation marks and no commentary ' +
  'inside the fence. Each headline must be genuinely different from the others, under 90 ' +
  'characters, and must not simply repeat the subject above.';

function userPrompt(request: ComposeRequest): string {
  const title = request.title.trim();
  const length = request.length ?? 'medium';
  const tone = (request.tone ?? '').trim();

  /*
    A ceiling and a floor per setting, rather than one wide range. Handed
    "350-500" a model lands anywhere in it, and Short used to be able to come
    back longer than Medium began — the three settings overlapped.
  */
  const words = length === 'short'
    ? 'about 500 words, and never more than 500'
    : length === 'long'
      ? '800 words or more'
      : 'between 600 and 650 words';

  const parts: string[] = [`Title: ${title}`];
  // A headline-only request has no body to size, so a word target is just noise.
  if (request.mode !== 'title') parts.push(`Target length: ${words}.`);
  if (tone) parts.push(`Tone: ${tone}`);

  if (request.mode === 'outline') {
    parts.push('Produce an outline only: five to eight ## headings, each followed by one sentence describing what that section will cover.');
  } else if (request.mode === 'continue') {
    parts.push('Continue the draft below. Do not repeat or restate it — pick up mid-flow and write the next sections to a natural conclusion.');
    parts.push('', '--- DRAFT SO FAR ---', (request.existing ?? '').trim().slice(0, 12_000), '--- END ---');
  } else if (request.mode === 'selection') {
    parts.push('Rewrite only the highlighted passage below. Keep its meaning and any facts intact, improve clarity and rhythm, and return just the replacement text with no surrounding commentary.');
    parts.push('', '--- SELECTION ---', (request.selection ?? '').trim().slice(0, 8_000), '--- END ---');
  } else if (request.mode === 'title') {
    /*
      Nothing but the fence. The model is still told not to write the article,
      because otherwise it volunteers a draft that composeDraft then has to
      throw away — and a preamble it adds anyway is discarded there too.
    */
    parts.push('Do not write the article body.', `Reply with ${TITLES_INSTRUCTION}`);
  } else if (request.mode === 'title_post_image') {
    /*
      The title above is a subject to write from, not a headline to keep, so the
      wording says "subject" and the headlines are asked for in a fence — the
      same trick the diagrams use, because a fence is far more reliable to split
      out of free-form Markdown than a delimiter the model might also use in the
      prose. The picture is drawn separately and never asked of a text model.
    */
    parts.push('Write the complete post body for that subject.');
    parts.push('', `Then end your reply with ${TITLES_INSTRUCTION}`);
  } else {
    parts.push('Write the complete post body for that title.');
  }

  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/* provider call                                                      */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Reject anything that is not an http(s) URL before it reaches `fetch`.
 *
 * The base URL is administrator-supplied, so this is not a privilege boundary —
 * an admin may already point the CMS at any host they like, and that is the
 * feature. It exists so a typo such as `file:///etc/passwd` produces a sentence
 * someone can act on instead of an opaque failure from the fetch layer.
 */
function assertHttpUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new AiError(
      'The AI base URL is not a usable URL.',
      'It needs a scheme and a host, such as http://127.0.0.1:11434/v1.',
      400,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiError(
      `The AI base URL uses an unsupported scheme (${parsed.protocol.replace(':', '')}).`,
      'Only http and https are supported.',
      400,
    );
  }
}

export async function callChatCompletion(config: AiConfig, messages: ChatMessage[]): Promise<string> {
  if (!config.model) {
    throw new AiError('No model name is saved for the AI assistant.', 'Add one under Studio → AI assistant.', 400);
  }
  assertHttpUrl(config.baseUrl);

  const url = `${config.baseUrl}/chat/completions`;

  /*
    No key means no Authorization header at all — not an empty `Bearer `.

    A present-but-empty credential is worse than an absent one: several local
    servers read it as a malformed key and answer 401, which would look exactly
    like a rejected key and send the administrator hunting for one that was
    never needed.
  */
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? `The model did not answer within ${Math.round(config.timeoutMs / 1000)} seconds.`
      : `Could not reach ${config.baseUrl}.`;
    throw new AiError(reason, 'Check the base URL, and that this server is allowed to make outbound requests.', 502);
  }

  const body = await response.text();

  if (!response.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      detail = parsed?.error?.message ?? '';
    } catch {
      detail = body.slice(0, 200);
    }
    const status = response.status === 401 || response.status === 403
      ? config.apiKey
        ? 'The provider rejected that API key.'
        : 'The provider requires an API key and none is saved.'
      : response.status === 404
        ? `The provider has no such model or endpoint (${config.model}).`
        : response.status === 429
          ? 'The provider rate-limited this request.'
          : `The provider returned ${response.status}.`;
    const hint = !config.apiKey && (response.status === 401 || response.status === 403)
      ? 'Add a key under Studio → AI assistant, or pick a provider that works without one.'
      : '';
    throw new AiError(detail ? `${status} ${detail}`.trim() : status, hint, response.status >= 500 ? 502 : 400);
  }

  let content = '';
  try {
    const parsed = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
    };
    content = parsed?.choices?.[0]?.message?.content ?? parsed?.choices?.[0]?.text ?? '';
  } catch {
    throw new AiError('The provider sent a response that was not valid JSON.', '', 502);
  }

  const text = String(content).trim();
  if (!text) throw new AiError('The model returned an empty response.', 'Try again, or ask for a shorter draft.', 502);
  return text;
}

/* ------------------------------------------------------------------ */
/* diagrams                                                           */
/* ------------------------------------------------------------------ */

const DIAGRAM_FENCE = /```[ \t]*(?:diagram|drawio)[ \t]*\r?\n([\s\S]*?)```/gi;
const DIAGRAM_DIR = 'diagrams';

/**
 * Persist one rendered diagram into the media library.
 *
 * SVG is intentionally absent from `config.uploads.allowedMime`: an uploaded SVG
 * is a stored-XSS vector because navigating to it renders it as a document.
 * These files never come from an upload — they are drawn by `renderDiagram` from
 * a validated spec, so every label is XML-escaped and no element or attribute
 * originates from the model. They are still written to their own subfolder so a
 * CSP header can be pinned to that path (see app.ts).
 */
async function persistDiagram(
  spec: DiagramSpec,
  options: { title: string; uploadedBy: number | null },
): Promise<{ url: string; alt: string; width: number; height: number }> {
  const { svg, width, height } = renderDiagram(spec);
  const dir = path.join(UPLOADS_DIR, DIAGRAM_DIR);
  await fs.mkdir(dir, { recursive: true });

  const base = slugify(spec.title || options.title || 'diagram').slice(0, 48) || 'diagram';
  const filename = `${base}-${randomBytes(4).toString('hex')}.svg`;
  await fs.writeFile(path.join(dir, filename), svg, 'utf8');

  const alt = spec.title || `${options.title} diagram`;
  const size = Buffer.byteLength(svg, 'utf8');

  await createMedia({
    filename,
    path: `/uploads/${DIAGRAM_DIR}/${filename}`,
    original_name: filename,
    mime_type: 'image/svg+xml',
    size,
    width,
    height,
    alt_text: alt,
    caption: 'Generated diagram',
    title: alt,
    uploaded_by: options.uploadedBy,
  });

  return { url: `/uploads/${DIAGRAM_DIR}/${filename}`, alt, width, height };
}

/**
 * Replace every ```diagram fence with a Markdown image.
 *
 * A spec that fails validation is dropped rather than thrown: losing one picture
 * must not discard an otherwise good draft.
 */
export async function inlineDiagrams(
  markdown: string,
  options: { title: string; uploadedBy: number | null },
): Promise<{ markdown: string; created: number; skipped: number }> {
  const blocks: Array<{ raw: string; body: string }> = [];
  for (const match of markdown.matchAll(DIAGRAM_FENCE)) {
    blocks.push({ raw: match[0], body: match[1] });
  }
  if (blocks.length === 0) return { markdown, created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;
  let output = markdown;

  for (const block of blocks) {
    const spec = parseDiagramSpec(block.body);
    if (!spec) {
      skipped += 1;
      // A replacer function, not a string: `String.replace` interprets `$&`,
      // `$'` and friends inside a string replacement, so a label containing a
      // dollar sign would otherwise splice stray text into the draft.
      output = output.replace(block.raw, () => '');
      continue;
    }
    try {
      const diagram = await persistDiagram(spec, options);
      created += 1;
      const markdownImage = `![${diagram.alt}](${diagram.url})`;
      output = output.replace(block.raw, () => markdownImage);
    } catch {
      skipped += 1;
      output = output.replace(block.raw, () => '');
    }
  }

  return { markdown: output.replace(/\n{3,}/g, '\n\n').trim(), created, skipped };
}

/* ------------------------------------------------------------------ */
/* title suggestions                                                  */
/* ------------------------------------------------------------------ */

/** How many headlines are offered. Five is asked for; anything from one up is accepted. */
export const MAX_TITLE_SUGGESTIONS = 5;

/*
  Singular and plural, `title` or `headline`: models rename a fence they were
  not told to keep verbatim often enough that accepting four spellings costs
  nothing and saves a surprising number of drafts.
*/
const TITLES_FENCE = /```[ \t]*(?:titles?|headlines?)[ \t]*\r?\n([\s\S]*?)```/gi;

/**
 * Pull a headline fence out of a draft.
 *
 * The fence is stripped in EVERY mode, not just `article`: a block of raw
 * headlines left behind would land in the editor as literal text. Which modes
 * then get the suggestions handed back is the caller's decision.
 *
 * Never throws. A model that ignores the instruction yields no suggestions and
 * the caller says so, rather than throwing away a good draft.
 */
export function extractTitleSuggestions(markdown: string): { markdown: string; suggestions: string[] } {
  const collected: string[] = [];

  const withoutFence = markdown.replace(TITLES_FENCE, (_block, body: string) => {
    for (const line of body.split(/\r?\n/)) {
      const cleaned = line
        /* "1. ", "- ", "• ", "(2)", "Title 3:" — models add these even when told not to. */
        .replace(/^\s*(?:[-*+•·]|\(\d+\)|\d+[.)]|(?:title|headline|option)\s*\d*\s*[:\-–—.)])\s*/i, '')
        /* wrapping quotes, including the typographic ones models favour */
        .replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '')
        .trim();
      /* A whole paragraph is not a headline; drop it rather than show it. */
      if (cleaned && cleaned.length <= 140) collected.push(cleaned);
    }
    return '';
  });

  /* Case- and punctuation-insensitive de-dupe, keeping the first spelling seen. */
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const candidate of collected) {
    const key = candidate.toLowerCase().replace(/[^a-z0-9\u0080-\uffff]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(candidate);
    if (suggestions.length >= MAX_TITLE_SUGGESTIONS) break;
  }

  return { markdown: withoutFence.replace(/\n{3,}/g, '\n\n').trim(), suggestions };
}

/* ------------------------------------------------------------------ */
/* feature images                                                     */
/* ------------------------------------------------------------------ */

/** Where generated feature images live, under the uploads root. */
const IMAGE_DIR = 'ai-images';

/** Refuse anything larger, so a runaway response cannot fill the disk. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface GeneratedImage {
  /** Media library row, ready to go straight into `featured_image_id`. */
  mediaId: number;
  url: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  /**
   * Which backend produced it — it affects privacy, so it is not hidden.
   * `provider` is the administrator's own configured server; `fallback` is the
   * keyless service at IMAGE_FALLBACK_URL, which is public and unauthenticated.
   */
  source: 'provider' | 'fallback';
}

/**
 * Identify an image from its bytes, never from a Content-Type header.
 *
 * The fallback is an unauthenticated public endpoint and a provider that errors
 * may still answer 200 with an HTML or JSON body. Trusting a header would write
 * that to /uploads and register it in the media library as an image.
 *
 * SVG is deliberately absent. It is the one image format that can carry script,
 * and the upload path refuses it for the same reason.
 */
function sniffImage(bytes: Buffer): { ext: string; mime: string } | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  const head = bytes.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return { ext: 'gif', mime: 'image/gif' };
  return null;
}

/** Short, safe wording for why one backend did not work. */
function describeFailure(error: unknown): string {
  if (error instanceof AiError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 160) || 'an unexpected error';
}

async function downloadImage(url: string, timeoutMs: number): Promise<Buffer> {
  assertHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`answered ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('returned an empty image');
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('was larger than the 8 MB limit');
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

/** `POST {baseUrl}/images/generations` — the OpenAI-compatible image shape. */
async function imageFromProvider(config: AiConfig, prompt: string): Promise<Buffer> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/images/generations`;
  assertHttpUrl(endpoint);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // A blank key means send no Authorization header at all, exactly as chat does.
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ model: config.imageModel, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
    });
    if (!response.ok) throw new Error(`answered ${response.status}`);

    const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = Array.isArray(payload.data) ? payload.data[0] : undefined;
    if (!first) throw new Error('returned no image data');
    if (typeof first.b64_json === 'string' && first.b64_json) {
      const bytes = Buffer.from(first.b64_json, 'base64');
      if (!bytes.length) throw new Error('returned an empty image');
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('was larger than the 8 MB limit');
      return bytes;
    }
    // Some servers answer with a URL instead, whichever response_format was asked for.
    if (typeof first.url === 'string' && first.url) return downloadImage(first.url, config.timeoutMs);
    throw new Error('returned neither b64_json nor a url');
  } finally {
    clearTimeout(timer);
  }
}

async function imageFromFallback(prompt: string, timeoutMs: number): Promise<Buffer> {
  /*
    The keyless default takes the prompt in the path and the size in the query.
    1200x675 is the 16:9 the theme's cards and hero expect. The seed varies per
    attempt, so retrying cannot return the identical picture every time.
  */
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `${IMAGE_FALLBACK_URL}${encodeURIComponent(prompt)}?width=1200&height=675&nologo=true&seed=${seed}`;
  return downloadImage(url, timeoutMs);
}

/**
 * Turn a subject into a picture prompt.
 *
 * Explicitly asks for no text: image models reliably render garbled words into
 * covers, and a cover with a fake masthead looks broken rather than designed.
 */
export function featureImagePrompt(subject: string, tone?: string): string {
  const parts = [
    `Editorial magazine cover photograph for an article about: ${subject.trim()}.`,
    'Evocative and concrete, natural light, shallow depth of field, a single clear subject.',
    'No text, no words, no letters, no captions, no watermark, no logo.',
  ];
  const mood = (tone ?? '').trim();
  if (mood) parts.push(`Mood: ${mood}.`);
  return parts.join(' ');
}

/**
 * Generate one feature image, save it to the media library, and return its row.
 *
 * Tries the configured provider first and falls back to the keyless service.
 * The provider is only tried when an image model is actually named: a chat
 * model id cannot draw, so without one the round trip is a guaranteed failure
 * and the fallback is used directly.
 */
export async function generateFeatureImage(
  config: AiConfig,
  options: { subject: string; tone?: string; alt?: string; uploadedBy: number | null },
): Promise<GeneratedImage> {
  const subject = (options.subject ?? '').trim();
  if (subject.length < 3) {
    throw new AiError('Describe the article in a few words so there is something to draw.', '', 400);
  }

  const prompt = featureImagePrompt(subject, options.tone);
  const tried: string[] = [];
  let bytes: Buffer | null = null;
  let source: GeneratedImage['source'] = 'fallback';

  if (config.imageModel) {
    try {
      bytes = await imageFromProvider(config, prompt);
      source = 'provider';
    } catch (error) {
      tried.push(`your image model (${describeFailure(error)})`);
    }
  }

  if (!bytes) {
    try {
      bytes = await imageFromFallback(prompt, config.timeoutMs);
      source = 'fallback';
    } catch (error) {
      tried.push(`the keyless image service (${describeFailure(error)})`);
      throw new AiError(
        'No feature image could be generated.',
        `Tried ${tried.join(', then ')}. Check the image model under Studio → AI assistant, or that this server can make outbound requests.`,
        502,
      );
    }
  }

  const kind = sniffImage(bytes);
  if (!kind) {
    throw new AiError(
      'The image service did not return a usable picture.',
      'It answered with something that is not a PNG, JPEG, WebP or GIF. Check the image model name under Studio → AI assistant.',
      502,
    );
  }

  /* Dimensions are cosmetic, so a failure to read them must not lose the image. */
  let width = 0;
  let height = 0;
  try {
    const size = imageSize(bytes);
    width = size.width ?? 0;
    height = size.height ?? 0;
  } catch {
    /* leave at 0 */
  }

  const dir = path.join(UPLOADS_DIR, IMAGE_DIR);
  await fs.mkdir(dir, { recursive: true });
  const base = slugify(subject).slice(0, 48) || 'feature';
  const filename = `${base}-${randomBytes(4).toString('hex')}.${kind.ext}`;
  await fs.writeFile(path.join(dir, filename), bytes);

  const url = `/uploads/${IMAGE_DIR}/${filename}`;
  const alt = (options.alt ?? '').trim() || subject;

  const mediaId = await createMedia({
    filename,
    path: url,
    original_name: filename,
    mime_type: kind.mime,
    size: bytes.byteLength,
    width,
    height,
    alt_text: alt,
    caption: 'Generated feature image',
    title: alt,
    uploaded_by: options.uploadedBy,
  });

  return { mediaId, url, alt, width, height, bytes: bytes.byteLength, source };
}

/* ------------------------------------------------------------------ */
/* orchestration                                                      */
/* ------------------------------------------------------------------ */

/** Turn a title (plus optional context) into Markdown, diagrams inlined. */
export async function composeDraft(
  config: AiConfig,
  request: ComposeRequest,
  options: { uploadedBy: number | null },
): Promise<ComposeResult> {
  const readiness = describeAiReadiness(config);
  if (!readiness.ready) throw new AiError(readiness.reason, 'Configure the assistant under Studio → AI assistant.', 400);

  const title = (request.title ?? '').trim();
  const mode = request.mode;
  const wantsHeadlines = mode === 'title' || mode === 'title_post_image';
  const wantsImage = mode === 'image' || mode === 'title_post_image';
  if (title.length < 3) {
    /*
      `title`, `image` and the combined mode are exactly what someone reaches
      for when they have nothing yet, so demanding "a title" from them reads as
      though the feature does not work. They still need a subject to work from —
      it just has to say so.
    */
    throw new AiError(
      wantsHeadlines || wantsImage
        ? 'Describe the article in a few words — the assistant will work from that.'
        : 'Give the assistant a title of at least three characters.',
      '',
      400,
    );
  }
  if (request.mode === 'continue' && !(request.existing ?? '').trim()) {
    throw new AiError('There is nothing to continue from yet.', 'Write an opening first, or choose "Post".', 400);
  }
  if (request.mode === 'selection' && !(request.selection ?? '').trim()) {
    throw new AiError('Select some text in the editor first.', '', 400);
  }

  /*
    `image` makes no chat call at all. The picture is drawn from the subject
    directly, so paying a language model to paraphrase it first would only add
    latency and a second thing that can fail.
  */
  if (mode === 'image') {
    const image = await generateFeatureImage(config, {
      subject: title,
      tone: request.tone,
      uploadedBy: options.uploadedBy,
    });
    return {
      markdown: '', diagramsCreated: 0, diagramsSkipped: 0, model: config.model,
      titleSuggestions: [], image, imageNote: '',
    };
  }

  const raw = await callChatCompletion(config, [
    { role: 'system', content: systemPrompt(config, request.siteName ?? '') },
    { role: 'user', content: userPrompt(request) },
  ]);

  // A model that wraps its whole answer in a fence would land in the textarea
  // as literal backticks, so unwrap exactly one outer fence if present.
  const unwrapped = raw.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n```\s*$/, '$1').trim();

  /*
    Split the headline fence out before the diagrams are touched, so neither can
    end up nested inside the other. Stripping happens in every mode; only the two
    headline modes hand the suggestions back, which leaves the others behaving
    exactly as they did before.
  */
  const { markdown: body, suggestions } = extractTitleSuggestions(unwrapped);
  const titleSuggestions = wantsHeadlines ? suggestions : [];

  /*
    `title` must not touch the body. The model is told to reply with only the
    fence, but one that adds a preamble anyway would otherwise overwrite the
    editor with its commentary, so whatever survives the fence is dropped.
  */
  let markdown = '';
  let diagramsCreated = 0;
  let diagramsSkipped = 0;
  if (mode !== 'title') {
    if (!config.diagrams) {
      markdown = body.replace(DIAGRAM_FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
    } else {
      const inlined = await inlineDiagrams(body, { title, uploadedBy: options.uploadedBy });
      markdown = inlined.markdown;
      diagramsCreated = inlined.created;
      diagramsSkipped = inlined.skipped;
    }
  }

  /*
    In the combined mode a missing picture is not a lost article: the draft and
    the headlines are already worth keeping, so the failure rides along beside
    them instead of throwing the whole request away. `image` mode has nothing
    else to return, so there the same failure is fatal and was thrown above.
  */
  let image: GeneratedImage | null = null;
  let imageNote = '';
  if (mode === 'title_post_image') {
    try {
      image = await generateFeatureImage(config, {
        subject: title,
        tone: request.tone,
        uploadedBy: options.uploadedBy,
      });
    } catch (error) {
      imageNote = error instanceof AiError ? error.message : 'The feature image could not be generated.';
    }
  }

  return { markdown, diagramsCreated, diagramsSkipped, model: config.model, titleSuggestions, image, imageNote };
}

/* ------------------------------------------------------------------ */
/* connection probe                                                    */
/* ------------------------------------------------------------------ */

export interface ProbeResult {
  ok: boolean;
  message: string;
  hint: string;
  model: string;
  baseUrl: string;
  latencyMs: number;
  /** True when the probe went out with no credentials at all. */
  keyless: boolean;
}

/**
 * Make one tiny real call so an administrator can confirm their base URL, key
 * and model actually work before they rely on them.
 *
 * Deliberately bypasses `composeDraft`: no diagrams are drawn, nothing is
 * written to the media library, and `maxTokens` is forced down to 8 so a test
 * costs a fraction of a cent even on a paid provider.
 *
 * Also deliberately ignores `config.enabled`. Testing before switching the
 * assistant on is the normal order of operations, and requiring an admin to
 * enable a feature in order to find out whether it works is backwards.
 *
 * A failed probe is returned as `{ ok: false }` rather than thrown: the request
 * to *test* succeeded, and it successfully reported that the provider does not
 * work. Reserving HTTP error codes for "the test itself broke" keeps the
 * client-side handling to one branch.
 */
export async function probeProvider(config: AiConfig): Promise<ProbeResult> {
  const started = Date.now();
  const base = { model: config.model, baseUrl: config.baseUrl, keyless: !config.apiKey };

  /*
    No key check here, deliberately. Probing is the only way an administrator
    can find out whether a keyless server is actually listening, so refusing to
    probe for want of a key would make the keyless providers untestable — the
    one thing they are supposed to be is easy to try. If the endpoint does want
    credentials it answers 401 and `callChatCompletion` says so in words.
  */
  if (!config.model) {
    return {
      ...base, ok: false, latencyMs: 0,
      message: 'No model name is saved yet.',
      hint: 'Pick a provider preset to fill in a current model id, or press "Find models" to read the ones this server offers.',
    };
  }

  try {
    const reply = await callChatCompletion(
      { ...config, maxTokens: 8 },
      [{ role: 'user', content: 'Reply with the single word: ready' }],
    );
    const trimmed = reply.trim().slice(0, 60);
    const connected = base.keyless ? 'Connected with no API key' : 'Connected';
    return {
      ...base, ok: true, latencyMs: Date.now() - started,
      message: trimmed
        ? `${connected} — the model replied “${trimmed}”.`
        : `${connected} — the model replied.`,
      hint: '',
    };
  } catch (error) {
    const message = error instanceof AiError ? error.message : 'The connection test failed unexpectedly.';
    const hint = error instanceof AiError ? error.hint : 'Check the base URL and that this server can make outbound requests.';
    return { ...base, ok: false, latencyMs: Date.now() - started, message, hint };
  }
}

/* ------------------------------------------------------------------ */
/* model discovery                                                    */
/* ------------------------------------------------------------------ */

export interface ModelListResult {
  ok: boolean;
  models: string[];
  baseUrl: string;
  message: string;
  hint: string;
  keyless: boolean;
}

/** Shapes seen in the wild for `GET {baseUrl}/models`. */
type RawModelList =
  | { data?: Array<{ id?: string } | string> }
  | { models?: Array<{ id?: string } | string> }
  | Array<{ id?: string } | string>;

function pluckModelIds(parsed: unknown): string[] {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { data?: unknown })?.data)
      ? ((parsed as { data: unknown[] }).data)
      : Array.isArray((parsed as { models?: unknown })?.models)
        ? ((parsed as { models: unknown[] }).models)
        : null;
  if (!list) return [];

  const ids: string[] = [];
  for (const entry of list) {
    const id = typeof entry === 'string' ? entry : (entry as { id?: unknown })?.id;
    if (typeof id === 'string' && id.trim()) ids.push(id.trim());
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 100);
}

/**
 * Ask a provider which models it is actually serving.
 *
 * This exists because a keyless local server has no documentation page to look
 * model ids up on, and a wrong id produces a 404 that reads like a broken
 * installation. `/models` is part of the same OpenAI-compatible contract the
 * chat endpoint is, so a server that can answer one can almost always answer
 * the other — and it needs no key wherever the chat call needs none.
 *
 * A short timeout on purpose: this is a button press, and a local server that
 * is not running should say so quickly rather than hanging for 90 seconds.
 */
export async function listProviderModels(config: AiConfig): Promise<ModelListResult> {
  const base = { baseUrl: config.baseUrl, keyless: !config.apiKey };

  try {
    assertHttpUrl(config.baseUrl);
  } catch (error) {
    const message = error instanceof AiError ? error.message : 'The base URL is not usable.';
    const hint = error instanceof AiError ? error.hint : '';
    return { ...base, ok: false, models: [], message, hint };
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? 'The server did not answer within 15 seconds.'
      : `Could not reach ${config.baseUrl}.`;
    return {
      ...base, ok: false, models: [],
      message: reason,
      hint: 'A local server has to be running, and reachable from wherever this CMS runs — on shared hosting it will not be.',
    };
  }

  const body = await response.text();

  if (!response.ok) {
    const message = response.status === 404
      ? 'That server has no /models endpoint, so its model ids cannot be listed.'
      : response.status === 401 || response.status === 403
        ? config.apiKey
          ? 'The provider rejected that API key.'
          : 'The provider requires an API key and none is saved.'
        : `The provider returned ${response.status}.`;
    return {
      ...base, ok: false, models: [], message,
      hint: 'Type the model id by hand — discovery is a convenience, not a requirement.',
    };
  }

  let models: string[] = [];
  try {
    models = pluckModelIds(JSON.parse(body) as RawModelList);
  } catch {
    return {
      ...base, ok: false, models: [],
      message: 'The server answered, but not with a model list.',
      hint: 'Type the model id by hand.',
    };
  }

  if (models.length === 0) {
    return {
      ...base, ok: false, models: [],
      message: 'The server answered with an empty model list.',
      hint: 'Download or load a model first, then try again.',
    };
  }

  return {
    ...base, ok: true, models,
    message: `${models.length} model${models.length === 1 ? '' : 's'} available.`,
    hint: '',
  };
}
