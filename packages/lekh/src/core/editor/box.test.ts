import { describe, expect, it } from "vitest";

import {
  defineBlock,
  EditorConfigurationError,
  SchemaKind,
  type BoxSide,
  type SchemaEntry,
} from "../../index";
import { editorFor } from "../../testing/editor";
import { block, documentOf, onMobile } from "../../testing/tree";

/**
 * A Box: a Block's spacing on up to four sides, declared by its Schema
 * (ADR-0040). Each side stays its own prop. Nothing stores whether it is
 * locked, so what lekh owes a Consumer is the grouping, a write to several
 * sides as one step, and a clear of several Mobile Overrides as one step.
 */

const side = (
  label: string,
  sides: BoxSide | readonly BoxSide[],
  box = "padding",
): SchemaEntry<number> => ({
  kind: SchemaKind.number,
  label,
  defaultValue: 0,
  box,
  side: sides,
  mobile: (value) => ({ padding: `${String(value)}px` }),
});

const email = defineBlock({
  type: "email",
  label: "Email",
  schema: {},
  render: () => null,
});

const card = defineBlock<{
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  innerY: number;
  innerX: number;
  title: string;
}>({
  type: "card",
  label: "Card",
  schema: {
    paddingTop: side("Top", "top"),
    paddingRight: side("Right", "right"),
    paddingBottom: side("Bottom", "bottom"),
    paddingLeft: side("Left", "left"),
    innerY: side("Inner, top and bottom", ["top", "bottom"], "inner"),
    innerX: side("Inner, sides", ["left", "right"], "inner"),
    title: { kind: SchemaKind.text, label: "Title", defaultValue: "" },
  },
  render: () => null,
});

const SIDES = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];

/** An email holding one card, selected, with these props and overrides. */
function editorWith(
  props: Readonly<Record<string, unknown>> = {},
  mobile?: Readonly<Record<string, unknown>>,
) {
  const own = block("card", { id: "card", ...props });
  const editor = editorFor(
    documentOf(
      block("email", {}, [mobile === undefined ? own : onMobile(own, mobile)]),
    ),
    { definitions: [email, card] },
  );
  editor.select("card");
  return editor;
}

const controlOf = (editor: ReturnType<typeof editorWith>, name: string) =>
  editor.getControls().find((control) => control.name === name);

describe("a Box on a Control Descriptor", () => {
  it("names the Box and the side each entry is", () => {
    const editor = editorWith();

    expect(controlOf(editor, "paddingTop")).toMatchObject({
      box: "padding",
      side: "top",
    });
    expect(controlOf(editor, "paddingLeft")).toMatchObject({
      box: "padding",
      side: "left",
    });
  });

  it("carries several sides when an entry is more than one", () => {
    const editor = editorWith();

    expect(controlOf(editor, "innerY")).toMatchObject({
      box: "inner",
      side: ["top", "bottom"],
    });
  });

  it("carries neither on an entry that is no side of a Box", () => {
    const control = controlOf(editorWith(), "title");

    expect(control).not.toHaveProperty("box");
    expect(control).not.toHaveProperty("side");
  });

  it("carries them on the mobile Stage too", () => {
    const editor = editorWith();
    editor.setStage("mobile");

    expect(controlOf(editor, "paddingRight")).toMatchObject({
      box: "padding",
      side: "right",
    });
  });
});

/** Declaring a Block with this Schema, to see whether it throws. */
const declare = (schema: Readonly<Record<string, SchemaEntry>>) => () =>
  defineBlock({ type: "odd", label: "Odd", schema, render: () => null });

describe("declaring a Box", () => {
  it("refuses a Box with no side", () => {
    expect(
      declare({
        gap: {
          kind: SchemaKind.number,
          label: "Gap",
          defaultValue: 0,
          box: "padding",
        },
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("refuses a side with no Box", () => {
    expect(
      declare({
        gap: {
          kind: SchemaKind.number,
          label: "Gap",
          defaultValue: 0,
          side: "top",
        },
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("refuses two entries on the same side of one Box", () => {
    expect(
      declare({ a: side("A", "top"), b: side("B", ["top", "bottom"]) }),
    ).toThrow(/top of Box "padding"/u);
  });

  it("takes the same side on two different Boxes", () => {
    expect(
      declare({ a: side("A", "top"), b: side("B", "top", "inner") }),
    ).not.toThrow();
  });
});

describe("locking an uneven Box", () => {
  const lockAt = (editor: ReturnType<typeof editorWith>, value: number) =>
    editor.setPendingChange(
      "card",
      Object.fromEntries(SIDES.map((name) => [name, value])),
    ) && editor.commitPendingChange();

  it("sets every side as one undo step, and undo puts the old sides back", () => {
    const editor = editorWith({ paddingTop: 8, paddingLeft: 24 });

    expect(lockAt(editor, 24)).toBe(true);
    expect(editor.getBlock("card")?.props).toMatchObject({
      paddingTop: 24,
      paddingRight: 24,
      paddingBottom: 24,
      paddingLeft: 24,
    });

    editor.undo();
    expect(editor.getBlock("card")?.props).toEqual({
      paddingTop: 8,
      paddingLeft: 24,
    });
    expect(editor.canUndo()).toBe(false);
  });

  it("on mobile, overrides every side at once, even one that matched desktop", () => {
    const editor = editorWith({ paddingTop: 16 }, { paddingLeft: 4 });
    editor.setStage("mobile");

    expect(lockAt(editor, 16)).toBe(true);
    expect(editor.getBlock("card")?.mobile).toEqual({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });
    expect(editor.getBlock("card")?.props).toEqual({ paddingTop: 16 });
  });
});

describe("clearing several Mobile Overrides", () => {
  it("drops them all as one undo step", () => {
    const editor = editorWith(
      { paddingTop: 16 },
      { paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 },
    );
    editor.setStage("mobile");

    expect(editor.clearMobileOverride("card", SIDES)).toBe(true);
    expect(editor.getBlock("card")).not.toHaveProperty("mobile");
    expect(controlOf(editor, "paddingTop")).toMatchObject({
      value: 16,
      origin: "block",
    });

    editor.undo();
    expect(editor.getBlock("card")?.mobile).toEqual({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    });
    expect(editor.canUndo()).toBe(false);
  });

  it("drops the ones there are, leaving the rest following desktop", () => {
    const editor = editorWith({}, { paddingTop: 8, innerX: 2 });

    expect(editor.clearMobileOverride("card", SIDES)).toBe(true);
    expect(editor.getBlock("card")?.mobile).toEqual({ innerX: 2 });
  });

  it("is refused when none of them has an override", () => {
    const editor = editorWith({}, { innerX: 2 });

    expect(editor.clearMobileOverride("card", SIDES)).toBe(false);
    expect(editor.canUndo()).toBe(false);
  });

  it("is refused whole when one is not Overridable", () => {
    const editor = editorWith({}, { paddingTop: 8 });

    expect(editor.clearMobileOverride("card", ["paddingTop", "title"])).toBe(
      false,
    );
    expect(editor.getBlock("card")?.mobile).toEqual({ paddingTop: 8 });
  });
});
