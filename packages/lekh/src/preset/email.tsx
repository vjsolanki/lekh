import { Preview } from "@react-email/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import type { Asset } from "../core/document/assets";
import { isUsableColor, NONE, parseColor } from "../core/document/color";
import { validatedProps } from "../core/document/props";
import {
  defineBlock,
  SchemaKind,
  type BlockRenderContext,
  type Surface,
} from "../core/document/definition";
import type { Diagnostic } from "../core/validate/diagnostic";
import type { SetPropRepair } from "../core/validate/repair";
import { MobileStyles } from "../core/layout/responsive";
import { escapeAttribute } from "../core/markup/markup-safety";
import {
  directionOf,
  fontFamilyOf,
  isSafeFontStack,
  type Direction,
} from "../core/document/typography";
import { backgroundImageUrlOf } from "./band";
import { BLOCK_TYPE, LEAF_TYPES, PresetDiagnostic } from "./names";
import type { PresetDefaults } from "./options";

/** The two directions an email can run in, in an Author's words. */
const DIRECTIONS: readonly { label: string; value: Direction }[] = [
  { label: "Left to right", value: "ltr" },
  { label: "Right to left", value: "rtl" },
];

/** The namespaces classic Outlook reads VML and Office settings under. */
const OFFICE_NAMESPACES: Readonly<Record<string, string>> = {
  "xmlns:v": "urn:schemas-microsoft-com:vml",
  "xmlns:o": "urn:schemas-microsoft-com:office:office",
};

/**
 * Keeps classic Outlook at 96 DPI. On a 120 DPI screen it scales pixel sizes
 * and VML apart, and a background image stops lining up with its content.
 * In every email, image or not: it costs nothing where it is not needed.
 */
const OFFICE_SETTINGS =
  "<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>" +
  "</o:OfficeDocumentSettings></xml>";

/**
 * The email's language tag, if it stores one that looks like a tag: letters,
 * digits and hyphens, starting with two or three letters. Anything else writes
 * no `lang` at all rather than refusing to render: a missing `lang` costs
 * nothing a reader can see, and a wrong one is worse than none.
 */
function languageOf(
  rootProps: Readonly<Record<string, unknown>>,
): string | undefined {
  const language = rootProps["language"];
  if (typeof language !== "string") return undefined;
  const tag = language.trim();
  return /^[a-z]{2,3}(?:-[a-z\d]+)*$/iu.test(tag) ? tag : undefined;
}

