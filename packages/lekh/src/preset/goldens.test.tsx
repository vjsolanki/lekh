import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createCompliancePreset,
  createReactEmailPreset,
  REACT_EMAIL_ROOT_TYPE,
} from "../blocks";
import { renderDocument, toHtml } from "../index";
import { block, documentOf, onMobile, type BlockSpec } from "../testing/tree";

/**
 * What the Preset sends, pinned byte for byte.
 *
 * Each shipped Block has a golden `.html` file per main state, rendered through
 * the public render path with its doctype, so a file opens in a browser as the
 * email it is. A change to any byte fails here, and the diff is what reaches an
 * inbox. When the change is meant, update them with
 * `pnpm --filter lekh-editor goldens` and commit them on their own, saying why.
 *
 * They pin today's output, drift included. A golden that looks wrong is fixed
 * by the ticket that fixes the Preset, in its own commit.
 */

const GOLDEN_DIRECTORY = new URL("__goldens__/", import.meta.url);

const preset = createReactEmailPreset();

const compliance = createCompliancePreset({
  unsubscribeUrl: "https://esp.example/u/{{recipient_id}}",
  postalAddress: "Lekh Ltd, 1 Example Street, London N1 1AA",
});

/**
 * The Preset with the compliance Blocks added. Only their goldens use it: with
 * it, every email has to carry both Required Blocks, and a golden for a
 * heading is clearer without them.
 */
const withCompliance = [...preset, ...compliance];

const COMPLIANCE_TYPES = new Set(
  compliance.map((definition) => definition.type),
);

const PHOTO = {
  src: "https://cdn.example.com/photo.png",
  width: 1200,
  height: 600,
  alt: "A hillside at dawn",
};

const BACKDROP = {
  src: "https://cdn.example.com/backdrop.png",
  width: 1200,
  height: 400,
};

const ICON = {
  src: "https://cdn.example.com/icon.png",
  width: 64,
  height: 64,
  alt: "Our page",
};

const BORDER = {
  borderWidth: 2,
  borderStyle: "solid",
  borderColor: "#d0d0d0",
  borderRadius: 6,
};

const READ_ON = { label: "Read on", href: "https://example.com" };

const PADDING = {
  paddingTop: 24,
  paddingRight: 32,
  paddingBottom: 24,
  paddingLeft: 32,
};

/** A small tile, for the page behind the email. */
const TEXTURE = {
  src: "https://cdn.example.com/linen.png",
  width: 64,
  height: 64,
};

/** Some Blocks under the Preset's root, with nothing set on it. */
function email(...children: readonly BlockSpec[]): BlockSpec {
  return block(REACT_EMAIL_ROOT_TYPE, {}, children);
}

const copy = (content = "<p>Some words.</p>"): BlockSpec =>
  block("text", { content });

const twoColumns = (
  props: Readonly<Record<string, unknown>> = {},
  left: Readonly<Record<string, unknown>> = {},
): BlockSpec =>
  block("columns", props, [
    block("column", { width: 50, ...left }, [copy("<p>Left</p>")]),
    block("column", { width: 50 }, [copy("<p>Right</p>")]),
  ]);

const icons = (props: Readonly<Record<string, unknown>> = {}): BlockSpec =>
  block("icon-row", props, [
    block("icon", { asset: ICON, href: "https://example.com/a" }),
    block("icon", { asset: ICON, href: "https://example.com/b" }),
    block("icon", { asset: ICON }),
  ]);

const nav = (props: Readonly<Record<string, unknown>> = {}): BlockSpec =>
  block("nav", props, [
    block("nav-link", { label: "Shop", href: "https://example.com/shop" }),
    block("nav-link", { label: "Blog", href: "https://example.com/blog" }),
    block("nav-link", { label: "About", href: "https://example.com/about" }),
  ]);

