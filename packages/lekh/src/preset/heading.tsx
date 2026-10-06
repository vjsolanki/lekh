import { Heading } from "@react-email/components";

import {
  defineBlock,
  SchemaKind,
  type Surface,
} from "../core/document/definition";
import { RichText } from "../core/render/rich-text";
import {
  alignment,
  ALIGNMENT_BY_READING_ORDER,
  alignSchema,
  directionOf,
  fontFamilyOf,
  pixels,
} from "../core/document/typography";
import { presetBlock } from "./block";
import { leafShell } from "./leaf";
import { BLOCK_TYPE } from "./names";
import { linkColorOf, type PresetDefaults } from "./options";
import {
  BACKGROUND_COLOR,
  leafSchema,
  SHOW_ON_FROM_HIDE_ON_MOBILE,
  textColorSchema,
  typographySchema,
  typographyStyles,
  type PaddingProps,
  type TypographyDefaults,
  type TypographyProps,
} from "./schema";

/** A heading starts tight and bold, as clients draw an `h1` unstyled. */
const HEADING_TYPOGRAPHY: TypographyDefaults = {
  lineHeight: 1.2,
  fontWeight: 700,
};

/** One line of rich text, as an `h1`, `h2` or `h3`. */
function headingDefinition(config: PresetDefaults) {
  return defineBlock<
    {
      content: string;
      level: number;
      fontSize: number;
      color: string;
      backgroundColor: Surface;
      align: string;
      showOn: string;
    } & TypographyProps &
      PaddingProps
  >({
    type: BLOCK_TYPE.heading,
    label: "Heading",
    // Version 1 follows the email's text colour. A heading stored before it
    // with no colour of its own rendered in #111111, and keeps it (ADR-0022).
    // Version 2 turns `hideOnMobile` into `showOn` (ADR-0025).
    // Version 3 stores alignment by reading order (ADR-0027).
    version: 3,
    migrations: {
      1: ({ props, mobile }) => ({
        props:
          props["color"] === undefined ? { ...props, color: "#111111" } : props,
        mobile,
      }),
      2: SHOW_ON_FROM_HIDE_ON_MOBILE,
      3: ALIGNMENT_BY_READING_ORDER,
    },
    schema: {
      content: {
        kind: SchemaKind.richText,
        label: "Heading",
        defaultValue: "Your heading",
      },
      level: {
        kind: SchemaKind.select,
        label: "Level",
        defaultValue: 1,
        constraints: {
          options: [
            { label: "H1", value: 1 },
            { label: "H2", value: 2 },
            { label: "H3", value: 3 },
          ],
        },
      },
      // Explicit rather than left to each client's idea of an `h1`, which is
      // also what gives the mobile Stage something to override: a 32px headline
      // is what overflows a phone.
      fontSize: {
        kind: SchemaKind.number,
        label: "Font size",
        defaultValue: 28,
        constraints: { min: 14, max: 64, unit: "px" },
        mobile: pixels("font-size"),
      },
      ...typographySchema(HEADING_TYPOGRAPHY),
      color: textColorSchema(config),
      backgroundColor: BACKGROUND_COLOR,
      align: alignSchema("start", true),
      ...leafSchema(),
    },
    // In the leaf shell, as the text Block is, for the same reason: the
    // padding needs a cell, and the Mobile Override class goes on that cell.
    // So the cell carries the size and alignment too, and the heading sizes
    // itself at `1em` of it and inherits the alignment, which lets one
    // override reach it (ADR-0023).
    render: ({ props, mobile, rootProps }) => {
      const align = alignment(props.align, directionOf(rootProps));
      return leafShell(props, mobile, {
        align,
        style: {
          backgroundColor: props.backgroundColor,
          fontSize: props.fontSize,
          textAlign: align,
        },
        children: (
          <Heading
            as={headingTag(props.level)}
            style={{
              color: props.color,
              fontFamily: fontFamilyOf(rootProps, config),
              fontSize: "1em",
              ...typographyStyles(props, HEADING_TYPOGRAPHY),
              margin: 0,
            }}
          >
            <RichText
              value={props.content}
              linkColor={linkColorOf(rootProps, config)}
            />
          </Heading>
        ),
      });
    },
  });
}

function headingTag(level: unknown): "h1" | "h2" | "h3" {
  if (level === 2) return "h2";
  return level === 3 ? "h3" : "h1";
}

/** The heading, for `pickReactEmailPreset`. */
export const headingBlock = presetBlock(BLOCK_TYPE.heading, (config) => [
  headingDefinition(config),
]);
