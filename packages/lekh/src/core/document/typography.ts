/**
 * The small pieces both shipped Presets write text with.
 *
 * Here rather than in either one because a Preset is an entry point: the
 * built-in Blocks and the compliance Blocks are composed together far more
 * often than not, and a footer whose alignment narrowed differently from the
 * paragraph above it would be a bug nobody could see coming. Pure, and nothing
 * to do with react.email, so ADR-0001 is untouched.
 */

import { SchemaKind, type Migration, type SchemaEntry } from "./definition";
import type { MobileDeclarations } from "../layout/responsive";

/** What a Preset falls back to when a Consumer has no brand font to name. */
export const DEFAULT_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * One family of a stack: a name in matching quotes, or a bare name. Letters,
 * digits, spaces and hyphens only, and at least one letter. Letters in any
 * script, because a Japanese stack names its fonts in Japanese.
 */
const FAMILY =
  /^ *(?:'[\p{L}\p{N} -]*\p{L}[\p{L}\p{N} -]*'|"[\p{L}\p{N} -]*\p{L}[\p{L}\p{N} -]*"|[\p{L}\p{N} -]*\p{L}[\p{L}\p{N} -]*) *$/u;

/**
 * Whether a stored value is a font stack safe to emit (ADR-0021).
 *
 * Checked family by family, so every quote closes where it opened. A quote
 * left open would make the rest of the style one long string.
 */
export function isSafeFontStack(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.split(",").every((family) => FAMILY.test(family))
  );
}

/**
 * The email's font, read by any Block that writes text.
 *
 * The root's stack when it is safe to emit, whether or not the Consumer listed
 * it: the list is a menu, not a gate. Otherwise the caller's own default. A
 * root with no font, a Consumer's root that never declared one, and a stack
 * that would break the style all land there (ADR-0021).
 */
export function fontFamilyOf(
  rootProps: Readonly<Record<string, unknown>>,
  config: { readonly fontFamily: string },
): string {
  const stack = rootProps["fontFamily"];
  return isSafeFontStack(stack) ? stack : config.fontFamily;
}

/** Which way the email runs: left to right, or right to left (ADR-0027). */
export type Direction = "ltr" | "rtl";

/**
 * The email's direction, read off the root's resolved props.
 *
 * `"rtl"` only for a stored `"rtl"`. Anything else is the default rather than
 * a refusal to render (ADR-0006). Nothing is guessed from the language.
 */
export function directionOf(
  rootProps: Readonly<Record<string, unknown>>,
): Direction {
  return rootProps["direction"] === "rtl" ? "rtl" : "ltr";
}

/** An alignment as the Document stores it: by reading order (ADR-0027). */
export type Alignment = "start" | "center" | "end";

/** The three alignments an email can rely on, by reading order. */
export const ALIGNMENTS: readonly Alignment[] = ["start", "center", "end"];

/** What every alignment prop tells an Author about start and end. */
export const ALIGNMENT_HELP =
  "Start is the side the email reads from: left in a left-to-right email, " +
  "right in a right-to-left one. End is the other side.";

/**
 * Alignment, resolved to the physical side the email writes.
 *
 * `start` is `left` in a left-to-right email and `right` in a right-to-left
 * one, and `end` the reverse. Never `text-align: start`, which Outlook on the
 * desktop and Yahoo do not read (ADR-0027).
 *
 * The fallback is the caller's, because it is their Schema default: a stored
 * value that means nothing should render as the Block would have without it,
 * not as whatever this file happens to prefer.
 */
export function alignment(
  align: unknown,
  direction: Direction,
  fallback: Alignment = "start",
): "left" | "center" | "right" {
  const logical =
    align === "start" || align === "center" || align === "end"
      ? align
      : fallback;
  if (logical === "center") return "center";
  return (logical === "start") === (direction === "ltr") ? "left" : "right";
}

/**
 * Brings a Block whose `align` stored a physical side forward to reading
 * order (ADR-0027): `left` is `start` and `right` is `end`, in `props` and in
 * `mobile`. Every email was left to right until then, so the side it showed
 * is the side it keeps. Anything else stays as stored.
 */
export const ALIGNMENT_BY_READING_ORDER: Migration = ({ props, mobile }) => ({
  props: byReadingOrder(props),
  ...(mobile && { mobile: byReadingOrder(mobile) }),
});

function byReadingOrder(
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const align = values["align"];
  if (align === "left") return { ...values, align: "start" };
  if (align === "right") return { ...values, align: "end" };
  return { ...values };
}

/** A number of pixels, as one or more CSS properties the mobile Stage can override. */
export const pixels =
  (...properties: readonly string[]): MobileDeclarations<number> =>
  (value) =>
    Object.fromEntries(
      properties.map((property) => [property, `${String(value)}px`]),
    );

/**
 * An alignment prop, as every shipped Block declares one: stored by reading
 * order, written as a physical side (ADR-0027). The default is the caller's,
 * since a divider and a footer start centred.
 *
 * An Overridable one resolves its Mobile Override against the email's
 * direction, like the inline value it overrides, and falls back to the same
 * default.
 */
export function alignSchema(
  defaultValue: Alignment,
  overridable: boolean,
): SchemaEntry<string> {
  const mobile: MobileDeclarations<string> = (align, rootProps) => ({
    "text-align": alignment(align, directionOf(rootProps), defaultValue),
  });
  return {
    kind: SchemaKind.align,
    label: "Alignment",
    defaultValue,
    constraints: { options: ALIGNMENTS, help: ALIGNMENT_HELP },
    ...(overridable && { mobile }),
  };
}

/**
 * A line height multiplier as a whole percentage, so `1.5` is `150%`.
 *
 * Not a bare multiplier: classic Outlook reads `1.5` as a percentage and drops
 * the decimal, which is `100%` (#56). A percentage resolves against the
 * element's own size, so on an element that sets its size it is the same
 * height.
 */
export function lineHeightPercent(multiplier: number): string {
  return `${String(Math.round(multiplier * 100))}%`;
}
