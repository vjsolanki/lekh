/**
 * The stand-in for a Consumer's asset library.
 *
 * Drawn rather than fetched, so the example needs no network and the Document
 * never carries a `blob:` URL that would mean nothing an hour later. A real
 * product would open its digital asset manager here and return locations that
 * already exist.
 */

import type { Asset } from "lekh-editor";

export interface StockImage extends Asset {
  readonly label: string;
}

/** Wrap an SVG document as a `data:` URL an `<img>` can load. */
function dataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * One plate from the asset library: a two-stop wash, a couple of arcs to give
 * it some structure, and its name set in the corner.
 */
function plate(
  label: string,
  from: string,
  to: string,
  width: number,
  height: number,
): StockImage {
  const id = label.toLowerCase();
  const type = Math.round(Math.min(width, height) / 14);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">`,
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
    `</linearGradient></defs>`,
    `<rect width="100%" height="100%" fill="url(#${id})"/>`,
    `<g fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="${String(Math.max(1, Math.round(width / 220)))}">`,
    `<circle cx="${String(width * 0.78)}" cy="${String(height * 0.24)}" r="${String(height * 0.42)}"/>`,
    `<circle cx="${String(width * 0.78)}" cy="${String(height * 0.24)}" r="${String(height * 0.66)}"/>`,
    `<path d="M0 ${String(height * 0.78)} L${String(width)} ${String(height * 0.44)}"/>`,
    `</g>`,
    `<text x="${String(type)}" y="${String(height - type * 0.8)}" fill="#ffffff" fill-opacity="0.92"`,
    ` font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${String(type)}"`,
    ` letter-spacing="${String(type * 0.14)}">${label.toUpperCase()}</text>`,
    `</svg>`,
  ].join("");

  return { label, src: dataUrl(svg), width, height };
}

/**
 * The sender's wordmark, which is the one image in the sample email that has
 * to be a specific thing rather than a placeholder.
 */
function wordmark(): StockImage {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="264" height="72" viewBox="0 0 264 72">`,
    `<rect width="264" height="72" fill="none"/>`,
    `<rect x="0" y="14" width="44" height="44" rx="10" fill="#2f2ab8"/>`,
    `<path d="M14 27v18h16" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="58" y="49" fill="#12141a" font-family="Georgia, 'Times New Roman', serif"`,
    ` font-size="34" letter-spacing="0.5">lekh</text>`,
    `<text x="58" y="63" fill="#79808f" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"`,
    ` font-size="9" letter-spacing="2.4">RELEASE NOTES</text>`,
    `</svg>`,
  ].join("");

  return { label: "Wordmark", src: dataUrl(svg), width: 264, height: 72 };
}

/** The sender's mark, used in the sample email's masthead. */
export const WORDMARK = wordmark();

/** The plate the sample email leads with — deliberately without alt text. */
export const HERO = plate("Harbour", "#2f2ab8", "#0f766e", 1200, 600);

/** The plate beside the spotlight copy. */
export const SPOTLIGHT = plate("Orchard", "#b45309", "#7c2d12", 800, 600);

/** Everything the gallery dialog offers. */
export const STOCK: readonly StockImage[] = [
  HERO,
  SPOTLIGHT,
  plate("Tideline", "#0369a1", "#0f172a", 1000, 1000),
  plate("Kiln", "#be123c", "#4c1d95", 1600, 600),
  plate("Meadow", "#4d7c0f", "#134e4a", 900, 700),
  WORDMARK,
];
