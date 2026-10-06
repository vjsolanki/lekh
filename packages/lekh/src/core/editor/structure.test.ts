import { beforeEach, describe, expect, it } from "vitest";

import { createEditor, defineBlock, type Editor } from "../../index";
import {
  definitions,
  definitionsWithRequired,
  definitionsWithSeeded,
  email,
  sequentialIds,
} from "../../testing/blocks";

/** Types of the root's children, which is what most structural claims are about. */
function shape(editor: Editor): readonly string[] {
  return (editor.getDocument().root.children ?? []).map((child) => child.type);
}

/** Types of one Block's children, for claims further down the tree. */
function childTypes(editor: Editor, blockId: string): readonly string[] {
  return (editor.getBlock(blockId)?.children ?? []).map((child) => child.type);
}

describe("inserting, moving and deleting", () => {
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

  it("inserts a Block at a specific position", () => {
    editor.insertBlock("text", root);
    editor.insertBlock("image", root);
    editor.insertBlock("section", root, 1);

    expect(shape(editor)).toEqual(["text", "section", "image"]);
  });

  it("appends when no position is given", () => {
    editor.insertBlock("text", root);
    editor.insertBlock("image", root);

    expect(shape(editor)).toEqual(["text", "image"]);
  });

  it("moves a Block to a different parent", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    const textId = editor.insertBlock("text", root) ?? "";

    expect(editor.moveBlock(textId, sectionId, 0)).toBe(true);
    expect(shape(editor)).toEqual(["section"]);
    expect(editor.getBlock(sectionId)?.children?.[0]?.id).toBe(textId);
  });

  it("reorders within a parent", () => {
    editor.insertBlock("text", root);
    editor.insertBlock("image", root);
    const last = editor.insertBlock("section", root) ?? "";

    expect(editor.moveBlock(last, root, 0)).toBe(true);
    expect(shape(editor)).toEqual(["section", "text", "image"]);
  });

  it("refuses a move that would change nothing", () => {
    const id = editor.insertBlock("text", root) ?? "";
    const before = editor.getDocument();

    expect(editor.moveBlock(id, root, 0)).toBe(false);
    expect(editor.getDocument()).toBe(before);

    // Undo reaches past the refusal to the insertion, not to nothing.
    editor.undo();
    expect(shape(editor)).toEqual([]);
  });

  it("refuses to move a Block into its own subtree", () => {
    const outer = editor.insertBlock("section", root) ?? "";
    const inner = editor.insertBlock("text", outer) ?? "";

    expect(editor.moveBlock(outer, inner, 0)).toBe(false);
    expect(editor.moveBlock(outer, outer, 0)).toBe(false);
  });

  it("duplicates a Block with all of its children, giving each a new identity", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    editor.insertBlock("text", sectionId);
    editor.setProp(sectionId, "padding", 40);

    const copyId = editor.duplicateBlock(sectionId) ?? "";
    const copy = editor.getBlock(copyId);

    expect(shape(editor)).toEqual(["section", "section"]);
    expect(copy?.props).toEqual({ padding: 40 });
    expect(copy?.children).toHaveLength(1);
    expect(copy?.children?.[0]?.id).not.toBe(
      editor.getBlock(sectionId)?.children?.[0]?.id,
    );
  });

  it("places a duplicate immediately after its original", () => {
    editor.insertBlock("text", root);
    const middle = editor.insertBlock("image", root) ?? "";
    editor.insertBlock("text", root);

    editor.duplicateBlock(middle);

    expect(shape(editor)).toEqual(["text", "image", "image", "text"]);
  });

  it("deletes a Block", () => {
    const id = editor.insertBlock("text", root) ?? "";

    expect(editor.removeBlock(id)).toBe(true);
    expect(shape(editor)).toEqual([]);
  });

  it("refuses to delete the root", () => {
    expect(editor.removeBlock(root)).toBe(false);
  });
});

