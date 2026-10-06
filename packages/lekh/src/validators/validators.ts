/**
 * The shipped Validators, on `lekh`.
 *
 * Three heuristics a Consumer opts into: text too small to read, text hidden
 * against its background, and links that go nowhere. Nothing here is wired up
 * by default — an editor given no Validators reports none.
 *
 * All default to `warning`. A heuristic that misfires must never stop a
 * legitimate send, and error-severity Diagnostics stop the render path dead
 * (ADR-0006). A Consumer whose product is regulated enough to want them
 * enforced escalates them, either here or through the editor's severity map.
 *
 * Pure and DOM-free, like everything else the render path can reach: these are
 * the same Validators on both sides of the editor/send line.
 */

import { contrastRatio, parseColor, type Color } from "../core/document/color";
import type { BlockDefinition } from "../core/document/definition";
import { SchemaKind } from "../core/document/definition";
import type {
  Diagnostic,
  Severity,
  Validator,
} from "../core/validate/diagnostic";
import type { Block } from "../core/document/document";
import { surfaceBehind, type Painted } from "../core/document/behind";
import { resolveProps, rootPropsOf } from "../core/document/props";
import { linkProblem, type LinkProblem } from "../core/validate/link";
import type { SetPropRepair } from "../core/validate/repair";
import { childrenOf, collectBlocks } from "../core/document/tree";
import { unreachable } from "../core/editor/unreachable";

/**
 * Every code these Validators raise, keyed by the code in camelCase. A code
 * names its subject first.
 */
export const ValidatorDiagnostic = {
  /** Text does not stand out enough from what is behind it. */
  contrastTooLow: "contrast-too-low",
  /** Text is smaller than the minimum a Consumer set. */
  fontSizeTooSmall: "font-size-too-small",
  /** A link has nothing in it to go to, like `https://` or `#`. */
  urlEmpty: "url-empty",
  /** A link has no scheme, like `example.com`. */
  urlNoScheme: "url-no-scheme",
  /** A link's scheme is misspelled or malformed, like `htps://` or `http:/`. */
  urlBadScheme: "url-bad-scheme",
} as const;

/** Below this, a phone in daylight is guesswork. */
const DEFAULT_MINIMUM_FONT_SIZE = 12;
/** WCAG AA for body text. */
const DEFAULT_MINIMUM_RATIO = 4.5;

export interface MinimumFontSizeOptions {
  /** Smallest acceptable size, in pixels. Defaults to 12. */
  readonly minimum?: number;
  /** Defaults to `"warning"`. */
  readonly severity?: Severity;
  /**
   * Which props hold a font size. Defaults to `["fontSize"]`, which is what the
   * built-in Preset calls it — a Consumer whose Blocks call it something else
   * says so here rather than forking the Validator.
   */
  readonly props?: readonly string[];
}

/**
 * Catch text too small to read, on either Stage.
 *
 * A Mobile Override is checked as well as the stored value, because the mobile
 * Stage is exactly where a font size gets shrunk — and a value only an Author
 * on a phone will ever see is the one least likely to be noticed.
 */
export function minimumFontSize(
  options: MinimumFontSizeOptions = {},
): Validator {
  const minimum = options.minimum ?? DEFAULT_MINIMUM_FONT_SIZE;
  const severity = options.severity ?? "warning";
  const props = options.props ?? ["fontSize"];

  return (document, context) => {
    const found: Diagnostic[] = [];
    // What a Block that follows the root resolves against (ADR-0022), so a
    // colour judged here is the colour that renders.
    const rootProps = rootPropsOf(document.root, (type) =>
      context.getDefinition(type),
    );

    const report = (
      block: Block,
      prop: string,
      size: unknown,
      onMobile: boolean,
    ): void => {
      if (typeof size !== "number" || !Number.isFinite(size)) return;
      if (size >= minimum) return;
      found.push({
        code: ValidatorDiagnostic.fontSizeTooSmall,
        message:
          `Text at ${String(size)}px${onMobile ? " on mobile" : ""} is ` +
          `smaller than the ${String(minimum)}px minimum.`,
        severity,
        blockId: block.id,
        prop,
        // A mobile value that differs is the Mobile Override's alone.
        ...(onMobile ? { stage: "mobile" as const } : {}),
      });
    };

    for (const block of collectBlocks(document.root)) {
      // Nothing may judge data the editor does not understand, and the
      // Document already reports an unregistered Block as unrenderable.
      const definition = context.getDefinition(block.type);
      if (!definition) continue;

      const desktop = resolveProps(block, definition, { rootProps });
      const mobile = resolveProps(block, definition, {
        stage: "mobile",
        rootProps,
      });

      for (const prop of props) {
        if (!Object.hasOwn(definition.schema, prop)) continue;
        report(block, prop, desktop[prop], false);
        // Only when the Override actually says something different, or every
        // Block would report its one font size twice.
        if (mobile[prop] !== desktop[prop]) {
          report(block, prop, mobile[prop], true);
        }
      }
    }

    return found;
  };
}

