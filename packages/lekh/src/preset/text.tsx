import {
  defineBlock,
  SchemaKind,
  type Surface,
} from "../core/document/definition";
import { RichText } from "../core/render/rich-text";
import {
  alignment,
  alignSchema,
  directionOf,
  fontFamilyOf,
  pixels,
} from "../core/document/typography";
import { presetBlock } from "./block";
import { LEAF_VERSIONS, leafShell } from "./leaf";
import { BLOCK_TYPE } from "./names";
import { linkColorOf, type PresetDefaults } from "./options";
import {
  BACKGROUND_COLOR,
  leafSchema,
  textColorSchema,
  typographySchema,
  typographyStyles,
  type PaddingProps,
  type TypographyDefaults,
  type TypographyProps,
} from "./schema";

/**
 * Text starts at 1.5, which is the 24px react.email's `Text` fixed at 16px,
 * but grows with the size instead of overlapping at 32px.
 */
const TEXT_TYPOGRAPHY: TypographyDefaults = {
  lineHeight: 1.5,
  fontWeight: 400,
};

/**
 * A margin with space only below. Longhands, so the zeroed bottom margin of the
 * last paragraph, list or item replaces one value rather than half a shorthand.
 */
function spaced(below: number) {
  return { marginTop: 0, marginRight: 0, marginBottom: below, marginLeft: 0 };
}

/** Body copy: rich text in paragraphs and lists. */
function textDefinition(config: PresetDefaults) {
  return defineBlock<
    {
      content: string;
      fontSize: number;
      color: string;
      backgroundColor: Surface;
      align: string;
      paragraphSpacing: number;
      listItemSpacing: number;
      showOn: string;
    } & TypographyProps &
      PaddingProps
  >({
    type: BLOCK_TYPE.text,
    label: "Text",
    ...LEAF_VERSIONS,
    schema: {
      // Body copy, so it holds paragraphs and lists: Return starts one,
      // Shift+Return breaks the line. The heading stays one line (ADR-0023,
      // ADR-0029).
      content: {
        kind: SchemaKind.richText,
        label: "Content",
        defaultValue: "Write something worth reading.",
        constraints: { paragraphs: true, lists: true },
      },
      fontSize: {
        kind: SchemaKind.number,
        label: "Font size",
        defaultValue: 16,
        constraints: { min: 10, max: 48, unit: "px" },
        mobile: pixels("font-size"),
      },
      ...typographySchema(TEXT_TYPOGRAPHY),
      color: textColorSchema(config),
      backgroundColor: BACKGROUND_COLOR,
      align: alignSchema("start", true),
      // The space between paragraphs, not around the Block: that is padding.
      // Not Overridable, since a phone needs the same gap a desktop does
      // (#71).
      paragraphSpacing: {
        kind: SchemaKind.number,
        label: "Paragraph spacing",
        defaultValue: 16,
        constraints: { min: 0, unit: "px" },
      },
      // The space between a list's items. Smaller than between paragraphs,
      // since an item is usually one short line (ADR-0029). Not Overridable,
      // for the same reason paragraph spacing is not.
      listItemSpacing: {
        kind: SchemaKind.number,
        label: "List item spacing",
        defaultValue: 4,
        constraints: { min: 0, max: 48, unit: "px" },
      },
      ...leafSchema(),
    },
    // In the leaf shell rather than react.email's `Text`, because a `<p>`
    // cannot hold the paragraphs. The cell is the Block's one surface: it
    // paints the background through the gaps, and it carries the padding, the
    // size and the alignment with the Mobile Override class, so one override
    // reaches every paragraph. Each `<p>` still writes the font, colour and
    // margins inline, because some mail clients set their own, and sizes
    // itself at `1em` of the cell.
    //
    // A list and each of its items write the same text style, for the same
    // reason. The list's indent is one and a half times the font size, in
    // pixels, on the side the text starts from (ADR-0029).
    render: ({ props, mobile, rootProps }) => {
      const direction = directionOf(rootProps);
      const align = alignment(props.align, direction);
      const text = {
        color: props.color,
        fontFamily: fontFamilyOf(rootProps, config),
        fontSize: "1em",
        ...typographyStyles(props, TEXT_TYPOGRAPHY),
      };
      return leafShell(props, mobile, {
        align,
        style: {
          backgroundColor: props.backgroundColor,
          fontSize: props.fontSize,
          textAlign: align,
        },
        children: (
          <RichText
            value={props.content}
            linkColor={linkColorOf(rootProps, config)}
            paragraphStyle={{ ...text, ...spaced(props.paragraphSpacing) }}
            listStyle={{ ...spaced(props.paragraphSpacing), ...text }}
            listItemStyle={{ ...spaced(props.listItemSpacing), ...text }}
            listIndent={Math.round(props.fontSize * 1.5)}
            direction={direction}
          />
        ),
      });
    },
  });
}

/** The text, for `pickReactEmailPreset`. */
export const textBlock = presetBlock(BLOCK_TYPE.text, (config) => [
  textDefinition(config),
]);
