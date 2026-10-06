import { describe, expect, it } from "vitest";

import {
  createEditor,
  type BlockRect,
  type DropOutcome,
  type DropTarget,
  type Editor,
} from "../../index";
import { definitions } from "../../testing/blocks";
import {
  definitions as presetDefinitions,
  newsletter,
} from "../../testing/preset";

/**
 * A stacked layout, measured once and written down.
 *
 * Resolution is a pure function of pointer, rectangles and accepts rules, so
 * this suite needs no browser and no layout engine — synthetic rectangles say
 * everything a real one would.
 *
 *   root       0 .. 400
 *     head     0 ..  50   text
 *     row     50 .. 150   section, one of its two slots used
 *       a     60 ..  90   text
 *     full   150 .. 250   section, both slots used
 *       c    160 .. 190   text
 *       d    190 .. 240   text
 *     foot   250 .. 300   text
 */
const layout: readonly BlockRect[] = [
  { blockId: "root", top: 0, left: 0, width: 600, height: 400 },
  { blockId: "head", top: 0, left: 0, width: 600, height: 50 },
  { blockId: "row", top: 50, left: 0, width: 600, height: 100 },
  { blockId: "a", top: 60, left: 0, width: 600, height: 30 },
  { blockId: "full", top: 150, left: 0, width: 600, height: 100 },
  { blockId: "c", top: 160, left: 0, width: 600, height: 30 },
  { blockId: "d", top: 190, left: 0, width: 600, height: 50 },
  { blockId: "foot", top: 250, left: 0, width: 600, height: 50 },
];

function editorWithLayout(): Editor {
  return createEditor({
    definitions,
    document: {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          { id: "head", type: "text", props: {} },
          {
            id: "row",
            type: "section",
            props: {},
            children: [{ id: "a", type: "text", props: {} }],
          },
          {
            id: "full",
            type: "section",
            props: {},
            children: [
              { id: "c", type: "text", props: {} },
              { id: "d", type: "text", props: {} },
            ],
          },
          { id: "foot", type: "text", props: {} },
        ],
      },
    },
  });
}

function outcomeAt(y: number, draggedType = "text", draggedBlockId?: string) {
  return editorWithLayout().resolveDropTarget({
    draggedType,
    pointer: { x: 300, y },
    rects: layout,
    draggedBlockId,
  });
}

/** The Drop Target a drag at this height lands on, or nothing if it does not. */
function resolve(y: number, draggedType = "text", draggedBlockId?: string) {
  return landing(outcomeAt(y, draggedType, draggedBlockId));
}

/** The Drop Target out of an outcome that was expected to land somewhere. */
function landing(outcome: DropOutcome): DropTarget | undefined {
  return outcome.status === "landing" ? outcome.target : undefined;
}

