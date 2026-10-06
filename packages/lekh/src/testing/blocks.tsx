import {
  SchemaKind,
  assetOf,
  classNames,
  defineBlock,
  MobileStyles,
  RichText,
  type Asset,
  type BlockDefinition,
} from "../index";
import { PresetDiagnostic } from "../blocks";

/**
 * A small set of Block Definitions used across the editor and render suites.
 *
 * Deliberately not the shipped Preset: these tests are about the engine, and
 * pinning them to react.email markup would make them fail for the wrong
 * reasons.
 */

export const email = defineBlock<{
  backgroundColor: string;
  contentWidth: number;
  previewText: string;
}>({
  type: "email",
  label: "Email",
  accepts: ["section", "text", "image", "unsubscribe"],
  schema: {
    backgroundColor: {
      kind: SchemaKind.color,
      label: "Background color",
      defaultValue: "#ffffff",
    },
    contentWidth: {
      kind: SchemaKind.number,
      label: "Content width",
      defaultValue: 600,
      constraints: { min: 320, max: 800 },
    },
    previewText: {
      kind: SchemaKind.text,
      label: "Preview text",
      defaultValue: "",
    },
  },
  render: ({ props, children, mobile }) => (
    <body style={{ backgroundColor: props.backgroundColor }}>
      {/* The root emits the one mobile stylesheet, and nothing at all when the
          email uses none of it. */}
      <MobileStyles css={mobile.stylesheet()} />
      <table width={props.contentWidth}>
        <tbody>{children}</tbody>
      </table>
    </body>
  ),
});

export const section = defineBlock<{ padding: number }>({
  type: "section",
  label: "Section",
  accepts: ["text", "image", "unsubscribe"],
  maxChildren: 2,
  schema: {
    padding: {
      kind: SchemaKind.number,
      label: "Padding",
      defaultValue: 16,
      mobile: (padding) => ({ padding: `${String(padding)}px` }),
    },
  },
  render: ({ props, children, mobile }) => (
    <tr>
      {/* The Overrides class goes on the element whose inline styles it beats. */}
      <td className={mobile.className} style={{ padding: props.padding }}>
        {children}
      </td>
    </tr>
  ),
});

export const text = defineBlock<{ content: string; fontSize: number }>({
  type: "text",
  label: "Text",
  schema: {
    content: {
      kind: SchemaKind.richText,
      label: "Content",
      defaultValue: "Text",
    },
    fontSize: {
      kind: SchemaKind.number,
      label: "Font size",
      defaultValue: 14,
      // Opted in to Mobile Overrides; `content` deliberately is not.
      mobile: (size) => ({ "font-size": `${String(size)}px` }),
    },
  },
  render: ({ props, mobile }) => (
    <p className={mobile.className} style={{ fontSize: props.fontSize }}>
      <RichText value={props.content} />
    </p>
  ),
});

export const image = defineBlock<{ asset: Asset | undefined }>({
  type: "image",
  label: "Image",
  schema: {
    asset: {
      kind: SchemaKind.asset,
      label: "Image",
      defaultValue: undefined,
      primary: true,
    },
  },
  validate: (block) =>
    assetOf(block.props["asset"])?.alt === undefined
      ? [
          {
            // The Preset's code, so a severity override names the same code in both.
            code: PresetDiagnostic.imageAltTextMissing,
            message: "This image has no alt text.",
            severity: "warning" as const,
            blockId: block.id,
          },
        ]
      : [],
  // Explicit dimensions, because several mail clients render an image at its
  // intrinsic size without them.
  render: ({ props }) =>
    props.asset ? (
      <img
        src={props.asset.src}
        alt={props.asset.alt ?? ""}
        width={props.asset.width}
        height={props.asset.height}
      />
    ) : null,
});

/** A Required Block, the way a compliance Preset would ship one. */
export function unsubscribe(
  overrides: { deletable?: boolean } = {},
): BlockDefinition<{ label: string }> {
  return defineBlock<{ label: string }>({
    type: "unsubscribe",
    label: "Unsubscribe link",
    required: true,
    ...overrides,
    schema: {
      label: {
        kind: SchemaKind.text,
        label: "Link text",
        defaultValue: "Unsubscribe",
      },
    },
    render: ({ props }) => (
      <tr>
        <td>
          <a href="{{unsubscribe_url}}">{props.label}</a>
        </td>
      </tr>
    ),
  });
}

/**
 * A Structural Block: the Author never places one, and the grid below creates
 * them. Carries a prop, because that is the reason it stays a Block at all.
 */
export const cell = defineBlock<{ padding: number }>({
  type: "cell",
  label: "Cell",
  structural: true,
  accepts: ["text", "image"],
  schema: {
    padding: { kind: SchemaKind.number, label: "Padding", defaultValue: 0 },
  },
  render: ({ props, children }) => (
    <td style={{ padding: props.padding }}>{children}</td>
  ),
});

