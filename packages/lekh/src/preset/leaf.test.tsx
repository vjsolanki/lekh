import { describe, expect, it } from "vitest";

import { createCompliancePreset, createReactEmailPreset } from "../blocks";
import { createEditor, type EmailDocument, type Migration } from "../index";
import { parseMarkup, styleOf } from "../testing/markup";
import {
  definitions,
  markup,
  newsletter,
  alone,
  styleOfFirst,
  aligned,
  ALIGNED,
  tagsWearingOverride,
  commentsIn,
  MOBILE_ONLY_OPENING,
  paragraphStyles,
  placed,
  overriddenCell,
  PADDED,
  valuesOf,
  definitionOf,
} from "../testing/preset";

/** One Block under a root, with a Mobile Override stored against it. */
function overridden(
  type: string,
  props: Record<string, unknown>,
  mobile: Record<string, unknown>,
): EmailDocument {
  return alone({ id: "subject", type, props, mobile });
}

// ADR-0020: every shipped Definition puts `mobile.className` on one element.
// Since #67 that is the cell its padding is on, so a padding override replaces
// the inline value. Each case checks the class lands there and nowhere else,
// since a rule nothing wears is the silent failure this guards.
describe("a shipped Block's Mobile Override class", () => {
  const asset = { src: "https://example.com/a.png", width: 800, height: 600 };

  // A leaf's padding needs a cell, and the class goes on that cell with it
  // (#67). So a prop styled on the element inside, such as the image's width,
  // is not one a Consumer can make Overridable without a render of their own.
  it.each(["image", "button", "divider"])(
    "lands on the %s's cell, beside its padding",
    (type) => {
      const html = markup(
        overridden(
          type,
          type === "image" ? { asset, paddingLeft: 12 } : { paddingLeft: 12 },
          { paddingLeft: 0 },
        ),
      );

      expect(html).toContain(".lekh-m-subject{padding-left:0px!important}");
      expect(tagsWearingOverride(html)).toEqual(["td"]);
    },
  );

  it("lands on the columns' padding cell, not the row its reversal is on", () => {
    // Hidden too, so the band wears a class of its own and the check proves
    // the override class did not go with it.
    const html = markup(
      alone({
        id: "subject",
        type: "columns",
        props: { reverseOnMobile: true, showOn: "desktop" },
        mobile: { paddingTop: 8 },
        children: [
          { id: "left", type: "column", props: {}, children: [] },
          { id: "right", type: "column", props: {}, children: [] },
        ],
      }),
    );

    expect(html).toContain(".lekh-m-subject{padding-top:8px!important}");
    expect(html).toContain('class="lekh-reverse lekh-stacked"');
    expect(tagsWearingOverride(html)).toEqual(["td"]);
  });

  it("lands on the section's padding cell, not its band", () => {
    const html = markup(overridden("section", {}, { paddingLeft: 8 }));

    expect(html).toContain(".lekh-m-subject{padding-left:8px!important}");
    expect(tagsWearingOverride(html)).toEqual(["td"]);
  });

  it("lands on the column's cell", () => {
    const html = markup(
      alone({
        id: "row",
        type: "columns",
        props: {},
        children: [
          {
            id: "subject",
            type: "column",
            props: {},
            mobile: { paddingTop: 4 },
          },
          { id: "other", type: "column", props: {}, children: [] },
        ],
      }),
    );

    expect(html).toContain(".lekh-m-subject{padding-top:4px!important}");
    expect(tagsWearingOverride(html)).toEqual(["td"]);
  });

  it("lands on the text's cell, which its paragraphs size themselves by", () => {
    const html = markup(
      overridden("text", { content: "<p>a</p><p>b</p>" }, { fontSize: 14 }),
    );

    expect(html).toContain(".lekh-m-subject{font-size:14px!important}");
    // One class on the cell, never on each paragraph: a padding override
    // there would pad every one of them (ADR-0023).
    expect(tagsWearingOverride(html)).toEqual(["td"]);
    expect(
      paragraphStyles(html).every((style) => style["font-size"] === "1em"),
    ).toBe(true);
  });
});

const REVEAL_RULE =
  ".lekh-mobile-only{display:block!important;max-height:none!important;" +
  "overflow:visible!important}";

const COMPLIANCE = {
  unsubscribeUrl: "https://esp.example/u",
  postalAddress: "1 Example Street",
};

/** The comments in the body, leaving out the head's own Outlook settings. */
const bodyComments = (html: string) =>
  commentsIn(parseMarkup(html).one("body"));