describe("a container that seeds its own children", () => {
  let editor: Editor;
  let root: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsWithSeeded,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
  });

  it("arrives holding its minimum", () => {
    // The whole point: one gesture yields a usable row, where before it gave an
    // empty shell that did nothing until something was dragged into it.
    const gridId = editor.insertBlock("grid", root) ?? "";

    expect(childTypes(editor, gridId)).toEqual(["cell", "cell"]);
  });

  it("seeds the whole shape in one Op, so one undo takes it back", () => {
    const ops: string[] = [];
    editor.onOp((op) => {
      ops.push(op.kind);
    });

    editor.insertBlock("grid", root);
    expect(ops).toEqual(["insert"]);

    editor.undo();
    expect(shape(editor)).toEqual([]);
  });

  it("gives the seeded children real identities", () => {
    const gridId = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(gridId)?.children ?? [];

    expect(cells.map((cell) => cell.id)).toHaveLength(2);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(2);
  });

  it("leaves a container with no minimum empty", () => {
    // A Block an Author drops is theirs to fill; seeding is the exception a
    // `minChildren` asks for, not the rule.
    const sectionId = editor.insertBlock("section", root) ?? "";

    expect(childTypes(editor, sectionId)).toEqual([]);
  });

  it("refuses a removal that would take it below its minimum", () => {
    const gridId = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(gridId)?.children ?? [];

    expect(editor.removeBlock(cells[0]?.id ?? "")).toBe(false);
    expect(childTypes(editor, gridId)).toEqual(["cell", "cell"]);
  });

  it("allows a removal that leaves the minimum standing", () => {
    const gridId = editor.insertBlock("grid", root) ?? "";
    const third = editor.insertBlock("cell", gridId) ?? "";

    expect(editor.removeBlock(third)).toBe(true);
    expect(childTypes(editor, gridId)).toEqual(["cell", "cell"]);
  });

  it("refuses a move out that would take it below its minimum", () => {
    // Taking a cell to another grid empties this one as surely as deleting it.
    const from = editor.insertBlock("grid", root) ?? "";
    const to = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(from)?.children ?? [];

    expect(editor.moveBlock(cells[0]?.id ?? "", to, 0)).toBe(false);
    expect(childTypes(editor, from)).toEqual(["cell", "cell"]);
    expect(childTypes(editor, to)).toEqual(["cell", "cell"]);
  });

  it("allows a move out that leaves the minimum standing", () => {
    const from = editor.insertBlock("grid", root) ?? "";
    const to = editor.insertBlock("grid", root) ?? "";
    const third = editor.insertBlock("cell", from) ?? "";

    expect(editor.moveBlock(third, to, 0)).toBe(true);
    expect(childTypes(editor, from)).toEqual(["cell", "cell"]);
    expect(childTypes(editor, to)).toEqual(["cell", "cell", "cell"]);
  });

  it("allows a move within it at its minimum", () => {
    // Reordering keeps the count, so the floor has nothing to say about it.
    const gridId = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(gridId)?.children ?? [];
    const first = cells[0]?.id ?? "";

    expect(editor.moveBlock(first, gridId, 2)).toBe(true);
    expect(editor.getBlock(gridId)?.children?.[1]?.id).toBe(first);
  });

  it("leaves no undo entry behind a refused removal", () => {
    const gridId = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(gridId)?.children ?? [];
    editor.removeBlock(cells[0]?.id ?? "");

    // Undo takes back the insertion, not a delete that never happened.
    editor.undo();
    expect(shape(editor)).toEqual([]);
  });

  it("still deletes the container itself", () => {
    // Nothing is made impossible by the floor: an Author who wants the row gone
    // selects the row. It is only the last children that are held in place.
    const gridId = editor.insertBlock("grid", root) ?? "";

    expect(editor.removeBlock(gridId)).toBe(true);
    expect(shape(editor)).toEqual([]);
  });

  it("says in advance which removals would be refused", () => {
    // The button and the delete behind it have to agree, or an enabled button
    // does nothing when pressed.
    const gridId = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(gridId)?.children ?? [];
    const first = cells[0]?.id ?? "";

    expect(editor.canRemove(first)).toBe(false);

    const third = editor.insertBlock("cell", gridId) ?? "";
    expect(editor.canRemove(first)).toBe(true);
    expect(editor.canRemove(third)).toBe(true);
    expect(editor.canRemove(gridId)).toBe(true);
  });

  it("agrees with what removeBlock actually does", () => {
    const gridId = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(gridId)?.children ?? [];
    const first = cells[0]?.id ?? "";

    expect(editor.canRemove(first)).toBe(editor.removeBlock(first));
  });

  it("refuses an unknown Block", () => {
    expect(editor.canRemove("nowhere")).toBe(false);
  });

  it("seeds a duplicate from the original rather than afresh", () => {
    // `duplicateBlock` clones, so the copy carries whatever the original held
    // — seeding never runs twice over the same row.
    const gridId = editor.insertBlock("grid", root) ?? "";
    const cells = editor.getBlock(gridId)?.children ?? [];
    editor.insertBlock("text", cells[0]?.id ?? "");

    const copyId = editor.duplicateBlock(gridId) ?? "";
    const copied = editor.getBlock(copyId)?.children ?? [];

    expect(copied).toHaveLength(2);
    expect(copied[0]?.children).toHaveLength(1);
  });
});

