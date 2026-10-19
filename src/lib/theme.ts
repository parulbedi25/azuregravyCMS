/**
 * Turns the saved accent colour into CSS custom properties, so the Appearance
 * screen really does repaint the public site. All shades are mixed in sRGB,
 * which is close enough for UI tints and needs no dependencies.
 */

function parseHex(value: string | undefined | null): [number, number, number] | null {
  if (!value) return null;
  let hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix `amount` (0–1) of `target` into `rgb`. */
function mix(rgb: [number, number, number], target: [number, number, number], amount: number): string {
  return toHex([
    rgb[0] + (target[0] - rgb[0]) * amount,
    rgb[1] + (target[1] - rgb[1]) * amount,
    rgb[2] + (target[2] - rgb[2]) * amount,
  ]);
}

/** Relative luminance, used to pick readable text on the accent. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function accentStylesheet(accent: string | undefined | null): string {
  const rgb = parseHex(accent);
  if (!rgb) return '';
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];

  // Light: the colour as given, with a deeper ink and a 8% tint.
  const lightInk = luminance(rgb) > 0.5 ? mix(rgb, black, 0.55) : mix(rgb, black, 0.18);
  const lightSoft = mix(rgb, white, 0.9);
  const contrast = luminance(rgb) > 0.62 ? '#1d1d1f' : '#ffffff';

  // Dark: lift the colour so it stays legible on black, tint stays very deep.
  const darkAccent = luminance(rgb) < 0.35 ? mix(rgb, white, 0.28) : mix(rgb, white, 0.12);
  const darkInk = mix(rgb, white, 0.6);
  const darkSoft = mix(rgb, black, 0.78);

  return [
    `<style id="accent-tokens">`,
    `:root{--accent:${toHex(rgb)};--accent-ink:${lightInk};--accent-soft:${lightSoft};--accent-contrast:${contrast};}`,
    `[data-theme='dark']{--accent:${darkAccent};--accent-ink:${darkInk};--accent-soft:${darkSoft};--admin-accent:${darkAccent};}`,
    `</style>`,
  ].join('');
}
