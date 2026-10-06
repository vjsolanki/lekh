import { describe, expect, it } from "vitest";

import { defineBlock, SchemaKind } from "../../index";
import { editorFor } from "../../testing/editor";
import { block, documentOf, onMobile } from "../../testing/tree";

/**
 * Mail Client Notes: what a mail client will do with a prop's value, declared
 * by the Schema entry (ADR-0041). The descriptor carries the ones whose
 * condition holds for the value in view. They are not Diagnostics.
 */

const email = defineBlock({
  type: "email",
  label: "Email",
  schema: {},
  render: () => null,
});

const pill = defineBlock<{ radius: number; label: string }>({
  type: "pill",
  label: "Pill",
  schema: {
    radius: {
      kind: SchemaKind.number,
      label: "Corner radius",
      defaultValue: 0,
      mobile: (value) => ({ "border-radius": `${String(value)}px` }),
      clients: [
        {
          client: "outlook-windows",
          when: (value) => value > 0,
          note: "Shows square corners",
        },
        {
          client: "gmail",
          when: (value) => value > 20,
          note: "Rounds less",
        },
        {
          client: "yahoo",
          when: (value) => value >= 0,
          note: "Always says this",
        },
      ],
    },
    label: { kind: SchemaKind.text, label: "Label", defaultValue: "" },
  },
  render: () => null,
});

function editorWith(
  props: Readonly<Record<string, unknown>> = {},
  mobile?: Readonly<Record<string, unknown>>,
) {
  const own = block("pill", { id: "pill", ...props });
  const editor = editorFor(
    documentOf(
      block("email", {}, [mobile === undefined ? own : onMobile(own, mobile)]),
    ),
    { definitions: [email, pill] },
  );
  editor.select("pill");
  return editor;
}

const controlOf = (editor: ReturnType<typeof editorWith>, name: string) =>
  editor.getControls().find((control) => control.name === name);

describe("Mail Client Notes on a Control Descriptor", () => {
  it("carries only the notes whose condition holds for the value", () => {
    expect(controlOf(editorWith({ radius: 8 }), "radius")?.clients).toEqual([
      { client: "outlook-windows", note: "Shows square corners" },
      { client: "yahoo", note: "Always says this" },
    ]);
    expect(controlOf(editorWith({ radius: 24 }), "radius")?.clients).toEqual([
      { client: "outlook-windows", note: "Shows square corners" },
      { client: "gmail", note: "Rounds less" },
      { client: "yahoo", note: "Always says this" },
    ]);
  });

  it("follows the value as it changes", () => {
    const editor = editorWith({ radius: 0 });
    expect(controlOf(editor, "radius")?.clients).toEqual([
      { client: "yahoo", note: "Always says this" },
    ]);

    controlOf(editor, "radius")?.set(4);

    expect(controlOf(editor, "radius")?.clients).toContainEqual({
      client: "outlook-windows",
      note: "Shows square corners",
    });
  });

  it("reads the value on the Stage in view", () => {
    const editor = editorWith({ radius: 0 }, { radius: 12 });
    expect(controlOf(editor, "radius")?.clients).toHaveLength(1);

    editor.setStage("mobile");

    expect(controlOf(editor, "radius")?.clients).toHaveLength(2);
  });

  it("is absent on a prop that declares none", () => {
    expect(controlOf(editorWith(), "label")).not.toHaveProperty("clients");
  });

  it("is never a Diagnostic", () => {
    const editor = editorWith({ radius: 24 });

    expect(editor.getDiagnostics()).toEqual([]);
  });
});
