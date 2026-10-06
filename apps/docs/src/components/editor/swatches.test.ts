import { describe, expect, it } from "vitest";
import { defineBlock, NONE, SchemaKind, type Block } from "lekh";

import { colorsInEmail } from "./swatches";

const definitions = [
  defineBlock<Record<string, unknown>>({
    type: "box",
    label: "Box",
    schema: {
      color: { kind: SchemaKind.color, label: "Color", defaultValue: "" },
      backgroundColor: {
        kind: SchemaKind.surface,
        label: "Background",
        defaultValue: "",
      },
      label: { kind: SchemaKind.text, label: "Label", defaultValue: "" },
    },
    render: () => null,
  }),
];

let ids = 0;

const box = (
  props: Record<string, unknown>,
  extra: Partial<Block> = {},
): Block => ({ id: `box-${String((ids += 1))}`, type: "box", props, ...extra });

describe("the colours in this email", () => {
  it("lists every stored colour and Surface once, in Document order", () => {
    const root = box(
      { color: "#111111" },
      {
        children: [
          box({ backgroundColor: "#FF0000", label: "#00ff00" }),
          box({ color: "#111111" }, { mobile: { color: "#222222" } }),
        ],
      },
    );

    expect(colorsInEmail(root, definitions)).toEqual([
      "#111111",
      "#ff0000",
      "#222222",
    ]);
  });

  it("leaves out None, what is not a colour, and the Brand Colours", () => {
    const root = box(
      { color: "#abcdef" },
      {
        children: [
          box({ backgroundColor: NONE }),
          box({ color: "red; x: y" }),
          box({ backgroundColor: "#ff5a1f" }),
        ],
      },
    );

    expect(colorsInEmail(root, definitions, ["#FF5A1F"])).toEqual(["#abcdef"]);
  });

  it("counts one colour once however it is spelt, rgb() included", () => {
    const root = box(
      { color: "#FFF" },
      {
        children: [
          box({ color: "#ffffff" }),
          box({ backgroundColor: "rgb(1, 2, 3)" }),
          box({ backgroundColor: "#F50" }),
        ],
      },
    );

    expect(colorsInEmail(root, definitions, ["#ff5500"])).toEqual([
      "#ffffff",
      "rgb(1,2,3)",
    ]);
  });

  it("skips a Block whose type it does not know", () => {
    expect(
      colorsInEmail(
        { id: "x", type: "other", props: { color: "#123456" } },
        definitions,
      ),
    ).toEqual([]);
  });
});
