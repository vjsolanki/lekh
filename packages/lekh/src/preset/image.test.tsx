import { describe, expect, it } from "vitest";

import { createEditor, type EmailDocument } from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf } from "../testing/markup";
import {
  definitions,
  markup,
  alone,
  styleOfFirst,
  schemaOf,
  placed,
} from "../testing/preset";

describe("the image Block", () => {
  const asset = { src: "https://example.com/a.png", width: 800, height: 600 };

  function withImage(props: Record<string, unknown>): EmailDocument {
    return alone({ id: "photo", type: "image", props: { asset, ...props } });
  }

  it("fills the email by default, so a hero needs no arithmetic", () => {
    // The default is the Preset's content width, and the height follows the
    // Asset's own proportions from there.
    const html = markup(
      withImage({}),
      createReactEmailPreset({ contentWidth: 640 }),
    );

    expect(html).toContain('width="640"');
    expect(html).toContain('height="480"');
  });

  it("shrinks into a narrower column without squashing", () => {
    // Both attributes are emitted, for the clients that read nothing else.
    // Then `max-width` lets the width give way, and `height: auto` lets the
    // height follow it — without the second, a 240 by 180 picture in a 219px
    // column renders 219 wide and still 180 tall.
    const html = markup(withImage({ width: 240 }));

    expect(html).toContain('width="240"');
    expect(html).toContain('height="180"');
    expect(styleOf(parseMarkup(html).one("img"))).toMatchObject({
      "max-width": "100%",
      height: "auto",
    });
  });

  it("aligns through the cell for Outlook and margins for everyone else", () => {
    // A block is not moved by `text-align`. The margins do it where CSS is
    // read, and the cell's `align` where it is not.
    const centred = markup(withImage({ align: "center" }));
    expect(centred).toContain('<td align="center"');
    expect(styleOf(parseMarkup(centred).one("img"))).toMatchObject({
      "margin-left": "auto",
      "margin-right": "auto",
    });

    const right = markup(withImage({ align: "right" }));
    expect(right).toContain('<td align="right"');
    expect(styleOf(parseMarkup(right).one("img"))["margin-left"]).toBe("auto");
    expect(right).not.toContain("margin-right");

    expect(markup(withImage({}))).toContain('<td align="left"');
  });

  // #166: the reason says whether a picture is already there.
  it.each([
    ["add", "with no picture", { asset: undefined }, "replace"],
    ["add", "with no picture", { asset: undefined }, "add"],
    ["replace", "holding a picture", {}, "replace"],
    ["replace", "holding a picture", {}, "add"],
    ["drop", "for a dropped file", {}, "drop"],
  ] as const)("asks to %s an image %s", (reason, _, props, asked) => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: withImage(props),
      resolveImage: () => new Promise(() => {}),
    });

    editor.replaceImage("photo", asked);

    expect(editor.getImageRequests()).toMatchObject([
      {
        reason,
        placement: {
          kind: "replace",
          blockId: "photo",
          prop: "asset",
          decorative: false,
        },
      },
    ]);
  });

  it("takes its row and its link with it when hidden on mobile", () => {
    // The hidden class goes on the outermost element: a hidden image that
    // left its row behind would leave an empty one on the phone.
    const html = markup(
      withImage({ showOn: "desktop", href: "https://example.com" }),
    );
    const row = html.indexOf(
      '<table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" class="',
    );
    const anchor = html.indexOf("<a href=");
    const img = html.indexOf("<img");

    expect(row).toBeGreaterThan(-1);
    expect(row).toBeLessThan(anchor);
    expect(anchor).toBeLessThan(img);
    expect(parseMarkup(html).all("img[class], a[class]")).toEqual([]);
  });
});

// #70: an image's corner radius. The default matches how it looked before.
describe("the image's corner radius", () => {
  it("notes that Outlook for Windows shows square corners", () => {
    const entry = schemaOf("image")?.["borderRadius"];

    expect(entry?.clients?.filter((note) => note.when(300))).toEqual([
      expect.objectContaining({
        client: "outlook-windows",
        note: "Shows square corners",
      }),
    ]);
    expect(entry?.clients?.filter((note) => note.when(0))).toEqual([]);
  });

  it("rounds the image itself", () => {
    const style = styleOfFirst(
      markup(placed("image", { borderRadius: 300 })),
      "img",
    );

    expect(style["border-radius"]).toBe("300px");
  });

  it("leaves an image square by default", () => {
    expect(styleOfFirst(markup(placed("image", {})), "img")).not.toHaveProperty(
      "border-radius",
    );
  });

  it("offers the image's radius up to 400px, not Overridable", () => {
    const schema = schemaOf("image");

    expect(schema?.["borderRadius"]).toMatchObject({
      kind: "number",
      defaultValue: 0,
      constraints: { min: 0, max: 400, unit: "px" },
    });
    expect(schema?.["borderRadius"]).not.toHaveProperty("mobile");
    expect(schema).not.toHaveProperty("borderWidth");
  });
});
