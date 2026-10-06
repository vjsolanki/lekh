/**
 * The Schema entries several Blocks share, and the styles each one writes:
 * visibility, border, background, padding and typography.
 */

import { NONE } from "../core/document/color";
import { SchemaKind, type Surface } from "../core/document/definition";
import { lineHeightPercent, pixels } from "../core/document/typography";
import type {
  BoxSide,
  Migration,
  MailClientNote,
  SchemaEntry,
} from "../core/document/definition";
import type { PresetDefaults } from "./options";

/**
 * The group a container's inner column of content sits under.
 *
 * A container is one Block with two surfaces: it reaches the edge of whatever
 * window the email is read in, and it holds a column of content at the email's
 * width inside that. Both sets of props sit in one panel, so each container
 * heads its own with its own name — a row says "Columns", a section says
 * "Section" — and everything about the column inside sits under this one.
 * Naming the outer group after the Block rather than after the shape keeps the
 * heading in words the Author already has: it is the thing they selected.
 */
export const CONTENT_GROUP = "Content";
export const MOBILE_GROUP = "Mobile";

/** Which screens a Block shows on (ADR-0025). */
type ShowOn = "all" | "desktop" | "mobile";

const SHOW_ON_OPTIONS: readonly { label: string; value: ShowOn }[] = [
  { label: "All screens", value: "all" },
  { label: "Desktop only", value: "desktop" },
  { label: "Mobile only", value: "mobile" },
];

/**
 * Mobile only's Mail Client Notes: the phone readers that never show it.
 *
 * A mobile-only Block is hidden inline and revealed by a rule in the media
 * query (ADR-0025). Where the `<style>` or the media query is stripped, the
 * reveal never fires and the Block stays hidden, so it must never be the only
 * copy of something.
 *
 * Checked 2026-10-05 against caniemail's `html-style` (last tested 2023-07-27)
 * and `css-at-media` (last tested 2023-12-13) pages, keeping the clients a
 * phone reads mail in. The Gmail app strips both for a non-Google account,
 * Gmail in a phone's browser supports neither, Samsung Email drops the media
 * query for an Outlook or Hotmail account, and the SFR and La Poste apps
 * support neither. Desktop clients are left out: hidden there is what the
 * Author asked for. Recheck when caniemail does.
 */
const NEVER_SHOWN: readonly MailClientNote<string>[] = [
  {
    client: "gmail-app",
    when: (showOn) => showOn === "mobile",
    note: "Never shows it with a non-Google account",
  },
  {
    client: "gmail-mobile-webmail",
    when: (showOn) => showOn === "mobile",
    note: "Never shows it",
  },
  {
    client: "samsung-email",
    when: (showOn) => showOn === "mobile",
    note: "Never shows it with an Outlook or Hotmail account",
  },
  {
    client: "sfr",
    when: (showOn) => showOn === "mobile",
    note: "Never shows it",
  },
  {
    client: "laposte",
    when: (showOn) => showOn === "mobile",
    note: "Never shows it",
  },
];

/**
 * The Schema entry every Block but the root and the compliance Blocks shares.
 *
 * One choice rather than two booleans, so no Block can be hidden everywhere.
 * `"desktop"` is the old `hideOnMobile` and asks for the fixed class. `"mobile"`
 * goes through the wrapper the library builds (ADR-0025).
 */
export const SHOW_ON: SchemaEntry<string> = {
  kind: SchemaKind.select,
  label: "Show on",
  defaultValue: "all",
  advanced: true,
  constraints: { options: SHOW_ON_OPTIONS },
  clients: NEVER_SHOWN,
};

/**
 * The column's, without `"mobile"`. A column is a `<td>`, which a `<div>`
 * cannot wrap, and a row missing a column on desktop is short of a hundred
 * per cent (ADR-0016).
 */
export const COLUMN_SHOW_ON: SchemaEntry<string> = {
  kind: SchemaKind.select,
  // A Columns Block's panel holds its column's settings too, so this says whose.
  label: "Show this column on",
  defaultValue: "all",
  advanced: true,
  constraints: {
    options: SHOW_ON_OPTIONS.filter((option) => option.value !== "mobile"),
  },
};

