import { defineBlock } from "lekh";
import { createCompliancePreset, createReactEmailPreset } from "lekh/blocks";
import { describe, expect, it } from "vitest";

import { describeBlocks, type Inline } from "./block-reference";

const nothing = () => null;

/** An Inline written out the way a reader sees it, with backticks for code. */
const text = (inline: Inline) =>
  inline
    .map((part) => (typeof part === "string" ? part : `\`${part.code}\``))
    .join("");

describe("describeBlocks", () => {
  it("gives a Definition with no version version 0", () => {
    const [unversioned, versioned] = describeBlocks([
      defineBlock({ type: "a", label: "A", schema: {}, render: nothing }),
      defineBlock({
        type: "b",
        label: "B",
        version: 3,
        schema: {},
        render: nothing,
      }),
    ]);

    expect(unversioned).toMatchObject({ type: "a", label: "A", version: 0 });
    expect(versioned).toMatchObject({ type: "b", label: "B", version: 3 });
  });

  it("calls a Block with no accepts a leaf", () => {
    const [leaf] = describeBlocks([
      defineBlock({ type: "a", label: "A", schema: {}, render: nothing }),
    ]);

    expect(text(leaf.holds)).toBe("A leaf: it holds no Blocks.");
  });

  it("lists what a container accepts, with its bounds", () => {
    const [open, bounded, capped] = describeBlocks([
      defineBlock({
        type: "a",
        label: "A",
        accepts: ["x", "y"],
        schema: {},
        render: nothing,
      }),
      defineBlock({
        type: "b",
        label: "B",
        accepts: ["x"],
        minChildren: 2,
        maxChildren: 6,
        schema: {},
        render: nothing,
      }),
      defineBlock({
        type: "c",
        label: "C",
        accepts: ["x"],
        maxChildren: 4,
        schema: {},
        render: nothing,
      }),
    ]);

    expect(text(open.holds)).toBe("Holds `x`, `y`.");
    expect(text(bounded.holds)).toBe("Holds `x`, 2 to 6 of them.");
    expect(text(capped.holds)).toBe("Holds `x`, up to 4 of them.");
  });

  it("gives every Schema entry a row, in Schema order", () => {
    const [block] = describeBlocks([
      defineBlock<{ size: number; label: string }>({
        type: "a",
        label: "A",
        schema: {
          size: {
            kind: "number",
            label: "Size",
            defaultValue: 16,
            constraints: { min: 10, max: 48, unit: "px" },
            mobile: (value) => ({ fontSize: `${String(value)}px` }),
          },
          label: { kind: "text", label: "Label", defaultValue: "Go" },
        },
        render: nothing,
      }),
    ]);

    expect(
      block.props.map((row) => ({
        name: row.name,
        label: row.label,
        kind: row.kind,
        defaultValue: text(row.defaultValue),
        constraints: text(row.constraints),
        overridable: row.overridable,
      })),
    ).toEqual([
      {
        name: "size",
        label: "Size",
        kind: "number",
        defaultValue: "`16`",
        constraints: "10 to 48 px",
        overridable: true,
      },
      {
        name: "label",
        label: "Label",
        kind: "text",
        defaultValue: '`"Go"`',
        constraints: "",
        overridable: false,
      },
    ]);
  });

  it("writes each kind of default so it can be told apart", () => {
    const [block] = describeBlocks([
      defineBlock({
        type: "a",
        label: "A",
        schema: {
          unset: { kind: "asset", label: "Picture", defaultValue: undefined },
          flag: { kind: "boolean", label: "Flag", defaultValue: false },
          color: {
            kind: "color",
            label: "Color",
            follows: "textColor",
            defaultValue: "#333333",
          },
        },
        render: nothing,
      }),
    ]);

    expect(block.props.map((row) => text(row.defaultValue))).toEqual([
      "not set",
      "`false`",
      'the email\'s `textColor`, else `"#333333"`',
    ]);
  });

  it("writes constraints as a reader would say them", () => {
    const [block] = describeBlocks([
      defineBlock({
        type: "a",
        label: "A",
        schema: {
          stepped: {
            kind: "number",
            label: "Stepped",
            defaultValue: 600,
            constraints: { min: 320, max: 800, step: 10, unit: "px" },
          },
          floor: {
            kind: "number",
            label: "Floor",
            defaultValue: 16,
            constraints: { min: 0, unit: "px" },
          },
          plain: {
            kind: "select",
            label: "Plain",
            defaultValue: "solid",
            constraints: { options: ["solid", "dashed"] },
          },
          labelled: {
            kind: "select",
            label: "Labelled",
            defaultValue: 400,
            constraints: {
              options: [
                { label: "Regular", value: 400 },
                { label: "Bold", value: 700 },
              ],
              help: "Words for an Inspector, not a constraint on the value.",
            },
          },
          other: {
            kind: "text",
            label: "Other",
            defaultValue: "",
            constraints: { maxLength: 3, multiline: true },
          },
          empty: {
            kind: "asset",
            label: "Empty",
            defaultValue: undefined,
            constraints: { options: [] },
          },
        },
        render: nothing,
      }),
    ]);

    expect(block.props.map((row) => text(row.constraints))).toEqual([
      "320 to 800 px, in steps of 10",
      "0 px or more",
      '`"solid"`, `"dashed"`',
      "`400` Regular, `700` Bold",
      "`maxLength: 3`, `multiline: true`",
      "no options listed",
    ]);
  });

  it("covers every prop of every shipped Block", () => {
    const definitions = [
      ...createReactEmailPreset(),
      ...createCompliancePreset({ unsubscribeUrl: "%%unsubscribe%%" }),
    ];

    const described = describeBlocks(definitions);

    expect(described.map((block) => block.type)).toEqual(
      definitions.map((definition) => definition.type),
    );
    described.forEach((block, index) => {
      expect(block.props.map((row) => row.name)).toEqual(
        Object.keys(definitions[index].schema),
      );
    });
  });
});
