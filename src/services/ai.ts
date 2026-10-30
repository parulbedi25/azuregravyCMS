import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { UPLOADS_DIR } from '../config.js';
import { createMedia } from './media.js';
import { parseDiagramSpec, renderDiagram, type DiagramSpec } from './diagram.js';
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

export type ComposeMode = 'full' | 'continue' | 'selection' | 'outline';

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
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
}

/** An error with a message safe to show an administrator. */
export class AiError extends Error {
  constructor(message: string, readonly hint = '', readonly status = 502) {
    super(message);
    this.name = 'AiError';
  }
}

export const AI_MODES: Array<{ id: ComposeMode; label: string; help: string }> = [
  { id: 'full', label: 'Write the whole post', help: 'Replaces the body with a complete draft built from your title.' },
  { id: 'outline', label: 'Outline only', help: 'Headings and one-line beats, so you can fill in the detail yourself.' },
  { id: 'continue', label: 'Continue from here', help: 'Keeps what you have written and carries on from the end of it.' },
  { id: 'selection', label: 'Rewrite the selection', help: 'Expands or improves only the text you have highlighted.' },
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

function userPrompt(request: ComposeRequest): string {
  const title = request.title.trim();
  const length = request.length ?? 'medium';
  const words = length === 'short' ? '350-500' : length === 'long' ? '1100-1500' : '650-900';
  const tone = (request.tone ?? '').trim();

  const parts: string[] = [`Title: ${title}`, `Target length: ${words} words.`];
  if (tone) parts.push(`Tone: ${tone}`);

  if (request.mode === 'outline') {
    parts.push('Produce an outline only: five to eight ## headings, each followed by one sentence describing what that section will cover.');
  } else if (request.mode === 'continue') {
    parts.push('Continue the draft below. Do not repeat or restate it — pick up mid-flow and write the next sections to a natural conclusion.');
    parts.push('', '--- DRAFT SO FAR ---', (request.existing ?? '').trim().slice(0, 12_000), '--- END ---');
  } else if (request.mode === 'selection') {
    parts.push('Rewrite only the highlighted passage below. Keep its meaning and any facts intact, improve clarity and rhythm, and return just the replacement text with no surrounding commentary.');
    parts.push('', '--- SELECTION ---', (request.selection ?? '').trim().slice(0, 8_000), '--- END ---');
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
  if (title.length < 3) {
    throw new AiError('Give the assistant a title of at least three characters.', '', 400);
  }
  if (request.mode === 'continue' && !(request.existing ?? '').trim()) {
    throw new AiError('There is nothing to continue from yet.', 'Write an opening first, or choose "Write the whole post".', 400);
  }
  if (request.mode === 'selection' && !(request.selection ?? '').trim()) {
    throw new AiError('Select some text in the editor first.', '', 400);
  }

  const raw = await callChatCompletion(config, [
    { role: 'system', content: systemPrompt(config, request.siteName ?? '') },
    { role: 'user', content: userPrompt(request) },
  ]);

  // A model that wraps its whole answer in a fence would land in the textarea
  // as literal backticks, so unwrap exactly one outer fence if present.
  const unwrapped = raw.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n```\s*$/, '$1').trim();

  if (!config.diagrams) {
    const stripped = unwrapped.replace(DIAGRAM_FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
    return { markdown: stripped, diagramsCreated: 0, diagramsSkipped: 0, model: config.model };
  }

  const inlined = await inlineDiagrams(unwrapped, { title, uploadedBy: options.uploadedBy });
  return {
    markdown: inlined.markdown,
    diagramsCreated: inlined.created,
    diagramsSkipped: inlined.skipped,
    model: config.model,
  };
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
