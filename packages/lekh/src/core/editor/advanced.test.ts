import { describe, expect, it } from "vitest";

import { defineBlock, describeBlocks, SchemaKind } from "../../index";
import { editorFor } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/**
 * An `advanced` Schema entry is one an Author rarely needs, so an Inspector
 * may fold it by default. The descriptor carries the mark. The Agent is
 * never told it: every prop is the same to a model.
 */

const email = defineBlock({
  type: "email",
  label: "Email",
  schema: {},
  render: () => null,
});

const card = (advanced: boolean) =>
  defineBlock<{ title: string; spacing: number }>({
    type: "card",
    label: "Card",
    schema: {
      title: { kind: SchemaKind.text, label: "Title", defaultValue: "" },
      spacing: {
        kind: SchemaKind.number,
        label: "Inner spacing",
        defaultValue: 8,
        mobile: (value) => ({ padding: `${String(value)}px` }),
        ...(advanced ? { advanced: true as const } : {}),
      },
    },
    render: () => null,
  });

function editorWith(advanced = true) {
  const editor = editorFor(
    documentOf(block("email", {}, [block("card", { id: "card" })])),
    { definitions: [email, card(advanced)] },
  );
  editor.select("card");
  return editor;
}

const controlOf = (editor: ReturnType<typeof editorWith>, name: string) =>
  editor.getControls().find((control) => control.name === name);

describe("advanced on a Control Descriptor", () => {
  it("is carried from the Schema entry", () => {
    expect(controlOf(editorWith(), "spacing")).toMatchObject({
      advanced: true,
    });
  });

  it("is absent on an entry that is not advanced", () => {
    expect(controlOf(editorWith(), "title")).not.toHaveProperty("advanced");
  });

  it("is carried on the mobile Stage too", () => {
    const editor = editorWith();
    editor.setStage("mobile");

    expect(controlOf(editor, "spacing")).toMatchObject({ advanced: true });
  });
});

describe("advanced and the Agent", () => {
  it("tells the Agent nothing different", () => {
    expect(describeBlocks(editorWith(true).getDefinitions())).toEqual(
      describeBlocks(editorWith(false).getDefinitions()),
    );
  });
});