describe("resolving a Drop Target", () => {
  it("inserts before the hovered Block when the pointer is in its top half", () => {
    expect(resolve(10)).toEqual({
      parentId: "root",
      index: 0,
      position: "before",
      referenceBlockId: "head",
      axis: "vertical",
    });
  });

  it("inserts after the hovered Block when the pointer is in its bottom half", () => {
    expect(resolve(40)).toEqual({
      parentId: "root",
      index: 1,
      position: "after",
      referenceBlockId: "head",
      axis: "vertical",
    });
  });

  it("walks up from a leaf until it finds an ancestor that accepts the type", () => {
    // `a` is a text Block and accepts nothing, so the drop lands in the
    // section around it rather than nowhere.
    expect(resolve(65)).toEqual({
      parentId: "row",
      index: 0,
      position: "before",
      referenceBlockId: "a",
      axis: "vertical",
    });
  });

  it("keeps walking up when the nearest container refuses the type", () => {
    // A section may not hold another section, so the drop climbs to the root
    // and lands relative to the row.
    expect(resolve(65, "section")).toEqual({
      parentId: "root",
      index: 1,
      position: "before",
      referenceBlockId: "row",
      axis: "vertical",
    });
  });

  it("lands beside the nearest child when the pointer is over the container's own space", () => {
    // The 55px of the row below `a` is padding, and an Author holding a Block
    // there means "under `a`" — not "somewhere in this row", and not "at the
    // end", which is where a whole-container drop would have put it.
    expect(resolve(145)).toEqual({
      parentId: "row",
      index: 1,
      position: "after",
      referenceBlockId: "a",
      axis: "vertical",
    });
  });

  it("climbs past a container that is already at its maximum", () => {
    expect(resolve(165)).toEqual({
      parentId: "root",
      index: 2,
      position: "before",
      referenceBlockId: "full",
      axis: "vertical",
    });
  });

  it("lets a full container still receive a Block already inside it", () => {
    expect(resolve(165, "text", "d")).toEqual({
      parentId: "full",
      index: 0,
      position: "before",
      referenceBlockId: "c",
      axis: "vertical",
    });
  });

  it("does not append when the container's own space is above its children", () => {
    // The 10px of `full` above `c`. Counting this as a drop into the container
    // would put the Block at the end of it — the opposite end from the one the
    // Author was pointing at.
    expect(resolve(155, "text", "d")).toEqual({
      parentId: "full",
      index: 0,
      position: "before",
      referenceBlockId: "c",
      axis: "vertical",
    });
  });

  it("refuses to drop a Block into its own subtree", () => {
    expect(resolve(65, "section", "row")).toMatchObject({ parentId: "root" });
  });

  it("resolves to elsewhere when the pointer is over no Block at all", () => {
    // Not a refusal: nothing turned the drag down, it is simply not over the
    // email. Carrying a Block off the Canvas and letting go is how an Author
    // abandons a drag, and it must stay silent.
    expect(
      editorWithLayout().resolveDropTarget({
        draggedType: "text",
        pointer: { x: 900, y: 10 },
        rects: layout,
      }),
    ).toEqual({ status: "elsewhere" });
  });

  it("refuses, with a reason, when no ancestor accepts the type", () => {
    // Nothing accepts the root's own type.
    expect(outcomeAt(10, "email")).toEqual({
      status: "refused",
      refusal: {
        code: "not-accepted",
        message: "Email is not allowed inside Email.",
        blockId: "root",
      },
    });
  });

  it("names the nearest container rather than the leaf under the pointer", () => {
    // The pointer is inside `a`, a text Block, which is not a container at
    // all — "not allowed inside Text" is true and useless. The Author was
    // aiming at the section around it, so that is what the refusal names.
    expect(outcomeAt(65, "email")).toMatchObject({
      status: "refused",
      refusal: {
        blockId: "row",
        message: "Email is not allowed inside Section.",
      },
    });
  });

  it("keeps drawing an indicator when only some of the chain refuses", () => {
    // The section refuses a section and the root accepts one, so this is a
    // landing rather than a refusal — a refusal is every candidate saying no.
    expect(outcomeAt(65, "section")).toMatchObject({ status: "landing" });
  });

  it("ignores rectangles for Blocks that are not in the Document", () => {
    // The pointer is inside the ghost, which resolves nothing: the drop lands
    // where it would have without it, under the last of the root's children.
    expect(
      landing(
        editorWithLayout().resolveDropTarget({
          draggedType: "text",
          pointer: { x: 300, y: 380 },
          rects: [
            ...layout,
            { blockId: "ghost", top: 350, left: 0, width: 600, height: 50 },
          ],
        }),
      ),
    ).toEqual({
      parentId: "root",
      index: 4,
      position: "after",
      referenceBlockId: "foot",
      axis: "vertical",
    });
  });
});

const empty: readonly BlockRect[] = [
  { blockId: "root", top: 0, left: 0, width: 600, height: 200 },
  { blockId: "hollow", top: 0, left: 0, width: 600, height: 100 },
];

function editorWithEmptyContainer(): Editor {
  return createEditor({
    definitions,
    document: {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "hollow", type: "section", props: {}, children: [] }],
      },
    },
  });
}

describe("resolving a Drop Target inside an empty container", () => {
  it("drops inside, because there is nothing to land beside", () => {
    expect(
      landing(
        editorWithEmptyContainer().resolveDropTarget({
          draggedType: "text",
          pointer: { x: 300, y: 50 },
          rects: empty,
        }),
      ),
    ).toEqual({
      parentId: "hollow",
      index: 0,
      position: "inside",
      axis: "vertical",
    });
  });
});

/**
 * Children sharing a line — a row of columns.
 *
 * Which side of a column a drop lands on is a question about x, and answering
 * it with y would decide left and right by whether the pointer was high or low
 * in the row. The axis is read off the rectangles themselves: these two
 * overlap all the way down and not at all across.
 *
 *   root   0 .. 200
 *     left    x   0 .. 300
 *     right   x 300 .. 600
 */
