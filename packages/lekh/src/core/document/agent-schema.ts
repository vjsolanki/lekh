import { listedAssetsOf } from "./assets";
import {
  SchemaKind,
  entryTextShape,
  type BlockDefinition,
  type JSONSchema,
  type SchemaEntry,
} from "./definition";
import { NONE, brandColorsOf } from "./color";
import type { TextShape } from "../markup/inline-markup";

/**
 * One Block Definition as an Agent reads it: which props it may set, as JSON
 * Schema, and where the Block may go.
 */
export interface BlockDescription {
  readonly type: string;
  readonly label: string;
  /**
   * The props an Agent may set, as a JSON Schema object. A prop closed to
   * Agents, or of a Consumer's kind with no `agent` fragment, is left out, and
   * `suggest` refuses it.
   */
  readonly props: {
    readonly type: "object";
    readonly title: string;
    readonly properties: Readonly<Record<string, JSONSchema>>;
    readonly additionalProperties: false;
  };
  /** The Block types that take this one as a child, in Definition order. */
  readonly parents: readonly string[];
}

/**
 * Describe Block Definitions to an Agent, one {@link BlockDescription} each,
 * in the order given.
 *
 * What a model needs to write Edits that apply: each prop's shape, from its
 * kind and constraints or its `agent` fragment, and which parents take which
 * types. Pass the editor's own, `editor.getDefinitions()`.
 */
export function describeBlocks(
  definitions: readonly BlockDefinition[],
): readonly BlockDescription[] {
  return definitions.map((definition) => ({
    type: definition.type,
    label: definition.label,
    props: propsSchema(definition),
    parents: definitions
      .filter((parent) => parent.accepts?.includes(definition.type) === true)
      .map((parent) => parent.type),
  }));
}

function propsSchema(definition: BlockDefinition): BlockDescription["props"] {
  const properties: Record<string, JSONSchema> = {};
  for (const [name, entry] of Object.entries<SchemaEntry>(definition.schema)) {
    const schema = agentSchemaOf(entry);
    if (schema) properties[name] = schema;
  }
  return {
    type: "object",
    title: definition.label,
    properties,
    additionalProperties: false,
  };
}

/**
 * What an Agent is told one prop holds, or `undefined` when it may not set
 * it: closed with `agent: false`, or a Consumer's kind with no fragment.
 *
 * The one test of whether a prop is open to Agents, for `describeBlocks` and
 * `suggest` alike.
 */
export function agentSchemaOf(entry: SchemaEntry): JSONSchema | undefined {
  if (entry.agent === false) return undefined;
  if (entry.agent !== undefined) return { title: entry.label, ...entry.agent };
  const shape = kindSchema(entry);
  if (!shape) return undefined;
  const help = entry.constraints?.["help"];
  const description = [shape.description, help]
    .filter((part) => typeof part === "string")
    .join(" ");
  return {
    title: entry.label,
    ...shape,
    ...(description === "" ? {} : { description }),
    ...(entry.defaultValue === undefined
      ? {}
      : { default: entry.defaultValue }),
  };
}

/**
 * A colour as `parseColor` reads one: hex in three lengths and a half, or
 * `rgb()` and `rgba()`.
 */
const COLOR_PATTERN =
  "^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\\([^()]*\\))$";

const COLOR_HOW = "A CSS color: #rgb, #rrggbb, rgb() or rgba().";

const COLOR: JSONSchema = {
  type: "string",
  pattern: COLOR_PATTERN,
  description: COLOR_HOW,
};

/**
 * A colour's description, with the Brand Colours it offers named after it, so
 * "make it on-brand" means something. The Agent still writes the colour itself.
 */
function namingBrandColors(
  description: string,
  constraints: Readonly<Record<string, unknown>>,
): string {
  const brandColors = brandColorsOf(constraints);
  if (brandColors.length === 0) return description;
  const named = brandColors.map(({ label, value }) => `${label} ${value}`);
  return (
    `${description} The brand's colors: ${named.join(", ")}. ` +
    "Write the color itself. Any other color works too."
  );
}