/**
 * Every Block with `showOn` stored `hideOnMobile` before it. `true` is
 * `"desktop"`; anything else is the default, so nothing is stored.
 */
export const SHOW_ON_FROM_HIDE_ON_MOBILE: Migration = ({ props, mobile }) => {
  const { hideOnMobile, ...rest } = props;
  return {
    props: hideOnMobile === true ? { ...rest, showOn: "desktop" } : rest,
    mobile,
  };
};

/**
 * The styles an Author gets when a Block can have an edge of its own.
 *
 * Three props rather than one, because a composite value is harder to give a
 * Mobile Override to later and every control here is one the example already
 * draws. Zero width is how a border is turned off, so there is no separate
 * switch saying the same thing a second way.
 *
 * Dashed and dotted are rare in mail and render inconsistently, but they are
 * two entries in an array rather than machinery — withholding them would be the
 * library having a taste, which is not its job.
 */
export const BORDER_STYLES = ["solid", "dashed", "dotted"];

export type BorderProps = {
  borderWidth: number;
  borderStyle: string;
  borderColor: string;
  borderRadius: number;
};

/**
 * A corner radius's Mail Client Note: classic Outlook for Windows draws the
 * corners square (ADR-0041).
 *
 * Checked 2026-10-05 against caniemail's border-radius page (its data last
 * tested 2021-03-09): Outlook for Windows, 2003 to 2019, does not support it
 * and needs VML's RoundRect, which nothing in this Preset draws. Recheck when
 * either changes.
 */
export const SQUARE_CORNERS: readonly MailClientNote<number>[] = [
  {
    client: "outlook-windows",
    when: (radius) => radius > 0,
    note: "Shows square corners",
  },
];

/**
 * The four border entries. The radius default is the caller's, because a
 * button starts rounded where a row and a column start square.
 */
export function borderSchema(
  group?: string,
  borderRadius = 0,
): {
  [TKey in keyof BorderProps]: SchemaEntry<BorderProps[TKey]>;
} {
  // Spread rather than set, so a Schema that groups nothing stays a Schema with
  // no `group` key on it at all. Advanced, as most Blocks are drawn without
  // an edge.
  const grouped = {
    ...(group === undefined ? {} : { group }),
    advanced: true as const,
  };
  return {
    borderWidth: {
      kind: SchemaKind.number,
      label: "Border width",
      defaultValue: 0,
      constraints: { min: 0, max: 12, unit: "px" },
      ...grouped,
    },
    borderStyle: {
      kind: SchemaKind.select,
      label: "Border style",
      defaultValue: "solid",
      constraints: { options: BORDER_STYLES },
      ...grouped,
    },
    borderColor: {
      kind: SchemaKind.color,
      label: "Border color",
      defaultValue: "#e6e6e6",
      ...grouped,
    },
    // Best-effort, and knowingly so. Outlook's Word engine ignores a radius on
    // a table outright, so a row squares off there; and a column with a
    // background of its own paints a square corner over the row's rounded one,
    // because `overflow: hidden` does not clip table cells reliably. The column
    // carries one for exactly that reason — a cell rounds its own corners, so
    // the per-column background is the combination that actually delivers a
    // rounded card.
    borderRadius: {
      kind: SchemaKind.number,
      label: "Corner radius",
      defaultValue: borderRadius,
      constraints: { min: 0, max: 32, unit: "px" },
      clients: SQUARE_CORNERS,
      ...grouped,
    },
  };
}

/** The one declaration those three props make, or none when there is no edge. */
export function borderStyles(props: Readonly<BorderProps>): {
  border?: string;
  borderRadius?: number;
} {
  return {
    ...(props.borderWidth === 0
      ? {}
      : {
          border: `${String(props.borderWidth)}px ${props.borderStyle} ${props.borderColor}`,
        }),
    ...(props.borderRadius === 0 ? {} : { borderRadius: props.borderRadius }),
  };
}

