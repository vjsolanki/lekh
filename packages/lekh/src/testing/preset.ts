/**
 * Shared setup for the Preset's tests: the shipped Definitions, its markup
 * read back, and the small Documents most of those tests start from.
 */

import {
  createEditor,
  NONE,
  SchemaKind,
  type Block,
  type BlockDefinition,
  type Editor,
  type EmailDocument,
} from "../index";
import {
  createReactEmailPreset,
  REACT_EMAIL_ROOT_TYPE,
  type ReactEmailIcon,
} from "../blocks";
import { markupOf, parseMarkup, styleOf, type Markup } from "./markup";

export const definitions = createReactEmailPreset();

/**
 * The stack the Preset writes when a Consumer names none. Spelt out, since it
 * is what reaches an inbox and no entry point exports it.
 */
export const DEFAULT_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export function markup(document: EmailDocument, set = definitions): string {
  return markupOf(document, { definitions: set });
}

/** The Preset's markup for a Document, parsed. */
export function parsed(document: EmailDocument, set = definitions): Markup {
  return parseMarkup(markup(document, set));
}

/** Every element the selector matches, each with its inline style as a map. */
export function stylesOf(
  html: string,
  selector: string,
): readonly Readonly<Record<string, string>>[] {
  return parseMarkup(html)
    .all(selector)
    .map((element) => styleOf(element));
}

/** The style of the table a band's Container renders: the content column. */
export function containerTable(html: string): Readonly<Record<string, string>> {
  return stylesOf(html, "table").find((style) => "max-width" in style) ?? {};
}

export const newsletter: EmailDocument = {
  root: {
    id: "root",
    type: REACT_EMAIL_ROOT_TYPE,
    props: { previewText: "This week in email" },
    children: [
      {
        id: "row",
        type: "section",
        props: {},
        children: [
          { id: "title", type: "heading", props: { content: "Hello" } },
          { id: "copy", type: "text", props: { content: "Some words." } },
          {
            id: "cta",
            type: "button",
            props: { label: "Read on", href: "https://example.com" },
          },
        ],
      },
    ],
  },
};

/** A Document holding one Block directly under the root. */
export function alone(
  block: Block,
  rootProps: Record<string, unknown> = {},
): EmailDocument {
  return {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: rootProps,
      children: [block],
    },
  };
}

/** One divider under a root that paints nothing, so it is the only surface. */
export function dividerAlone(props: Record<string, unknown>): EmailDocument {
  return alone(
    { id: "rule", type: "divider", props },
    { backgroundColor: "none" },
  );
}

/** Every surface a Definition declares, explicitly emptied. */
export function surfacesCleared(
  definition: BlockDefinition,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(definition.schema)
      .filter(([, entry]) => entry.kind === SchemaKind.surface)
      .map(([name]) => [name, NONE]),
  );
}

/**
 * One Block of a type, every surface on it and on the root emptied.
 *
 * The image and the icon get an Asset, or they render to nothing and pass by
 * drawing nothing at all.
 */
export function cleared(definition: BlockDefinition): EmailDocument {
  const root = definitions.find(
    (candidate) => candidate.type === REACT_EMAIL_ROOT_TYPE,
  );

  return {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: root ? surfacesCleared(root) : {},
      children: [
        {
          id: "block",
          type: definition.type,
          props: {
            ...surfacesCleared(definition),
            ...(definition.type === "image" || definition.type === "icon"
              ? {
                  asset: {
                    src: "https://example.com/a.png",
                    width: 2,
                    height: 1,
                  },
                }
              : {}),
          },
        },
      ],
    },
  };
}

/** The inline style of the first element matching `tag`. */
export function styleOfFirst(
  html: string,
  tag: string,
): Readonly<Record<string, string>> {
  const [first] = parseMarkup(html).all(tag);
  return first ? styleOf(first) : {};
}

/** The Schema the shipped Preset gives a type. */
export const schemaOf = (type: string) =>
  definitions.find((definition) => definition.type === type)?.schema;

/** An element's attributes, as a map of name to value. */
export function attributesOf(element: Element): Record<string, string | null> {
  return Object.fromEntries(
    element
      .getAttributeNames()
      .map((name) => [name, element.getAttribute(name)]),
  );
}

/**
 * The table the root wraps its children in, and the one cell inside it.
 *
 * react-email's `Body` already writes a table cell of its own, so the wrapper
 * is the table inside that one, after the preview text if there is any.
 */
export function wrapper(html: string): { table: Element; cell: Element } {
  const table = parseMarkup(html).one(`${BODY_CELL} > table`);
  const cell = table.querySelector("td");
  if (cell === null) throw new Error("The wrapper table has no cell.");
  return { table, cell };
}

/** The cell react-email's `Body` writes, which everything else sits in. */
export const BODY_CELL = "body > table > tbody > tr > td";

/** A Document with its root's direction set, or left unset with `undefined`. */
export function directed(
  document: EmailDocument,
  direction: unknown,
): EmailDocument {
  return {
    root: { ...document.root, props: { ...document.root.props, direction } },
  };
}

