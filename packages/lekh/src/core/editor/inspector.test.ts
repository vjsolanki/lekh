import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, defineBlock, type Editor } from "../../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../../blocks";
import {
  definitions,
  definitionsWithSeeded,
  sequentialIds,
} from "../../testing/blocks";

describe("the Inspector", () => {
  let editor: Editor;
  let root: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
  });

  it("describes the selected Block's editable props as data", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.select(id);

    expect(editor.getControls()).toMatchObject([
      {
        blockId: id,
        name: "content",
        kind: "rich-text",
        label: "Content",
        value: "Text",
      },
      {
        blockId: id,
        name: "fontSize",
        kind: "number",
        label: "Font size",
        value: 14,
      },
    ]);
  });

  it("says which Asset is the one the Block is", () => {
    const id = editor.insertBlock("image", root) ?? "";
    editor.select(id);

    // The Inspector offers "remove" only for an Asset that is not primary.
    expect(editor.getControls()).toMatchObject([
      { name: "asset", kind: "asset", primary: true },
    ]);
  });

  it("carries nothing renderable", () => {
    const control = editor
      .getControls()
      .find((candidate) => candidate.name === "contentWidth");

    expect(Object.keys(control ?? {}).toSorted()).toEqual([
      "blockId",
      "cancel",
      "clearOverride",
      "commit",
      "constraints",
      "kind",
      "label",
      "name",
      "origin",
      "overridable",
      "preview",
      "reset",
      "set",
      "value",
    ]);
  });

  it("passes kind-specific constraints through untouched", () => {
    const width = editor
      .getControls()
      .find((control) => control.name === "contentWidth");

    expect(width?.constraints).toEqual({ min: 320, max: 800 });
  });

  it("leaves control kinds as open strings", () => {
    // Nothing here is a closed union the Inspector switches on: a Consumer's
    // Block may declare a kind the library has never heard of, and their own
    // control renders it (ADR-0002).
    const bespoke = createEditor({
      definitions: [
        defineBlock<{ product: string }>({
          type: "email",
          label: "Email",
          accepts: [],
          schema: {
            product: {
              kind: "product-picker",
              label: "Product",
              defaultValue: "",
            },
          },
          render: () => null,
        }),
      ],
      rootType: "email",
      createId: sequentialIds(),
    });

    expect(bespoke.getControls().map((control) => control.kind)).toEqual([
      "product-picker",
    ]);
  });

  it("describes an Asset prop as one control, Asset and all", () => {
    // `asset` is one of the two kinds the library itself recognises, but only
    // so that it knows where a resolved Asset goes — the Inspector still hands
    // the whole value straight through (ADR-0010).
    const id = editor.insertBlock("image", root) ?? "";
    editor.select(id);

    expect(editor.getControls().map((control) => control.kind)).toEqual([
      "asset",
    ]);
  });

  it("describes the root Block when nothing is selected", () => {
    expect(editor.getSelection()).toBeUndefined();
    expect(editor.getControls().map((control) => control.blockId)).toEqual([
      root,
      root,
      root,
    ]);
  });

  it("falls back to the root when the selected Block disappears", () => {
    const id = editor.insertBlock("text", root) ?? "";
    editor.select(id);
    editor.removeBlock(id);

    expect(editor.getControls()[0]?.blockId).toBe(root);
  });

  it("changes the Document through the descriptor's setter", () => {
    editor
      .getControls()
      .find((control) => control.name === "backgroundColor")
      ?.set("#101010");

    expect(editor.getDocument().root.props["backgroundColor"]).toBe("#101010");
  });

  it("makes each control change undoable", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const width = editor
      .getControls()
      .find((control) => control.name === "contentWidth");
    width?.set(720);
    // Past `newGroupDelay`, or the two sets would undo as one drag.
    vi.advanceTimersByTime(1000);
    width?.set(480);
    vi.useRealTimers();

    editor.undo();
    expect(editor.getDocument().root.props["contentWidth"]).toBe(720);

    editor.undo();
    expect(editor.getDocument().root.props["contentWidth"]).toBeUndefined();
  });

  it("announces the change so a Canvas can re-render immediately", () => {
    let changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });
    editor.getControls()[0]?.set("#000000");

    expect(changes).toBe(1);
  });

  it("describes nothing for an unregistered root", () => {
    const stray = createEditor({
      definitions,
      document: { root: { id: "root", type: "mystery", props: {} } },
      rootType: "email",
    });

    expect(stray.getControls()).toEqual([]);
  });

  it("offers no addable children for a Block whose types are all placeable", () => {
    // A `section` takes text and images, and an Author drags either from the
    // palette. There is nothing here only the parent can make.
    const id = editor.insertBlock("section", root) ?? "";
    editor.select(id);

    expect(editor.getAddableChildren()).toEqual([]);
  });
});

