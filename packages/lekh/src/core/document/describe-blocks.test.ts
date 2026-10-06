import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  SchemaKind,
  defineBlock,
  describeBlocks,
  type BlockDefinition,
  type BlockDescription,
  type JSONSchema,
} from "../../index";
import { definitions } from "../../testing/blocks";
import { definitions as presetDefinitions } from "../../testing/preset";

const picture = { src: "https://cdn.example/a.png", width: 600, height: 300 };

/** One Block holding a prop of every library kind. */
const everything = defineBlock<Record<string, unknown>>({
  type: "everything",
  label: "Everything",
  schema: {
    title: {
      kind: SchemaKind.text,
      label: "Title",
      defaultValue: "",
      constraints: { maxLength: 20 },
    },
    line: { kind: SchemaKind.richText, label: "Line", defaultValue: "" },
    body: {
      kind: SchemaKind.richText,
      label: "Body",
      defaultValue: "",
      constraints: { paragraphs: true, lists: true },
    },
    ink: { kind: SchemaKind.color, label: "Ink", defaultValue: "#111111" },
    fill: { kind: SchemaKind.surface, label: "Fill", defaultValue: "none" },
    brand: {
      kind: SchemaKind.surface,
      label: "Brand",
      defaultValue: "none",
      constraints: {
        brandColors: [
          { label: "Orange", value: "#ff5a1f" },
          { label: "Ink", value: "#111111" },
        ],
      },
    },
    href: { kind: SchemaKind.url, label: "Link", defaultValue: "" },
    size: {
      kind: SchemaKind.number,
      label: "Size",
      defaultValue: 14,
      constraints: { min: 10, max: 48, unit: "px" },
    },
    share: {
      kind: SchemaKind.width,
      label: "Width",
      defaultValue: 50,
      constraints: { min: 10 },
    },
    hidden: { kind: SchemaKind.boolean, label: "Hidden", defaultValue: false },
    level: {
      kind: SchemaKind.select,
      label: "Level",
      defaultValue: 1,
      constraints: { options: [1, 2, 3] },
    },
    weight: {
      kind: SchemaKind.select,
      label: "Weight",
      defaultValue: 400,
      constraints: {
        options: [
          { label: "Regular", value: 400 },
          { label: "Bold", value: 700 },
        ],
      },
    },
    align: { kind: SchemaKind.align, label: "Align", defaultValue: "start" },
    image: { kind: SchemaKind.asset, label: "Image", defaultValue: undefined },
    icon: {
      kind: SchemaKind.asset,
      label: "Icon",
      defaultValue: undefined,
      constraints: { options: [{ label: "A", asset: picture }] },
    },
    backdrop: {
      kind: SchemaKind.asset,
      label: "Backdrop",
      defaultValue: undefined,
      decorative: true,
    },
    markup: { kind: SchemaKind.html, label: "HTML", defaultValue: "" },
  },
  render: () => null,
});

/** A Consumer's Block with kinds of its own, and a prop closed to Agents. */
const product = defineBlock<Record<string, unknown>>({
  type: "product",
  label: "Product",
  schema: {
    sku: {
      kind: "product-picker",
      label: "Product",
      defaultValue: "",
      agent: { type: "string", pattern: "^SKU-\\d+$" },
    },
    stock: { kind: "stock-meter", label: "Stock", defaultValue: 0 },
    legal: {
      kind: SchemaKind.text,
      label: "Legal",
      defaultValue: "",
      agent: false,
    },
  },
  render: () => null,
});

const ajv = new Ajv2020({ strict: true });

/** The description of one type, failing the test when there is none. */
const describedAs = (
  type: string,
  set: readonly BlockDefinition[],
): BlockDescription => {
  const found = describeBlocks(set).find(
    (description) => description.type === type,
  );
  if (!found) throw new Error(`"${type}" is not described.`);
  return found;
};

const propsOf = (description: BlockDescription) => description.props.properties;

/** Whether a value fits a JSON Schema, by a real validator. */
const fits = (schema: JSONSchema, value: unknown): boolean =>
  ajv.validate(schema, value);

