/**
 * Responsiveness, split in two (ADR-0007).
 *
 * **Structural behaviour** — stacking columns, reversing their order, hiding a
 * Block on a small screen — is an ordinary boolean prop. A Block Definition
 * asks for a fixed class by name and the root emits one stylesheet. No
 * per-Block machinery, and nothing here has to know which props a Consumer
 * called what.
 *
 * **Mobile Overrides** — this headline is smaller on phones — need a generated
 * class per Block, collected while the Document renders and emitted into the
 * same stylesheet. They are allowed only on props whose Schema opts in by
 * declaring a `mobile` declaration, realistically font size, padding and alignment.
 *
 * Both halves are forced with `!important`, because a Block Definition's own
 * inline styles otherwise beat every rule in a stylesheet — which is the whole
 * reason this file exists rather than the values simply being resolved.
 */

import type { ReactElement } from "react";

import { surfaceColor } from "../document/color";
import {
  SchemaKind,
  type BlockDefinition,
  type SchemaEntry,
} from "../document/definition";
import type { Block } from "../document/document";
import { classSafe, isSafeDeclaration } from "../markup/markup-safety";
import { walk } from "../document/tree";

/** Which form factor the Author is currently editing. */
export type Stage = "desktop" | "mobile";

/**
 * Whether a Schema entry opted its prop in to Mobile Overrides.
 *
 * The one statement of the rule. Resolution, the Inspector, the write path and
 * the stylesheet all judge against this, so a Definition's `mobile` is the
 * single thing that decides whether a prop has a mobile life at all (ADR-0007).
 */
export function isOverridable(entry: SchemaEntry): boolean {
  return entry.mobile !== undefined;
}

/**
 * A Block's Mobile Override for one prop, or `undefined` when it does not count.
 *
 * An override stored for a prop that is not Overridable is inert: a Definition
 * that has since dropped its `mobile` leaves values behind, and there is no CSS
 * to emit for them. They are kept on the Block rather than deleted, because a
 * Definition may change its mind back.
 */
export function overrideOf(
  block: Block,
  name: string,
  entry: SchemaEntry,
): unknown {
  return isOverridable(entry) ? block.mobile?.[name] : undefined;
}

/**
 * The one breakpoint, in pixels. A viewport this wide or narrower gets the
 * mobile rules.
 *
 * Below the narrowest content width a desktop email is built at, and above the
 * widest phone held in portrait. Both edges matter: the Canvas renders the email
 * in a frame exactly as wide as the email, so a breakpoint at the usual 600
 * would fire on the desktop Stage and every email would look like the phone one.
 *
 * Arbitrary breakpoints are deliberately not offered: Outlook on the desktop
 * ignores media queries entirely, and every other client is either a phone or a
 * wide window (ADR-0007).
 */
export const MOBILE_MAX_WIDTH = 480;

/**
 * How a prop's Mobile Override becomes CSS — a Schema entry's `mobile`.
 *
 * Declaring one is what opts a Schema entry in to being overridable: a prop
 * without it never appears on the mobile Stage, because there would be nothing
 * to emit for it. Return ordinary declarations keyed by CSS property — the
 * `!important` every one of them needs is added by the library, not by the
 * Consumer.
 *
 * The second argument is the root's resolved props, the same ones `render`
 * reads as `rootProps` (ADR-0017). Most declarations ignore it. An alignment
 * needs it, because `start` is a different side in a right-to-left email
 * (ADR-0027).
 *
 * ```ts
 * const pixels: MobileDeclarations<number> = (size) => ({ "font-size": `${size}px` });
 * ```
 */
