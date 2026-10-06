import { isResolvedAsset, type Asset } from "../core/document/assets";
import { isUsableColor, type BrandColor } from "../core/document/color";
import { rootColorOf } from "../core/document/props";
import {
  DEFAULT_FONT_STACK,
  isSafeFontStack,
  type Direction,
} from "../core/document/typography";
import { fontFaceCss, type ReactEmailWebFont } from "./web-font";

/** One font a Consumer offers an Author, by name. */
export interface ReactEmailFont {
  /** What the Author picks it by. */
  readonly label: string;
  /** The font stack the Document stores and the markup writes. */
  readonly stack: string;
  /**
   * The files that load this font for readers who do not have it installed.
   * Their family is the stack's first name. Best-effort: Gmail drops them and
   * classic Outlook never reads them, so the rest of the stack still matters.
   */
  readonly webFont?: ReactEmailWebFont;
}

export interface ReactEmailPresetOptions {
  /**
   * The font stack a new email starts in, and the one an email with no font
   * of its own renders in. A brand's typography is the first thing a Consumer
   * needs to change, and changing it must not mean forking the Preset.
   */
  readonly fontFamily?: string;
  /**
   * The other fonts an Author may pick for an email. The default is always
   * offered too, as "Default" unless it is listed here under a label of its
   * own (ADR-0021).
   */
  readonly fonts?: readonly ReactEmailFont[];
  /**
   * Your Brand Colours. Every colour and Surface entry offers them as
   * `constraints.brandColors`, and an Agent is told them on each colour prop. The
   * Document stores the colour, never the label, so any other colour still
   * works and changing this list leaves stored emails as they were.
   */
  readonly colors?: readonly ReactEmailColor[];
  /** Default content width, in pixels. */
  readonly contentWidth?: number;
  /** Default background colour behind the content Container. */
  readonly backgroundColor?: string;
  /**
   * The ink a new email starts in, and the one text and headings render in
   * when neither they nor the email set one. Defaults to `#333333`.
   */
  readonly textColor?: string;
  /**
   * The colour every link in text and headings is written in, when the email
   * sets none. Defaults to `#0b57d0`.
   */
  readonly linkColor?: string;
  /**
   * The language tag a new email starts in, such as `en` or `fr-CA`. Defaults
   * to `""`, no language: a wrong `lang` is worse than none.
   */
  readonly language?: string;
  /**
   * Which way a new email runs, `"ltr"` or `"rtl"`. Defaults to `"ltr"`. It
   * only seeds new Documents: one stored without a direction is `"ltr"`.
   */
  readonly direction?: Direction;
  /**
   * The icons an Author picks from for an icon row, such as your social
   * links. Each is already resolved, so picking one asks for no image
   * (ADR-0030). A new row starts with the first three. Defaults to none:
   * lekh ships no icon files.
   */
  readonly icons?: readonly ReactEmailIcon[];
}

/** One Brand Colour a Consumer offers an Author and an Agent, by name. */
export type ReactEmailColor = BrandColor;

/** One icon a Consumer offers an Author for an icon row (ADR-0030). */
export interface ReactEmailIcon {
  /** What the Author picks it by. */
  readonly label: string;
  /** The image, already at a durable location with its real size. */
  readonly asset: Asset;
  /** Where a new row's icon links to, when it starts as this one. */
  readonly href?: string;
}

/** A labelled choice, as a `select` Schema entry offers one. */
interface FontOption {
  readonly label: string;
  readonly value: string;
}

/** Preset options with every default filled in. */
export interface PresetDefaults {
  readonly fontFamily: string;
  /** Every font on offer, the default among them. */
  readonly fonts: readonly FontOption[];
  /** The `@font-face` rules each listed stack loads, by stack. */
  readonly fontFaces: ReadonlyMap<string, string>;
  /** The Brand Colours, as every colour and Surface entry offers them. */
  readonly colors: readonly BrandColor[];
  readonly contentWidth: number;
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly linkColor: string;
  readonly language: string;
  readonly direction: Direction;
  readonly icons: readonly ReactEmailIcon[];
}

/**
 * Fill in every default, and refuse an option the Preset could never use.
 *
 * It throws here, where the Consumer sees it, rather than flagging every email
 * an Author makes.
 */