/**
 * The background every Block in this Preset carries.
 *
 * A surface is not a container's privilege: a heading wants a highlight behind
 * it, an image with transparency wants something to sit on, a footer line wants
 * to be a tinted band. So the prop is on every Definition here, and every one of
 * them puts it straight into a style — `SchemaKind.surface` is resolved before
 * `render` sees it, so a Block an Author has not styled receives `undefined`,
 * emits no declaration at all, and shows whatever is behind it (ADR-0019).
 *
 * The root and the button are the two that do not use this entry, because both
 * start at an actual colour rather than at nothing — the email needs a page
 * behind it, and a button with no fill is not a button. They declare the same
 * kind all the same: what makes a prop a surface is where its value lands, not
 * where it starts, and an Author may empty either one.
 */
export const BACKGROUND_COLOR: SchemaEntry<Surface> = {
  kind: SchemaKind.surface,
  label: "Background color",
  defaultValue: NONE,
};

/**
 * The space inside every Block but the root, one prop a side.
 *
 * Four props, each with its own Mobile Override, so a phone can loosen one
 * side and keep the rest (ADR-0024). Zero by default, because spacing is the
 * Author's to give rather than the library's to assume: a padding an Author
 * never asked for is one they have to find and undo. The divider is the one
 * exception, and says so where it calls this.
 */
const PADDING_SIDES = ["Top", "Right", "Bottom", "Left"] as const;
type PaddingSide = (typeof PADDING_SIDES)[number];
export type PaddingProps = {
  [TSide in PaddingSide as `padding${TSide}`]: number;
};

/** Each side, as a side of the padding Box (ADR-0040). */
const BOX_SIDE = {
  Top: "top",
  Right: "right",
  Bottom: "bottom",
  Left: "left",
} as const satisfies Record<PaddingSide, BoxSide>;

export function paddingSchema(
  group?: string,
  defaults: Partial<PaddingProps> = {},
): { [TKey in keyof PaddingProps]: SchemaEntry<number> } {
  const grouped = group === undefined ? {} : { group };
  const entry = (side: PaddingSide): SchemaEntry<number> => ({
    kind: SchemaKind.number,
    label: `${side} padding`,
    defaultValue: defaults[`padding${side}`] ?? 0,
    constraints: { min: 0, max: 96, unit: "px" },
    mobile: pixels(`padding-${side.toLowerCase()}`),
    box: "padding",
    side: BOX_SIDE[side],
    ...grouped,
  });
  return {
    paddingTop: entry("Top"),
    paddingRight: entry("Right"),
    paddingBottom: entry("Bottom"),
    paddingLeft: entry("Left"),
  };
}

/**
 * The padding a cell writes inline, as longhands, so a Mobile Override of one
 * side lines up with exactly one declaration. A side at zero writes nothing,
 * and so does one a Block does not have.
 */
export function paddingStyles(
  props: Readonly<Partial<PaddingProps>>,
): Partial<Record<keyof PaddingProps, number>> {
  return Object.fromEntries(
    PADDING_SIDES.map((side) => `padding${side}` as const)
      .filter((name) => props[name] !== undefined && props[name] !== 0)
      .map((name) => [name, props[name]]),
  );
}

/**
 * A migration that splits old padding props into the four sides, in `props`
 * and in `mobile` alike (ADR-0024). Each old key names the sides it becomes.
 * The old key goes, and a side its old key never set stays unset.
 */
