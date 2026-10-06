/**
 * What the library knows about colour: how to read one, and how to say there
 * is none.
 *
 * Deliberately narrow. A stored prop value is whatever a Consumer's Schema
 * default or an Author's colour control produced, and the Validator's contract
 * is that it stays silent rather than guessing — so anything this cannot read
 * with certainty comes back as unreadable, and the caller says nothing.
 *
 * `NONE` and `surfaceColor` live here rather than in a Preset because both
 * shipped Presets read colour props and neither imports the other. One
 * definition of what no colour means, and one place that decides what it emits.
 */

/**
 * How a colour prop says there is no colour.
 *
 * Not a CSS colour, and that is deliberate: an Author choosing a background is
 * choosing between a colour and nothing, and `transparent` is the stylesheet's
 * word for that rather than theirs.
 *
 * It is the value an Inspector *writes* and never one a Definition reads. A
 * `SchemaKind.surface` prop is resolved through `surfaceColor` before `render`
 * sees it, so the sentinel stops at the edge of the emit path. It stays public
 * because a Consumer's clear affordance has to store something, and storing
 * `undefined` would resolve back to the Schema default — which for a button is
 * black, so clearing its fill would repaint it.
 */
export const NONE = "none";

/**
 * A stored surface value as CSS: the colour, or nothing at all.
 *
 * The one place that decides what no colour emits, and the only route a
 * `SchemaKind.surface` prop has to a stylesheet. Both paths that turn a prop
 * into CSS cross it — the inline style a Definition renders and the mobile
 * Override a Schema entry declares — so there is no way to reach CSS carrying
 * the sentinel. That is the whole of the enforcement; see ADR-0019.
 *
 * Omitting rather than emitting `transparent` is the most portable way to say
 * it: `background-color` starts out transparent, so no declaration and a
 * transparent one paint the same thing in every client, including the one whose
 * rendering engine is a word processor. It is also the same shape as a border of
 * zero width, which emits no border.
 *
 * A Document written before `NONE` existed says `transparent`, which is a real
 * colour and still renders identically, so nothing needs migrating.
 *
 * A stored value that is not a string is treated as no colour at all. It is
 * whatever a Consumer's Schema default or a hand-edited Document put there, and
 * the two things this could do with it are emit nothing or coerce it — where
 * coercing an object writes `background-color: [object Object]` into the
 * markup. Nothing is the same answer the rest of this file gives to a value it
 * cannot read.
 */
export function surfaceColor(value: unknown): string | undefined {
  return typeof value === "string" && value !== NONE ? value : undefined;
}

