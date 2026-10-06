/**
 * The band Section and Columns are both drawn as: a colour to the edges of the
 * window, and a column of content at the email's width inside it.
 */

import { Column, Container, Row, Section } from "@react-email/components";
import type { ReactElement, ReactNode } from "react";

import { assetOf, type Asset } from "../core/document/assets";
import { NONE, parseColor } from "../core/document/color";
import { SchemaKind, type Surface } from "../core/document/definition";
import { validatedProps } from "../core/document/props";
import { escapeAttribute, isSafeUrl } from "../core/markup/markup-safety";
import type { BlockRenderContext } from "../core/document/definition";
import type {
  Diagnostic,
  ValidationContext,
} from "../core/validate/diagnostic";
import type { Block } from "../core/document/document";
import { shownOn } from "./leaf";
import { PresetDiagnostic } from "./names";
import { contentWidthOf, type PresetDefaults } from "./options";
import {
  BACKGROUND_COLOR,
  borderStyles,
  CONTENT_GROUP,
  paddingSchema,
  paddingStyles,
  SHOW_ON_FROM_HIDE_ON_MOBILE,
  splitPadding,
  type BorderProps,
  type PaddingProps,
} from "./schema";

/**
 * The versions Section and Columns share. Version 1 splits `paddingY` and
 * `paddingX` into four sides (ADR-0024). Version 2 turns `hideOnMobile` into
 * `showOn` (ADR-0025).
 */
export const BAND_VERSIONS = {
  version: 2,
  migrations: {
    1: splitPadding({
      paddingY: ["Top", "Bottom"],
      paddingX: ["Left", "Right"],
    }),
    2: SHOW_ON_FROM_HIDE_ON_MOBILE,
  },
};

/**
 * The two surfaces every band offers, grouped under its own name.
 *
 * Both start at `NONE`, like every other colour in this Preset: a container an
 * Author has not styled shows the email through it rather than a white the
 * library decided on their behalf. A Consumer wanting a house style says so in
 * the Document they open the editor with, or in Definitions of their own.
 */
export function surfaceSchema(ownGroup: string) {
  return {
    // "Full-width": it reaches the edges of the reader's window. The Content
    // one below is the background an Author means, so it takes the plain name.
    backgroundColor: {
      ...BACKGROUND_COLOR,
      label: "Full-width background color",
      group: ownGroup,
    },
    // The email's column colour until the Author sets one here, and `none`
    // stored here keeps this one clear (ADR-0022). A root `none` is no colour
    // to follow, so the band falls back to its own `none`.
    contentBackgroundColor: {
      kind: SchemaKind.surface,
      label: "Background color",
      follows: "contentBackgroundColor",
      defaultValue: NONE,
      group: CONTENT_GROUP,
    },
    // Optional, not primary: a section is not an image, so a dropped file
    // never becomes one and placing one asks for nothing (ADR-0026). Not
    // Overridable, as no Asset is. The colour above is its fallback.
    // Decorative: a background is never drawn with its alt text.
    contentBackgroundImage: {
      kind: SchemaKind.asset,
      label: "Content background image",
      defaultValue: undefined,
      decorative: true,
      group: CONTENT_GROUP,
    },
    // Padding on the content, inside the colour, in the Content group.
    ...paddingSchema(CONTENT_GROUP),
  } as const;
}

/** What a band reads to draw itself. */
export type BandProps = {
  readonly backgroundColor: Surface;
  readonly contentBackgroundColor: Surface;
  readonly contentBackgroundImage: Asset | undefined;
  readonly showOn: string;
} & BorderProps &
  PaddingProps;

/**
 * A band, not a box. The Section spans whatever window the email is being read
 * in and carries the background; the Container inside it holds the content to
 * the email's width and centres it. Two elements rather than one because that
 * is the only way a colour reaches the edge of a client's window while the
 * words stay in a readable column.
 *
 * The padding goes on a cell inside the column, so it insets the content
 * without interrupting the band: an Author asking for 32px of breathing room is
 * not asking for a stripe of the page's colour down each side. A cell, because
 * react.email's `Container` styles its table, and the Mobile Override class
 * goes on the same cell so an override replaces the padding rather than adding
 * to it (ADR-0020). The hidden class stays on the band.
 *
 * The border goes round the content column, outside the padding, and the
 * content cell's width comes inside it. Section and Columns draw it the same
 * way, so two stacked with the same border and padding line up.
 */
