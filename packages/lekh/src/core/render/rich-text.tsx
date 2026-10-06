import {
  createContext,
  createElement,
  Fragment,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  MARK_ELEMENTS,
  orderMarks,
  parseInlineMarkup,
  LIST_MARKUP,
  splitStretches,
  type InlineNode,
  type ListKind,
  type Mark,
  type TextShape,
} from "../markup/inline-markup";
import type { Direction } from "../document/typography";

/**
 * How a Block's text is drawn where it is only being read.
 *
 * Semantic tags with the style spelled out on the element: a mail client that
 * drops the stylesheet still shows bold text as bold, and one that honours
 * neither `<strong>` nor a class still honours an inline style.
 */
const MARK_STYLES: Readonly<Record<Mark["kind"], CSSProperties>> = {
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
  underline: { textDecoration: "underline" },
  strike: { textDecoration: "line-through" },
  link: { textDecoration: "underline" },
};

/** How a Block's text is drawn, beyond the text itself. */
export interface InlineMarkupOptions {
  /**
   * The colour written on every link. Inline on the `<a>`, because a link does
   * not reliably take its colour from the text around it in mail clients — left
   * out, each client picks its own blue (ADR-0022).
   */
  readonly linkColor?: string;
  /**
   * The style written on every `<p>`, when the Block's text holds paragraphs
   * (ADR-0023). Inline on each one, because some mail clients set their own
   * paragraph font and margin. The last paragraph's `marginBottom` is zeroed,
   * since the space below the Block is the Block's own, so set the gap as
   * `marginBottom` rather than in a `margin` shorthand.
   */
  readonly paragraphStyle?: CSSProperties;
  /** The class written on every `<p>`, when the text holds paragraphs. */
  readonly paragraphClassName?: string;
  /**
   * The style written on every `<ul>` and `<ol>`, when the text holds lists
   * (ADR-0029). A list counts as one paragraph, so give it the paragraph gap
   * as `marginBottom`; it is zeroed on a list that ends the text. The indent,
   * the padding and the marker are written for you.
   */
  readonly listStyle?: CSSProperties;
  /**
   * The style written on every `<li>`. Give it the Block's full text style, as
   * some mail clients reset an item's font, and the gap between items as
   * `marginBottom`; it is zeroed on the last item of each list.
   */
  readonly listItemStyle?: CSSProperties;
  /**
   * How far a list is indented from the side the text starts on, in pixels.
   * Written as a physical margin, since mail clients drop logical ones.
   * Defaults to 24.
   */
  readonly listIndent?: number;
  /**
   * Which way the text runs. A right-to-left list carries `dir="rtl"` and is
   * indented from the right. Defaults to `"ltr"`.
   */
  readonly direction?: Direction;
}

/**
 * Draws a Block's text where it is only being read.
 *
 * Every Block Definition with a `rich-text` prop renders it through this, so
 * the same stored string produces the same markup in a send pipeline as an
 * Author saw while writing it.
 */
export function renderInlineMarkup(
  value: unknown,
  options: InlineMarkupOptions = {},
  shape: TextShape = {},
): ReactNode {
  const nodes = parseInlineMarkup(value, shape);
  if (nodes.length === 0) return null;
  // Colour first, so it reads beside the underline it is the colour of.
  const styles: Readonly<Record<Mark["kind"], CSSProperties>> = {
    ...MARK_STYLES,
    link: { color: options.linkColor, ...MARK_STYLES.link },
  };
  const runs = (line: readonly InlineNode[]): ReactNode[] =>
    line.map((node, at) => renderNode(node, at, styles));

  if (shape.paragraphs !== true)
    return createElement(Fragment, null, ...runs(nodes));

  // The same stretches the stored string is written from, so a list in text
  // that does not hold lists is drawn as the paragraphs it would be stored as.
  const stretches = splitStretches(nodes, shape);
  return createElement(
    Fragment,
    null,
    ...stretches.map((stretch, at) => {
      const last = at === stretches.length - 1;
      if (stretch.kind === "paragraph") {
        return createElement(
          "p",
          {
            key: at,
            className: options.paragraphClassName,
            style: paragraphStyleAt(options, last),
          },
          ...runs(stretch.runs),
        );
      }
      return createElement(
        LIST_MARKUP[stretch.list].tag,
        {
          key: at,
          ...(options.direction === "rtl" ? { dir: "rtl" } : {}),
          style: listStyleAt(options, stretch.list, last),
        },
        ...stretch.items.map((item, index) =>
          createElement(
            "li",
            {
              key: index,
              style: listItemStyleAt(
                options,
                stretch.list,
                index === stretch.items.length - 1,
              ),
            },
            ...runs(item),
          ),
        ),
      );
    }),
  );
}