/** lekh's own description of a library kind. None for a Consumer's kind. */
function kindSchema(entry: SchemaEntry): JSONSchema | undefined {
  const constraints = entry.constraints ?? {};
  switch (entry.kind) {
    case SchemaKind.text: {
      const { maxLength } = constraints;
      return {
        type: "string",
        description: "Plain text, no markup.",
        ...(typeof maxLength === "number" ? { maxLength } : {}),
      };
    }
    case SchemaKind.richText: {
      return {
        type: "string",
        contentMediaType: "text/html",
        description: `HTML using only ${heldMarkup(entryTextShape(entry))}.`,
      };
    }
    case SchemaKind.html: {
      return {
        type: "string",
        contentMediaType: "text/html",
        description:
          "Hand-written HTML for the email. Scripts, event handlers and " +
          "unsafe links are cleaned out before it is sent.",
      };
    }
    case SchemaKind.url: {
      return {
        type: "string",
        description:
          "A link: https:, http:, mailto: or tel:, a relative path or a " +
          '#fragment. "" for no link. Any other scheme is left out of the ' +
          "email and reported.",
      };
    }
    case SchemaKind.color: {
      return {
        ...COLOR,
        description: namingBrandColors(COLOR_HOW, constraints),
      };
    }
    case SchemaKind.surface: {
      return {
        anyOf: [COLOR, { const: NONE, description: "No color at all." }],
        description: namingBrandColors(
          `A CSS color, or "${NONE}" for no color.`,
          constraints,
        ),
      };
    }
    case SchemaKind.number: {
      const { min, max, unit } = constraints;
      return {
        type: "number",
        ...(typeof min === "number" ? { minimum: min } : {}),
        ...(typeof max === "number" ? { maximum: max } : {}),
        ...(typeof unit === "string" ? { description: `In ${unit}.` } : {}),
      };
    }
    case SchemaKind.width: {
      const { min } = constraints;
      return {
        type: "number",
        minimum: typeof min === "number" ? min : 0,
        maximum: 100,
        description:
          "Its share of its parent's width, in per cent. Its siblings " +
          "give or take the difference, so the row still adds up to 100.",
      };
    }
    case SchemaKind.boolean: {
      return { type: "boolean" };
    }
    case SchemaKind.select: {
      const values = optionValues(constraints["options"]);
      return values.length > 0
        ? { enum: values }
        : { type: ["string", "number"] };
    }
    case SchemaKind.align: {
      return {
        enum: ["start", "center", "end"],
        description:
          "By reading order: start is right in a right-to-left email.",
      };
    }
    case SchemaKind.asset: {
      return assetSchema(entry);
    }
    default: {
      return undefined;
    }
  }
}

/** A select's options, each a value or `{ label, value }`, as their values. */
function optionValues(options: unknown): readonly (string | number)[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option: unknown) => {
    const value =
      typeof option === "object" && option !== null && "value" in option
        ? option.value
        : option;
    return typeof value === "string" || typeof value === "number"
      ? [value]
      : [];
  });
}

const ASSET_DESCRIPTION =
  "A resolved Asset: where the image lives and its size in pixels. Never a " +
  "URL on its own. Get one from a tool that resolves images.";

/** Said after an Asset's description when its entry is `decorative`. */
const DECORATIVE_NOTE = " Decorative: alt text is not used. Leave alt out.";

/**
 * An Asset, or one of those its prop lists (ADR-0030), with a note when it is
 * decorative, so an Agent writes no alt text nobody sees.
 */
function assetSchema(entry: SchemaEntry): JSONSchema {
  const note = entry.decorative === true ? DECORATIVE_NOTE : "";
  const listed = listedAssetsOf(entry.constraints);
  if (listed && listed.length > 0) {
    return {
      anyOf: listed.map((asset) => ({
        type: "object",
        properties: {
          src: { const: asset.src },
          width: { const: asset.width },
          height: { const: asset.height },
          alt: { type: "string" },
        },
        required: ["src", "width", "height"],
        additionalProperties: false,
      })),
      description: `One of the Assets listed here, with any alt text.${note}`,
    };
  }
  return {
    type: "object",
    properties: {
      src: { type: "string", pattern: "\\S" },
      width: { type: "number", exclusiveMinimum: 0 },
      height: { type: "number", exclusiveMinimum: 0 },
      alt: {
        type: "string",
        description: "What the image says when images are blocked.",
      },
    },
    required: ["src", "width", "height"],
    additionalProperties: false,
    description: `${ASSET_DESCRIPTION}${note}`,
  };
}

/** The tags a rich-text prop holds, for an Agent to read. */
export function heldMarkup(shape: TextShape): string {
  const inline = "<strong>, <em>, <u>, <s>, <a href> and <br>";
  if (shape.lists === true) return `${inline}, in <p>, <ul> and <ol> with <li>`;
  if (shape.paragraphs === true) return `${inline}, in <p>`;
  return `${inline} only, in one line with no <p>`;
}