/** A grid seeding the props it is handed, on top of a floor of one. */
function editorSeeding(
  seeds: readonly Readonly<Record<string, unknown>>[],
  floor = 1,
): { editor: Editor; root: string } {
  const editor = createEditor({
    definitions: definitionsWithSeeded.map((definition) =>
      definition.type === "grid"
        ? { ...definition, minChildren: floor, seed: () => seeds }
        : definition,
    ),
    rootType: "email",
    createId: sequentialIds(),
  });
  return { editor, root: editor.getDocument().root.id };
}

const seededProps = (editor: Editor, gridId: string) =>
  (editor.getBlock(gridId)?.children ?? []).map((child) => child.props);

describe("a container that gives its seeded children starting props", () => {
  it("seeds one child per props object, each starting with its own", () => {
    const { editor, root } = editorSeeding([
      { padding: 4 },
      { padding: 8 },
      {},
    ]);
    const gridId = editor.insertBlock("grid", root) ?? "";

    expect(seededProps(editor, gridId)).toEqual([
      { padding: 4 },
      { padding: 8 },
      {},
    ]);
  });

  it("keeps its floor apart from how many it seeds", () => {
    const { editor, root } = editorSeeding([{}, {}, {}]);
    const gridId = editor.insertBlock("grid", root) ?? "";
    const [first, second] = editor.getBlock(gridId)?.children ?? [];

    expect(editor.removeBlock(first?.id ?? "")).toBe(true);
    expect(editor.removeBlock(second?.id ?? "")).toBe(true);
    expect(
      editor.canRemove(editor.getBlock(gridId)?.children?.[0]?.id ?? ""),
    ).toBe(false);
  });

  it("still seeds its minimum when it hands over fewer", () => {
    const { editor, root } = editorSeeding([{ padding: 4 }], 2);
    const gridId = editor.insertBlock("grid", root) ?? "";

    expect(seededProps(editor, gridId)).toEqual([{ padding: 4 }, {}]);
  });

  it("never seeds past its ceiling", () => {
    const { editor, root } = editorSeeding(
      Array.from({ length: 6 }, () => ({})),
    );
    const gridId = editor.insertBlock("grid", root) ?? "";

    expect(seededProps(editor, gridId)).toHaveLength(4);
  });
});

describe("what selecting a Block actually reaches", () => {
  let editor: Editor;
  let root: string;
  let gridId: string;
  let cellId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsWithSeeded,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
    gridId = editor.insertBlock("grid", root) ?? "";
    cellId = editor.getBlock(gridId)?.children?.[0]?.id ?? "";
  });

  it("answers with the Block itself for anything an Author places", () => {
    expect(editor.getSelectable(gridId)).toBe(gridId);
    expect(editor.getSelectable(root)).toBe(root);
  });

  it("answers with the parent for a structural child", () => {
    expect(editor.getSelectable(cellId)).toBe(gridId);
  });

  it("stops at the first Block that is not structural, not the top", () => {
    // A Block inside a column is the Author's own — the column is what belongs
    // to the row, and only the column hands its selection on.
    const textId = editor.insertBlock("text", cellId) ?? "";

    expect(editor.getSelectable(textId)).toBe(textId);
  });

  it("answers with nothing for a Block that is not in the Document", () => {
    expect(editor.getSelectable("nowhere")).toBeUndefined();
  });

  it("puts the selection on the parent, however the id arrived", () => {
    // The rule lives here rather than in the Canvas, so a Consumer's own tree
    // panel gets it without knowing there is a rule.
    expect(editor.select(cellId)).toBe(true);
    expect(editor.getSelection()).toBe(gridId);
  });

  it("still refuses a Block it has never heard of", () => {
    expect(editor.select("nowhere")).toBe(false);
    expect(editor.getSelection()).toBeUndefined();
  });
});

