import { Column, Row } from "@react-email/components";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";

import {
  defineBlock,
  SchemaKind,
  type Surface,
} from "../core/document/definition";
import { classNames, STACK_DECLARATIONS } from "../core/layout/responsive";
import {
  band,
  BAND_VERSIONS,
  type BandProps,
  surfaceSchema,
  validateContentBackground,
} from "./band";
import { presetBlock } from "./block";
import { desktopOnlyClass } from "./leaf";
import { BLOCK_TYPE, LEAF_TYPES } from "./names";
import type { PresetDefaults } from "./options";
import {
  BACKGROUND_COLOR,
  borderSchema,
  borderStyles,
  COLUMN_SHOW_ON,
  CONTENT_GROUP,
  MOBILE_GROUP,
  paddingSchema,
  paddingStyles,
  SHOW_ON,
  SHOW_ON_FROM_HIDE_ON_MOBILE,
  splitPadding,
  type BorderProps,
  type PaddingProps,
} from "./schema";

/**
 * The `columns` Block's own reversal, which the library does not ship a class
 * for because it is the one structural behaviour that depends on surrounding
 * markup.
 *
 * `column-reverse` is the only thing that actually reorders stacked boxes —
 * `direction: rtl` reverses boxes sharing a line, and stacked columns each have
 * a line to themselves. It has to go on the element whose children are the
 * columns, which inside react.email's `Row` is the `<tr>`. Flexbox in an email
 * is a narrower bet than the rest of this, but it is made inside a media query
 * that Outlook on the desktop ignores entirely — and that is the client the bet
 * would lose to (ADR-0007).
 */
const REVERSE_CLASS = "lekh-reverse";
const REVERSE_RULE =
  `.${REVERSE_CLASS}>tbody>tr{display:flex!important;` +
  `flex-direction:column-reverse!important}`;

/**
 * The row's other rule about markup it owns: its columns, stacked.
 *
 * The library ships `mobile.use("stack")` for this, and it is element-local by
 * design — it stacks whatever it is put on. That is exactly why it cannot be
 * used here. The decision belongs to the row, because a row where one column
 * stacks and its neighbour does not is a full-width block followed by a cell
 * with no row left to sit in; and the row cannot put a class on its columns,
 * having been handed them already rendered. So it reaches through the markup it
 * knows it emitted, as `REVERSE_CLASS` does, with the declarations the
 * library's class carries.
 */
const STACK_CLASS = "lekh-stacked";
const STACK_RULE = `.${STACK_CLASS}>tbody>tr>td${STACK_DECLARATIONS}`;

/**
 * Where a row's columns sit against each other's height.
 *
 * The row's, like stacking: one column can't line up with its neighbours on
 * its own (#43). But it has to land inline on every column cell, so a client
 * that strips the head keeps it, and the row gets its columns already
 * rendered. So the row hands the value down through a context, and the
 * column's cell reads it as it renders. It costs no markup, and it still
 * reaches a column the Canvas reused from its cache. Only a structural Block
 * may read its owner like this, since it can never be moved (ADR-0031).
 */
const VERTICAL_ALIGNS = ["top", "middle", "bottom"];
const DEFAULT_VERTICAL_ALIGN = "top";
const RowAlignment = createContext(DEFAULT_VERTICAL_ALIGN);

/**
 * The space between two columns of a row, as a cell of its own.
 *
 * Square, so the same cell is the gap across a wide row and the gap down a
 * stacked one: the stack rule makes every cell of the row full width, gap cells
 * too, and then the height is what shows. Reversal flips the whole `<tr>`, so a
 * gap cell still falls between every pair.
 *
 * No colour, so the row's content colour shows through and each column's own
 * stops at its edge. The `&nbsp;` keeps a client from collapsing an empty cell,
 * and the zeroed font and line height keep it from being taller than asked.
 *
 * A column hidden on a phone leaves its gap cell behind, so there are two gaps
 * in a row there. Accepted: the gap cell can't see whether its neighbour shows.
 *
 * Unverified in classic Outlook: a row of `%` columns plus `px` gap cells adds
 * up to more than the row, which browsers settle by shrinking the columns. If
 * Outlook overflows instead, the fix is an Outlook-only table with px widths
 * (#56). Not built until a real send says it's needed.
 */
function GapCell({ gap }: { readonly gap: number }): ReactNode {
  return (
    <td
      aria-hidden="true"
      style={{ width: gap, height: gap, fontSize: 0, lineHeight: 0 }}
    >
      {"\u00A0"}
    </td>
  );
}