export interface MinimumContrastOptions {
  /** Smallest acceptable contrast ratio. Defaults to 4.5, WCAG AA body text. */
  readonly ratio?: number;
  /** Defaults to `"warning"`. */
  readonly severity?: Severity;
  /** Which prop holds a Block's text colour. Defaults to `"color"`. */
  readonly colorProp?: string;
}

/**
 * Catch text that disappears into what is behind it — an unsubscribe link in
 * pale grey on white, a heading that survived a change of section colour.
 *
 * Each text colour is read against the Surface really behind it: the one its
 * Schema entry names with `on`, or else the nearest beneath it that is not
 * None. A Block's Surfaces stack in Schema order, the last on top, so a
 * Section's column is read before its band.
 *
 * **It stays silent whenever it cannot be sure.** A background image between
 * the text and the Surface, a value that is not a colour this can read — a
 * gradient, a variable, a named colour, a partly transparent one — or nothing
 * beneath with a colour at all produces no Diagnostic. That is a contract, not
 * a gap: this Validator is one a Consumer may escalate to an error, and a guess
 * that blocked a send would be worse than anything it could catch.
 *
 * Desktop values only, unlike the font size check above. A Mobile Override
 * exists only for a prop whose Schema opted in, and ADR-0007 keeps that to font
 * size, padding and alignment — a colour that changes with the Stage is not
 * something this library emits.
 *
 * Each finding carries a Repair when one exists: the same text colour moved far
 * enough towards black or white to clear the minimum, whichever moves it less.
 * The text and never the Surface, because the Surface is the more deliberate
 * of the two — a brand colour an Author picked for a Section is not something a
 * warning about one line of copy should repaint. A ratio no pure black or white
 * can reach against that Surface, which a mid-grey does to 4.5:1, gets a
 * Diagnostic and no Repair rather than one that lands short.
 */
export function minimumContrast(
  options: MinimumContrastOptions = {},
): Validator {
  const minimum = options.ratio ?? DEFAULT_MINIMUM_RATIO;
  const severity = options.severity ?? "warning";
  const colorProp = options.colorProp ?? "color";

  return (document, context) => {
    const found: Diagnostic[] = [];
    // What a Block that follows the root resolves against (ADR-0022), so a
    // colour judged here is the colour that renders.
    const rootProps = rootPropsOf(document.root, (type) =>
      context.getDefinition(type),
    );

    const visit = (block: Block, above: readonly Painted[]): void => {
      const definition = context.getDefinition(block.type);
      const props = resolveProps(
        block,
        definition,
        block === document.root ? {} : { rootProps },
      );
      const trail = [...above, { definition, props }];
      const next = (): void => {
        for (const child of childrenOf(block)) visit(child, trail);
      };
      // Nothing is known about what an unregistered Block draws, though a
      // descendant that paints its own is still judgeable.
      if (!definition || !Object.hasOwn(definition.schema, colorProp)) {
        next();
        return;
      }

      const foreground = parseColor(props[colorProp]);
      const background =
        foreground.kind === "opaque"
          ? surfaceBehind(trail, colorProp)?.color
          : undefined;

      if (
        background !== undefined &&
        foreground.kind === "opaque" &&
        carriesText(definition, props)
      ) {
        const ratio = contrastRatio(foreground.color, background);
        if (ratio < minimum) {
          // Only when one demonstrably works: the same rule as the silence
          // above, applied to the fix rather than the finding.
          const legible = readableAgainst(
            foreground.color,
            background,
            minimum,
          );
          const repair: SetPropRepair | undefined = legible && {
            kind: "set-prop",
            blockId: block.id,
            prop: colorProp,
            value: hex(legible),
            // Contrast is judged on desktop, so the fix is the desktop value.
            stage: "desktop",
          };

          found.push({
            code: ValidatorDiagnostic.contrastTooLow,
            message: `${subject(definition.label)} is ${howBad(ratio)}.`,
            severity,
            blockId: block.id,
            prop: colorProp,
            ...(repair ? { repair } : {}),
          });
        }
      }

      next();
    };

    visit(document.root, []);
    return found;
  };
}

export interface WorkingLinksOptions {
  /** Defaults to `"warning"`. */
  readonly severity?: Severity;
}

/**
 * Catch a link that goes nowhere, or not where it was meant to: one with
 * nothing in it, one with no scheme, and one whose scheme is a typo.
 *
 * Every `SchemaKind.url` prop is judged, as it is stored, the same as
 * `url-unsafe`. A link this cannot be sure of passes, so `mailto:`, `tel:`, a
 * relative link and a merge tag are left alone, and an attack is `url-unsafe`'s
 * alone. A misspelled scheme is one the render path drops, so it is both: the
 * Repair here is the one worth taking, and it clears the two.
 *
 * A blank link is not judged. Whether a Block needs one is the Block's to say:
 * an image without a link is fine, and the Preset's button reports its own.
 *
 * Desktop values only, like the contrast check: ADR-0007 keeps Mobile
 * Overrides to font size, padding and alignment.
 */