describe("children only the parent can make", () => {
  let editor: Editor;
  let root: string;
  let gridId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsWithSeeded,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
    gridId = editor.insertBlock("grid", root) ?? "";
  });

  it("offers the structural child, labelled in its own words", () => {
    editor.select(gridId);

    expect(editor.getAddableChildren()).toMatchObject([
      { type: "cell", label: "Cell" },
    ]);
  });

  it("adds one on request, after the children already there", () => {
    editor.select(gridId);
    editor.getAddableChildren()[0]?.add();

    expect(editor.getBlock(gridId)?.children).toHaveLength(3);
  });

  it("leaves the parent selected, so the affordance survives the click", () => {
    // Selecting the new child would take the button away with it, and an Author
    // going from two to four would have to reselect the row between clicks.
    editor.select(gridId);
    editor.getAddableChildren()[0]?.add();

    expect(editor.getSelection()).toBe(gridId);
    expect(editor.getAddableChildren()).toHaveLength(1);
  });

  it("offers nothing once the parent is at its ceiling", () => {
    editor.select(gridId);
    editor.getAddableChildren()[0]?.add();
    editor.getAddableChildren()[0]?.add();

    // `grid` caps at four, so the affordance disappears rather than sitting
    // there refusing.
    expect(editor.getBlock(gridId)?.children).toHaveLength(4);
    expect(editor.getAddableChildren()).toEqual([]);
  });

  it("reads the selection, so another Block offers its own answer", () => {
    const cellId = editor.getBlock(gridId)?.children?.[0]?.id ?? "";
    const textId = editor.insertBlock("text", cellId) ?? "";
    editor.select(textId);

    // A text Block accepts nothing, so there is nothing only it could create.
    expect(editor.getSelection()).toBe(textId);
    expect(editor.getAddableChildren()).toEqual([]);
  });

  it("answers for the parent when the child selected is structural", () => {
    const cellId = editor.getBlock(gridId)?.children?.[0]?.id ?? "";
    editor.select(cellId);

    // A cell cannot be selected, so the selection is the grid and so is the
    // answer — not the empty list a cell would have given.
    expect(editor.getSelection()).toBe(gridId);
    expect(editor.getAddableChildren()).toHaveLength(1);
  });
});

describe("children the parent is configured through", () => {
  let editor: Editor;
  let gridId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsWithSeeded,
      rootType: "email",
      createId: sequentialIds(),
    });
    gridId = editor.insertBlock("grid", editor.getDocument().root.id) ?? "";
    editor.select(gridId);
  });

  const cellIds = (): readonly string[] =>
    (editor.getBlock(gridId)?.children ?? []).map((cell) => cell.id);

  it("describes each structural child's own props, in the child's words", () => {
    // The reason this method exists: a cell cannot be selected, so these props
    // have no other route to an Inspector at all.
    const [first, second] = cellIds();

    expect(editor.getEditableChildren()).toMatchObject([
      {
        blockId: first,
        label: "Cell",
        controls: [{ name: "padding", kind: "number", value: 0 }],
      },
      { blockId: second, label: "Cell" },
    ]);
  });

  it("writes to the child it describes, never to the parent", () => {
    const [first] = cellIds();
    editor.getEditableChildren()[0]?.controls[0]?.set(12);

    expect(editor.getBlock(first ?? "")?.props["padding"]).toBe(12);
    expect(editor.getBlock(gridId)?.props["padding"]).toBeUndefined();
  });

  it("offers nothing for a Block whose children an Author places", () => {
    // A section holds text and images. Both are selectable in their own right,
    // so describing them here would be a second way to reach the same props.
    const id =
      editor.insertBlock("section", editor.getDocument().root.id) ?? "";
    editor.select(id);

    expect(editor.getEditableChildren()).toEqual([]);
  });

  it("refuses removal while the minimum holds the last children in place", () => {
    // Two cells is the floor, so neither can go — the affordance disables
    // rather than being left to do nothing.
    expect(
      editor.getEditableChildren().map((child) => child.canRemove),
    ).toEqual([false, false]);
  });

  it("permits removal once there is one to spare, and carries it out", () => {
    editor.getAddableChildren()[0]?.add();
    const [, second] = cellIds();

    expect(
      editor.getEditableChildren().map((child) => child.canRemove),
    ).toEqual([true, true, true]);
    editor.getEditableChildren()[1]?.remove();

    expect(cellIds()).toHaveLength(2);
    expect(cellIds()).not.toContain(second);
  });

  it("leaves the parent selected, so the panel survives the delete", () => {
    editor.getAddableChildren()[0]?.add();
    editor.getEditableChildren()[0]?.remove();

    expect(editor.getSelection()).toBe(gridId);
    expect(editor.getEditableChildren()).toHaveLength(2);
  });
});