/** An opaque sRGB colour: the only thing a contrast ratio can be taken of. */
export interface Color {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/**
 * What a CSS colour value turned out to be.
 *
 * Three outcomes rather than two, because they lead to three different
 * decisions: a colour is the answer, `transparent` means keep looking behind
 * it, and unreadable means stop and say nothing.
 */
export type ParsedColor =
  | { readonly kind: "opaque"; readonly color: Color }
  | { readonly kind: "transparent" }
  | { readonly kind: "unreadable" };

const UNREADABLE: ParsedColor = { kind: "unreadable" };
const TRANSPARENT: ParsedColor = { kind: "transparent" };

const HEX = /^#([\da-f]+)$/u;
const FUNCTIONAL = /^rgba?\((?<body>[^()]*)\)$/u;

/**
 * Read a CSS colour.
 *
 * Hex in its three lengths and `rgb()`/`rgba()` in both the comma and the
 * space syntax, because those are what a colour control produces. A named
 * colour, a gradient, a variable or anything else is unreadable on purpose: a
 * table of 148 colour names would buy a little coverage and a lot of confidence
 * in a guess.
 *
 * Two of those names are read, and they mean the same thing. `transparent` is
 * CSS's way of saying nothing is there; `none` is the way a Preset's colour prop
 * says it, for an Author who is choosing between a colour and no colour rather
 * than writing a stylesheet. Anything reading a Document has to understand both,
 * or a Validator looking for what shows through a container gives up at the
 * first one an Author never styled.
 */
export function parseColor(value: unknown): ParsedColor {
  if (typeof value !== "string") return UNREADABLE;
  const text = value.trim().toLowerCase();
  if (text === "transparent" || text === NONE) return TRANSPARENT;

  const hex = HEX.exec(text);
  if (hex?.[1] !== undefined) return fromHex(hex[1]);

  const functional = FUNCTIONAL.exec(text);
  if (functional?.groups?.["body"] !== undefined) {
    return fromFunctional(functional.groups["body"]);
  }
  return UNREADABLE;
}

/**
 * Whether a value is a colour that can be written as ink: one this file reads
 * as opaque.
 *
 * The test a prop that follows the root puts the root's value to. Anything
 * else — `none`, a part-transparent colour, a name, a string carrying a second
 * declaration — is passed over for the default rather than written into a style
 * (ADR-0022).
 */
export function isUsableColor(value: unknown): value is string {
  return parseColor(value).kind === "opaque";
}

/**
 * A Brand Colour: a named colour a Consumer offers beside every colour and
 * Surface, as the entry's `constraints.brandColors` lists it.
 *
 * A menu, not a gate. The Document stores `value`, never `label`, so any other
 * colour still works, and a brand that changes its list leaves stored emails
 * as they were.
 */
export interface BrandColor {
  /** What an Author and an Agent pick it by. */
  readonly label: string;
  /** The colour the Document stores. */
  readonly value: string;
}

/**
 * The Brand Colours a colour or Surface entry offers, read off its `constraints`.
 * Any that is not a label and a colour that can be written is left out.
 */
export function brandColorsOf(
  constraints: Readonly<Record<string, unknown>> | undefined,
): readonly BrandColor[] {
  const brandColors = constraints?.["brandColors"];
  if (!Array.isArray(brandColors)) return [];
  return brandColors.flatMap((color: unknown) => {
    if (typeof color !== "object" || color === null) return [];
    const { label, value } = color as Partial<Record<string, unknown>>;
    return typeof label === "string" && isUsableColor(value)
      ? [{ label, value }]
      : [];
  });
}

/**
 * The WCAG contrast ratio between two opaque colours, from 1 to 21.
 *
 * Same formula the accessibility guidelines are written in, so a Consumer's
 * `ratio` means what their design team means by it.
 */
export function contrastRatio(one: Color, other: Color): number {
  const first = relativeLuminance(one);
  const second = relativeLuminance(other);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance({ red, green, blue }: Color): number {
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** One channel, undone from sRGB's transfer curve. */
function linear(channel: number): number {
  const proportion = channel / 255;
  return proportion <= 0.039_28
    ? proportion / 12.92
    : ((proportion + 0.055) / 1.055) ** 2.4;
}

function fromHex(digits: string): ParsedColor {
  const short = digits.length === 3 || digits.length === 4;
  if (!short && digits.length !== 6 && digits.length !== 8) return UNREADABLE;

  const size = short ? 1 : 2;
  const channel = (index: number): number => {
    const part = digits.slice(index * size, (index + 1) * size);
    return Number.parseInt(short ? part.repeat(2) : part, 16);
  };

  const alpha = digits.length === 4 || digits.length === 8 ? channel(3) : 255;
  return withAlpha(
    { red: channel(0), green: channel(1), blue: channel(2) },
    alpha / 255,
  );
}

function fromFunctional(body: string): ParsedColor {
  // Both syntaxes at once: `rgb(1, 2, 3)`, `rgb(1 2 3)`, and either with an
  // alpha given after a comma or a slash.
  const [channels = "", slashed] = body.split("/");
  const parts = channels.split(/[\s,]+/u).filter((part) => part !== "");
  const given = slashed === undefined ? parts : [...parts, slashed];
  if (given.length !== 3 && given.length !== 4) return UNREADABLE;

  const numbers: number[] = [];
  for (const [index, part] of given.entries()) {
    // The alpha runs 0 to 1 where a channel runs 0 to 255, which is all a
    // percentage in either position needs to know.
    const value = component(part, index === 3 ? 1 : 255);
    if (value === undefined) return UNREADABLE;
    numbers.push(value);
  }

  const [red = 0, green = 0, blue = 0, alpha = 1] = numbers;
  return withAlpha({ red, green, blue }, alpha);
}

/** One `rgb()` argument, pinned into range, or `undefined` when it is not one. */
function component(part: string, maximum: number): number | undefined {
  const text = part.trim();
  const percentage = text.endsWith("%");
  const number = Number(percentage ? text.slice(0, -1) : text);
  if (!Number.isFinite(number)) return undefined;

  const value = percentage ? (number / 100) * maximum : number;
  return Math.min(Math.max(value, 0), maximum);
}

/**
 * A colour with its alpha applied — which is to say, refused unless it has
 * none.
 *
 * A colour part-way over an unknown background is a blend this cannot compute,
 * and fully transparent is the same as not being there at all.
 */
function withAlpha(color: Color, alpha: number): ParsedColor {
  if (alpha === 0) return TRANSPARENT;
  return alpha === 1 ? { kind: "opaque", color } : UNREADABLE;
}