/** The row's columns with a gap cell between each pair, when it has a gap. */
function withGaps(cells: readonly ReactNode[], gap: number): ReactNode[] {
  if (gap <= 0) return [...cells];
  return cells.flatMap((cell, index) =>
    index === 0
      ? [cell]
      : [<GapCell key={`gap-${String(index)}`} gap={gap} />, cell],
  );
}

/**
 * A row of columns, which arrives as two.
 *
 * The row owns its columns outright — it creates them, and an Author adds and
 * deletes them through it rather than dragging them about. So this is the one
 * palette entry for "put two things side by side", and dropping it gives
 * something that already works.
 *
 * It owns the row's own surface — a background, padding, an edge — and every
 * decision about the row's shape on a phone: whether its columns stack, and
 * whether they come out in the opposite order, so an image on the right of a
 * wide layout can be the first thing a thumb reaches. Both are the row's
 * because both are about the row: stacking one column and not its neighbour
 * produces markup nothing can render, and the row is the only Block that can
 * see more than one column at a time.
 *
 * What stays with the column is what one column can answer alone — its share of
 * the row, its own surface, and whether it is on a phone at all.
 */
function columnsDefinition(config: PresetDefaults) {
  return defineBlock<
    BandProps & {
      verticalAlign: string;
      gap: number;
      stackOnMobile: boolean;
      reverseOnMobile: boolean;
    }
  >({
    type: BLOCK_TYPE.columns,
    label: "Columns",
    accepts: [BLOCK_TYPE.column],
    // Two, because a row holding one column contradicts its own name and
    // renders as a single cell — which is a `section` with extra steps, and a
    // second way to say what the Preset already says once.
    minChildren: 2,
    // Six is 100px a column at 600px: a small logo, a byline, not much else.
    // Past that the ceiling stops being a guardrail against an unreadable
    // layout and becomes the reason the layout is unreadable.
    maxChildren: 6,
    ...BAND_VERSIONS,
    schema: {
      // The row's two surfaces: one across the window, and the column of
      // content inside it that every other Block in the email lines up with.
      ...surfaceSchema("Columns"),
      // On the content, not the band. A border drawn at the window's edges is
      // two lines an Author cannot see the ends of; drawn round the content it
      // is the card they were asking for.
      ...borderSchema(CONTENT_GROUP),
      // How the columns sit against each other, so the row's: one column
      // can't line up with its neighbours alone (#43). Neither is
      // Overridable. Alignment does nothing once the columns stack, and a
      // phone wants the same gap a desktop does (#71).
      verticalAlign: {
        kind: SchemaKind.select,
        label: "Vertical alignment",
        defaultValue: DEFAULT_VERTICAL_ALIGN,
        constraints: { options: VERTICAL_ALIGNS },
        group: CONTENT_GROUP,
      },
      // Half a padding's range: a wider gap leaves the columns no room.
      gap: {
        kind: SchemaKind.number,
        label: "Gap",
        defaultValue: 0,
        constraints: { min: 0, max: 48, unit: "px" },
        group: CONTENT_GROUP,
      },
      // The row's, not the column's. `lekh-stack` makes the element it is on a
      // full-width block, so a row where one column stacks and its neighbour
      // does not is a block followed by a cell with no row left to sit in — a
      // mixed state does not degrade, it breaks. One switch is also the honest
      // shape of the question: stacking is about the row's layout, which is why
      // it sits beside `reverseOnMobile` rather than six rows further down.
      //
      // On by default, because two 50% columns side by side at 375px are two
      // unreadable columns, and the sensible default is the one an Author never
      // has to find.
      stackOnMobile: {
        kind: SchemaKind.boolean,
        label: "Stack on mobile",
        defaultValue: true,
        group: MOBILE_GROUP,
      },
      reverseOnMobile: {
        kind: SchemaKind.boolean,
        label: "Reverse order on mobile",
        defaultValue: false,
        group: MOBILE_GROUP,
      },
      showOn: { ...SHOW_ON, group: MOBILE_GROUP },
    },
    validate: validateContentBackground,
    // Banded like a Section, and for the same reason — but the band takes the
    // hidden-on-mobile class, the background and the border, while the inner
    // `Row` keeps every class that reaches through to its own `<tbody>`:
    // reversal and stacking are rules about the cells of this row's `<tr>`,
    // and moving them out to the band would point them at markup that has no
    // columns in it.
    render: (context) => {
      const { props, children, mobile } = context;
      // Reversal is this Block's own mobile behaviour rather than one of the
      // library's fixed classes, because it is the only part that depends on the
      // markup around it: a flex container reorders its own children, and this
      // Block's columns are the cells of the `<tr>` inside `Row`. So the rule
      // reaches through the row it knows it rendered, and `Row` stays `Row`.
      if (props.reverseOnMobile) mobile.add(REVERSE_RULE);
      if (props.stackOnMobile) mobile.add(STACK_RULE);

      return band(
        context,
        config,
        <Row
          className={classNames(
            props.reverseOnMobile && REVERSE_CLASS,
            props.stackOnMobile && STACK_CLASS,
          )}
        >
          <RowAlignment.Provider value={props.verticalAlign}>
            {withGaps(children, props.gap)}
          </RowAlignment.Provider>
        </Row>,
      );
    },
  });
}

