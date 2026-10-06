/**
 * The example's own contrast maths, for the live meter beside a colour.
 *
 * lekh's Diagnostics read the stored Document, never a drag in progress
 * (ADR-0032). So while an Author drags, the meter works the ratio out here,
 * from the dragged colour and the descriptor's `against`. The Diagnostic
 * catches up when the drag is let go.
 */

/** WCAG AA for body text: the line lekh's contrast check warns under. */
export const READABLE = 4.5;

export type Rgb = readonly [number, number, number];

/** Hex in three or six digits, or `rgb()`. Anything else is `undefined`. */
function rgbOf(value: string): Rgb | undefined {
  const text = value.trim().toLowerCase();
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/u.exec(text)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? hex.replaceAll(/./gu, "$&$&") : hex;
    const channel = (at: number): number =>
      Number.parseInt(full.slice(at, at + 2), 16);
    return [channel(0), channel(2), channel(4)];
  }
  const rgb = /^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/u.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return undefined;
}

/** One sRGB channel, 0 to 255, as linear light. */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: Rgb): number {
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** The contrast ratio of two colours, 1 to 21, or `undefined` if unreadable. */
export function contrastOf(one: string, other: string): number | undefined {
  const first = rgbOf(one);
  const second = rgbOf(other);
  if (!first || !second) return undefined;
  return ratioOf(first, second);
}

/** The contrast ratio of two colours already in channels, 1 to 21. */
export function ratioOf(one: Rgb, other: Rgb): number {
  const a = luminance(one);
  const b = luminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