export function workingLinks(options: WorkingLinksOptions = {}): Validator {
  const severity = options.severity ?? "warning";

  return (document, context) => {
    const found: Diagnostic[] = [];

    for (const block of collectBlocks(document.root)) {
      const definition = context.getDefinition(block.type);
      if (!definition) continue;

      for (const [prop, entry] of Object.entries(definition.schema)) {
        if (entry.kind !== SchemaKind.url) continue;
        const value = block.props[prop];
        if (typeof value !== "string") continue;
        const problem = linkProblem(value);
        if (!problem) continue;

        // An empty link has no address to guess at.
        const repair: SetPropRepair | undefined =
          problem.kind === "empty"
            ? undefined
            : {
                kind: "set-prop",
                blockId: block.id,
                prop,
                value: problem.fixed,
                // Links are judged on desktop, so the fix is the desktop value.
                stage: "desktop",
              };

        found.push({
          code: LINK_CODES[problem.kind],
          message: linkMessage(entry.label, problem),
          severity,
          blockId: block.id,
          prop,
          ...(repair ? { repair } : {}),
        });
      }
    }

    return found;
  };
}

const LINK_CODES = {
  empty: ValidatorDiagnostic.urlEmpty,
  "no-scheme": ValidatorDiagnostic.urlNoScheme,
  "bad-scheme": ValidatorDiagnostic.urlBadScheme,
} as const;

function linkMessage(label: string, problem: LinkProblem): string {
  switch (problem.kind) {
    case "empty":
      return `"${label}" is a link to nowhere.`;
    case "no-scheme":
      return `"${label}" needs https:// in front, or it may not open.`;
    case "bad-scheme":
      return `"${label}" has a typo in its https://.`;
    default:
      return unreachable(problem);
  }
}

/**
 * How bad it looks, in words rather than in a ratio.
 *
 * A contrast ratio is the precise part of this finding and the least useful
 * one: an Author reading `1.2:1` has no way to tell whether that is a shade too
 * pale or text nobody will ever see. It is left out of the message entirely —
 * a Consumer who wants it back has the code to key their own wording off, and
 * a panel showing twenty of these is read by scanning rather than by studying
 * one.
 */
function howBad(ratio: number): string {
  if (ratio < 2) return "almost invisible";
  if (ratio < 3) return "very hard to read";
  return "hard to read";
}

/**
 * What the sentence is about: the Block's own name, and the word "text" unless
 * its name already carries it.
 *
 * "Button text is hard to read" needs the noun to say that the label rather
 * than the fill is the problem. The Preset's text Block is already called
 * Text, and "Text text" reads like a typo.
 */
function subject(label: string): string {
  return label.toLowerCase().endsWith("text") ? label : `${label} text`;
}

/** A Colour as the six-digit hex an Author's colour control writes. */
function hex({ red, green, blue }: Color): string {
  return `#${digits(red)}${digits(green)}${digits(blue)}`;
}

function digits(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, "0");
}

const BLACK: Color = { red: 0, green: 0, blue: 0 };
const WHITE: Color = { red: 255, green: 255, blue: 255 };

/** How finely the walk towards black or white is sampled. */
const STEPS = 100;

/**
 * The nearest version of a text colour that clears the minimum, or nothing when
 * neither end of the scale reaches it.
 *
 * Stepped rather than solved for, because contrast against a fixed background
 * is not monotonic as a colour moves: text darkening towards a dark background
 * gets worse before it gets better, and a bisection would find the wrong side
 * of that dip. A hundred steps of a ratio this cheap costs nothing and cannot
 * be fooled.
 */
function readableAgainst(
  text: Color,
  background: Color,
  minimum: number,
): Color | undefined {
  let best: { readonly color: Color; readonly moved: number } | undefined;

  for (const target of [BLACK, WHITE]) {
    for (let step = 1; step <= STEPS; step++) {
      const moved = step / STEPS;
      const candidate = mix(text, target, moved);
      if (contrastRatio(candidate, background) < minimum) continue;
      // The first hit in this direction is the smallest change it offers, so
      // the rest of the walk has nothing left to say.
      if (!best || moved < best.moved) best = { color: candidate, moved };
      break;
    }
  }

  return best?.color;
}

/** One colour moved part of the way towards another. */
function mix(from: Color, to: Color, amount: number): Color {
  const channel = (start: number, end: number): number =>
    Math.round(start + (end - start) * amount);
  return {
    red: channel(from.red, to.red),
    green: channel(from.green, to.green),
    blue: channel(from.blue, to.blue),
  };
}

/**
 * Whether a Block renders text worth reading.
 *
 * Contrast is about text, so a Block with a colour prop and nothing to say —
 * the Preset's divider is a `#e6e6e6` hairline on white — is not a finding. Nor
 * is a text Block an Author has emptied.
 */
function carriesText(
  definition: BlockDefinition,
  props: Readonly<Record<string, unknown>>,
): boolean {
  for (const [name, entry] of Object.entries(definition.schema)) {
    if (entry.kind !== SchemaKind.richText && entry.kind !== SchemaKind.text)
      continue;
    const value = props[name];
    if (typeof value !== "string") continue;
    // Rich text is inline markup, so the tags come out before the question of
    // whether anything is left.
    if (value.replaceAll(/<[^>]*>/gu, "").trim() !== "") return true;
  }
  return false;
}
