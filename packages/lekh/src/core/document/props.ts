import { isUsableColor, surfaceColor } from "./color";
import {
  SchemaKind,
  type BlockDefinition,
  type SchemaEntry,
} from "./definition";
import type { ValidationContext } from "../validate/diagnostic";
import type { Block } from "./document";
import { htmlScopeOf, sanitiseHtml } from "../markup/html";
import { overrideOf, type Stage } from "../layout/responsive";
import { safeUrl } from "../markup/markup-safety";

/** What resolving a Block's props needs beyond the Block and its Definition. */
export interface ResolveOptions {
  /** Defaults to the desktop Stage. */
  readonly stage?: Stage;
  /**
   * The root Block's own resolved props, for a Schema entry that `follows` one.
   *
   * Leave it out only where nothing read can follow the root: a prop that does
   * then resolves to its default, as though the email had no colour of its own.
   */
  readonly rootProps?: Readonly<Record<string, unknown>>;
}

/**
 * Resolve a Block's props.
 *
 * On the desktop Stage: the value stored on the Block, then the root's value
 * for a prop that `follows` one, then the Schema default. The root's value is
 * passed over when it is not a usable colour, so a broken one renders the
 * default rather than broken CSS (ADR-0006). Nothing is read from any other
 * ancestor, and nothing chains: the root's own props come from the root's own
 * Block and defaults (ADR-0022).
 *
 * On the mobile Stage, one step in front of those: the Mobile Override. An
 * override only counts for a prop that is Overridable, so one left behind by a
 * Definition that has since changed its mind resolves to nothing.
 *
 * Stored props the Schema does not declare are passed through untouched, so
 * nothing is lost when a Definition drops a prop it used to have.
 */
export function resolveProps(
  block: Block,
  definition: BlockDefinition | undefined,
  options: ResolveOptions = {},
): Record<string, unknown> {
  const { stage = "desktop", rootProps } = options;
  const resolved: Record<string, unknown> = { ...block.props };
  if (!definition) return resolved;

  for (const [name, entry] of Object.entries(definition.schema)) {
    if (stage === "mobile") {
      const override = overrideOf(block, name, entry);
      if (override !== undefined) resolved[name] = override;
    }
    if (resolved[name] === undefined) {
      resolved[name] = rootValueFor(entry, rootProps) ?? entry.defaultValue;
    }
  }
  return resolved;
}

/**
 * Where a prop's value comes from, on one Stage. Exactly one, checked in this
 * order, which is the order {@link resolveProps} reads them in:
 *
 * - `"override"`: its Mobile Override. Only ever on the mobile Stage, and only
 *   for a prop that is Overridable.
 * - `"block"`: the value stored on the Block.
 * - `"email"`: the root's value, for a prop that follows one and finds it
 *   usable — an Email Default (ADR-0022).
 * - `"default"`: the Schema's default.
 */
export type Origin = "override" | "block" | "email" | "default";

/** The Origin of one prop's resolved value on `stage`. */
export function originOf(
  block: Block,
  name: string,
  entry: SchemaEntry,
  stage: Stage,
  rootProps: Readonly<Record<string, unknown>> | undefined,
): Origin {
  if (stage === "mobile" && overrideOf(block, name, entry) !== undefined) {
    return "override";
  }
  if (block.props[name] !== undefined) return "block";
  if (rootValueFor(entry, rootProps) !== undefined) return "email";
  return "default";
}

/**
 * The root's own props, resolved: what a Block that follows one reads.
 *
 * The root follows nothing itself, so it resolves with no root of its own.
 */
export function rootPropsOf(
  root: Block,
  lookup: (type: string) => BlockDefinition | undefined,
): Record<string, unknown> {
  return resolveProps(root, lookup(root.type));
}

/**
 * One of the root's colours, when it is one that can be written. `undefined`
 * otherwise, so the caller falls back to a default of its own (ADR-0022).
 */
export function rootColorOf(
  rootProps: Readonly<Record<string, unknown>> | undefined,
  prop: string,
): string | undefined {
  const value = rootProps?.[prop];
  return isUsableColor(value) ? value : undefined;
}

/** The root's value for a prop that follows one, when it is usable. */
function rootValueFor(
  entry: SchemaEntry,
  rootProps: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  return entry.follows === undefined
    ? undefined
    : rootColorOf(rootProps, entry.follows);
}

/**
 * A Block's props as its Definition's `render` receives them.
 *
 * {@link resolveProps} and one thing more: every {@link SchemaKind.surface}
 * prop comes through as a colour or as `undefined`, never as the sentinel. That
 * is what makes putting one straight into a style object correct, and it is why
 * `render` is the only reader whose props differ from everyone else's.
 *
 * Every {@link SchemaKind.html} prop comes through cleaned, with its `<style>`
 * scoped to the Block (ADR-0028). Here rather than in a Definition, so a
 * Consumer's own Block that declares the kind cannot forget to clean it, and
 * the Canvas and render clean it the same way.
 *
 * Every {@link SchemaKind.url} prop comes through as a link an email may carry,
 * or as `""` (ADR-0033), for the same reason.
 *
 * Everything else that resolves props — the Inspector, the Validators, a
 * Definition's own `validate` — keeps seeing the stored `none`. They are
 * reading a value rather than emitting one, and `parseColor` already knows the
 * word. Moving the substitution into `resolveProps` itself would break all
 * three to fix a path that is not theirs: `minimumContrast` in particular reads
 * `none` as transparent and keeps looking behind it, and an `undefined` there
 * would make it give up inside every unstyled container in the Document.
 */
export function renderProps(
  block: Block,
  definition: BlockDefinition | undefined,
  rootProps: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const resolved = resolveProps(block, definition, { rootProps });
  if (!definition) return resolved;

  for (const [name, entry] of Object.entries(definition.schema)) {
    if (entry.kind === SchemaKind.surface) {
      resolved[name] = surfaceColor(resolved[name]);
    } else if (entry.kind === SchemaKind.html) {
      resolved[name] = sanitiseHtml(resolved[name], htmlScopeOf(block.id));
    } else if (entry.kind === SchemaKind.url) {
      resolved[name] = safeUrl(resolved[name]);
    }
  }
  return resolved;
}

/**
 * A Block's props as a Block Definition's `validate` reads them.
 *
 * Resolved rather than stored, because an unset prop is not an empty one: it
 * is whatever the Schema says. And resolved against the root, so a prop that
 * takes an Email Default is judged by the value that renders (ADR-0022). Every check in
 * the shipped Presets reads through here, so none can leave the root out.
 */
export function validatedProps(
  block: Block,
  context: ValidationContext,
): Record<string, unknown> {
  return resolveProps(block, context.getDefinition(block.type), {
    rootProps: context.rootProps,
  });
}