export type MobileDeclarations<TValue = unknown> = (
  value: TValue,
  rootProps: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, string>>;

/**
 * The structural behaviours the library ships a class for.
 *
 * Both are element-local: `stack` makes the element it is on a full-width
 * column, `hide` takes it off a small screen. Neither says anything about the
 * markup around it, which is what lets any Block Definition ask for them
 * whatever it renders.
 *
 * Anything that *does* depend on the markup around it — reversing the order of a
 * row's columns needs the element whose children those columns are — belongs
 * with the Block that owns that markup, emitted through `add`. See the Preset's
 * `columns` Block.
 */
export const MOBILE_CLASSES = {
  stack: "lekh-stack",
  hide: "lekh-hidden",
} as const;

/** One of the structural behaviours a Block Definition can ask for by name. */
export type MobileStructure = keyof typeof MOBILE_CLASSES;

/**
 * What stacking does on a small screen: an inline-block column at full width —
 * the technique responsive email settled on, because it makes a `<td>`
 * full-width without disturbing the table anatomy around it.
 *
 * Exported for a Block that stacks markup it owns rather than the element the
 * class is on, as the Preset's `columns` stacks its cells.
 */
export const STACK_DECLARATIONS =
  "{display:inline-block!important;width:100%!important;" +
  "max-width:100%!important;box-sizing:border-box!important}";

/** What each structural class does on a small screen. */
const STRUCTURAL_RULES: Readonly<Record<MobileStructure, string>> = {
  stack: `.${MOBILE_CLASSES.stack}${STACK_DECLARATIONS}`,
  hide: `.${MOBILE_CLASSES.hide}{display:none!important}`,
};

/**
 * The class on the wrapper `mobile.only` builds (ADR-0025).
 *
 * Not one of `MOBILE_CLASSES`, because it is not element-local. The reveal
 * sets `display` back to `block`, which is right only for the `<div>` the
 * library wraps round a Block, so a Definition gets the wrapper and never the
 * class on its own.
 */
export const MOBILE_ONLY_CLASS = "lekh-mobile-only";

/**
 * How the wrapper hides on every screen the reveal does not reach.
 *
 * Inline, because a client that strips the `<style>` must still hide it. The
 * height and overflow are for the clients that ignore `display:none`.
 */
export const MOBILE_ONLY_HIDING = {
  display: "none",
  maxHeight: 0,
  overflow: "hidden",
} as const;

/** What undoes the inline hiding inside the media query. */
const REVEAL_RULE =
  `.${MOBILE_ONLY_CLASS}{display:block!important;max-height:none!important;` +
  `overflow:visible!important}`;

/** Fixed emission order, so the stylesheet does not depend on render order. */
const STRUCTURE_ORDER: readonly MobileStructure[] = ["hide", "stack"];

/**
 * Everything that has to end up in the one mobile stylesheet, gathered as the
 * Document renders.
 *
 * Per-Block Override rules are worked out up front — they follow from the
 * Document alone — while structural classes and a Block's own bespoke rules
 * arrive as each Definition renders and asks for them. A Block renders before
 * its parent, so by the time the root renders the collection is complete, which
 * is what lets the root emit the whole stylesheet in its head.
 */
export interface MobileRules {
  /** The Overrides class for a Block, or `undefined` when it carries none. */
  readonly classOf: (blockId: string) => string | undefined;
  /** Ask for structural classes by name, marking their rules as needed. */
  readonly use: (...structures: readonly MobileStructure[]) => string;
  /** Contribute bespoke rules, already inside the media query. */
  readonly add: (css: string) => void;
  /**
   * Mark the mobile-only reveal rule as needed, and return its class. The
   * wrapper's business, so a Definition is handed `only` instead.
   */
  readonly reveal: () => string;
  /** Every collected rule in one media query. Empty when nothing needs one. */
  readonly stylesheet: () => string;
}

/**
 * What a Block Definition is handed for its own responsive behaviour.
 *
 * The same collection every Block shares, plus the one thing that is this
 * Block's alone: the class its Mobile Overrides were emitted under.
 */
export interface MobileRenderContext extends Omit<
  MobileRules,
  "classOf" | "reveal"
> {
  /**
   * The class carrying this Block's Mobile Overrides, or `undefined` when it
   * has none. Put it on the element the overrides should style — the same
   * element whose inline styles they are overriding.
   *
   * The one thing here that is this Block's alone. Looking another Block's class
   * up is the collection's business, so `classOf` is not passed on.
   */
  readonly className: string | undefined;
  /**
   * Show an element on a phone and nowhere else (ADR-0025).
   *
   * Hand it everything the Block rendered. It comes back inside a `<div>` that
   * is hidden inline and shown by a rule in the media query, with the markup
   * kept out of Outlook on the desktop as well. Call it only when the Block is
   * mobile-only, because calling it is what puts the rule in the stylesheet.
   *
   * Where the `<style>` is stripped the rule never fires, so the content is
   * never seen there. It must not be the only copy of anything.
   */
  readonly only: (element: ReactElement) => ReactElement;
}

/**
 * One Block's Mobile Overrides, as the rule they will be emitted as.
 *
 * Declarations are already forced and already checked — what is here is what
 * reaches the stylesheet, so a caller can assert on it without serialising.
 */
export interface MobileOverrideRule {
  readonly blockId: string;
  /** The class the rule is emitted under, and the one that Block must carry. */
  readonly className: string;
  /** CSS property and value pairs, in Schema order. */
  readonly declarations: readonly (readonly [string, string])[];
}

/**
 * The Mobile Override rules a Document implies.
 *
 * The half of the stylesheet that follows from the Document alone, worked out
 * before anything renders — which is what lets every Block know its class in
 * time to put it on the element its Overrides have to beat.
 *
 * Deterministic: the same Document produces the same classes and the same rules
 * in the same order every time, because a stored render that changed between
 * identical calls could not be diffed.
 */
export function overrideRulesOf(
  root: Block,
  lookup: (type: string) => BlockDefinition | undefined,
  rootProps: Readonly<Record<string, unknown>>,
): readonly MobileOverrideRule[] {
  const rules: MobileOverrideRule[] = [];

  walk(root, (block) => {
    const declarations = overrideDeclarationsOf(
      block,
      lookup(block.type),
      rootProps,
    );
    if (declarations.length === 0) return;
    rules.push({
      blockId: block.id,
      className: mobileClassOf(block.id),
      declarations,
    });
  });

  return rules;
}

/**
 * Work out the Mobile Override rules a Document needs, and start collecting the
 * rest.
 *
 * `rootProps` are the root's resolved props, the same ones every Block renders
 * against, so an Override resolves as its inline value did.
 */
export function collectMobileRules(
  root: Block,
  lookup: (type: string) => BlockDefinition | undefined,
  rootProps: Readonly<Record<string, unknown>>,
): MobileRules {
  const rules = overrideRulesOf(root, lookup, rootProps);
  const classes = new Map(rules.map((rule) => [rule.blockId, rule.className]));
  const overrides = rules.map(
    (rule) =>
      `.${rule.className}{${rule.declarations
        .map(([property, value]) => `${property}:${value}`)
        .join(";")}}`,
  );

  const structures = new Set<MobileStructure>();
  let revealed = false;
  // A Set, as `use` already is: two Blocks asking for the same rule want it in
  // the stylesheet, not in it twice. Iteration order is first emission, which is
  // render order — deterministic for a given Document.
  const bespoke = new Set<string>();

  return {
    classOf: (blockId) => classes.get(blockId),

    use: (...names) => {
      for (const name of names) structures.add(name);
      return names.map((name) => MOBILE_CLASSES[name]).join(" ");
    },

    // Unescaped, unlike an Override: this is CSS a Block Definition wrote, and
    // trimmed so that two spellings of one rule are one rule (ADR-0012).
    add: (css) => {
      const rule = css.trim();
      if (rule !== "") bespoke.add(rule);
    },

    reveal: () => {
      revealed = true;
      return MOBILE_ONLY_CLASS;
    },

    stylesheet: () => {
      const body = [
        ...STRUCTURE_ORDER.filter((name) => structures.has(name)).map(
          (name) => STRUCTURAL_RULES[name],
        ),
        ...(revealed ? [REVEAL_RULE] : []),
        ...bespoke,
        // Overrides last: one Block's own value must beat a generic structural
        // rule, and both are forced, so the later of the two wins.
        ...overrides,
      ].join("");

      // A Document that uses none of this carries no stylesheet at all.
      return body === ""
        ? ""
        : `@media only screen and (max-width:${String(MOBILE_MAX_WIDTH)}px){${body}}`;
    },
  };
}

/**
 * The Mobile Override context for one Block.
 *
 * `only` is handed in rather than built here, because the wrapper differs
 * between the render path and the Canvas (`RenderPolicy.mobileOnly`).
 */
export function mobileRenderContext(
  rules: MobileRules,
  blockId: string,
  only: (element: ReactElement) => ReactElement,
): MobileRenderContext {
  const { use, add, stylesheet } = rules;
  return { use, add, stylesheet, only, className: rules.classOf(blockId) };
}

/**
 * The stylesheet the collected rules amount to, ready for a root Block's head.
 *
 * A component rather than a bare string because CSS put through React as a text
 * child comes out with its `>` and `&` escaped, which silently breaks any rule
 * a Block Definition emitted with a descendant selector in it. Renders nothing
 * when no rule was collected, so a simple email carries no dead stylesheet.
 */
export function MobileStyles({
  css,
}: {
  readonly css: string;
}): ReactElement | null {
  return css === "" ? null : (
    // oxlint-disable-next-line react/no-danger
    <style dangerouslySetInnerHTML={{ __html: css }} />
  );
}

/**
 * Join class names, dropping the ones that are not there.
 *
 * `undefined` rather than `""` when nothing is left, so a Block that asked for
 * no responsive behaviour emits no `class` attribute at all.
 */
export function classNames(
  ...names: readonly (string | false | undefined)[]
): string | undefined {
  const present = names.filter(
    (name) => typeof name === "string" && name !== "",
  );
  return present.length === 0 ? undefined : present.join(" ");
}

/**
 * The class a Block's Mobile Overrides are emitted under.
 *
 * Derived from the Block's own identity rather than from a counter, so adding
 * an override to one Block does not renumber every Block after it.
 *
 * Escaped rather than stripped, because two Blocks must never land on one class:
 * replacing every awkward character with a dash would put `a.b` and `a-b` on the
 * same rule, and an Author would change one heading and watch another move.
 */
function mobileClassOf(blockId: string): string {
  return `lekh-m-${classSafe(blockId)}`;
}

/**
 * One Block's Override declarations, empty when it has none that count.
 *
 * Walks the Schema rather than the stored overrides, so the declarations come
 * out in Schema order whatever order they were written in, and so an override
 * left behind for a prop that is no longer Overridable emits nothing.
 */
function overrideDeclarationsOf(
  block: Block,
  definition: BlockDefinition | undefined,
  rootProps: Readonly<Record<string, unknown>>,
): readonly (readonly [string, string])[] {
  if (!block.mobile || !definition) return [];

  const declarations: (readonly [string, string])[] = [];
  for (const [name, entry] of Object.entries(definition.schema)) {
    const value = overrideOf(block, name, entry);
    if (value === undefined) continue;

    // The second of the two paths a surface prop has to CSS, and the reason
    // the substitution is not simply done where a Definition renders: this one
    // never goes near `render`. An Override of `none` handed to `mobile` would
    // emit `background-color: none !important`, which `isSafeDeclaration`
    // below has no reason to catch — it guards against a value closing the
    // rule, not against a value being the wrong colour. See ADR-0019.
    if (
      entry.kind === SchemaKind.surface &&
      surfaceColor(value) === undefined
    ) {
      continue;
    }

    // The same `mobile` that made the prop Overridable, so the optional call
    // only ever resolves one way — but it is called through the Schema entry
    // rather than captured, because it is declared as a method.
    const declared = entry.mobile?.(value, rootProps);
    if (declared === undefined) continue;

    // An Override is stored data, and a Schema's `mobile` is the right place
    // to constrain it to the handful of values it can be. This is the backstop
    // for one that forgot: the same check an HTML Block's styles pass.
    for (const [property, css] of Object.entries(declared)) {
      if (!isSafeDeclaration(property, css)) continue;
      declarations.push([property, forced(css)]);
    }
  }
  return declarations;
}

/** A declaration value that beats an inline style, however it arrived. */
function forced(value: string): string {
  return `${value.replace(/\s*!\s*important\s*$/iu, "").trimEnd()}!important`;
}
