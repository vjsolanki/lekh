import {
  defineBlock,
  SchemaKind,
  type Surface,
} from "../core/document/definition";
import { pixels } from "../core/document/typography";
import { presetBlock } from "./block";
import { leafShell } from "./leaf";
import { BLOCK_TYPE } from "./names";
import { BACKGROUND_COLOR, SHOW_ON } from "./schema";

/**
 * Classic Outlook's rule that a line is exactly its line height. Not in
 * React's CSS types, so spread in rather than written inline.
 */
const OUTLOOK_EXACT_LINE = { msoLineHeightRule: "exactly" };

/**
 * A blank gap between Blocks, a height and an optional colour (#76).
 *
 * No padding: the spacer is spacing. The height is Overridable, because a gap
 * tuned for a desktop is often too big on a phone (ADR-0007).
 *
 * One cell, its height written three ways: the attribute, `height` and
 * `line-height`. The zeroed font and Outlook's exact line rule stop classic
 * Outlook growing a small gap to a line of text, and the `&nbsp;` stops a
 * client collapsing the empty cell. The override writes both, or a shorter
 * height would leave the line box as tall as before.
 */
function spacerDefinition() {
  return defineBlock<{
    height: number;
    backgroundColor: Surface;
    showOn: string;
  }>({
    type: BLOCK_TYPE.spacer,
    label: "Spacer",
    schema: {
      height: {
        kind: SchemaKind.number,
        label: "Height",
        defaultValue: 24,
        constraints: { min: 4, max: 160, unit: "px" },
        mobile: pixels("height", "line-height"),
      },
      backgroundColor: BACKGROUND_COLOR,
      showOn: SHOW_ON,
    },
    render: ({ props, mobile }) =>
      leafShell(props, mobile, {
        height: props.height,
        style: {
          height: props.height,
          lineHeight: `${String(props.height)}px`,
          fontSize: 0,
          ...OUTLOOK_EXACT_LINE,
          backgroundColor: props.backgroundColor,
        },
        children: " ",
      }),
  });
}

/** The spacer, for `pickReactEmailPreset`. */
export const spacerBlock = presetBlock(BLOCK_TYPE.spacer, () => [
  spacerDefinition(),
]);