/**
 * Every comment ending a conditional in the body. Conditional comments do not
 * nest: Outlook ends a hidden region at the first `<![endif]` it meets, and
 * shows whatever follows.
 */
const endifs = (html: string) =>
  bodyComments(html).filter((comment) => comment.includes("<![endif]"));

/** Every Block that may go mobile-only: all of `PADDED` but the column. */
// The spacer pads nothing, but it still shows on some screens.
const WRAPPABLE = [...PADDED.filter((type) => type !== "column"), "spacer"];

const editorWithCompliance = (document: EmailDocument) =>
  createEditor({
    definitions: [...definitions, ...createCompliancePreset(COMPLIANCE)],
    document,
  });

// ADR-0025: one choice, `showOn`, in place of `hideOnMobile`.
describe("showing a Block on some screens", () => {
  it("offers all, desktop and mobile on every Block but the column", () => {
    for (const type of WRAPPABLE) {
      const entry = definitionOf(type)?.schema["showOn"];
      expect(entry?.kind).toBe("select");
      expect(entry?.label).toBe("Show on");
      expect(entry?.defaultValue).toBe("all");
      expect(valuesOf(entry?.constraints)).toEqual([
        "all",
        "desktop",
        "mobile",
      ]);
      expect(entry?.constraints).not.toHaveProperty("help");
      expect(definitionOf(type)?.schema["hideOnMobile"]).toBeUndefined();
    }
  });

  describe("its Mail Client Notes", () => {
    const showOnOf = (type: string, showOn: string) => {
      const editor = editorWithCompliance(placed(type, { showOn }));
      editor.select("subject");
      return editor.getControls().find((control) => control.name === "showOn");
    };

    it.each(WRAPPABLE)(
      "names the phone readers that never show a mobile-only %s",
      (type) => {
        expect(showOnOf(type, "mobile")?.clients).toEqual([
          {
            client: "gmail-app",
            note: "Never shows it with a non-Google account",
          },
          { client: "gmail-mobile-webmail", note: "Never shows it" },
          {
            client: "samsung-email",
            note: "Never shows it with an Outlook or Hotmail account",
          },
          { client: "sfr", note: "Never shows it" },
          { client: "laposte", note: "Never shows it" },
        ]);
      },
    );

    it.each(["all", "desktop"])("notes nothing for %s", (showOn) => {
      expect(showOnOf("text", showOn)).not.toHaveProperty("clients");
    });

    it("gives the column's Show on no notes", () => {
      expect(definitionOf("column")?.schema["showOn"]?.clients).toBeUndefined();
      expect(showOnOf("column", "desktop")).not.toHaveProperty("clients");
    });
  });

  it("refuses mobile on the column, which a div cannot wrap", () => {
    const entry = definitionOf("column")?.schema["showOn"];

    expect(valuesOf(entry?.constraints)).toEqual(["all", "desktop"]);
  });

  // #168: a Columns Block's panel shows its column's too, so it says whose.
  it("labels the column's own as the column's", () => {
    expect(definitionOf("column")?.schema["showOn"]?.label).toBe(
      "Show this column on",
    );
  });

  it("shows a column that somehow stored mobile on every screen", () => {
    const html = markup(placed("column", { showOn: "mobile" }));

    expect(html).not.toContain("lekh-mobile-only");
    expect(html).not.toContain("lekh-hidden");
  });

  it("leaves the compliance Blocks without it", () => {
    for (const definition of createCompliancePreset(COMPLIANCE)) {
      expect(definition.schema["showOn"]).toBeUndefined();
    }
  });

  describe("migrating hideOnMobile", () => {
    it.each(PADDED)("makes a %s's hideOnMobile: true desktop only", (type) => {
      const editor = editorWithCompliance(placed(type, { hideOnMobile: true }));
      const block = editor.getBlock("subject");

      expect(block?.props["showOn"]).toBe("desktop");
      expect(block?.props).not.toHaveProperty("hideOnMobile");
      expect(block?.version).toBe(definitionOf(type)?.version);
    });

    it.each(PADDED)("stores nothing for a %s that was shown", (type) => {
      for (const hidden of [{ hideOnMobile: false }, {}]) {
        const block = editorWithCompliance(placed(type, hidden)).getBlock(
          "subject",
        );

        expect(block?.props).not.toHaveProperty("showOn");
        expect(block?.props).not.toHaveProperty("hideOnMobile");
      }
    });

    it.each(PADDED)("changes nothing the second time, on a %s", (type) => {
      const definition = definitionOf(type);
      const migrations = Object.values(definition?.migrations ?? {});
      if (migrations.length === 0) throw new Error(`${type} has no migration.`);
      // Every migration in turn, so the one that moved hideOnMobile is in it
      // wherever it sits in the chain.
      const migration: Migration = (stored) =>
        migrations.reduce<ReturnType<Migration>>(
          (current, step) =>
            step({ props: current.props, mobile: current.mobile }),
          {
            props: { ...stored.props },
            ...(stored.mobile && { mobile: { ...stored.mobile } }),
          },
        );
      const once = migration({
        props: { hideOnMobile: true, paddingTop: 4 },
        mobile: { paddingTop: 2 },
      });

      expect(migration({ props: once.props, mobile: once.mobile })).toEqual(
        once,
      );
    });
  });

  it.each(PADDED)(
    "renders a desktop-only %s exactly as hideOnMobile: true did",
    (type) => {
      const html = markup(placed(type, { showOn: "desktop" }));

      expect(html).toBe(markup(placed(type, { hideOnMobile: true })));
      expect(html).toContain(".lekh-hidden{display:none!important}");
      expect(html).not.toContain("lekh-mobile-only");
    },
  );

  it.each(WRAPPABLE)(
    "wraps a mobile-only %s, inside the comment Outlook skips",
    (type) => {
      const html = markup(placed(type, { showOn: "mobile" }));
      const wrapped = html.indexOf(MOBILE_ONLY_OPENING);

      // The wrapper is the Block's outermost element, with the whole Block
      // after the comment and nothing else hidden.
      expect(wrapped).toBeGreaterThan(-1);
      expect(html.indexOf("<table", wrapped)).toBe(
        wrapped + MOBILE_ONLY_OPENING.length,
      );
      expect(html).toContain("<!--<![endif]--></div>");
      expect(html).toContain(REVEAL_RULE);
      expect(html).not.toContain("lekh-hidden");
      // React preloads an image rendered on its own; that is head material.
      expect(html.slice(wrapped)).not.toContain('rel="preload"');
    },
  );

  it("keeps the button's own Outlook comments from ending the hidden region", () => {
    const html = markup(
      placed("button", {
        showOn: "mobile",
        label: "Go",
        href: "https://example.com",
      }),
    );

    expect(endifs(html)).toHaveLength(1);
    expect(
      bodyComments(html).filter((comment) => comment.includes("[if mso]")),
    ).toEqual([]);
    expect(html).toContain(">Go</span>");
  });

  it("hides a mobile-only Block inside another behind one comment", () => {
    const html = markup(
      alone({
        id: "subject",
        type: "section",
        props: { showOn: "mobile" },
        children: [
          {
            id: "inner",
            type: "text",
            props: { showOn: "mobile", content: "Inner" },
          },
          { id: "after", type: "text", props: { content: "After" } },
        ],
      }),
    );

    expect(
      bodyComments(html).filter((comment) => comment.startsWith("[if !mso]")),
    ).toHaveLength(1);
    expect(endifs(html)).toHaveLength(1);
    const body = html.slice(html.indexOf("<body"));
    expect(body.indexOf("After")).toBeLessThan(body.indexOf("<![endif]"));
    // The inner Block keeps its own wrapper, so it still needs the reveal.
    expect(parseMarkup(html).all('[class="lekh-mobile-only"]')).toHaveLength(2);
  });

  it("keeps the paragraphs of mobile-only text", () => {
    const html = markup(
      placed("text", { showOn: "mobile", content: "<p>One</p><p>Two</p>" }),
    );

    expect(parseMarkup(html).all("p")).toHaveLength(2);
  });

  it("still collects the rules of what a mobile-only container holds", () => {
    const html = markup(
      alone({
        id: "subject",
        type: "section",
        props: { showOn: "mobile" },
        children: [
          {
            id: "row",
            type: "columns",
            props: { reverseOnMobile: true },
            children: [
              { id: "a", type: "column", props: {}, children: [] },
              { id: "b", type: "column", props: {}, children: [] },
            ],
          },
          { id: "copy", type: "text", props: {}, mobile: { fontSize: 12 } },
        ],
      }),
    );

    expect(html).toContain(".lekh-reverse>tbody>tr");
    expect(html).toContain(".lekh-m-copy{font-size:12px!important}");
    expect(html).toContain(REVEAL_RULE);
  });

  it("leaves the reveal rule out when nothing is mobile-only", () => {
    expect(markup(newsletter)).not.toContain("lekh-mobile-only");
  });
});

