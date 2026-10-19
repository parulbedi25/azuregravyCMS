import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true, breaks: false });

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

export interface RenderedContent {
  html: string;
  toc: TocItem[];
}

const slugifyHeading = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'section';

/**
 * Render markdown to clean, safe HTML and collect a table of contents.
 * Heading IDs are injected after rendering so we don't depend on marked's
 * renderer API, which changes between major versions.
 */
export function renderMarkdown(markdown: string): RenderedContent {
  const raw = marked.parse(markdown ?? '', { async: false }) as string;

  const toc: TocItem[] = [];
  const used = new Map<string, number>();
  const withIds = raw.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g, (_match, level: string, attrs: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let id = slugifyHeading(text);
    const count = used.get(id) ?? 0;
    used.set(id, count + 1);
    if (count > 0) id = `${id}-${count + 1}`;
    toc.push({ id, text, level: Number(level) });
    const cleanAttrs = attrs.replace(/\s*id="[^"]*"/g, '');
    return `<h${level}${cleanAttrs} id="${id}">${inner}</h${level}>`;
  });

  const html = sanitizeHtml(withIds, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags.filter((tag) => tag !== 'iframe'),
      'img', 'figure', 'figcaption', 'picture', 'source', 'video', 'audio',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'del', 'ins', 'sup', 'sub', 'mark',
      'details', 'summary', 'hr', 'input',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
      source: ['src', 'srcset', 'type', 'media'],
      video: ['src', 'controls', 'poster', 'width', 'height'],
      audio: ['src', 'controls'],
      '*': ['class', 'id', 'title', 'align', 'colspan', 'rowspan', 'style'],
      input: ['type', 'checked', 'disabled'],
    },
    allowedStyles: {
      '*': {
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        width: [/^\d+(px|%)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? '';
        const external = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(external ? { rel: 'noopener noreferrer' } : {}),
            ...(external && attribs.target === '_blank' ? {} : {}),
          },
        };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: attribs.loading ?? 'lazy', decoding: 'async' },
      }),
    },
  });

  return { html, toc };
}

/** Plain-text preview used for SEO descriptions and search snippets. */
export function plainText(htmlOrMarkdown: string): string {
  return sanitizeHtml(htmlOrMarkdown, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}
