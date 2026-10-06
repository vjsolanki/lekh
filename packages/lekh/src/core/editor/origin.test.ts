import { describe, expect, it } from "vitest";

import { defineBlock, SchemaKind, type BlockDefinition } from "../../index";
import { editorFor } from "../../testing/editor";
import { block, documentOf, onMobile } from "../../testing/tree";

/**
 * Where each control's value comes from, on the Stage in view and on the other
 * one: its Mobile Override, the Block, an Email Default, or the Schema's
 * default. The first that holds a value wins.
 */

const email = defineBlock<{ ink: string }>({
  type: "email",
  label: "Email",
  schema: {
    // No colour until the Author picks one, so there is nothing to follow.
    ink: { kind: SchemaKind.color, label: "Ink", defaultValue: "none" },
  },
  render: () => null,
});

const copy = defineBlock<{ color: string; label: string }>({
  type: "copy",
  label: "Copy",
  schema: {
    // Follows the email and has a mobile life, so it can come from anywhere.
    color: {
      kind: SchemaKind.color,
      label: "Color",
      follows: "ink",
      defaultValue: "#000000",
      mobile: (color) => ({ color }),
    },
    // Neither: a desktop-only prop.
    label: { kind: SchemaKind.text, label: "Label", defaultValue: "" },
  },
  render: () => null,
});

/** An email with one copy Block, selected, storing what it is given. */
function editorWith(
  options: {
    readonly ink?: string;
    readonly color?: string;
    readonly mobileColor?: string;
    readonly definitions?: readonly BlockDefinition[];
  } = {},
) {
  const own = block("copy", {
    id: "copy",
    ...(options.color === undefined ? {} : { color: options.color }),
  });
  const editor = editorFor(
    documentOf(
      block("email", options.ink === undefined ? {} : { ink: options.ink }, [
        options.mobileColor === undefined
          ? own
          : onMobile(own, { color: options.mobileColor }),
      ]),
    ),
    { definitions: options.definitions ?? [email, copy] },
  );
  editor.select("copy");
  return editor;
}

const controlOf = (editor: ReturnType<typeof editorWith>, name: string) =>
  editor.getControls().find((control) => control.name === name);

describe("a control's Origin", () => {
  it("is the default when nothing is set anywhere", () => {
    const editor = editorWith();

    expect(controlOf(editor, "color")).toMatchObject({
      value: "#000000",
      origin: "default",
      otherStage: { value: "#000000", origin: "default" },
    });

    editor.setStage("mobile");
    expect(controlOf(editor, "color")).toMatchObject({
      value: "#000000",
      origin: "default",
      otherStage: { value: "#000000", origin: "default" },
    });
  });

  it("is the email when the Block follows a usable Email Default", () => {
    const editor = editorWith({ ink: "#123456" });

    expect(controlOf(editor, "color")).toMatchObject({
      value: "#123456",
      origin: "email",
      otherStage: { value: "#123456", origin: "email" },
    });

    editor.setStage("mobile");
    expect(controlOf(editor, "color")).toMatchObject({
      value: "#123456",
      origin: "email",
      otherStage: { value: "#123456", origin: "email" },
    });
  });

  it("is the default when the email's value is unusable", () => {
    const editor = editorWith({ ink: "none" });

    expect(controlOf(editor, "color")).toMatchObject({
      value: "#000000",
      origin: "default",
    });
  });

  it("is the Block when it stores its own, over the email's", () => {
    const editor = editorWith({ ink: "#123456", color: "#abcdef" });

    expect(controlOf(editor, "color")).toMatchObject({
      value: "#abcdef",
      origin: "block",
      otherStage: { value: "#abcdef", origin: "block" },
    });

    editor.setStage("mobile");
    expect(controlOf(editor, "color")).toMatchObject({
      value: "#abcdef",
      origin: "block",
      otherStage: { value: "#abcdef", origin: "block" },
    });
  });

  it("is the override on mobile, and names it from desktop", () => {
    const editor = editorWith({
      ink: "#123456",
      color: "#abcdef",
      mobileColor: "#fedcba",
    });

    expect(controlOf(editor, "color")).toMatchObject({
      value: "#abcdef",
      origin: "block",
      otherStage: { value: "#fedcba", origin: "override" },
    });

    editor.setStage("mobile");
    expect(controlOf(editor, "color")).toMatchObject({
      value: "#fedcba",
      origin: "override",
      otherStage: { value: "#abcdef", origin: "block" },
    });
  });

  it("names the email under an override", () => {
    const editor = editorWith({ ink: "#123456", mobileColor: "#fedcba" });
    editor.setStage("mobile");

    expect(controlOf(editor, "color")).toMatchObject({
      origin: "override",
      otherStage: { value: "#123456", origin: "email" },
    });
  });

  it("moves as the Author sets, overrides and resets", () => {
    const editor = editorWith({ ink: "#123456" });

    controlOf(editor, "color")?.set("#abcdef");
    expect(controlOf(editor, "color")?.origin).toBe("block");

    editor.setStage("mobile");
    controlOf(editor, "color")?.set("#fedcba");
    expect(controlOf(editor, "color")?.origin).toBe("override");

    controlOf(editor, "color")?.clearOverride();
    expect(controlOf(editor, "color")?.origin).toBe("block");

    editor.setStage("desktop");
    controlOf(editor, "color")?.reset();
    expect(controlOf(editor, "color")?.origin).toBe("email");
  });

  it("has no other Stage for a prop that is not Overridable", () => {
    const editor = editorWith();
    const label = controlOf(editor, "label");

    expect(label?.origin).toBe("default");
    expect(label).not.toHaveProperty("otherStage");
  });

  it("ignores an override the prop no longer opts in to", () => {
    // A Definition that dropped its `mobile` leaves overrides behind that
    // resolve to nothing, so they are no Origin.
    const editor = editorWith({
      mobileColor: "#fedcba",
      definitions: [
        email,
        {
          ...copy,
          schema: {
            ...copy.schema,
            color: { ...copy.schema.color, mobile: undefined },
          },
        },
      ],
    });

    expect(controlOf(editor, "color")).toMatchObject({
      origin: "default",
      overridable: false,
    });
    expect(controlOf(editor, "color")).not.toHaveProperty("otherStage");
  });
});