const margins = (align: string, direction: string) =>
  styleOfFirst(markup(aligned("image", align, direction)), "img");

/** An editor over the shipped Preset alone. */
const presetEditorFor = (document: EmailDocument) =>
  createEditor({ definitions, document });

describe("alignment by reading order", () => {
  it("stores start, center or end on every aligned Block", () => {
    for (const type of ALIGNED) {
      const entry = definitionOf(type)?.schema["align"];

      expect(entry?.kind).toBe("align");
      expect(valuesOf(entry?.constraints)).toEqual(["start", "center", "end"]);
      expect(entry?.constraints?.["help"]).toMatch(/Start.*End/su);
      expect(entry?.defaultValue).toBe(type === "divider" ? "center" : "start");
    }
  });

  const PHYSICAL = [
    ["start", "ltr", "left"],
    ["start", "rtl", "right"],
    ["end", "ltr", "right"],
    ["end", "rtl", "left"],
    ["center", "ltr", "center"],
    ["center", "rtl", "center"],
  ] as const;

  describe.each(ALIGNED)("on a %s", (type) => {
    it.each(PHYSICAL)("renders %s in %s as %s", (align, direction, side) => {
      const html = markup(aligned(type, align, direction));
      const cell = overriddenCell(html);

      expect(cell.getAttribute("align")).toBe(side);
      // The image aligns by its margins, not by `text-align`.
      if (type !== "image") expect(styleOf(cell)["text-align"]).toBe(side);
      // The whole output, the stylesheet and Outlook's markup included.
      expect(html).not.toContain("text-align:start");
      expect(html).not.toContain("text-align:end");
    });

    it("renders an unknown alignment as its default", () => {
      const side = type === "divider" ? "center" : "right";

      expect(
        overriddenCell(markup(aligned(type, "justify", "rtl"))).getAttribute(
          "align",
        ),
      ).toBe(side);
    });
  });

  it("flips the image's auto margins under rtl", () => {
    expect(margins("start", "ltr")["margin-left"]).not.toBe("auto");
    expect(margins("start", "rtl")["margin-left"]).toBe("auto");
    expect(margins("start", "rtl")["margin-right"]).not.toBe("auto");
    expect(margins("end", "rtl")["margin-left"]).not.toBe("auto");
  });

  it("writes a mobile start as right in an rtl email", () => {
    const html = markup(
      aligned("heading", "center", "rtl", {
        paddingTop: undefined,
        align: "start",
      }),
    );

    expect(html).toContain(".lekh-m-subject{text-align:right!important}");
  });

  it("resolves a mobile override against the Preset's default direction", () => {
    const set = createReactEmailPreset({ direction: "rtl" });
    const html = markup(
      placed("heading", { content: "Hi" }, { align: "start" }),
      set,
    );

    expect(html).toContain(".lekh-m-subject{text-align:right!important}");
  });

  it("writes a mobile end as right in an ltr email", () => {
    const html = markup(
      aligned("text", "center", undefined, {
        paddingTop: undefined,
        align: "end",
      }),
    );

    expect(html).toContain(".lekh-m-subject{text-align:right!important}");
  });

  describe("migrating physical alignment", () => {
    it.each(ALIGNED)(
      "makes a %s's stored left and right start and end, overrides too",
      (type) => {
        const block = presetEditorFor(
          placed(type, { align: "right" }, { align: "left" }),
        ).getBlock("subject");

        expect(block?.props["align"]).toBe("end");
        expect(block?.mobile?.["align"]).toBe("start");
        expect(block?.version).toBe(definitionOf(type)?.version);
      },
    );

    it.each(ALIGNED)("keeps a %s's center and anything else", (type) => {
      for (const align of ["center", "justify", 3]) {
        const block = presetEditorFor(
          placed(type, { align }, { align }),
        ).getBlock("subject");

        expect(block?.props["align"]).toBe(align);
        expect(block?.mobile?.["align"]).toBe(align);
      }
    });

    it.each(ALIGNED)("renders an old %s as it did before", (type) => {
      const old = markup(placed(type, { align: "right" }, { align: "left" }));

      expect(old).toBe(
        markup(placed(type, { align: "end" }, { align: "start" })),
      );
      expect(old).toContain('align="right"');
    });
  });
});
