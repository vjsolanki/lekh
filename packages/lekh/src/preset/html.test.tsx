import { describe, expect, it } from "vitest";

import {
  createEditor,
  DiagnosticCode,
  type EmailDocument,
  UnknownBlockError,
} from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf } from "../testing/markup";
import {
  definitions,
  markup,
  alone,
  MOBILE_ONLY_OPENING,
  definitionOf,
} from "../testing/preset";

/** The cell wearing the html Block's scope class. */
function scopedCell(html: string): Element {
  return parseMarkup(html).one("td.lekh-h-subject");
}

const htmlAlone = (
  props: Record<string, unknown>,
  mobile?: Record<string, unknown>,
): EmailDocument =>
  alone({
    id: "subject",
    type: "html",
    props,
    ...(mobile ? { mobile } : {}),
  });

// #75 and ADR-0028: the html Block keeps the Author's markup, cleaned.
describe("the html Block", () => {
  it("is called HTML and holds markup, padding and showOn, nothing else", () => {
    const definition = definitionOf("html");

    expect(definition?.label).toBe("HTML");
    expect(Object.keys(definition?.schema ?? {})).toEqual([
      "html",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "showOn",
    ]);
    expect(definition?.schema["html"]).toMatchObject({
      kind: "html",
      defaultValue: "",
    });
  });

  it("can go under the root, in a section and in a column", () => {
    for (const type of [REACT_EMAIL_ROOT_TYPE, "section", "column"]) {
      expect(definitionOf(type)?.accepts).toContain("html");
    }
  });

  it("tells an Inspector its markup is of the html kind", () => {
    const editor = createEditor({ definitions, document: htmlAlone({}) });
    editor.select("subject");

    expect(
      editor.getControls().find((control) => control.name === "html")?.kind,
    ).toBe("html");
  });

  it("puts the padding, the Mobile Override class and the scope on one cell", () => {
    const html = markup(
      htmlAlone(
        { html: "<p>Hi</p>", paddingTop: 24, paddingLeft: 8 },
        { paddingTop: 4 },
      ),
    );
    const cell = scopedCell(html);

    expect(styleOf(cell)).toMatchObject({
      "padding-top": "24px",
      "padding-left": "8px",
    });
    expect(cell.classList.contains("lekh-m-subject")).toBe(true);
    expect(html).toContain(".lekh-m-subject{padding-top:4px!important}");
    expect(cell.innerHTML).toBe("<p>Hi</p>");
  });

  it("sends the markup cleaned, with its style scoped to the Block", () => {
    const html = markup(
      htmlAlone({
        html:
          "<style>td{padding:0}</style>" +
          '<p onclick="x">Hi</p><script>alert(1)</script>',
      }),
    );

    expect(html).toContain(
      "<style>.lekh-h-subject td{padding:0}</style><p>Hi</p>",
    );
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
  });

  it("renders nothing when it holds nothing", () => {
    const empty: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [],
      },
    };

    expect(markup(htmlAlone({}))).toBe(markup(empty));
  });

  it("renders nothing when cleaning leaves nothing", () => {
    expect(markup(htmlAlone({ html: "<script>x</script>" }))).not.toContain(
      "lekh-h-subject",
    );
  });

  it("hides a desktop-only one with the fixed class", () => {
    const html = markup(htmlAlone({ html: "<p>Hi</p>", showOn: "desktop" }));

    expect(html).toContain(".lekh-hidden{display:none!important}");
    expect(html).not.toContain("lekh-mobile-only");
  });

  it("wraps a mobile-only one through mobile.only", () => {
    const html = markup(htmlAlone({ html: "<p>Hi</p>", showOn: "mobile" }));
    const wrapped = html.indexOf(MOBILE_ONLY_OPENING);

    expect(wrapped).toBeGreaterThan(-1);
    expect(html.indexOf("<table", wrapped)).toBe(
      wrapped + MOBILE_ONLY_OPENING.length,
    );
    expect(html.slice(wrapped)).toContain("<p>Hi</p>");
  });

  it("is unknown once a Consumer turns it off, so render refuses it", () => {
    const without = createReactEmailPreset().filter(
      (definition) => definition.type !== "html",
    );

    expect(() => markup(htmlAlone({ html: "<p>Hi</p>" }), without)).toThrow(
      UnknownBlockError,
    );
  });

  describe("its warnings", () => {
    const codesFor = (html: string) =>
      createEditor({ definitions, document: htmlAlone({ html }) })
        .getDiagnostics()
        .filter((diagnostic) => diagnostic.blockId === "subject");

    it("says nothing about clean markup", () => {
      expect(codesFor("<table><tr><td>Hi</td></tr></table>")).toEqual([]);
    });

    it.each([
      [
        "<p onclick=x>Hi</p>",
        DiagnosticCode.htmlMarkupRemoved,
        "Some markup will be removed when this email is sent.",
      ],
      [
        "<table><tr><td>Hi",
        DiagnosticCode.htmlMarkupUnbalanced,
        "This markup looks unbalanced. It may break the Blocks after it.",
      ],
      [
        "<html><head><title>t</title></head><body><p>Hi</p></body></html>",
        DiagnosticCode.htmlWholeDocument,
        "This looks like a whole email. Only its body is kept.",
      ],
    ])("warns about %s", (html, code, message) => {
      expect(codesFor(html)).toEqual([
        {
          code,
          message,
          severity: "warning",
          blockId: "subject",
          prop: "html",
        },
      ]);
    });

    it("never stops a send", () => {
      expect(() =>
        markup(htmlAlone({ html: "<html><body><table><script>x" })),
      ).not.toThrow();
    });
  });
});
