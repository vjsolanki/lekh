import { Button } from "@react-email/components";

import { missingProp } from "../core/validate/blank";
import {
  defineBlock,
  SchemaKind,
  type Surface,
} from "../core/document/definition";
import {
  alignment,
  alignSchema,
  directionOf,
  fontFamilyOf,
} from "../core/document/typography";
import { presetBlock } from "./block";
import { LEAF_VERSIONS, leafShell } from "./leaf";
import { BLOCK_TYPE, PresetDiagnostic } from "./names";
import type { PresetDefaults } from "./options";
import {
  borderSchema,
  borderStyles,
  paddingSchema,
  SHOW_ON,
  weightAndSpacingSchema,
  weightAndSpacingStyles,
  type BorderProps,
  type PaddingProps,
} from "./schema";

/**
 * The button's own rule for a phone: its anchor, full width.
 *
 * Structural, like hiding, so a fixed class rather than a Mobile Override. The
 * override class sits on the cell, and the width belongs on the anchor inside
 * it, so the rule reaches through markup the button knows it emitted
 * (ADR-0012).
 */
const FULL_WIDTH_CLASS = "lekh-button-full";
const FULL_WIDTH_RULE =
  `.${FULL_WIDTH_CLASS} a{display:block!important;` +
  `text-align:center!important}`;

const BUTTON_INNER_PADDING = { min: 0, max: 48, unit: "px" } as const;
const BUTTON_FONT_WEIGHT = 400;

/** A link drawn as a button. */
function buttonDefinition(config: PresetDefaults) {
  return defineBlock<
    {
      label: string;
      href: string;
      backgroundColor: Surface;
      color: string;
      align: string;
      innerPaddingY: number;
      innerPaddingX: number;
      fullWidth: boolean;
      fullWidthOnMobile: boolean;
      fontSize: number;
      fontWeight: number;
      letterSpacing: number;
      showOn: string;
    } & BorderProps &
      PaddingProps
  >({
    type: BLOCK_TYPE.button,
    label: "Button",
    ...LEAF_VERSIONS,
    schema: {
      label: {
        kind: SchemaKind.text,
        label: "Label",
        defaultValue: "Read more",
      },
      href: { kind: SchemaKind.url, label: "Links to", defaultValue: "" },
      backgroundColor: {
        kind: SchemaKind.surface,
        label: "Background color",
        defaultValue: "#111111",
      },
      // The button's own, not the email's text colour: the label sits on the
      // button's fill, not on the page.
      color: {
        kind: SchemaKind.color,
        label: "Text color",
        defaultValue: "#ffffff",
        on: "backgroundColor",
      },
      // Every default below is how the button looked before it had the prop,
      // so a stored button needs no migration (#69).
      align: alignSchema("start", true),
      // The leaf's padding, declared before the inner Box because it is the
      // outer one: the Canvas takes the first declared Box as the outer when
      // both have the same values (ADR-0040).
      ...paddingSchema(),
      // The space inside the button, around its label: its own Box, apart from
      // the outer padding. Not Overridable: a phone's button is as fat as a
      // desktop's. Advanced: the Preset's default fits most labels.
      innerPaddingY: {
        kind: SchemaKind.number,
        label: "Inner padding, top and bottom",
        defaultValue: 12,
        constraints: BUTTON_INNER_PADDING,
        box: "inner",
        side: ["top", "bottom"],
        advanced: true,
      },
      innerPaddingX: {
        kind: SchemaKind.number,
        label: "Inner padding, sides",
        defaultValue: 20,
        constraints: BUTTON_INNER_PADDING,
        box: "inner",
        side: ["left", "right"],
        advanced: true,
      },
      fullWidth: {
        kind: SchemaKind.boolean,
        label: "Full width",
        defaultValue: false,
      },
      fullWidthOnMobile: {
        kind: SchemaKind.boolean,
        label: "Full width on mobile",
        defaultValue: false,
      },
      ...borderSchema(undefined, 6),
      // The label's type. No line height: the inner padding is what makes a
      // button taller. The family still follows the email's.
      fontSize: {
        kind: SchemaKind.number,
        label: "Font size",
        defaultValue: 16,
        constraints: { min: 12, max: 32, unit: "px" },
      },
      ...weightAndSpacingSchema(BUTTON_FONT_WEIGHT),
      showOn: SHOW_ON,
    },
    validate: (block, context) =>
      missingProp(block, context, "href", {
        code: PresetDiagnostic.buttonHrefMissing,
        message: "This button does not go anywhere.",
        severity: "warning",
      }),
    // In the leaf shell, because react.email's Button is an inline-block
    // anchor: two of them would sit side by side on one line, and two Blocks
    // sharing a line have no vertical midpoint for a drop to aim at — Drop
    // Target resolution reads a Block's rectangle, and there is only one
    // rectangle to go round. The image Block earns its row the same way, for
    // the gap an aligned image leaves beside itself. The cell holds the
    // padding, the alignment and the Mobile Override class, and since the
    // anchor is inline-block, the cell's `text-align` moves it. The inner
    // padding is the button's, not the Block's.
    //
    // Full width makes the anchor a block. Classic Outlook ignores `display`
    // on an anchor, so there the button likely stays as wide as its label
    // (#56).
    render: ({ props, mobile, rootProps }) => {
      const align = alignment(props.align, directionOf(rootProps));
      if (props.fullWidthOnMobile) mobile.add(FULL_WIDTH_RULE);
      return leafShell(props, mobile, {
        align,
        className: props.fullWidthOnMobile && FULL_WIDTH_CLASS,
        style: { textAlign: align },
        children: (
          <Button
            href={props.href}
            style={{
              backgroundColor: props.backgroundColor,
              ...borderStyles(props),
              color: props.color,
              fontFamily: fontFamilyOf(rootProps, config),
              fontSize: props.fontSize,
              ...weightAndSpacingStyles(props, BUTTON_FONT_WEIGHT),
              paddingTop: props.innerPaddingY,
              paddingRight: props.innerPaddingX,
              paddingBottom: props.innerPaddingY,
              paddingLeft: props.innerPaddingX,
              ...(props.fullWidth
                ? { display: "block", textAlign: "center" }
                : {}),
            }}
          >
            {props.label}
          </Button>
        ),
      });
    },
  });
}

/** The button, for `pickReactEmailPreset`. */
export const buttonBlock = presetBlock(BLOCK_TYPE.button, (config) => [
  buttonDefinition(config),
]);