/** The root every email is built around: its page, font, colours, language and direction. */
export function emailDefinition(config: PresetDefaults) {
  return defineBlock<{
    backgroundColor: Surface;
    backgroundImage: Asset | undefined;
    contentBackgroundColor: Surface;
    contentWidth: number;
    fontFamily: string;
    textColor: string;
    linkColor: string;
    language: string;
    direction: string;
    previewText: string;
  }>({
    type: BLOCK_TYPE.email,
    label: "Email",
    accepts: [BLOCK_TYPE.section, BLOCK_TYPE.columns, ...LEAF_TYPES],
    schema: {
      // What every section's and row's content column follows until the
      // Author colours that one (ADR-0022). The root draws no column of its
      // own: each band centres its own, and a Block placed on the root sits
      // on the page. Not Overridable: one column colour per email.
      // Declared first, under the page colour: Surfaces stack in Schema
      // order, so text on the root is read against the page, not this.
      contentBackgroundColor: {
        kind: SchemaKind.surface,
        label: "Content background color",
        defaultValue: NONE,
      },
      backgroundColor: {
        kind: SchemaKind.surface,
        label: "Background color",
        defaultValue: config.backgroundColor,
      },
      // Optional, not primary, like a band's (ADR-0026). Wallpaper rather than
      // a picture, so it always tiles. Not Overridable. The colour above is
      // its fallback. Decorative: it is never drawn with its alt text.
      backgroundImage: {
        kind: SchemaKind.asset,
        label: "Background image",
        defaultValue: undefined,
        decorative: true,
      },
      contentWidth: {
        kind: SchemaKind.number,
        label: "Content width",
        defaultValue: config.contentWidth,
        constraints: { min: 320, max: 800, step: 10, unit: "px" },
      },
      // The stack itself rather than a label, so a stored email says what it
      // looks like without the list it was picked from. A stack not on the
      // list renders as stored: the list is a menu, not a gate (ADR-0021).
      // Not Overridable: one font per email.
      fontFamily: {
        kind: SchemaKind.select,
        label: "Font",
        defaultValue: config.fontFamily,
        constraints: { options: config.fonts },
      },
      // What text and headings follow, and what every link in them is written
      // in (ADR-0022). Not Overridable: one ink per email.
      textColor: {
        kind: SchemaKind.color,
        label: "Text color",
        defaultValue: config.textColor,
      },
      linkColor: {
        kind: SchemaKind.color,
        label: "Link color",
        defaultValue: config.linkColor,
      },
      // The tag as typed. The editor takes anything (ADR-0006); render writes
      // it only when it looks like a tag. Not Overridable: one language per
      // email.
      language: {
        kind: SchemaKind.text,
        label: "Language",
        defaultValue: config.language,
      },
      // Its own prop, not read off the language: a tag says what the words
      // are, not which way the Author wants them laid out. Not Overridable:
      // one direction per email (ADR-0027).
      direction: {
        kind: SchemaKind.select,
        label: "Direction",
        defaultValue: config.direction,
        constraints: { options: DIRECTIONS },
      },
      previewText: {
        kind: SchemaKind.text,
        label: "Preview text",
        defaultValue: "",
        constraints: { maxLength: 150 },
      },
    },
    // Render falls back to the default rather than refusing, so this is a
    // warning: the email still goes, in a font the Author did not pick.
    // The colours are the same: a Block following one gets the default.
    validate: (block, context) => {
      const props = validatedProps(block, context);
      const found: Diagnostic[] = [];
      const flag = (code: string, prop: string, message: string): void => {
        const repair: SetPropRepair = {
          kind: "set-prop",
          blockId: block.id,
          prop,
          value: undefined,
          stage: "desktop",
        };
        found.push({
          code,
          message,
          severity: "warning",
          blockId: block.id,
          prop,
          repair,
        });
      };

      if (!isSafeFontStack(props["fontFamily"])) {
        flag(
          PresetDiagnostic.fontFamilyUnsafe,
          "fontFamily",
          "This font cannot be used, so the email uses the default.",
        );
      }
      for (const [prop, what] of [
        ["textColor", "text"],
        ["linkColor", "link"],
      ] as const) {
        if (isUsableColor(props[prop])) continue;
        flag(
          PresetDiagnostic.emailColorUnusable,
          prop,
          `This ${what} color cannot be used, so the email uses the default.`,
        );
      }
      // Many clients block images until the reader allows them. With no page
      // colour, the reader's own window shows instead. Only for an image that
      // renders: an unsafe one draws nothing to fall back from. No Repair: which colour
      // is the Author's to pick, as it is on a band.
      if (
        backgroundImageUrlOf(props["backgroundImage"]) !== undefined &&
        parseColor(props["backgroundColor"]).kind === "transparent"
      ) {
        found.push({
          code: PresetDiagnostic.backgroundImageColorMissing,
          message:
            "With images off, the page shows the reader's own window " +
            "color. Pick a background color.",
          severity: "warning",
          blockId: block.id,
          prop: "backgroundColor",
        });
      }
      return found;
    },
    render: ({ props, children, mobile, outlook }) => {
      const lang = languageOf(props);
      const dir = directionOf(props);
      const fontFamily = fontFamilyOf(props, config);
      const fontFaces = config.fontFaces.get(fontFamily);
      return (
        // A plain `html`, not react-email's `Html`: that one writes `lang="en"`
        // when given none, which would mislabel every email in another
        // language. `dir` is always written, `ltr` included, as `Html` did.
        // The namespaces are for the VML a content background image draws in
        // classic Outlook.
        <html dir={dir} lang={lang} {...OFFICE_NAMESPACES}>
          {/* The one place the mobile rules go. Every Block has already rendered
            by the time the root does, so the stylesheet is complete here — and
            empty, emitting nothing at all, for an email that uses none of it.
            A plain `head` with react.email's two metas, because `Head` writes
            children of its own and the Outlook settings need the whole of it. */}
          {outlook(
            <head>
              <meta
                content="text/html; charset=UTF-8"
                httpEquiv="Content-Type"
              />
              <meta name="x-apple-disable-message-reformatting" />
              <MobileStyles css={mobile.stylesheet()} />
              {/* Only for a listed stack that loads a web font, and in a
                stylesheet of its own: a client that drops it must not take
                the mobile rules with it. */}
              {fontFaces === undefined ? null : (
                // oxlint-disable-next-line react/no-danger
                <style dangerouslySetInnerHTML={{ __html: fontFaces }} />
              )}
            </head>,
            OFFICE_SETTINGS,
            "",
          )}
          {/* No Container here any more. The root used to hold every Block in one
            centred column, which is why a Section could never be wider than its
            own content — and why a Section's colour stopped where the content
            stopped. Each container centres its own column now, against
            `contentWidth`, which is still the root's to own and the Author's to
            change. */}
          <PageBody
            dir={dir}
            lang={lang}
            color={props.backgroundColor}
            image={backgroundImageUrlOf(props.backgroundImage)}
            fontFamily={fontFamily}
            outlook={outlook}
          >
            {/* Inside the Body, not beside it. `Preview` renders a hidden div,
              and a div is not a legal child of `html` — react-email's own
              examples put it there and get away with it only because the
              parser folds it into the body anyway. The Canvas renders this
              tree into a live document rather than to a string, so React's
              nesting check sees the invalid markup and warns on every render.
              First child of the Body is where the preheader belongs regardless:
              clients read the snippet from the first text in the body. */}
            {props.previewText === "" ? null : (
              <Preview>{props.previewText}</Preview>
            )}
            {/* The language and direction again, on a cell around everything.
              Some clients drop the html and body tags, or rewrite them, so
              this is the one that survives. `dir` here cascades into every
              table inside, so a row's columns flip by themselves. The CSS is
              a backup for a client that drops the attribute. Full width, no
              padding: each container still centres itself against
              `contentWidth`. Written by hand because react-email's `Section`
              cannot put an attribute on its cell. */}
            <table
              align="center"
              width="100%"
              border={0}
              cellPadding="0"
              cellSpacing="0"
              role="presentation"
              style={{ width: "100%" }}
            >
              <tbody>
                <tr>
                  <td dir={dir} lang={lang} style={{ direction: dir }}>
                    {children}
                  </td>
                </tr>
              </tbody>
            </table>
          </PageBody>
        </html>
      );
    },
  });
}