/** Every golden: the Block it is for, its state, and the email it renders. */
const GOLDENS: Readonly<Record<string, Readonly<Record<string, BlockSpec>>>> = {
  email: {
    default: email(),
    options: block(
      REACT_EMAIL_ROOT_TYPE,
      {
        backgroundColor: "#f4f1ea",
        contentWidth: 640,
        fontFamily: "Georgia, 'Times New Roman', serif",
        textColor: "#222222",
        linkColor: "#0b57d0",
        language: "fr",
        previewText: "Les nouvelles de la semaine",
      },
      [copy('<p>Lisez <a href="https://example.com">la suite</a>.</p>')],
    ),
    "right-to-left": block(
      REACT_EMAIL_ROOT_TYPE,
      { language: "ar", direction: "rtl" },
      [copy("<p>مرحبا</p>"), twoColumns()],
    ),
    "content-color": block(
      REACT_EMAIL_ROOT_TYPE,
      { backgroundColor: "#eeeeee", contentBackgroundColor: "#ffffff" },
      [
        block("section", {}, [copy()]),
        twoColumns(),
        block("section", { contentBackgroundColor: "#123456" }, [copy()]),
      ],
    ),
    "background-image": block(
      REACT_EMAIL_ROOT_TYPE,
      { backgroundColor: "#eeeeee", backgroundImage: TEXTURE },
      [copy()],
    ),
  },
  section: {
    default: email(block("section", {}, [copy()])),
    "border-and-padding": email(
      block("section", { ...BORDER, ...PADDING }, [copy()]),
    ),
    "background-image": email(
      block(
        "section",
        { contentBackgroundImage: BACKDROP, contentBackgroundColor: "#123456" },
        [copy()],
      ),
    ),
    "background-colors": email(
      block(
        "section",
        { backgroundColor: "#eeeeee", contentBackgroundColor: "#ffffff" },
        [copy()],
      ),
    ),
    "mobile-override": email(
      onMobile(block("section", PADDING, [copy()]), {
        paddingTop: 8,
        paddingLeft: 12,
      }),
    ),
    "desktop-only": email(block("section", { showOn: "desktop" }, [copy()])),
    "mobile-only": email(block("section", { showOn: "mobile" }, [copy()])),
  },
  columns: {
    default: email(twoColumns()),
    "border-and-padding": email(twoColumns({ ...BORDER, ...PADDING })),
    "background-image": email(
      twoColumns({
        contentBackgroundImage: BACKDROP,
        contentBackgroundColor: "#123456",
      }),
    ),
    options: email(
      block(
        "columns",
        {
          gap: 16,
          verticalAlign: "middle",
          stackOnMobile: true,
          reverseOnMobile: true,
        },
        [
          block("column", { width: 25 }, [copy("<p>One</p>")]),
          block("column", { width: 50 }, [copy("<p>Two</p>")]),
          block("column", { width: 25 }, [copy("<p>Three</p>")]),
        ],
      ),
    ),
    "side-by-side-on-mobile": email(twoColumns({ stackOnMobile: false })),
    "mobile-override": email(
      onMobile(twoColumns(PADDING), { paddingTop: 8, paddingBottom: 8 }),
    ),
  },
  column: {
    options: email(
      twoColumns({}, { backgroundColor: "#fff8e1", ...PADDING, ...BORDER }),
    ),
    "mobile-override": email(
      block("columns", {}, [
        onMobile(block("column", { width: 60, ...PADDING }, [copy()]), {
          paddingLeft: 0,
          paddingRight: 0,
        }),
        block("column", { width: 40 }, [copy()]),
      ]),
    ),
  },
  heading: {
    default: email(block("heading", { content: "Hello" })),
    options: email(
      block("heading", {
        content: "Hello <em>there</em>",
        level: 1,
        fontSize: 36,
        lineHeight: 120,
        fontWeight: 800,
        letterSpacing: 1,
        color: "#0b3d2e",
        backgroundColor: "#e8f5e9",
        align: "center",
        ...PADDING,
      }),
    ),
    "level-3": email(block("heading", { content: "Small print", level: 3 })),
    "mobile-override": email(
      onMobile(block("heading", { content: "Hello", fontSize: 32 }), {
        fontSize: 24,
        align: "center",
      }),
    ),
  },
  text: {
    default: email(copy()),
    options: email(
      block("text", {
        content:
          '<p>Intro with <a href="https://example.com">a link</a>, <strong>bold</strong> and <em>italic</em>.</p><ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>',
        fontSize: 18,
        lineHeight: 160,
        fontWeight: 300,
        letterSpacing: 0.5,
        color: "#333333",
        backgroundColor: "#fafafa",
        align: "justify",
        paragraphSpacing: 20,
        listItemSpacing: 6,
        ...PADDING,
      }),
    ),
    "mobile-override": email(
      onMobile(block("text", { content: "<p>a</p><p>b</p>" }), {
        fontSize: 14,
        align: "center",
        paddingLeft: 8,
      }),
    ),
    "desktop-only": email(
      block("text", { content: "<p>Wide</p>", showOn: "desktop" }),
    ),
  },
  image: {
    default: email(block("image", { asset: PHOTO })),
    options: email(
      block("image", {
        asset: PHOTO,
        width: 300,
        align: "right",
        href: "https://example.com/gallery",
        backgroundColor: "#000000",
        borderRadius: 12,
        ...PADDING,
      }),
    ),
    "mobile-override": email(
      onMobile(block("image", { asset: PHOTO, ...PADDING }), {
        paddingLeft: 0,
        paddingRight: 0,
      }),
    ),
  },
  button: {
    default: email(block("button", READ_ON)),
    options: email(
      block("button", {
        label: "Shop the sale",
        href: "https://example.com/sale",
        backgroundColor: "#b00020",
        color: "#ffffff",
        align: "left",
        innerPaddingY: 16,
        innerPaddingX: 40,
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 2,
        ...PADDING,
      }),
    ),
    border: email(
      block("button", {
        ...READ_ON,
        ...BORDER,
      }),
    ),
    "full-width": email(
      block("button", {
        ...READ_ON,
        fullWidth: true,
      }),
    ),
    "full-width-on-mobile": email(
      block("button", {
        ...READ_ON,
        fullWidthOnMobile: true,
      }),
    ),
    "mobile-override": email(
      onMobile(block("button", READ_ON), { align: "left", paddingTop: 4 }),
    ),
  },
  divider: {
    default: email(block("divider")),
    options: email(
      block("divider", {
        color: "#888888",
        thickness: 3,
        lineStyle: "dashed",
        width: 50,
        align: "left",
        backgroundColor: "#f0f0f0",
        ...PADDING,
      }),
    ),
    "mobile-override": email(
      onMobile(block("divider", PADDING), { paddingTop: 4, paddingBottom: 4 }),
    ),
  },
  spacer: {
    default: email(block("spacer")),
    options: email(block("spacer", { height: 64, backgroundColor: "#dddddd" })),
    "mobile-override": email(
      onMobile(block("spacer", { height: 64 }), { height: 16 }),
    ),
  },
  // An empty one renders nothing, the same bytes as the empty email.
  html: {
    markup: email(
      block("html", {
        html: '<table role="presentation"><tr><td style="color: #333333">Hand-written</td></tr></table>',
        ...PADDING,
      }),
    ),
    "mobile-override": email(
      onMobile(block("html", { html: "<p>Hi</p>", ...PADDING }), {
        paddingTop: 0,
      }),
    ),
  },
  "icon-row": {
    default: email(icons()),
    options: email(
      icons({
        iconSize: 40,
        gap: 20,
        align: "left",
        backgroundColor: "#202124",
        ...PADDING,
      }),
    ),
    "mobile-override": email(
      onMobile(icons(), { align: "left", paddingTop: 4 }),
    ),
  },
  icon: {
    // An icon draws only inside its row. The row's goldens use linked icons
    // with alt text, so this one has neither.
    "no-link-no-alt": email(
      block("icon-row", {}, [
        block("icon", {
          asset: { src: ICON.src, width: ICON.width, height: ICON.height },
        }),
      ]),
    ),
  },
  nav: {
    default: email(nav()),
    options: email(
      nav({
        gap: 24,
        separator: "|",
        color: "#0b57d0",
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: 1,
        underline: true,
        align: "right",
        backgroundColor: "#f8f9fa",
        ...PADDING,
      }),
    ),
    "stack-on-mobile": email(nav({ stackOnMobile: true })),
    "mobile-override": email(onMobile(nav(), { align: "left", paddingTop: 4 })),
  },
  "nav-link": {
    "with-and-without-link": email(
      block("nav", {}, [
        block("nav-link", { label: "Shop", href: "https://example.com/shop" }),
        block("nav-link", { label: "No link" }),
        block("nav-link", { href: "https://example.com/blank" }),
      ]),
    ),
  },
  unsubscribe: {
    default: email(block("unsubscribe"), block("postal-address")),
    options: email(
      block("postal-address"),
      block("unsubscribe", {
        label: "Stop these emails",
        fontSize: 11,
        color: "#666666",
        backgroundColor: "#f5f5f5",
        align: "left",
      }),
    ),
    "mobile-override": email(
      onMobile(block("unsubscribe", { fontSize: 13 }), { fontSize: 11 }),
      block("postal-address"),
    ),
  },
  // Its default is the unsubscribe default: each needs the other.
  "postal-address": {
    options: email(
      block("unsubscribe"),
      block("postal-address", {
        address: "Lekh GmbH, Beispielstraße 1, 10115 Berlin",
        fontSize: 11,
        color: "#666666",
        backgroundColor: "#f5f5f5",
        align: "right",
      }),
    ),
    "mobile-override": email(
      block("unsubscribe"),
      onMobile(block("postal-address", { fontSize: 13 }), { fontSize: 11 }),
    ),
  },
};

describe("the golden HTML", () => {
  it("has a golden for every shipped Block", () => {
    expect(Object.keys(GOLDENS).toSorted()).toEqual(
      withCompliance.map((definition) => definition.type).toSorted(),
    );
  });

  for (const [type, states] of Object.entries(GOLDENS)) {
    describe(type, () => {
      for (const [state, root] of Object.entries(states)) {
        it(state, async () => {
          const html = toHtml(
            renderDocument(documentOf(root), {
              definitions: COMPLIANCE_TYPES.has(type) ? withCompliance : preset,
            }),
          );
          await expect(`${html}\n`).toMatchFileSnapshot(
            `__goldens__/${type}/${state}.html`,
          );
        });
      }
    });
  }
});

describe("the golden folder", () => {
  // An update writes files but never removes one, so the `goldens` script
  // empties the folder first. It skips this test, which would run before the
  // files are written at the end.
  it("keeps no file that no state writes", () => {
    const written = Object.entries(GOLDENS).flatMap(([type, states]) =>
      Object.keys(states).map((state) => `${type}/${state}.html`),
    );
    const onDisk = readdirSync(GOLDEN_DIRECTORY, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith(".html"));

    expect(onDisk.toSorted()).toEqual(written.toSorted());
  });
});
