import { Hr } from "@react-email/components";

import {
  defineBlock,
  SchemaKind,
  type Surface,
} from "../core/document/definition";
import {
  alignment,
  alignSchema,
  directionOf,
} from "../core/document/typography";
import { presetBlock } from "./block";
import { autoMargins, LEAF_VERSIONS, leafShell } from "./leaf";
import { BLOCK_TYPE } from "./names";
import {
  BACKGROUND_COLOR,
  BORDER_STYLES,
  leafSchema,
  type PaddingProps,
} from "./schema";

/** A horizontal rule between Blocks. */
function dividerDefinition() {
  return defineBlock<
    {
      color: string;
      thickness: number;
      lineStyle: string;
      width: number;
      align: string;
      backgroundColor: Surface;
      showOn: string;
    } & PaddingProps
  >({
    type: BLOCK_TYPE.divider,
    label: "Divider",
    ...LEAF_VERSIONS,
    schema: {
      color: {
        kind: SchemaKind.color,
        label: "Color",
        defaultValue: "#e6e6e6",
      },
      // The rule's own look. Every default is how it looked before, so a
      // stored divider needs no migration, and none is Overridable (#70).
      thickness: {
        kind: SchemaKind.number,
        label: "Thickness",
        defaultValue: 1,
        constraints: { min: 1, max: 12, unit: "px" },
      },
      lineStyle: {
        kind: SchemaKind.select,
        label: "Line style",
        defaultValue: "solid",
        constraints: { options: BORDER_STYLES },
      },
      // A share of the cell, so it stays a share in a narrow column.
      width: {
        kind: SchemaKind.number,
        label: "Width",
        defaultValue: 100,
        constraints: { min: 10, max: 100, unit: "%" },
      },
      // Centred, because a short rule is usually a break in the middle of the
      // page. Nothing to see until the width is under 100%.
      align: alignSchema("center", false),
      backgroundColor: BACKGROUND_COLOR,
      // 16 above and below, the space the rule's own margin used to give, so
      // a divider nobody has touched looks as it always has.
      ...leafSchema({ paddingTop: 16, paddingBottom: 16 }),
    },
    // An `<hr>` is a border and nothing else: its box is zero pixels tall, so a
    // background on the rule would be invisible. The shell's cell is what the
    // background paints, what the padding pads, and what wears the Mobile
    // Override class. The rule keeps no margin, since the padding is the space.
    //
    // The line is the top border alone. react.email's `Hr` sets `border: none`
    // first, so no other edge shows. Alignment is done twice, like the image:
    // auto margins for clients that read CSS, and the cell's `align` for
    // Outlook, which reads neither.
    render: ({ props, mobile, rootProps }) => {
      const align = alignment(props.align, directionOf(rootProps), "center");
      return leafShell(props, mobile, {
        align,
        style: { textAlign: align, backgroundColor: props.backgroundColor },
        children: (
          <Hr
            style={{
              width: `${String(props.width)}%`,
              borderTop: `${String(props.thickness)}px ${props.lineStyle} ${props.color}`,
              margin: 0,
              ...autoMargins(align),
            }}
          />
        ),
      });
    },
  });
}

/** The divider, for `pickReactEmailPreset`. */
export const dividerBlock = presetBlock(BLOCK_TYPE.divider, () => [
  dividerDefinition(),
]);