describe("resolving a Drop Target across a row", () => {
  const row: readonly BlockRect[] = [
    { blockId: "root", top: 0, left: 0, width: 600, height: 200 },
    { blockId: "left", top: 0, left: 0, width: 300, height: 100 },
    { blockId: "right", top: 0, left: 300, width: 300, height: 100 },
  ];

  function resolveAcross(x: number) {
    return landing(
      createEditor({
        definitions,
        document: {
          root: {
            id: "root",
            type: "email",
            props: {},
            children: [
              { id: "left", type: "text", props: {} },
              { id: "right", type: "text", props: {} },
            ],
          },
        },
      }).resolveDropTarget({
        draggedType: "text",
        pointer: { x, y: 50 },
        rects: row,
      }),
    );
  }

  it("inserts before a child when the pointer is in its left half", () => {
    expect(resolveAcross(100)).toEqual({
      parentId: "root",
      index: 0,
      position: "before",
      referenceBlockId: "left",
      axis: "horizontal",
    });
  });

  it("inserts after a child when the pointer is in its right half", () => {
    expect(resolveAcross(200)).toEqual({
      parentId: "root",
      index: 1,
      position: "after",
      referenceBlockId: "left",
      axis: "horizontal",
    });
  });

  it("reads the same insertion point from either side of a boundary", () => {
    // Just right of the seam is `right`'s left half; just left of it is
    // `left`'s right half. Both mean between them.
    expect(resolveAcross(310)).toMatchObject({ index: 1 });
    expect(resolveAcross(290)).toMatchObject({ index: 1 });
  });

  it("inserts at the end past the last child", () => {
    expect(resolveAcross(590)).toEqual({
      parentId: "root",
      index: 2,
      position: "after",
      referenceBlockId: "right",
      axis: "horizontal",
    });
  });
});

/**
 * The pointerless form of the same question.
 *
 * Two of the three refusals cannot be reached by walking the chain in this
 * fixture — a full section and a Block dropped into itself both climb to a
 * root that accepts them, which is the right answer and not a refusal at all.
 * They are still reachable the other way: a drop that resolved cleanly and was
 * refused when it came to be applied.
 */
describe("explaining a refusal without a pointer", () => {
  it("says a container is full", () => {
    expect(editorWithLayout().explainDropRefusal("full", "text")).toEqual({
      code: "at-capacity",
      message: "Section is full.",
      blockId: "full",
    });
  });

  it("does not call a container full for a Block already inside it", () => {
    expect(
      editorWithLayout().explainDropRefusal("full", "text", "d"),
    ).toBeUndefined();
  });

  it("says a Block cannot be moved inside itself", () => {
    expect(
      editorWithLayout().explainDropRefusal("row", "section", "row"),
    ).toEqual({
      code: "own-subtree",
      message: "A Section cannot be moved inside itself.",
      blockId: "row",
    });
  });

  it("says a container does not take the type", () => {
    expect(editorWithLayout().explainDropRefusal("row", "section")).toEqual({
      code: "not-accepted",
      message: "Section is not allowed inside Section.",
      blockId: "row",
    });
  });

  it("explains nothing when the parent would take the Block", () => {
    expect(
      editorWithLayout().explainDropRefusal("row", "text"),
    ).toBeUndefined();
  });

  it("explains nothing about a parent that is not there", () => {
    expect(
      editorWithLayout().explainDropRefusal("gone", "text"),
    ).toBeUndefined();
  });
});

describe("a resolved Drop Target", () => {
  it("can be handed straight to moveBlock", () => {
    const editor = editorWithLayout();
    const target = landing(
      editor.resolveDropTarget({
        draggedType: "text",
        pointer: { x: 300, y: 65 },
        rects: layout,
        draggedBlockId: "foot",
      }),
    );

    expect(
      editor.moveBlock("foot", target?.parentId ?? "", target?.index ?? 0),
    ).toBe(true);
    expect(editor.getBlock("row")?.children?.map((child) => child.id)).toEqual([
      "foot",
      "a",
    ]);
  });

  it("counts its index as the Document reads now, moved Block included", () => {
    const editor = editorWithLayout();
    // Dropping `head` below `foot`, which is the fourth of four: the position
    // after it is the fourth, counted with `head` still sitting at the top.
    const target = landing(
      editor.resolveDropTarget({
        draggedType: "text",
        pointer: { x: 300, y: 290 },
        rects: layout,
        draggedBlockId: "head",
      }),
    );

    expect(target).toMatchObject({ position: "after", index: 4 });

    // `moveBlock` is what knows the Block is lifted out before it lands.
    editor.moveBlock("head", "root", target?.index ?? 0);
    expect(
      editor.getDocument().root.children?.map((child) => child.id),
    ).toEqual(["row", "full", "foot", "head"]);
  });

  it("reports the same index whether or not a Block is being moved", () => {
    const query = {
      draggedType: "text",
      pointer: { x: 300, y: 290 },
      rects: layout,
    } as const;
    const editor = editorWithLayout();

    // The one property the whole arrangement turns on: a target held while an
    // upload runs is read exactly like one acted on the instant it resolves.
    expect(editor.resolveDropTarget(query)).toEqual(
      editor.resolveDropTarget({ ...query, draggedBlockId: "head" }),
    );
  });
});

