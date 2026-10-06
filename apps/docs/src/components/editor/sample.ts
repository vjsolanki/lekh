/**
 * What this editor is configured with, and what it opens on.
 *
 * Two Presets composed into one set of Block Definitions, two Validators, and
 * an ordinary stored Document — the shape a database column holds. Ids are
 * legible here only because they were written by hand; the editor generates its
 * own for everything added afterwards.
 */

import {
  type BlockDefinition,
  type EmailDocument,
  minimumContrast,
  minimumFontSize,
  type Validator,
  workingLinks,
} from "lekh";
import {
  createCompliancePreset,
  createReactEmailPreset,
  REACT_EMAIL_ROOT_TYPE,
} from "lekh/blocks";

import { HERO, SPOTLIGHT, WORDMARK } from "./stock";

export { REACT_EMAIL_ROOT_TYPE };

/**
 * The font a new email starts in. The footer follows whatever the email picks,
 * so the compliance Preset's own stack is only for a root that names none.
 */
const FONT_FAMILY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * Every Block this editor offers.
 *
 * The compliance Preset is a second entry point rather than part of the
 * built-in one, so a product sending password resets simply never composes it
 * in. Composed here because this example is a marketing email, which is exactly
 * the case that is regulated.
 */
export const DEFINITIONS: readonly BlockDefinition[] = [
  ...createReactEmailPreset({
    fontFamily: FONT_FAMILY,
    // The faces an Author may pick for an email. Inter falls through to the
    // system sans where it is not installed; the other two are on nearly
    // every machine.
    fonts: [
      { label: "Inter", stack: FONT_FAMILY },
      { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
      { label: "Courier", stack: "'Courier New', Courier, monospace" },
    ],
    // The sender's Brand Colours, from its wordmark. Offered beside every
    // colour, to the Author and the Agent alike. The email stores the colour,
    // so any other still works.
    colors: [
      { label: "Indigo", value: "#2f2ab8" },
      { label: "Ink", value: "#12141a" },
      { label: "Slate", value: "#79808f" },
      { label: "Paper", value: "#ffffff" },
    ],
    contentWidth: 600,
  }),
  ...createCompliancePreset({
    fontFamily: FONT_FAMILY,
    // Whatever the email service provider substitutes per recipient. There is
    // no default, because a default would be a guess at somebody else's
    // substitution syntax — a dead link shipped quietly.
    unsubscribeUrl: "%%unsubscribe_url%%",
    // Content, unlike the URL: the same for every recipient, so an Author can
    // type it. This is only where a new Document starts.
    postalAddress:
      "Lekh Labs Ltd\n14 Wharf Road\nBristol BS1 4RN\nUnited Kingdom",
  }),
];

/**
 * Three heuristics, all opted into.
 *
 * Nothing is wired up by default — an editor given no Validators reports none.
 * All stay at `warning`: a heuristic that misfires must never stop a
 * legitimate send.
 */
export const VALIDATORS: readonly Validator[] = [
  minimumFontSize({ minimum: 12 }),
  minimumContrast({ ratio: 4.5 }),
  workingLinks(),
];

const INK = "#12141a";
const BODY = "#3d4453";
const MUTED = "#6f7686";
const PAPER = "#ffffff";
const ACCENT = "#2f2ab8";

/**
 * The email the editor opens on.
 *
 * Every Block Definition in both Presets appears at least once, and three of
 * them carry the responsive behaviour worth seeing: a Mobile Override on the
 * headline, a spotlight row that puts its image first on a phone, and a strip
 * of links that is hidden there entirely.
 *
 * Two Diagnostics are seeded on purpose, both of them mistakes real email makes
 * every week: the lead image has no alt text, and the small print is a pixel
 * under the readable minimum.
 */
export const STARTING_DOCUMENT: EmailDocument = {
  root: {
    id: "root",
    type: REACT_EMAIL_ROOT_TYPE,
    props: {
      backgroundColor: "#eceef3",
      contentWidth: 600,
      previewText:
        "Mobile Overrides, Required Blocks, and a Canvas that scrolls itself.",
    },
    children: [
      {
        id: "masthead",
        type: "section",
        props: {
          backgroundColor: PAPER,
          paddingTop: 28,
          paddingRight: 32,
          paddingBottom: 28,
          paddingLeft: 32,
        },
        children: [
          {
            id: "masthead-mark",
            type: "image",
            props: { asset: { ...WORDMARK, alt: "lekh" }, width: 132 },
          },
        ],
      },

      {
        id: "lead",
        type: "section",
        props: {
          backgroundColor: PAPER,
          paddingTop: 4,
          paddingRight: 32,
          paddingBottom: 4,
          paddingLeft: 32,
        },
        children: [
          {
            id: "lead-heading",
            type: "heading",
            props: {
              content: "Version 0.4 is out",
              level: 1,
              fontSize: 36,
              color: INK,
            },
            // Smaller on a phone, and only on a phone: stored on its own,
            // emitted as a forced rule, reverted in one click.
            mobile: { fontSize: 26 },
          },
          {
            id: "lead-text",
            type: "text",
            props: {
              content:
                '<strong>Mobile Overrides</strong> ship this week, the compliance Preset went stable, and the Canvas now scrolls itself while you drag a Block past its edge. The <a href="https://example.com/releases/0-4">full notes</a> run to about a page.',
              fontSize: 17,
              color: BODY,
            },
            mobile: { fontSize: 16 },
          },
        ],
      },

      {
        id: "lead-figure",
        type: "section",
        props: {
          backgroundColor: PAPER,
          paddingTop: 20,
          paddingRight: 32,
          paddingBottom: 20,
          paddingLeft: 32,
        },
        children: [
          {
            // No alt text, which is why the status bar opens with a warning.
            // An image that says nothing when images are blocked is the most
            // common defect in commercial email.
            id: "lead-image",
            type: "image",
            // No width either: an image fills whatever it lands in unless an
            // Author says otherwise, so a hero needs no arithmetic.
            props: {
              asset: { src: HERO.src, width: HERO.width, height: HERO.height },
              href: "https://example.com/releases/0-4",
            },
          },
        ],
      },

      {
        id: "spotlight",
        type: "columns",
        // The one structural behaviour that depends on the markup around it:
        // stacked on a phone, the image comes first. The copy sits level with
        // the middle of the picture, with a gap between the two.
        props: { reverseOnMobile: true, verticalAlign: "middle", gap: 16 },
        children: [
          {
            id: "spotlight-copy",
            type: "column",
            // The two columns of a row divide it, and the pair always comes to
            // a hundred. Uneven here on purpose: the copy earns the room, and
            // it is the case a fresh row will not show you.
            props: { width: 55, padding: 20 },
            children: [
              {
                id: "spotlight-heading",
                type: "heading",
                props: {
                  content: "One timeline",
                  level: 2,
                  fontSize: 21,
                  color: INK,
                },
              },
              {
                id: "spotlight-text",
                type: "text",
                props: {
                  content:
                    "Type a word, drag a Block, undo. You get the drag back rather than losing a character.",
                  fontSize: 15,
                  color: BODY,
                },
                mobile: { fontSize: 16 },
              },
            ],
          },
          {
            id: "spotlight-figure",
            type: "column",
            props: { width: 45, padding: 20 },
            children: [
              {
                id: "spotlight-image",
                type: "image",
                // The default width is the email's, and the column is
                // narrower than that: the picture shrinks to fit it.
                props: {
                  asset: {
                    ...SPOTLIGHT,
                    alt: "Two Blocks mid-drag on the Canvas",
                  },
                },
              },
            ],
          },
        ],
      },

      {
        id: "features",
        type: "section",
        props: {
          backgroundColor: PAPER,
          paddingTop: 8,
          paddingRight: 12,
          paddingBottom: 8,
          paddingLeft: 12,
        },
        children: [
          {
            id: "features-row",
            type: "columns",
            props: {},
            children: [
              {
                id: "features-left",
                type: "column",
                props: { width: 50, padding: 20 },
                children: [
                  {
                    id: "features-left-heading",
                    type: "heading",
                    props: {
                      content: "Mobile Overrides",
                      level: 3,
                      fontSize: 16,
                      color: INK,
                    },
                  },
                  {
                    id: "features-left-text",
                    type: "text",
                    props: {
                      content:
                        "Change a font size on mobile and the desktop value keeps its own life.",
                      fontSize: 15,
                      color: BODY,
                    },
                    mobile: { fontSize: 14 },
                  },
                ],
              },
              {
                id: "features-right",
                type: "column",
                props: { width: 50, padding: 20 },
                children: [
                  {
                    id: "features-right-heading",
                    type: "heading",
                    props: {
                      content: "Required Blocks",
                      level: 3,
                      fontSize: 16,
                      color: INK,
                    },
                  },
                  {
                    id: "features-right-text",
                    type: "text",
                    props: {
                      content:
                        "An unsubscribe link you can move, restyle and reword — but never lose by accident.",
                      fontSize: 15,
                      color: BODY,
                    },
                    mobile: { fontSize: 14 },
                  },
                ],
              },
            ],
          },
        ],
      },

      {
        id: "jump",
        type: "section",
        // Three columns of links are a thumb trap at 375px, so the whole strip
        // stands down on a phone.
        props: {
          backgroundColor: "#f4f5f8",
          paddingTop: 18,
          paddingRight: 12,
          paddingBottom: 18,
          paddingLeft: 12,
          showOn: "desktop",
        },
        children: [
          {
            id: "jump-row",
            type: "columns",
            props: {},
            children: [
              {
                id: "jump-one",
                type: "column",
                props: { width: 34, padding: 8 },
                children: [
                  {
                    id: "jump-one-text",
                    type: "text",
                    props: {
                      content:
                        '<a href="https://example.com/changelog">Changelog</a>',
                      fontSize: 14,
                      color: ACCENT,
                      align: "center",
                    },
                  },
                ],
              },
              {
                id: "jump-two",
                type: "column",
                props: { width: 33, padding: 8 },
                children: [
                  {
                    id: "jump-two-text",
                    type: "text",
                    props: {
                      content:
                        '<a href="https://example.com/migrate">Migration guide</a>',
                      fontSize: 14,
                      color: ACCENT,
                      align: "center",
                    },
                  },
                ],
              },
              {
                id: "jump-three",
                type: "column",
                props: { width: 33, padding: 8 },
                children: [
                  {
                    id: "jump-three-text",
                    type: "text",
                    props: {
                      content:
                        '<a href="https://example.com/discuss">Discussions</a>',
                      fontSize: 14,
                      color: ACCENT,
                      align: "center",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },

      {
        id: "call-to-action",
        type: "section",
        props: {
          backgroundColor: PAPER,
          paddingTop: 24,
          paddingRight: 32,
          paddingBottom: 24,
          paddingLeft: 32,
        },
        children: [
          {
            id: "call-to-action-button",
            type: "button",
            props: {
              label: "Read the release notes",
              href: "https://example.com/releases/0-4",
              backgroundColor: ACCENT,
              color: "#ffffff",
              borderRadius: 8,
            },
          },
        ],
      },

      {
        id: "footer",
        type: "section",
        props: {
          backgroundColor: PAPER,
          paddingTop: 8,
          paddingRight: 32,
          paddingBottom: 8,
          paddingLeft: 32,
        },
        children: [
          {
            id: "footer-rule",
            type: "divider",
            props: { color: "#e4e7ee" },
          },
          {
            // 11px, one under the minimum the Validator was given, so the
            // status bar has something to point at.
            id: "footer-note",
            type: "text",
            props: {
              content:
                "You are getting this because you asked for release notes. One email per release, nothing else.",
              fontSize: 11,
              color: MUTED,
              align: "center",
            },
          },
          {
            id: "footer-unsubscribe",
            type: "unsubscribe",
            props: { label: "Unsubscribe", fontSize: 12, color: MUTED },
          },
          {
            // The address itself is left unset, so it resolves to the one the
            // compliance Preset was configured with.
            id: "footer-address",
            type: "postal-address",
            props: { fontSize: 12, color: MUTED },
          },
        ],
      },
    ],
  },
};