/** A container that arrives holding two cells and is never left holding one. */
export const grid = defineBlock<Record<string, never>>({
  type: "grid",
  label: "Grid",
  accepts: ["cell"],
  minChildren: 2,
  maxChildren: 4,
  schema: {},
  render: ({ children }) => <tr>{children}</tr>,
});

/**
 * A cell that takes a share of the grid it sits in.
 *
 * The prop is called `share` rather than `width` on purpose: the core
 * recognises the Schema `kind` and never a name (ADR-0016), and a test
 * Definition is the only place that can be shown — the shipped Preset happens
 * to call its own prop `width`, so a suite driven through it proves nothing
 * either way.
 *
 * The floor is the Preset's ten, which is what every case in
 * `core/layout/width.unit.test.ts` uses too, so the numbers in the two suites can be
 * read against each other.
 */
export const dividingCell: BlockDefinition = {
  ...cell,
  schema: {
    ...cell.schema,
    share: {
      kind: SchemaKind.width,
      label: "Share",
      defaultValue: 50,
      constraints: { min: 10, max: 100 },
    },
  },
};

/** The set most tests use: no Required Blocks, so seeding stays uncluttered. */
export const definitions: readonly BlockDefinition[] = [
  email,
  section,
  text,
  image,
];

/** The same set plus a container that seeds its own structural children. */
export const definitionsWithSeeded: readonly BlockDefinition[] = [
  { ...email, accepts: ["section", "text", "image", "unsubscribe", "grid"] },
  section,
  text,
  image,
  grid,
  cell,
];

/**
 * The same again, with cells that divide the grid between them.
 *
 * A separate set rather than a change to `cell`, so the suites above keep the
 * Op streams they assert on: giving every seeded cell a width would add a
 * `set-prop` to insertions that are not about widths at all.
 */
export const definitionsDividing: readonly BlockDefinition[] = [
  { ...email, accepts: ["section", "text", "image", "unsubscribe", "grid"] },
  section,
  text,
  image,
  grid,
  dividingCell,
];

/** The same set plus a Required Block. */
export function definitionsWithRequired(
  overrides: { deletable?: boolean } = {},
): readonly BlockDefinition[] {
  return [...definitions, unsubscribe(overrides)];
}

// A container whose columns stack, plus one that emits rules of its own: the
// structural half of the split, which the library never models as a prop of its
// own — a Block Definition declares an ordinary boolean and asks for a class.
export const columns = defineBlock<{ reverseOnMobile: boolean }>({
  type: "columns",
  label: "Columns",
  accepts: ["column"],
  schema: {
    reverseOnMobile: {
      kind: SchemaKind.boolean,
      label: "Reverse on mobile",
      defaultValue: false,
    },
  },
  render: ({ props, children, mobile }) => {
    // Reversing depends on the markup around it, so it is not one of the fixed
    // classes: a Block that wants it emits its own rule, the way the shipped
    // Preset's own `columns` Block does.
    if (props.reverseOnMobile) mobile.add(REVERSE_RULE);
    return (
      <tr className={classNames(props.reverseOnMobile && "reverse-row")}>
        {children}
      </tr>
    );
  },
});

export const REVERSE_RULE = ".reverse-row{display:flex!important}";

export const column = defineBlock<{
  stackOnMobile: boolean;
  hideOnMobile: boolean;
}>({
  type: "column",
  label: "Column",
  accepts: ["text"],
  schema: {
    stackOnMobile: {
      kind: SchemaKind.boolean,
      label: "Stack on mobile",
      defaultValue: true,
    },
    hideOnMobile: {
      kind: SchemaKind.boolean,
      label: "Hide on mobile",
      defaultValue: false,
    },
  },
  render: ({ props, children, mobile }) => (
    <td
      className={classNames(
        props.stackOnMobile && mobile.use("stack"),
        props.hideOnMobile && mobile.use("hide"),
      )}
    >
      {children}
    </td>
  ),
});

/** A Block whose mobile behaviour the library never anticipated. */
export const marquee = defineBlock<Record<string, never>>({
  type: "marquee",
  label: "Marquee",
  schema: {},
  render: ({ mobile }) => {
    mobile.add(".marquee>span{letter-spacing:0!important}");
    return (
      <div className="marquee">
        <span>Sale</span>
      </div>
    );
  },
});

/** A container shown only on a phone, through the library's wrapper. */
export const teaser = defineBlock<Record<string, never>>({
  type: "teaser",
  label: "Teaser",
  accepts: ["text", "columns"],
  schema: {},
  render: ({ children, mobile }) =>
    mobile.only(<div className="teaser">{children}</div>),
});

/** The same set plus Blocks that stack, hide, emit rules or show only on a phone. */
export const definitionsResponsive: readonly BlockDefinition[] = [
  { ...email, accepts: ["section", "text", "columns", "marquee", "teaser"] },
  ...definitions.filter((definition) => definition.type !== "email"),
  columns,
  column,
  marquee,
  teaser,
];

/** Predictable ids, so tests can name Blocks instead of hunting for them. */
export function sequentialIds(prefix = "id"): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter)}`;
  };
}