export function splitPadding(
  splits: Readonly<Record<string, readonly PaddingSide[]>>,
): Migration {
  const split = (
    values: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> => {
    const next: Record<string, unknown> = { ...values };
    for (const [old, sides] of Object.entries(splits)) {
      if (!Object.hasOwn(values, old)) continue;
      const value = values[old];
      delete next[old];
      for (const side of sides) next[`padding${side}`] = value;
    }
    return next;
  };
  return ({ props, mobile }) =>
    mobile === undefined
      ? { props: split(props) }
      : { props: split(props), mobile: split(mobile) };
}

/**
 * The entries every leaf ends its Schema with: its padding, then which screens
 * it shows on. The divider is the one leaf that starts padded.
 */
export function leafSchema(padding: Partial<PaddingProps> = {}): {
  [TKey in keyof PaddingProps]: SchemaEntry<number>;
} & { showOn: SchemaEntry<string> } {
  return { ...paddingSchema(undefined, padding), showOn: SHOW_ON };
}

/**
 * The colour a heading's or text's words are in: the email's text colour
 * until the Author sets one (ADR-0022). The default is the Consumer's, so an
 * unusable email colour falls back to the same ink a new email starts in.
 */
export function textColorSchema(config: PresetDefaults): SchemaEntry<string> {
  return {
    kind: SchemaKind.color,
    label: "Color",
    follows: "textColor",
    defaultValue: config.textColor,
  };
}

/**
 * The weights a heading or text offers, named the way a type picker names
 * them. Stored as the number, which is what CSS writes.
 */
const FONT_WEIGHTS = [
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Extra bold", value: 800 },
] as const;

const LINE_HEIGHT = { min: 1, max: 2 } as const;
const LETTER_SPACING = { min: -2, max: 10 } as const;

/** Where a heading or text starts, before an Author sets either. */
export type TypographyDefaults = {
  readonly lineHeight: number;
  readonly fontWeight: number;
};

export type TypographyProps = {
  lineHeight: number;
  fontWeight: number;
  letterSpacing: number;
};

/**
 * Line height, weight and letter spacing, for a heading or text (#68).
 *
 * None is Overridable. A multiplier already scales with a phone's font size,
 * and the other two are part of the type's look, not its fit.
 */
export function typographySchema(defaults: TypographyDefaults): {
  [TKey in keyof TypographyProps]: SchemaEntry<number>;
} {
  return {
    lineHeight: {
      kind: SchemaKind.number,
      label: "Line height",
      defaultValue: defaults.lineHeight,
      constraints: { ...LINE_HEIGHT, step: 0.05 },
    },
    ...weightAndSpacingSchema(defaults.fontWeight),
  };
}

/** Weight and letter spacing alone, which the button's label takes too. */
export function weightAndSpacingSchema(fontWeight: number): {
  fontWeight: SchemaEntry<number>;
  letterSpacing: SchemaEntry<number>;
} {
  return {
    fontWeight: {
      kind: SchemaKind.select,
      label: "Weight",
      defaultValue: fontWeight,
      constraints: { options: FONT_WEIGHTS },
    },
    letterSpacing: {
      kind: SchemaKind.number,
      label: "Letter spacing",
      defaultValue: 0,
      constraints: { ...LETTER_SPACING, step: 0.5, unit: "px" },
    },
  };
}

/**
 * The three as the heading or each paragraph writes them.
 *
 * A stored value out of range is clamped and a weight off the list snaps to
 * the nearest, so a hand-edited Document still renders. The line height is a
 * percentage, for classic Outlook, and both elements size themselves at `1em`
 * so it is the same height. Zero letter spacing writes nothing.
 */
export function typographyStyles(
  props: Readonly<TypographyProps>,
  defaults: TypographyDefaults,
): { lineHeight: string; fontWeight: number; letterSpacing?: number } {
  const lineHeight = clamped(
    props.lineHeight,
    LINE_HEIGHT,
    defaults.lineHeight,
  );
  return {
    lineHeight: lineHeightPercent(lineHeight),
    ...weightAndSpacingStyles(props, defaults.fontWeight),
  };
}

/** Weight and letter spacing as `typographyStyles` writes them. */
export function weightAndSpacingStyles(
  props: Readonly<{ fontWeight: number; letterSpacing: number }>,
  fontWeight: number,
): { fontWeight: number; letterSpacing?: number } {
  const letterSpacing = clamped(props.letterSpacing, LETTER_SPACING, 0);
  return {
    fontWeight: nearestWeight(props.fontWeight, fontWeight),
    ...(letterSpacing === 0 ? {} : { letterSpacing }),
  };
}

/** A stored number held to a range, or the fallback when it is not one. */
export function clamped(
  value: unknown,
  range: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, range.min), range.max);
}

/** The listed weight closest to a stored one, the lighter on a tie. */
function nearestWeight(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  let nearest: number = FONT_WEIGHTS[0].value;
  for (const { value: weight } of FONT_WEIGHTS) {
    if (Math.abs(weight - value) < Math.abs(nearest - value)) nearest = weight;
  }
  return nearest;
}
