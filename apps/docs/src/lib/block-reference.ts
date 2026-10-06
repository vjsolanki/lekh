import type { BlockDefinition, SchemaEntry } from "lekh";

/**
 * A table cell's contents: words, and the pieces of them that are code.
 *
 * Kept as parts rather than a Markdown string, so a value holding a backtick
 * cannot break the cell it is written in.
 */
export type Inline = readonly (string | { readonly code: string })[];

/** One prop of a Block, as the reference table shows it. */
export interface PropRow {
  readonly name: string;
  /** What the prop is, in the words an Inspector shows your users. */
  readonly label: string;
  readonly kind: string;
  readonly defaultValue: Inline;
  readonly constraints: Inline;
  /** Whether the prop may have a value of its own on a phone. */
  readonly overridable: boolean;
}

/** One Block Definition, as the reference shows it. */
export interface BlockRow {
  readonly type: string;
  readonly label: string;
  /** The version the Definition writes today. 0 when it declares none. */
  readonly version: number;
  /** What it holds, as a sentence: the types it accepts, or that it is a leaf. */
  readonly holds: Inline;
  readonly props: readonly PropRow[];
}

/**
 * The reference tables for a list of Block Definitions, read from the
 * Definitions themselves.
 *
 * The docs build calls this on the shipped Presets, so a prop added to a
 * Schema reaches the page with no edit to the page.
 */
export function describeBlocks(
  definitions: readonly BlockDefinition[],
): readonly BlockRow[] {
  return definitions.map((definition) => ({
    type: definition.type,
    label: definition.label,
    version: definition.version ?? 0,
    holds: holdsOf(definition),
    props: Object.entries(definition.schema).map(([name, entry]) =>
      propRow(name, entry),
    ),
  }));
}

function holdsOf(definition: BlockDefinition): Inline {
  const { accepts, minChildren, maxChildren } = definition;
  if (accepts === undefined) return ["A leaf: it holds no Blocks."];

  const types = joined(accepts.map((type) => [{ code: type }]));
  const bounds = boundsOf(minChildren, maxChildren);
  return [
    "Holds ",
    ...types,
    bounds === undefined ? "." : `, ${bounds} of them.`,
  ];
}

function propRow(name: string, entry: SchemaEntry): PropRow {
  return {
    name,
    label: entry.label,
    kind: entry.kind,
    defaultValue: defaultOf(entry),
    constraints: constraintsOf(entry.constraints ?? {}),
    overridable: entry.mobile !== undefined,
  };
}

function defaultOf(entry: SchemaEntry): Inline {
  const own = asCode(entry.defaultValue);
  return entry.follows === undefined
    ? own
    : ["the email's ", { code: entry.follows }, ", else ", ...own];
}

/** A value as JSON in code, or "not set" for a value that is absent. */
function asCode(value: unknown): Inline {
  return value === undefined ? ["not set"] : [{ code: JSON.stringify(value) }];
}

/** "2 to 6", "2 or more", "up to 6", or nothing when neither bound is set. */
function boundsOf(min: unknown, max: unknown, unit = ""): string | undefined {
  if (typeof min === "number" && typeof max === "number") {
    return `${String(min)} to ${String(max)}${unit}`;
  }
  if (typeof min === "number") return `${String(min)}${unit} or more`;
  if (typeof max === "number") return `up to ${String(max)}${unit}`;
  return undefined;
}

/**
 * Keys read into words of their own, and `help`, which is words for an
 * Inspector to show and says nothing about the value. Every other key is
 * listed as it is.
 */
const READ_KEYS = new Set(["min", "max", "step", "unit", "options", "help"]);

function constraintsOf(constraints: Readonly<Record<string, unknown>>): Inline {
  const parts: Inline[] = [];

  const range = rangeOf(constraints);
  if (range !== undefined) parts.push([range]);

  const options = constraints["options"];
  if (Array.isArray(options)) parts.push(optionsOf(options));

  for (const [key, value] of Object.entries(constraints)) {
    if (!READ_KEYS.has(key))
      parts.push([{ code: `${key}: ${JSON.stringify(value)}` }]);
  }
  return joined(parts);
}

function rangeOf(
  constraints: Readonly<Record<string, unknown>>,
): string | undefined {
  const { min, max, step, unit } = constraints;
  const bounds = boundsOf(min, max, typeof unit === "string" ? ` ${unit}` : "");
  if (bounds === undefined) return undefined;
  return typeof step === "number"
    ? `${bounds}, in steps of ${String(step)}`
    : bounds;
}

/** A choice is a plain value, or `{ label, value }` with a name to show. */
function optionsOf(options: readonly unknown[]): Inline {
  if (options.length === 0) return ["no options listed"];
  return joined(
    options.map((option): Inline => {
      if (
        typeof option === "object" &&
        option !== null &&
        "value" in option &&
        "label" in option &&
        typeof option.label === "string"
      ) {
        return [...asCode(option.value), ` ${option.label}`];
      }
      return asCode(option);
    }),
  );
}

function joined(parts: readonly Inline[]): Inline {
  return parts.flatMap((part, index) => (index === 0 ? part : [", ", ...part]));
}