export function presetDefaults(
  options: ReactEmailPresetOptions,
): PresetDefaults {
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_STACK;
  // A stack the root can never render would flag every email, with a Repair
  // that puts back the same stack. So it fails here, where the Consumer sees it.
  for (const { label, stack } of [
    { label: "fontFamily", stack: fontFamily },
    ...(options.fonts ?? []),
  ]) {
    if (!isSafeFontStack(stack)) {
      throw new Error(
        `The font "${label}" is not a safe font stack: ${JSON.stringify(stack)}`,
      );
    }
  }
  const fontFaces = webFontsOf(options.fonts ?? []);
  // The same reasoning for the email's colours: a default the root cannot use
  // would be passed over for itself, and flagged on every email.
  const colors = {
    textColor: options.textColor ?? "#333333",
    linkColor: options.linkColor ?? "#0b57d0",
  };
  for (const [name, color] of Object.entries(colors)) {
    if (!isUsableColor(color)) {
      throw new Error(
        `The ${name} is not a color that can be written: ${JSON.stringify(color)}`,
      );
    }
  }
  // A Brand Colour is written as it stands the moment an Author picks it, so
  // one that could never be written fails here rather than in their email.
  const brand = options.colors ?? [];
  for (const { label, value } of brand) {
    if (!isUsableColor(value)) {
      throw new Error(
        `The color "${label}" is not a color that can be written: ` +
          JSON.stringify(value),
      );
    }
  }
  // A listed icon goes into the Document with no Image Request, so it is
  // checked once, here (ADR-0030).
  const icons = options.icons ?? [];
  for (const { label, asset } of icons) {
    if (!isResolvedAsset(asset)) {
      throw new Error(
        `The icon "${label}" needs a src and a positive width and height: ` +
          JSON.stringify(asset),
      );
    }
  }
  return {
    fontFamily,
    fonts: fontOptions(fontFamily, options.fonts ?? []),
    fontFaces,
    colors: brand,
    contentWidth: options.contentWidth ?? 600,
    backgroundColor: options.backgroundColor ?? "#f6f6f6",
    ...colors,
    language: options.language ?? "",
    direction: options.direction ?? "ltr",
    icons,
  };
}

/**
 * The `@font-face` rules of every listed font that loads a web font, by stack.
 *
 * A stack listed twice must load the same thing both times: the root looks it
 * up by stack alone, so it could not say which one the Author picked.
 */
function webFontsOf(
  fonts: readonly ReactEmailFont[],
): ReadonlyMap<string, string> {
  const css = new Map<string, string>();
  const loaded = new Map<string, string>();
  for (const { label, stack, webFont } of fonts) {
    const same = JSON.stringify(webFont ?? null);
    const before = loaded.get(stack);
    if (before !== undefined && before !== same) {
      throw new Error(
        `The font "${label}" lists a stack already listed with a different ` +
          `web font: ${JSON.stringify(stack)}`,
      );
    }
    loaded.set(stack, same);
    if (webFont !== undefined)
      css.set(stack, fontFaceCss(label, stack, webFont));
  }
  return css;
}

/**
 * The fonts an Author picks from, as `select` options. The default goes first
 * unless the Consumer listed it, in which case their label and order win.
 */
function fontOptions(
  fontFamily: string,
  fonts: readonly ReactEmailFont[],
): readonly FontOption[] {
  const all = fonts.some((font) => font.stack === fontFamily)
    ? fonts
    : [{ label: "Default", stack: fontFamily }, ...fonts];
  return all.map((font) => ({ label: font.label, value: font.stack }));
}

/**
 * The email's width, read by a Block that is not the root.
 *
 * Every container in this Preset paints edge to edge and keeps its content in a
 * column of this width, so each of them needs a number the root owns. It is
 * read defensively rather than typed: a Consumer may register their own root,
 * and a Preset's Section should degrade to the width it was configured with
 * rather than throw inside a render.
 */
export function contentWidthOf(
  rootProps: Readonly<Record<string, unknown>>,
  config: PresetDefaults,
): number {
  const width = rootProps["contentWidth"];
  return typeof width === "number" ? width : config.contentWidth;
}

/**
 * The colour every link in a Block's text is written in: the root's when it is
 * one that can be written, otherwise the Preset's default (ADR-0022).
 *
 * Read off the root rather than followed through a Schema entry, because no
 * Block here has a link colour of its own to set.
 */
export function linkColorOf(
  rootProps: Readonly<Record<string, unknown>>,
  config: PresetDefaults,
): string {
  return rootColorOf(rootProps, "linkColor") ?? config.linkColor;
}