/** A column's props, which its cell styles itself from. */
type ColumnProps = {
  width: number;
  backgroundColor: Surface;
  showOn: string;
} & BorderProps &
  PaddingProps;

/**
 * One column of a row, which the row creates rather than the Author.
 *
 * Structural: it stays a Block in the Document, because a column holds several
 * Blocks and the tree is the only place that grouping can live — and because
 * its props need an owner. What it stops being is something an Author handles.
 * It is not in the palette, it cannot be dragged, and a press on one selects
 * the row: every route to it goes through the Block that owns it, which is also
 * where it is added, configured and deleted.
 *
 * The props here are the ones a column can answer on its own. Its width is the
 * exception that proves it — the number is stored here, but what it may be is
 * decided by the siblings it is dividing the row with.
 */
function columnDefinition() {
  return defineBlock<ColumnProps>({
    type: BLOCK_TYPE.column,
    label: "Column",
    structural: true,
    accepts: LEAF_TYPES,
    // Version 1 splits `padding` into four sides (ADR-0024).
    // Version 2 turns `hideOnMobile` into `showOn` (ADR-0025).
    version: 2,
    migrations: {
      1: splitPadding({ padding: ["Top", "Right", "Bottom", "Left"] }),
      2: SHOW_ON_FROM_HIDE_ON_MOBILE,
    },
    schema: {
      // The one prop no column owns by itself: the columns of a row divide it,
      // so the editor moves a neighbour whenever this moves and the row always
      // comes to a hundred. Ten per cent is sixty pixels at the default content
      // width — an icon or a short label, and the point past which a column
      // holds nothing at all. It sits under the hundred-pixels-a-column figure
      // `maxChildren` was chosen against, which is right: that guards what a
      // row arrives as, this bounds what an Author may deliberately ask for.
      width: {
        kind: SchemaKind.width,
        label: "Width",
        defaultValue: 50,
        constraints: { min: 10, max: 100, unit: "%" },
      },
      backgroundColor: BACKGROUND_COLOR,
      // The column is already a cell, so its padding needs no wrapper.
      ...paddingSchema(),
      ...borderSchema(),
      showOn: COLUMN_SHOW_ON,
    },
    // The width goes on as a percentage and nothing normalises it here: the
    // editor keeps the row summing to a hundred, and a table cell's percentage
    // is advisory anyway — a row that somehow did not add up is renormalised by
    // the client rather than overflowing it.
    render: ({ props, children, mobile }) => (
      <ColumnCell
        // Never through `shownOn`: a column cannot be mobile-only, and a
        // stored `"mobile"` shows on every screen rather than wrapping a cell.
        className={classNames(
          desktopOnlyClass(props.showOn, mobile),
          mobile.className,
        )}
        column={props}
      >
        {children}
      </ColumnCell>
    ),
  });
}

/**
 * A column's cell, aligned the way its row asked.
 *
 * A component rather than markup the column returns, because the alignment
 * comes from the row through `RowAlignment`, and only a component can read a
 * context. Everything else passes straight to the cell, so the Canvas's
 * Block id still lands on the `<td>`.
 */
function ColumnCell({
  column,
  ...cell
}: Omit<ComponentProps<typeof Column>, "style"> & {
  readonly column: Readonly<ColumnProps>;
}): ReactNode {
  return (
    <Column
      {...cell}
      style={{
        width: `${String(column.width)}%`,
        backgroundColor: column.backgroundColor,
        ...paddingStyles(column),
        verticalAlign: useContext(RowAlignment),
        ...borderStyles(column),
      }}
    />
  );
}

/** The row, with its columns, for `pickReactEmailPreset`. */
export const columnsBlock = presetBlock(BLOCK_TYPE.columns, (config) => [
  columnsDefinition(config),
  columnDefinition(),
]);