/**
 * The body, and the cell react-email's `Body` would put everything in.
 *
 * Written by hand, to the same bytes `Body` writes, so the page image's VML
 * can go first in the body: classic Outlook reads `<v:background>` there and
 * not inside a table. A react-email upgrade that changes `Body` no longer
 * reaches the email; the goldens are what would show the two drifting apart. The colour goes on both, as `Body` puts it, because some
 * clients drop the body.
 *
 * The image tiles from the top left, on both, and as the body's `background`
 * attribute for a client that reads no CSS on it (#138). Outlook gets the same
 * tile as a VML fill, over the page colour.
 */
function PageBody({
  dir,
  lang,
  color,
  image,
  fontFamily,
  outlook,
  children,
}: {
  readonly dir: Direction;
  readonly lang: string | undefined;
  readonly color: string | undefined;
  readonly image: string | undefined;
  readonly fontFamily: string;
  readonly outlook: BlockRenderContext<unknown>["outlook"];
  readonly children: ReactNode;
}): ReactElement {
  const tile: CSSProperties =
    image === undefined
      ? {}
      : { backgroundImage: `url("${image}")`, backgroundRepeat: "repeat" };
  const vmlColor =
    color === undefined ? "" : ` color="${escapeAttribute(color)}"`;
  return (
    <body
      dir={dir}
      lang={lang}
      {...(image === undefined ? {} : { background: image })}
      style={{ backgroundColor: color, ...tile }}
    >
      {image === undefined
        ? null
        : outlook(
            <div />,
            `<v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="t">` +
              `<v:fill type="tile" src="${escapeAttribute(image)}"${vmlColor}/>` +
              `</v:background>`,
            "",
          )}
      <table
        border={0}
        width="100%"
        cellPadding="0"
        cellSpacing="0"
        role="presentation"
        align="center"
      >
        <tbody>
          <tr>
            <td style={{ backgroundColor: color, ...tile, fontFamily }}>
              {children}
            </td>
          </tr>
        </tbody>
      </table>
    </body>
  );
}