describe("entering a Block's text", () => {
  let editor: Editor;
  let root: string;
  let textId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsWithSeeded,
      rootType: "email",
      createId: sequentialIds(),
    });
    root = editor.getDocument().root.id;
    textId = editor.insertBlock("text", root) ?? "";
  });

  it("selects the Block it puts the Author into", () => {
    expect(editor.edit(textId)).toBe(true);

    expect(editor.getEditing()).toBe(textId);
    // The Inspector describes the Block whose words are being typed, without
    // a Consumer having to select it themselves first.
    expect(editor.getSelection()).toBe(textId);
  });

  it("is refused for a Block with no text in it", () => {
    const imageId = editor.insertBlock("image", root) ?? "";

    expect(editor.edit(imageId)).toBe(false);
    expect(editor.getEditing()).toBeUndefined();
    // Refused means nothing happened, including the selection.
    expect(editor.getSelection()).toBeUndefined();
  });

  it("is refused for a Block that is not in the Document", () => {
    expect(editor.edit("nowhere")).toBe(false);
    expect(editor.getEditing()).toBeUndefined();
  });

  it("is refused for a Block an Author reaches only through its parent", () => {
    // A structural Block belongs to whoever owns it. Typing into one would be
    // a fourth route around that, after the palette, the drag and the
    // selection — and it would put the caret somewhere the Inspector is not
    // describing, because the selection would be on the parent.
    const caption = defineBlock<{ content: string }>({
      type: "caption",
      label: "Caption",
      structural: true,
      schema: {
        content: { kind: "rich-text", label: "Content", defaultValue: "" },
      },
      render: () => null,
    });
    const frame = defineBlock<Record<string, never>>({
      type: "frame",
      label: "Frame",
      accepts: ["caption"],
      schema: {},
      render: () => null,
    });
    const framed = createEditor({
      definitions: [{ ...email, accepts: ["frame"] }, frame, caption],
      document: {
        root: {
          id: "root",
          type: "email",
          props: {},
          children: [
            {
              id: "frame",
              type: "frame",
              props: {},
              children: [
                { id: "caption", type: "caption", props: { content: "Hi" } },
              ],
            },
          ],
        },
      },
    });

    expect(framed.edit("caption")).toBe(false);
    expect(framed.getEditing()).toBeUndefined();
    expect(framed.getSelection()).toBeUndefined();
  });

  it("ends when the Author selects something else", () => {
    const other = editor.insertBlock("text", root) ?? "";
    editor.edit(textId);

    editor.select(other);

    expect(editor.getEditing()).toBeUndefined();
    expect(editor.getSelection()).toBe(other);
  });

  it("survives selecting the Block already being typed into", () => {
    editor.edit(textId);

    // Every press inside the words comes through here. Ending the edit on one
    // would take the caret away on the Author's second click.
    expect(editor.select(textId)).toBe(true);

    expect(editor.getEditing()).toBe(textId);
  });

  it("ends when the selection is cleared", () => {
    editor.edit(textId);

    editor.select(undefined);

    expect(editor.getEditing()).toBeUndefined();
  });

  it("ends when the Block leaves the Document", () => {
    editor.edit(textId);

    editor.removeBlock(textId);

    expect(editor.getEditing()).toBeUndefined();
  });

  it("leaves the selection where it is when the Author leaves the text", () => {
    editor.edit(textId);

    expect(editor.edit(undefined)).toBe(true);

    expect(editor.getEditing()).toBeUndefined();
    expect(editor.getSelection()).toBe(textId);
  });

  it("tells subscribers, so a surface can stop offering the drag", () => {
    let changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });

    editor.edit(textId);
    expect(changes).toBe(1);
    // Nothing moved, so nobody is woken.
    editor.edit(textId);
    expect(changes).toBe(1);

    editor.edit(undefined);
    expect(changes).toBe(2);
  });
});