/**
 * ADR-0011: a Consumer selects from the editor, so a getter that builds a fresh
 * array on every call re-renders every component reading it, whatever hook sits
 * in front. For these three that is the Inspector, on every keystroke — which
 * is why identity is asserted here rather than left to the implementation.
 */
describe("what an Inspector selects from", () => {
  let editor: Editor;
  let textId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    textId = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.select(textId);
  });

  it("answers with the same snapshot until something moves", () => {
    expect(editor.getControls()).toBe(editor.getControls());
    expect(editor.getAddableChildren()).toBe(editor.getAddableChildren());
    expect(editor.getEditableChildren()).toBe(editor.getEditableChildren());
  });

  it("describes the Block again once a prop changes", () => {
    const before = editor.getControls();
    editor.setProp(textId, "fontSize", 18);

    expect(editor.getControls()).not.toBe(before);
    expect(editor.getControls()).toMatchObject([
      { name: "content" },
      { name: "fontSize", value: 18 },
    ]);
  });

  it("describes the Block again once the selection moves", () => {
    const before = editor.getControls();
    editor.select(undefined);

    expect(editor.getControls()).not.toBe(before);
  });

  it("describes the Block again once the Stage changes", () => {
    // A Mobile Override is a different value on the same control, so the Stage
    // moving is a redescription even though the Document has not moved.
    const before = editor.getControls();
    editor.setStage("mobile");

    expect(editor.getControls()).not.toBe(before);
  });

  it("holds through a read that changes nothing", () => {
    const before = editor.getControls();
    // Refused: no Op, no undo entry, and nothing announced — so nothing an
    // Inspector selected from has moved.
    editor.setProp("no-such-block", "fontSize", 18);

    expect(editor.getControls()).toBe(before);
  });
});

/** A heading's controls, in an email running one way. */
const alignFor = (direction: string | undefined) => {
  const editor = createEditor({
    definitions: createReactEmailPreset(),
    rootType: REACT_EMAIL_ROOT_TYPE,
    createId: sequentialIds(),
  });
  const root = editor.getDocument().root.id;
  if (direction !== undefined) editor.setProp(root, "direction", direction);
  editor.select(editor.insertBlock("heading", root) ?? "");
  return editor.getControls();
};

// ADR-0027: `start` is a different side in a right-to-left email.
describe("an alignment control", () => {
  it("carries the root's direction", () => {
    expect(
      alignFor("rtl").find((control) => control.name === "align"),
    ).toMatchObject({ kind: "align", value: "start", direction: "rtl" });
  });

  it("carries ltr for a root with none, or a junk one", () => {
    for (const direction of [undefined, "sideways"]) {
      expect(
        alignFor(direction).find((control) => control.name === "align")
          ?.direction,
      ).toBe("ltr");
    }
  });

  it("leaves every other control without one", () => {
    expect(
      alignFor("rtl").filter((control) => control.direction !== undefined),
    ).toMatchObject([{ name: "align" }]);
  });
});
