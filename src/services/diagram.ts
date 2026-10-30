/**
 * Deterministic draw.io-style diagram renderer.
 *
 * Why the model never emits SVG or markup directly:
 *
 *   1. `renderMarkdown` pipes post content through `sanitize-html`, whose
 *      `allowedTags` list deliberately excludes `svg`. Any inline SVG an LLM
 *      produced would be stripped before it reached the page, so the diagram
 *      would silently vanish.
 *   2. An SVG file is served as a document: one `<script>` or `onload` handler
 *      inside it is stored XSS. Letting a model — or the diagram labels it
 *      invents — write raw markup would hand an attacker that vector.
 *
 * So the model returns a small, strictly validated JSON *spec*, and this module
 * draws the picture. Every label passes through `escapeXml`, every attribute is
 * generated from a fixed template, and nothing from the model ever reaches the
 * output as markup. The result is both safer and visually consistent: the
 * palette, corner radii, orthogonal routing and Helvetica labels below are the
 * draw.io defaults, so the images read as native draw.io diagrams.
 */

export type NodeKind = 'start' | 'end' | 'process' | 'decision' | 'data' | 'note';

export interface DiagramNode {
  id: string;
  label: string;
  kind: NodeKind;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

export interface DiagramSpec {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface RenderedDiagram {
  svg: string;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* draw.io default palette                                            */
/* ------------------------------------------------------------------ */

const PALETTE: Record<NodeKind, { fill: string; stroke: string; ink: string }> = {
  start: { fill: '#d5e8d4', stroke: '#82b366', ink: '#1f3d1f' },
  end: { fill: '#f8cecc', stroke: '#b85450', ink: '#4d1f1d' },
  process: { fill: '#dae8fc', stroke: '#6c8ebf', ink: '#1b2f4d' },
  decision: { fill: '#ffe6cc', stroke: '#d79b00', ink: '#4d3410' },
  data: { fill: '#e1d5e7', stroke: '#9673a6', ink: '#3b2a45' },
  note: { fill: '#fff2cc', stroke: '#d6b656', ink: '#4d431a' },
};

const KINDS = Object.keys(PALETTE) as NodeKind[];

const FONT = "Helvetica, Arial, sans-serif";
const FONT_SIZE = 12;
/** Approximate advance width of a character in Helvetica at 12px. */
const CHAR_W = 6.4;
const LINE_H = 15;

const NODE_MAX_W = 176;
const NODE_MIN_W = 112;
const NODE_PAD_X = 14;
const NODE_PAD_Y = 12;
const RANK_GAP = 84;
const SIBLING_GAP = 30;
const CANVAS_PAD = 30;
const TITLE_H = 30;

const MAX_NODES = 24;
const MAX_EDGES = 40;
const MAX_LABEL = 90;

export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------------ */
/* spec validation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Validate and normalise a spec from the model.
 *
 * Returns null rather than throwing: a malformed diagram must degrade to "no
 * diagram", never to a 500 in the middle of composing a post.
 */
export function parseDiagramSpec(raw: unknown): DiagramSpec | null {
  let input: unknown = raw;

  if (typeof input === 'string') {
    const text = stripCodeFence(input).trim();
    if (!text) return null;
    try {
      input = JSON.parse(text);
    } catch {
      return null;
    }
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;

  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (rawNodes.length < 2) return null; // a diagram of one box is not a diagram

  const nodes: DiagramNode[] = [];
  const seen = new Set<string>();

  for (const entry of rawNodes.slice(0, MAX_NODES)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;

    const label = clampLabel(typeof item.label === 'string' ? item.label : typeof item.text === 'string' ? item.text : '');
    if (!label) continue;

    let id = typeof item.id === 'string' ? item.id.trim() : typeof item.id === 'number' ? String(item.id) : '';
    if (!id) id = `n${nodes.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const requested = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
    const kind: NodeKind = KINDS.includes(requested as NodeKind)
      ? (requested as NodeKind)
      : label.endsWith('?')
        ? 'decision'
        : nodes.length === 0
          ? 'start'
          : 'process';

    nodes.push({ id, label, kind });
  }

  if (nodes.length < 2) return null;

  const edges: DiagramEdge[] = [];
  const rawEdges = Array.isArray(record.edges) ? record.edges : Array.isArray(record.links) ? record.links : [];

  for (const entry of rawEdges.slice(0, MAX_EDGES)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;

    const from = String(item.from ?? item.source ?? '').trim();
    const to = String(item.to ?? item.target ?? '').trim();
    if (!seen.has(from) || !seen.has(to) || from === to) continue;

    const dupe = edges.some((edge) => edge.from === from && edge.to === to);
    if (dupe) continue;

    edges.push({ from, to, label: clampLabel(typeof item.label === 'string' ? item.label : '') });
  }

  const title = clampLabel(typeof record.title === 'string' ? record.title : '', 70);
  return { title, nodes, edges };
}

function clampLabel(value: string, max = MAX_LABEL): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Accept ```diagram … ``` or a bare ``` … ``` fence around the JSON. */
function stripCodeFence(value: string): string {
  const fenced = value.match(/^\s*```[a-zA-Z0-9_-]*\s*([\s\S]*?)```\s*$/);
  return fenced ? fenced[1] : value;
}

/* ------------------------------------------------------------------ */
/* layout                                                             */
/* ------------------------------------------------------------------ */

interface Box {
  node: DiagramNode;
  rank: number;
  lines: string[];
  w: number;
  h: number;
  x: number;
  y: number;
}

function wrap(label: string): string[] {
  const maxChars = Math.max(10, Math.floor((NODE_MAX_W - NODE_PAD_X * 2) / CHAR_W));
  const words = label.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // A single word longer than the box gets hard-split rather than overflowing.
    if (word.length > maxChars) {
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      current = '';
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [label.slice(0, maxChars)];
}

/**
 * Rank nodes by longest path from a root, so edges generally point right.
 * Cycles are broken by the iteration cap — a back edge just routes around.
 */
function assignRanks(nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const node of nodes) incoming.set(node.id, 0);
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);

  const rank = new Map<string, number>();
  for (const node of nodes) rank.set(node.id, incoming.get(node.id) === 0 ? 0 : 0);

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  // Bellman-Ford style relaxation; the cap makes cycles terminate.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = (rank.get(edge.from) ?? 0) + 1;
      if (next > (rank.get(edge.to) ?? 0) && next < nodes.length) {
        rank.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Anything still unranked (isolated cycle) is parked in rank 0.
  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0);
  return rank;
}

function layout(spec: DiagramSpec): { boxes: Box[]; width: number; height: number } {
  const rankOf = assignRanks(spec.nodes, spec.edges);

  const boxes: Box[] = spec.nodes.map((node) => {
    const lines = wrap(node.label);
    const widest = Math.max(...lines.map((line) => line.length * CHAR_W));
    /*
      Rounded to whole pixels. CHAR_W is fractional, so without this the canvas
      comes out at e.g. 846.4px — and `media.width` is an INT UNSIGNED column,
      so the size stored in the library would not match the SVG. Fractional
      coordinates are left alone inside paths, where they are valid and render
      more smoothly.
    */
    const w = Math.round(node.kind === 'decision'
      ? Math.min(NODE_MAX_W + 34, Math.max(NODE_MIN_W + 24, widest + NODE_PAD_X * 2 + 30))
      : Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, widest + NODE_PAD_X * 2)));
    const h = Math.round(Math.max(46, lines.length * LINE_H + NODE_PAD_Y * 2));
    return { node, rank: rankOf.get(node.id) ?? 0, lines, w, h, x: 0, y: 0 };
  });

  const byRank = new Map<number, Box[]>();
  for (const box of boxes) {
    const list = byRank.get(box.rank) ?? [];
    list.push(box);
    byRank.set(box.rank, list);
  }

  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const titleOffset = spec.title ? TITLE_H : 0;

  let x = CANVAS_PAD;
  let tallestColumn = 0;

  for (const rank of ranks) {
    const column = byRank.get(rank)!;
    const colWidth = Math.max(...column.map((box) => box.w));
    const colHeight = column.reduce((sum, box) => sum + box.h, 0) + SIBLING_GAP * (column.length - 1);
    tallestColumn = Math.max(tallestColumn, colHeight);

    let y = CANVAS_PAD + titleOffset;
    for (const box of column) {
      box.x = x + Math.round((colWidth - box.w) / 2);
      box.y = y;
      y += box.h + SIBLING_GAP;
    }
    x += colWidth + RANK_GAP;
  }

  // Vertically centre every column against the tallest one.
  for (const rank of ranks) {
    const column = byRank.get(rank)!;
    const colHeight = column.reduce((sum, box) => sum + box.h, 0) + SIBLING_GAP * (column.length - 1);
    const shift = Math.round((tallestColumn - colHeight) / 2);
    if (shift > 0) for (const box of column) box.y += shift;
  }

  const width = Math.max(320, Math.ceil(x - RANK_GAP + CANVAS_PAD));
  const height = Math.max(200, Math.ceil(CANVAS_PAD + titleOffset + tallestColumn + CANVAS_PAD));

  return { boxes, width, height };
}

/* ------------------------------------------------------------------ */
/* rendering                                                          */
/* ------------------------------------------------------------------ */

function nodeShape(box: Box): string {
  const { fill, stroke, ink } = PALETTE[box.node.kind];
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="1.6"`;

  let shape: string;
  if (box.node.kind === 'decision') {
    shape = `<polygon points="${cx},${box.y} ${box.x + box.w},${cy} ${cx},${box.y + box.h} ${box.x},${cy}" ${common}/>`;
  } else if (box.node.kind === 'start' || box.node.kind === 'end') {
    shape = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.h / 2}" ry="${box.h / 2}" ${common}/>`;
  } else if (box.node.kind === 'note') {
    shape = `<path d="M${box.x} ${box.y} h${box.w - 14} l14 14 v${box.h - 14} h-${box.w} z" ${common}/>`;
  } else {
    shape = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="7" ry="7" ${common}/>`;
  }

  const startY = cy - ((box.lines.length - 1) * LINE_H) / 2;
  const text = box.lines
    .map((line, index) => `<tspan x="${cx}" y="${startY + index * LINE_H}">${escapeXml(line)}</tspan>`)
    .join('');

  return `${shape}<text font-family="${FONT}" font-size="${FONT_SIZE}" fill="${ink}" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
}

function edgePath(from: Box, to: Box): string {
  const y1 = from.y + from.h / 2;
  const y2 = to.y + to.h / 2;
  const forward = to.x > from.x + from.w;

  if (forward) {
    const x1 = from.x + from.w;
    const x2 = to.x;
    const mid = Math.round((x1 + x2) / 2);
    if (y1 === y2) return `M${x1} ${y1} H${x2 - 6}`;
    return `M${x1} ${y1} H${mid} V${y2} H${x2 - 6}`;
  }

  // Back edge or same-rank link: route below both boxes so it stays readable.
  const x1 = from.x + from.w / 2;
  const x2 = to.x + to.w / 2;
  const detour = Math.max(from.y + from.h, to.y + to.h) + 26;
  return `M${x1} ${from.y + from.h} V${detour} H${x2} V${y2 + to.h / 2 + 6}`;
}

function edgeLabel(from: Box, to: Box, label: string): string {
  if (!label) return '';
  const x = Math.round((from.x + from.w + to.x) / 2);
  const y = Math.round((from.y + from.h / 2 + to.y + to.h / 2) / 2);
  const w = Math.round(label.length * CHAR_W + 12);
  return (
    `<rect x="${x - w / 2}" y="${y - 9}" width="${w}" height="18" rx="4" fill="#ffffff" stroke="#d0d7e2" stroke-width="1"/>` +
    `<text x="${x}" y="${y + 1}" font-family="${FONT}" font-size="11" fill="#4a5568" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>`
  );
}

/**
 * Render a validated spec to draw.io-styled SVG.
 *
 * The output is built entirely from fixed templates plus escaped text, so no
 * model-supplied string can introduce an element, attribute or handler.
 */
export function renderDiagram(spec: DiagramSpec): RenderedDiagram {
  const { boxes, width, height } = layout(spec);
  const byId = new Map(boxes.map((box) => [box.node.id, box]));

  const edges = spec.edges
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return '';
      return (
        `<path d="${edgePath(from, to)}" fill="none" stroke="#5b6b7f" stroke-width="1.5" marker-end="url(#gravyArrow)"/>` +
        edgeLabel(from, to, edge.label)
      );
    })
    .join('');

  const title = spec.title
    ? `<text x="${CANVAS_PAD}" y="${CANVAS_PAD - 8}" font-family="${FONT}" font-size="15" font-weight="bold" fill="#22303f">${escapeXml(spec.title)}</text>`
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title || 'Diagram')}">` +
    `<defs><marker id="gravyArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0 0 L10 5 L0 10 z" fill="#5b6b7f"/></marker></defs>` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    title +
    `<g>${edges}</g>` +
    `<g>${boxes.map(nodeShape).join('')}</g>` +
    `</svg>`;

  return { svg, width, height };
}