describe("describeBlocks", () => {
  it("describes each Definition in order, with the parents that take it", () => {
    const described = describeBlocks(definitions);
    expect(described.map(({ type }) => type)).toEqual(
      definitions.map(({ type }) => type),
    );
    expect(describedAs("text", definitions).parents).toEqual([
      "email",
      "section",
    ]);
    expect(describedAs("email", definitions).parents).toEqual([]);
  });

  it("writes each Definition's props as a closed object", () => {
    const { props, label } = describedAs("text", definitions);
    expect(label).toBe("Text");
    expect(props).toMatchObject({
      type: "object",
      title: "Text",
      additionalProperties: false,
    });
    expect(fits(props, { content: "Hi", fontSize: 16 })).toBe(true);
    expect(fits(props, { colour: "#000" })).toBe(false);
    expect(fits(props, { fontSize: "16px" })).toBe(false);
  });

  describe("every library kind", () => {
    const props = propsOf(describedAs("everything", [everything]));
    const prop = (name: string): JSONSchema => {
      const schema = props[name];
      if (!schema) throw new Error(`"${name}" is not described.`);
      return schema;
    };

    it("names each prop with its label and default", () => {
      expect(prop("size")).toMatchObject({ title: "Size", default: 14 });
      expect(prop("image")).not.toHaveProperty("default");
    });

    it.each([
      ["title", "Hello", 12],
      ["title", "x".repeat(20), "x".repeat(21)],
      ["line", "<strong>Hi</strong>", 3],
      ["ink", "#ff0000", "red"],
      ["ink", "rgb(0, 0, 0)", "none"],
      ["fill", "none", "transparent"],
      ["fill", "#abcd", "#ab"],
      ["href", "https://example.com", 5],
      ["size", 10, 9],
      ["size", 48, 49],
      ["share", 10, 9],
      ["share", 100, 101],
      ["hidden", true, "true"],
      ["level", 2, 4],
      ["weight", 700, 500],
      ["align", "end", "right"],
      ["image", picture, picture.src],
      ["image", { ...picture, alt: "A" }, { ...picture, width: 0 }],
      ["image", picture, { ...picture, src: "  " }],
      ["icon", { ...picture, alt: "A" }, { ...picture, src: "b.png" }],
      ["markup", "<table></table>", null],
    ])("%s takes %j and not %j", (name, good, bad) => {
      expect(fits(prop(name), good)).toBe(true);
      expect(fits(prop(name), bad)).toBe(false);
    });

    it("lists the tags a rich-text prop allows", () => {
      expect(prop("line")["description"]).toContain("no <p>");
      expect(prop("body")["description"]).toContain("<ul> and <ol>");
      expect(prop("body")).toMatchObject({ contentMediaType: "text/html" });
    });

    it("says how to write a colour, and None on a surface", () => {
      expect(prop("ink")["description"]).toContain("#rrggbb");
      expect(prop("fill")["description"]).toContain('"none" for no color');
    });

    it("lists a colour's Brand Colours, and keeps any other colour open", () => {
      expect(prop("brand")["description"]).toContain(
        "Orange #ff5a1f, Ink #111111",
      );
      expect(prop("ink")["description"]).not.toContain("Orange");
      expect(fits(prop("brand"), "#123456")).toBe(true);
    });

    it("tells an Asset prop's reader never to send a URL alone", () => {
      expect(prop("image")["description"]).toContain("Never a URL");
    });

    it("tells an Agent a decorative Asset's alt text is not used", () => {
      expect(prop("backdrop")["description"]).toContain(
        "Decorative: alt text is not used",
      );
      expect(prop("image")["description"]).not.toContain("Decorative");
    });
  });

  describe("a Consumer's kind", () => {
    const props = propsOf(describedAs("product", [product]));

    it("uses the `agent` fragment it gives", () => {
      expect(props["sku"]).toEqual({
        title: "Product",
        type: "string",
        pattern: "^SKU-\\d+$",
      });
    });

    it("is left out with no `agent` fragment", () => {
      expect(props).not.toHaveProperty("stock");
    });

    it("is left out with `agent: false`, whatever its kind", () => {
      expect(props).not.toHaveProperty("legal");
    });
  });

  describe("the shipped Preset", () => {
    it("describes every prop, with no `agent` fields", () => {
      for (const definition of presetDefinitions) {
        const props = propsOf(describedAs(definition.type, presetDefinitions));
        expect(Object.keys(props), definition.type).toEqual(
          Object.keys(definition.schema),
        );
      }
    });

    it("takes every Definition's own defaults", () => {
      for (const definition of presetDefinitions) {
        const defaults = Object.fromEntries(
          Object.entries(definition.schema)
            .map(([name, entry]) => [name, entry.defaultValue] as const)
            .filter(([, value]) => value !== undefined),
        );
        const { props } = describedAs(definition.type, presetDefinitions);
        expect(fits(props, defaults), definition.type).toBe(true);
      }
    });
  });

  it("writes JSON Schema a validator accepts, for every Block", () => {
    for (const { type, props } of [
      ...describeBlocks(presetDefinitions),
      ...describeBlocks([everything, product, ...definitions]),
    ]) {
      expect(ajv.validateSchema(props), type).toBe(true);
      expect(() => ajv.compile(props), type).not.toThrow();
    }
  });
});
