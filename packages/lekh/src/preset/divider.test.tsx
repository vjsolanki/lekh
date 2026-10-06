import { describe, expect, it } from "vitest";

import { parseMarkup, styleOf } from "../testing/markup";
import {
  markup,
  dividerAlone,
  styleOfFirst,
  schemaOf,
} from "../testing/preset";

// #70: a divider's thickness, style, width and alignment. Every default
// matches how it looked before.
describe("the divider's style", () => {
  it("draws an unset divider as it always has: 1px solid, full width", () => {
    const style = styleOfFirst(markup(dividerAlone({})), "hr");

    expect(style["width"]).toBe("100%");
    expect(style["border-top"]).toBe("1px solid #e6e6e6");
    expect(style).not.toHaveProperty("border-color");
  });

  it("writes the divider's thickness, style and color as its top border only", () => {
    const style = styleOfFirst(
      markup(
        dividerAlone({ thickness: 4, lineStyle: "dotted", color: "#00ff00" }),
      ),
      "hr",
    );

    expect(style["border-top"]).toBe("4px dotted #00ff00");
    expect(
      Object.keys(style).filter((property) =>
        /^border-(?:color|width|style|bottom|left|right)/u.test(property),
      ),
    ).toEqual([]);
  });

  it("sets the divider's width as a percent of its cell", () => {
    expect(
      styleOfFirst(markup(dividerAlone({ width: 40 })), "hr")["width"],
    ).toBe("40%");
  });

  it.each([
    ["left", [], ["margin-left", "margin-right"]],
    ["center", ["margin-left", "margin-right"], []],
    ["right", ["margin-left"], ["margin-right"]],
  ])(
    "aligns a divider %s on its cell and with margins",
    (align, present, absent) => {
      const html = markup(dividerAlone({ width: 50, align }));
      const style = styleOfFirst(html, "hr");
      const cell = parseMarkup(html).one("hr").parentElement;

      expect(cell?.localName).toBe("td");
      expect(cell?.getAttribute("align")).toBe(align);
      expect(cell && styleOf(cell)["text-align"]).toBe(align);
      for (const margin of present) expect(style[margin]).toBe("auto");
      for (const margin of absent) expect(style[margin]).not.toBe("auto");
    },
  );

  it("offers the divider's new props with their ranges, none Overridable", () => {
    const schema = schemaOf("divider");

    expect(schema?.["thickness"]).toMatchObject({
      kind: "number",
      defaultValue: 1,
      constraints: { min: 1, max: 12, unit: "px" },
    });
    expect(schema?.["lineStyle"]).toMatchObject({
      kind: "select",
      defaultValue: "solid",
      constraints: { options: ["solid", "dashed", "dotted"] },
    });
    expect(schema?.["width"]).toMatchObject({
      kind: "number",
      defaultValue: 100,
      constraints: { min: 10, max: 100, unit: "%" },
    });
    expect(schema?.["align"]).toMatchObject({
      kind: "align",
      defaultValue: "center",
      constraints: { options: ["start", "center", "end"] },
    });
    for (const name of ["thickness", "lineStyle", "width", "align"]) {
      expect(schema?.[name]).not.toHaveProperty("mobile");
    }
  });
});