describe("nesting rules", () => {
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

  it("refuses an insertion the parent does not accept", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";

    expect(editor.canInsert("section", sectionId)).toBe(false);
    expect(editor.insertBlock("section", sectionId)).toBeUndefined();
    expect(editor.getBlock(sectionId)?.children).toEqual([]);
  });

  it("treats a Block with no accepts rule as a leaf", () => {
    const textId = editor.insertBlock("text", root) ?? "";

    expect(editor.canInsert("text", textId)).toBe(false);
    expect(editor.getBlock(textId)?.children).toBeUndefined();
  });

  it("refuses a move the target parent does not accept", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    const otherId = editor.insertBlock("section", root) ?? "";

    expect(editor.moveBlock(otherId, sectionId, 0)).toBe(false);
  });

  it("refuses children beyond the declared maximum", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    editor.insertBlock("text", sectionId);
    editor.insertBlock("text", sectionId);

    expect(editor.canInsert("text", sectionId)).toBe(false);
    expect(editor.insertBlock("text", sectionId)).toBeUndefined();
    expect(editor.getBlock(sectionId)?.children).toHaveLength(2);
  });

  it("refuses a duplicate that would overflow the parent", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    const first = editor.insertBlock("text", sectionId) ?? "";
    editor.insertBlock("text", sectionId);

    expect(editor.duplicateBlock(first)).toBeUndefined();
  });

  it("still allows reordering inside a full parent", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    editor.insertBlock("text", sectionId);
    const second = editor.insertBlock("image", sectionId) ?? "";

    expect(editor.moveBlock(second, sectionId, 0)).toBe(true);
    expect(
      editor.getBlock(sectionId)?.children?.map((child) => child.type),
    ).toEqual(["image", "text"]);
  });

  it("leaves no undo entry behind a refused operation", () => {
    const sectionId = editor.insertBlock("section", root) ?? "";
    editor.insertBlock("text", sectionId);
    editor.insertBlock("text", sectionId);
    const before = editor.getDocument();

    editor.insertBlock("text", sectionId);
    editor.undo();

    expect(editor.getDocument()).not.toBe(before);
    expect(editor.getBlock(sectionId)?.children).toHaveLength(1);
  });
});

describe("Required Blocks", () => {
  it("report themselves unremovable, which is a different fact from a floor", () => {
    // `deletable: false` is permanent and about the type — what a padlock says.
    // `canRemove` is about one Block where it sits, and reports both.
    const editor = createEditor({
      definitions: definitionsWithRequired({ deletable: false }),
      rootType: "email",
      createId: sequentialIds(),
    });
    const required = editor.getDocument().root.children?.[0]?.id ?? "";

    expect(editor.canRemove(required)).toBe(false);
    expect(editor.getDefinition("unsubscribe")?.deletable).toBe(false);
  });

  it("cannot be deleted directly when declared non-deletable", () => {
    const editor = createEditor({
      definitions: definitionsWithRequired({ deletable: false }),
      rootType: "email",
      createId: sequentialIds(),
    });
    const id = editor.getDocument().root.children?.[0]?.id ?? "";

    expect(editor.removeBlock(id)).toBe(false);
    expect(editor.getBlock(id)).toBeDefined();
  });

  it("can be removed along with the container holding them", () => {
    const editor = createEditor({
      definitions: definitionsWithRequired({ deletable: false }),
      rootType: "email",
      createId: sequentialIds(),
    });
    const root = editor.getDocument().root.id;
    const sectionId = editor.insertBlock("section", root) ?? "";
    const required = editor.getDocument().root.children?.[0]?.id ?? "";
    editor.moveBlock(required, sectionId, 0);

    // Redesigning a footer must stay possible, so deleting the container that
    // happens to hold Required content succeeds (ADR-0006).
    expect(editor.removeBlock(sectionId)).toBe(true);
    expect(editor.getBlock(required)).toBeUndefined();
  });
});
