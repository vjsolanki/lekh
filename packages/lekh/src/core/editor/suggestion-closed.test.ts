import { beforeEach, describe, expect, it } from "vitest";

import { SchemaKind, defineBlock, type Editor } from "../../index";
import { definitions, email } from "../../testing/blocks";
import { editorFor, suggested } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/** A Consumer's Block: a kind it describes, one it does not, and one closed. */
const product = defineBlock<Record<string, unknown>>({
  type: "product",
  label: "Product",
  schema: {
    sku: {
      kind: "product-picker",
      label: "Product",
      defaultValue: "",
      agent: { type: "string" },
    },
    stock: { kind: "stock-meter", label: "Stock", defaultValue: 0 },
    legal: {
      kind: SchemaKind.text,
      label: "Legal",
      defaultValue: "Ts and Cs",
      agent: false,
    },
  },
  render: () => null,
});

// An Agent sets a prop only when it can be told the prop's shape, and never
// one closed to it.
describe("a Suggestion on a prop closed to Agents", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = editorFor(
      documentOf(
        block("email", { id: "root" }, [block("product", { id: "p" })]),
      ),
      {
        definitions: [
          { ...email, accepts: [...(email.accepts ?? []), "product"] },
          ...definitions.filter(({ type }) => type !== "email"),
          product,
        ],
      },
    );
  });

  const setProp = (prop: string, value: unknown) =>
    editor.suggest([{ kind: "set-prop", blockId: "p", prop, value }]);

  it("is refused when the entry says `agent: false`", () => {
    expect(setProp("legal", "No refunds")).toEqual({
      status: "refused",
      reasons: [
        {
          index: 0,
          code: "closed-prop",
          message: '"legal" is closed to Agents. Only the Author changes it.',
        },
      ],
    });
  });

  it("is refused even to unset it", () => {
    expect(setProp("legal", undefined)).toMatchObject({
      reasons: [{ code: "closed-prop" }],
    });
  });

  it("is refused for a Consumer's kind with no `agent` fragment", () => {
    expect(setProp("stock", 3)).toEqual({
      status: "refused",
      reasons: [
        {
          index: 0,
          code: "closed-prop",
          message: '"stock" is not described to Agents, so it cannot be set.',
        },
      ],
    });
  });

  it("is refused on an insert's props", () => {
    const refused = editor.suggest([
      { kind: "insert", type: "product", parent: "root", props: { sku: "A" } },
      {
        kind: "insert",
        type: "product",
        parent: "root",
        props: { legal: "No refunds" },
      },
    ]);
    expect(refused).toMatchObject({
      status: "refused",
      reasons: [{ index: 1, code: "closed-prop" }],
    });
  });

  it("is open for a Consumer's kind that gives a fragment", () => {
    suggested(editor, [
      { kind: "set-prop", blockId: "p", prop: "sku", value: "SKU-1" },
    ]).accept();
    expect(editor.getDocument().root.children?.[0]?.props).toEqual({
      sku: "SKU-1",
    });
  });

  it("stays open to the Author's own setProp", () => {
    editor.setProp("p", "legal", "No refunds");
    editor.setProp("p", "stock", 3);
    expect(editor.getDocument().root.children?.[0]?.props).toEqual({
      legal: "No refunds",
      stock: 3,
    });
  });
});