export function band(
  {
    props,
    mobile,
    rootProps,
    outlook,
  }: Pick<
    BlockRenderContext<BandProps>,
    "props" | "mobile" | "rootProps" | "outlook"
  >,
  config: PresetDefaults,
  children: ReactNode,
): ReactElement {
  const contentWidth = contentWidthOf(rootProps, config);
  return shownOn(props.showOn, mobile, (hideClass) => (
    <Section
      className={hideClass}
      style={{ backgroundColor: props.backgroundColor }}
    >
      <Container
        style={{
          maxWidth: contentWidth,
          backgroundColor: props.contentBackgroundColor,
          ...borderStyles(props),
        }}
      >
        <Row>
          <ContentCell
            props={props}
            className={mobile.className}
            width={contentWidth - 2 * lengthOf(props.borderWidth)}
            outlook={outlook}
          >
            {children}
          </ContentCell>
        </Row>
      </Container>
    </Section>
  ));
}

/**
 * The cell a container's content sits in, padded, with its background image
 * behind it when there is one.
 *
 * The image is always cover, centred, no repeat, over the content colour: that
 * colour is what shows wherever images are off. Classic Outlook draws none of
 * the CSS, so it gets the same picture as a VML rectangle the content flows
 * inside. Between its two halves there is exactly one plain `<div>` and nothing
 * else, because that is the only shape known to hold up there. The rectangle
 * is as wide as the cell inside its padding, and square: Outlook drops the
 * row's rounded corners. `width` is the cell's own width, inside any border.
 *
 * Without an image this is the padded cell it always was.
 */
function ContentCell({
  props,
  className,
  width,
  outlook,
  children,
}: {
  readonly props: BandProps;
  readonly className: string | undefined;
  readonly width: number;
  readonly outlook: BlockRenderContext<unknown>["outlook"];
  readonly children: ReactNode;
}): ReactNode {
  const url = backgroundImageUrlOf(props.contentBackgroundImage);
  const padding = paddingStyles(props);
  if (url === undefined) {
    return (
      <Column className={className} style={padding}>
        {children}
      </Column>
    );
  }

  const color = props.contentBackgroundColor;
  const fill =
    color !== undefined && parseColor(color).kind !== "transparent"
      ? color
      : undefined;
  // Inside the padding, because the rectangle sits inside the cell. Outlook
  // leaves the padding the content colour; every other client paints it.
  const inner = Math.max(
    0,
    width - lengthOf(props.paddingLeft) - lengthOf(props.paddingRight),
  );
  return outlook(
    <Column
      className={className}
      // `bgcolor` too: the colour has to survive where the CSS does not.
      {...(fill === undefined ? {} : { bgcolor: fill })}
      style={{
        ...padding,
        backgroundColor: fill,
        backgroundImage: `url("${url}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div>{children}</div>
    </Column>,
    `<v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" ` +
      `style="width:${String(inner)}px;mso-fit-shape-to-text:true">` +
      `<v:fill type="frame" src="${escapeAttribute(url)}"` +
      (fill === undefined ? "" : ` color="${escapeAttribute(fill)}"`) +
      ` aspect="atleast"/>` +
      `<v:textbox inset="0,0,0,0">`,
    `</v:textbox></v:rect>`,
  );
}

/** A stored length in px, or none for anything that is not a usable one. */
function lengthOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/**
 * A background image's location as the email writes it, or `undefined` when
 * there is none it may carry.
 *
 * An Asset whose `src` passes the scheme allowlist, a `data:image/` one
 * included (ADR-0033). Anything else draws no image, and the colour behind it
 * shows. The root's page image and a band's content image both read through
 * here, so neither can draw what the other refuses.
 */
export function backgroundImageUrlOf(value: unknown): string | undefined {
  const image = assetOf(value);
  return image !== undefined && isSafeUrl(image.src, true)
    ? urlForCss(image.src)
    : undefined;
}

/**
 * An image's location, safe inside a quoted CSS `url()` and a quoted attribute.
 *
 * It is Author data (ADR-0012). Percent-encoding the characters that could end
 * the string, the function or the tag leaves the same URL, so the CSS and the
 * VML ask for the same image and neither can be broken out of.
 */
function urlForCss(src: string): string {
  return src.replaceAll(/[\s"'()<>\\]/gu, (character) =>
    "'()".includes(character)
      ? `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`
      : encodeURIComponent(character),
  );
}

/**
 * Warn when a content background image has no colour behind it.
 *
 * Many clients block images until the reader allows them, and then the text
 * sits on whatever is behind the container. A colour is the fallback.
 */
export function validateContentBackground(
  block: Block,
  context: ValidationContext,
): Diagnostic[] {
  const props = validatedProps(block, context);
  if (backgroundImageUrlOf(props["contentBackgroundImage"]) === undefined) {
    return [];
  }
  if (parseColor(props["contentBackgroundColor"]).kind !== "transparent") {
    return [];
  }
  return [
    {
      code: PresetDiagnostic.backgroundImageColorMissing,
      message:
        "With images off, this text may be unreadable. Pick a content " +
        "color the text reads on.",
      severity: "warning",
      blockId: block.id,
      prop: "contentBackgroundColor",
    },
  ];
}
