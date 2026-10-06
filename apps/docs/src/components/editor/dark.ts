import { ratioOf } from "./contrast";

/**
 * The example's guess at how a mail client darkens an email.
 *
 * Clients don't publish their rules and no two agree, so this is three broad
 * families rather than any one client: leave the colours alone, flip only the
 * light backgrounds and dark text, or flip everything. It reads the rendered
 * HTML and stores nothing. lekh has no part in it: dark-mode colours are not
 * Document data.
 */

export type DarkStrategy = "none" | "partial" | "full";

export const DARK_STRATEGIES: readonly {
  readonly strategy: DarkStrategy;
  readonly label: string;
  /** Where an Author is most likely to meet it, best known first. */
  readonly clients: readonly string[];
}[] = [
  { strategy: "none", label: "No change", clients: ["Apple Mail"] },
  {
    strategy: "partial",
    label: "Partial invert",
    clients: ["Outlook.com", "Gmail on Android"],
  },
  {
    strategy: "full",
    label: "Full invert",
    clients: ["Gmail on iOS", "Outlook on Windows"],
  },
];

export type Rgba = readonly [number, number, number, number];

/** What a client paints around the email in dark mode. */
export const DARK_PAGE: Rgba = [18, 18, 18, 1];

/** A computed colour, `rgb()` or `rgba()`. Anything else is `undefined`. */
export function rgbaOf(value: string): Rgba | undefined {
  const match =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/u.exec(
      value.trim(),
    );
  if (!match) return undefined;
  const alpha = match[4];
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    alpha === undefined
      ? 1
      : alpha.endsWith("%")
        ? Number(alpha.slice(0, -1)) / 100
        : Number(alpha),
  ];
}

export function cssOf([red, green, blue, alpha]: Rgba): string {
  const channels = [red, green, blue].map((channel) => Math.round(channel));
  return alpha === 1
    ? `rgb(${channels.join(", ")})`
    : `rgba(${channels.join(", ")}, ${String(alpha)})`;
}

/**
 * What a colour paints: the ground under text, or the text itself.
 *
 * Borders count as ground. A light rule on a light card goes dark with it.
 */
export type ColourRole = "ground" | "ink";

/**
 * A colour as the strategy would show it.
 *
 * Flipping keeps the hue and turns the lightness over, but stops short of pure
 * black and white, the way clients do: white ground lands on the page's dark,
 * black ink on a soft white.
 */
export function darken(
  strategy: DarkStrategy,
  role: ColourRole,
  colour: Rgba,
): Rgba {
  if (strategy === "none") return colour;
  const [hue, saturation, lightness] = hslOf(colour);
  const flips =
    strategy === "full" ||
    (role === "ground" ? lightness > 0.5 : lightness < 0.5);
  if (!flips) return colour;
  const turned = FLOOR + (1 - lightness) * (1 - 2 * FLOOR);
  return [...rgbOf(hue, saturation, turned), colour[3]];
}

/** How far a flip stays from black and white: `DARK_PAGE` is about this. */
const FLOOR = 0.07;

function hslOf([red, green, blue]: Rgba): readonly [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (chroma === 0) return [0, 0, lightness];
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  const sector =
    max === r
      ? ((g - b) / chroma + 6) % 6
      : max === g
        ? (b - r) / chroma + 2
        : (r - g) / chroma + 4;
  return [sector * 60, saturation, lightness];
}

function rgbOf(
  hue: number,
  saturation: number,
  lightness: number,
): readonly [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] =
    sector === 0
      ? [chroma, second, 0]
      : sector === 1
        ? [second, chroma, 0]
        : sector === 2
          ? [0, chroma, second]
          : sector === 3
            ? [0, second, chroma]
            : sector === 4
              ? [second, 0, chroma]
              : [chroma, 0, second];
  return [(r + base) * 255, (g + base) * 255, (b + base) * 255];
}

/* ---------------------------------------------------------- vanishing logos */

/**
 * The colours along an image's outline, where its opaque pixels meet its
 * transparent ones. `undefined` when the image has no transparency, so there
 * is no outline for a background to swallow.
 */
export function edgeColours(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): readonly Rgba[] | undefined {
  const alphaAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height
      ? 255
      : (pixels[(y * width + x) * 4 + 3] ?? 255);
  let transparent = false;
  const edges: Rgba[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = alphaAt(x, y);
      if (alpha < CLEAR) {
        transparent = true;
        continue;
      }
      if (alpha < SOLID) continue;
      // Anything less than solid beside it, so an antialiased fade a few
      // pixels wide still has an outline.
      const touchesClear =
        alphaAt(x - 1, y) < SOLID ||
        alphaAt(x + 1, y) < SOLID ||
        alphaAt(x, y - 1) < SOLID ||
        alphaAt(x, y + 1) < SOLID;
      if (!touchesClear) continue;
      const at = (y * width + x) * 4;
      edges.push([
        pixels[at] ?? 0,
        pixels[at + 1] ?? 0,
        pixels[at + 2] ?? 0,
        1,
      ]);
    }
  }
  return transparent ? edges : undefined;
}

const CLEAR = 32;
const SOLID = 128;

/**
 * Whether an outline is mostly too close to the ground behind it to see.
 *
 * A guess, and it says so wherever it shows: the share and the ratio are this
 * example's, not any client's.
 */
export function mayVanish(edges: readonly Rgba[], ground: Rgba): boolean {
  if (edges.length === 0) return false;
  const lost = edges.filter(
    ([red, green, blue]) =>
      ratioOf([red, green, blue], [ground[0], ground[1], ground[2]]) <
      INVISIBLE,
  ).length;
  return lost / edges.length >= LOST_SHARE;
}

/** Below this ratio an edge is as good as gone. */
const INVISIBLE = 1.6;
/** How much of the outline has to go before the image is flagged. */
const LOST_SHARE = 0.35;