/** The indent a list takes when the Block names none. */
const LIST_INDENT = 24;

/**
 * The style one list is written in (ADR-0029).
 *
 * The indent is a margin on the side the text starts from, and the padding is
 * zero: logical properties fail in Gmail, every Outlook and Yahoo, and a
 * client's own list padding would add to the indent. A list that ends the text
 * has no space below it, as the last paragraph has none.
 */
export function listStyleAt(
  options: InlineMarkupOptions,
  kind: ListKind,
  last: boolean,
): CSSProperties {
  const side = options.direction === "rtl" ? "marginRight" : "marginLeft";
  return {
    ...options.listStyle,
    [side]: options.listIndent ?? LIST_INDENT,
    ...(last ? { marginBottom: 0 } : {}),
    padding: 0,
    listStyleType: LIST_MARKUP[kind].marker,
  };
}

/**
 * The style one list item is written in.
 *
 * A bullet carries `mso-special-format: bullet`: without it, classic Outlook
 * turns the items into paragraphs once the list has a margin. The last item of
 * a list has no space below it, since the list's own margin is the gap.
 */
export function listItemStyleAt(
  options: InlineMarkupOptions,
  kind: ListKind,
  last: boolean,
): CSSProperties {
  return {
    ...options.listItemStyle,
    ...(last ? { marginBottom: 0 } : {}),
    padding: 0,
    ...(kind === "bullet" ? { msoSpecialFormat: "bullet" } : {}),
  };
}

/**
 * The style one paragraph is written in.
 *
 * The last has no space below it: whatever sits between the Block and the next
 * one is the Block's padding, and counting the gap there too would double it.
 */
export function paragraphStyleAt(
  options: InlineMarkupOptions,
  last: boolean,
): CSSProperties {
  return last
    ? { ...options.paragraphStyle, marginBottom: 0 }
    : { ...options.paragraphStyle };
}

function renderNode(
  node: InlineNode,
  at: number,
  styles: Readonly<Record<Mark["kind"], CSSProperties>>,
): ReactNode {
  // A boundary only reaches here in text that holds no paragraphs, where it
  // can only be a line break.
  if (node.kind !== "text") return createElement("br", { key: at });

  let rendered: ReactNode = node.text;
  // Innermost mark first, so the outermost tag is the one written last.
  for (const mark of orderMarks(node.marks).toReversed()) {
    rendered = createElement(
      MARK_ELEMENTS[mark.kind],
      {
        ...(mark.kind === "link" ? { href: mark.href } : {}),
        style: styles[mark.kind],
      },
      rendered,
    );
  }
  return createElement(Fragment, { key: at }, rendered);
}

/**
 * Draws a Block's text so an Author can type into it.
 *
 * Supplied by the Canvas, bound to the Block currently being rendered. Absent
 * everywhere else — the render path has no editor in it.
 */
export type EditableRichText = (
  value: unknown,
  options: InlineMarkupOptions,
  shape: TextShape,
) => ReactNode;

const EditableRichTextContext = createContext<EditableRichText | undefined>(
  undefined,
);

/** Set by the Canvas around each Block, so `RichText` becomes editable there. */
export const EditableRichTextProvider = EditableRichTextContext.Provider;

const TextShapeContext = createContext<TextShape>({});

/**
 * Set around each Block with rich text, on the Canvas and the render path
 * alike, so `RichText` reads the shape the Block's Schema declares rather than
 * being told it a second time in `render`.
 */
export const TextShapeProvider = TextShapeContext.Provider;

/** What `RichText` needs: the Block prop holding the text, whatever is in it. */
export interface RichTextProps extends InlineMarkupOptions {
  /** The Block's stored text. A value that is not a string draws nothing. */
  readonly value: unknown;
}

/**
 * A Block's rich text.
 *
 * The one component a Block Definition needs in order to hold text an Author
 * can format. On the Canvas it becomes the Text Engine's Editable Text; on
 * the render path it becomes email-safe inline markup. A Definition writes it
 * the same way either side of that line and needs to know nothing about which
 * one it is in.
 *
 * ```tsx
 * render: ({ props }) => <Text><RichText value={props.content} /></Text>
 * ```
 *
 * A `linkColor` is written on every link, on the Canvas and in the email alike.
 */
export function RichText({ value, ...options }: RichTextProps): ReactNode {
  const surface = useContext(EditableRichTextContext);
  const shape = useContext(TextShapeContext);
  return surface
    ? surface(value, options, shape)
    : renderInlineMarkup(value, options, shape);
}