/**
 * One aligned Block in an email running one way. A padding override gives it
 * a class, so `overriddenCell` can find the cell the alignment sits on.
 */
export function aligned(
  type: string,
  align: unknown,
  direction: unknown,
  mobile: Record<string, unknown> = {},
): EmailDocument {
  return directed(
    placed(
      type,
      { content: "Hi", ...(align === undefined ? {} : { align }) },
      { paddingTop: 2, ...mobile },
    ),
    direction,
  );
}

/** Every Block in the react.email Preset with an `align` prop. */
export const ALIGNED = ["heading", "text", "image", "button", "divider"];

/** The tag of every element wearing the overridden Block's class. */
export function tagsWearingOverride(html: string): string[] {
  return parseMarkup(html)
    .all(".lekh-m-subject")
    .map((element) => element.localName);
}

/** Set one column's width the way a Consumer's Inspector would. */
export function setWidth(
  editor: ReturnType<typeof createEditor>,
  rowId: string,
  index: number,
  value: number,
): void {
  editor.select(rowId);
  const column = editor.getEditableChildren()[index];
  column?.controls.find((control) => control.name === "width")?.set(value);
}

/** The text of every comment under an element, in document order. */
export function commentsIn(element: Element): string[] {
  return [...element.childNodes].flatMap((node) => {
    if (node.nodeType === COMMENT_NODE) return [node.textContent ?? ""];
    return node.nodeType === ELEMENT_NODE
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        commentsIn(node as Element)
      : [];
  });
}

export const ELEMENT_NODE = 1;

export const COMMENT_NODE = 8;

/** The wrapper `mobile.only` builds on the render path, up to its comment. */
export const MOBILE_ONLY_OPENING =
  '<div class="lekh-mobile-only" ' +
  'style="display:none;max-height:0;overflow:hidden"><!--[if !mso]><!-->';

/** The style of every styled `<p>` in the markup, in order. */
export function paragraphStyles(
  html: string,
): readonly Readonly<Record<string, string>>[] {
  return stylesOf(html, "p[style]");
}

/** One Block of a type, under the root or, for a column, in a row. */
export function placed(
  type: string,
  props: Record<string, unknown>,
  mobile?: Record<string, unknown>,
): EmailDocument {
  const asset = { src: "https://example.com/a.png", width: 800, height: 600 };
  const subject: Block = {
    id: "subject",
    type,
    props: { ...(type === "image" ? { asset } : {}), ...props },
    ...(mobile ? { mobile } : {}),
    ...(type === "column" ? { children: [] } : {}),
  };
  if (type !== "column") return alone(subject);
  return alone({
    id: "row",
    type: "columns",
    props: {},
    children: [
      subject,
      { id: "other", type: "column", props: {}, children: [] },
    ],
  });
}

/** The first element inside the root's wrapper cell: a Block's outermost. */
export function outermost(html: string): Element | null {
  return wrapper(html).cell.firstElementChild;
}

/** The cell wearing the overridden Block's class. */
export function overriddenCell(html: string): Element {
  return parseMarkup(html).one("td.lekh-m-subject");
}

export const PADDED = [
  "section",
  "columns",
  "column",
  "heading",
  "text",
  "image",
  "button",
  "divider",
];

/** The values a `select` entry offers, whether or not they carry labels. */
export function valuesOf(
  constraints: Readonly<Record<string, unknown>> | undefined,
): readonly unknown[] {
  const options = constraints?.["options"];
  if (!Array.isArray(options)) return [];
  return options.map((option: unknown) =>
    typeof option === "object" && option !== null && "value" in option
      ? option.value
      : option,
  );
}

/** The labels a `select` entry's options carry, leaving out bare values. */
export function labelsOf(
  constraints: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const options = constraints?.["options"];
  if (!Array.isArray(options)) return [];
  return options.flatMap((option: unknown) =>
    typeof option === "object" && option !== null && "label" in option
      ? [String(option.label)]
      : [],
  );
}

/** The link or span round each icon. */
export const anchors = (html: string): readonly Element[] =>
  parseMarkup(html)
    .all("a, span")
    .filter((element) => styleOf(element)["display"] === "inline-block");

/** An editor over the Preset with these icons listed, and a resolver. */
export function editorWithIcons(icons?: readonly ReactEmailIcon[]): Editor {
  return createEditor({
    definitions: createReactEmailPreset(icons ? { icons } : {}),
    rootType: REACT_EMAIL_ROOT_TYPE,
    resolveImage: () => Promise.resolve(undefined),
  });
}

/** An element as its tag and attributes, which say all its markup does. */
export const tagOf = (element: Element) => ({
  tag: element.localName,
  ...attributesOf(element),
});

export const definitionOf = (type: string, set = definitions) =>
  set.find((definition) => definition.type === type);

/** The email, rendered even when a Diagnostic makes it invalid. */
export const unchecked = (document: EmailDocument): string =>
  markupOf(document, { definitions, validate: false });