/** A Drop Target as its parent and index, whichever neighbour names it. */
function keyOf(target: DropTarget): string {
  return `${target.parentId}:${target.index}`;
}

/**
 * Every place a pointer sweeping down the layout resolves to.
 *
 * One pixel at a time down the middle, which in this layout crosses every
 * Block and every gap between them.
 */
function sweep(editor: Editor, draggedType: string, draggedBlockId?: string) {
  const places = new Set<string>();
  for (let y = 0; y < 400; y++) {
    const target = landing(
      editor.resolveDropTarget({
        draggedType,
        pointer: { x: 300, y },
        rects: layout,
        draggedBlockId,
      }),
    );
    if (target) places.add(keyOf(target));
  }
  return places;
}

/** The places listed for a drag, in a stable order. */
function listed(editor: Editor, draggedType: string, draggedBlockId?: string) {
  return editor
    .getDropTargets({ draggedType, draggedBlockId })
    .map((target) => keyOf(target))
    .toSorted();
}

describe("listing every Drop Target", () => {
  it("lists exactly the places a drag can resolve to", () => {
    const editor = editorWithLayout();

    // `full` is at capacity, so nothing lands inside it; every gap in the root
    // and in `row` does.
    expect(listed(editor, "text")).toEqual([
      "root:0",
      "root:1",
      "root:2",
      "root:3",
      "root:4",
      "row:0",
      "row:1",
    ]);
    expect(listed(editor, "text")).toEqual(
      [...sweep(editor, "text")].toSorted(),
    );
  });

  it("lists only the gaps between Sections when a Section is dragged", () => {
    const editor = editorWithLayout();

    expect(listed(editor, "section")).toEqual([
      "root:0",
      "root:1",
      "root:2",
      "root:3",
      "root:4",
    ]);
    expect(listed(editor, "section")).toEqual(
      [...sweep(editor, "section")].toSorted(),
    );
  });

  it("lists only the gaps between Sections for the Preset too", () => {
    const editor = createEditor({
      definitions: presetDefinitions,
      document: newsletter,
    });

    expect(editor.getDropTargets({ draggedType: "section" })).toEqual([
      {
        parentId: "root",
        index: 0,
        position: "before",
        referenceBlockId: "row",
      },
      {
        parentId: "root",
        index: 1,
        position: "after",
        referenceBlockId: "row",
      },
    ]);
  });

  it("lets a Block move within a container that is full", () => {
    const editor = editorWithLayout();

    expect(listed(editor, "text", "c")).toContain("full:0");
    // Every place the pointer finds is listed. Not the other way round: the
    // gap between `row` and `full` is valid, but both take text, so a pointer
    // there is always inside one of them first.
    expect(listed(editor, "text", "c")).toEqual(
      expect.arrayContaining([...sweep(editor, "text", "c")]),
    );
    expect(listed(editor, "text", "c")).toContain("root:2");
  });

  it("never lists a place inside the Block being moved", () => {
    const editor = editorWithLayout();

    // `row` would take a text Block. Carried as one, it still may not take
    // itself — the rule asked on its own, with nothing else in the way.
    const places = listed(editor, "text", "row");
    expect(places.filter((place) => place.startsWith("row:"))).toEqual([]);
    expect(places).toEqual([...sweep(editor, "text", "row")].toSorted());
  });

  it("lists an empty container as a drop inside it", () => {
    const editor = createEditor({
      definitions,
      document: {
        root: {
          id: "root",
          type: "email",
          props: {},
          children: [{ id: "empty", type: "section", props: {}, children: [] }],
        },
      },
    });

    expect(
      editor
        .getDropTargets({ draggedType: "text" })
        .filter((target) => target.parentId === "empty"),
    ).toEqual([{ parentId: "empty", index: 0, position: "inside" }]);
  });

  it("says which way each parent lays out when given the rectangles", () => {
    const targets = editorWithLayout().getDropTargets({
      draggedType: "text",
      rects: layout,
    });

    expect(targets.map((target) => target.axis)).toEqual(
      targets.map(() => "vertical"),
    );
  });
});
