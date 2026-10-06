import { beforeEach, describe, expect, it } from "vitest";

import { createEditor, type BlockDefinition, type Editor } from "../../index";
import {
  definitionsDividing,
  dividingCell,
  grid,
  sequentialIds,
} from "../../testing/blocks";

/**
 * A container's children dividing it, driven through the engine.
 *
 * No Preset and no react.email: the rules are the library's, and a suite that
 * reached them through the shipped Definitions would fail for the wrong reasons
 * the day that markup changed. `core/width.unit.test.ts` pins the arithmetic
 * underneath; this pins what the editor and a Consumer are told about it.
 *
 * The prop is `share` throughout, which is the point of the fixture — the core
 * recognises the Schema `kind` and never a name (ADR-0016).
 */

const SHARE = "share";

const sharesOf = (editor: Editor, gridId: string): readonly unknown[] =>
  (editor.getBlock(gridId)?.children ?? []).map((cell) => cell.props[SHARE]);

const setShare = (
  editor: Editor,
  gridId: string,
  index: number,
  value: number,
): void => {
  const cell = editor.getBlock(gridId)?.children?.[index];
  editor.setProp(cell?.id ?? "", SHARE, value);
};

describe("a container's children dividing it", () => {
  let editor: Editor;
  let gridId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsDividing,
      rootType: "email",
      createId: sequentialIds(),
    });
    gridId = editor.insertBlock("grid", editor.getDocument().root.id) ?? "";
    editor.select(gridId);
  });

  const addCell = (): void => {
    editor.getAddableChildren()[0]?.add();
  };

  it("arrives divided evenly, written out rather than left to a default", () => {
    // Stored, because the default is one number and cannot know how many
    // siblings it will have. A panel showing 50 beside a child drawn at a third
    // is the reason shares are in the Document at all.
    expect(sharesOf(editor, gridId)).toEqual([50, 50]);
  });

  it("moves the neighbour when one is widened, and only the neighbour", () => {
    addCell();
    // 50/40/10 — the arrival was paid for by the nearest child with room.
    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);

    setShare(editor, gridId, 0, 60);

    expect(sharesOf(editor, gridId)).toEqual([60, 30, 10]);
  });

  it("takes a whole rebalance back as the one thing the Author did", () => {
    setShare(editor, gridId, 0, 70);
    expect(sharesOf(editor, gridId)).toEqual([70, 30]);

    editor.undo();

    expect(sharesOf(editor, gridId)).toEqual([50, 50]);
  });

  it("stops one at what its neighbour can spare", () => {
    addCell();

    // 50/40/10. The second can give 30 before it hits the floor, so the first
    // stops at 80 however far the slider is dragged.
    setShare(editor, gridId, 0, 100);

    expect(sharesOf(editor, gridId)).toEqual([80, 10, 10]);
  });

  it("pays for each arrival from the nearest one with room", () => {
    // Backwards rather than proportionally, so the shares at the front of the
    // row — where the design is — survive being added to.
    setShare(editor, gridId, 0, 40);
    addCell();
    expect(sharesOf(editor, gridId)).toEqual([40, 50, 10]);

    // The grid's own ceiling is four, which is where this stops.
    addCell();
    expect(sharesOf(editor, gridId)).toEqual([40, 40, 10, 10]);
  });

  it("hands a deleted one's share to its neighbour", () => {
    addCell();
    // 50/40/10 — take the middle one out.
    const [, second] = editor.getBlock(gridId)?.children ?? [];
    editor.removeBlock(second?.id ?? "");

    expect(sharesOf(editor, gridId)).toEqual([50, 50]);
  });

  it("records the insertion and its rebalance as one undo entry", () => {
    addCell();
    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);

    editor.undo();

    // The child and the share it was paid with come back together, or ⌘Z
    // leaves a row that does not add up.
    expect(editor.getBlock(gridId)?.children).toHaveLength(2);
    expect(sharesOf(editor, gridId)).toEqual([50, 50]);
  });

  it("writes no Op at all when a set would move nothing", () => {
    const ops: unknown[] = [];
    editor.onOp((op) => {
      ops.push(op);
    });
    const undoable = editor.canUndo();

    setShare(editor, gridId, 0, 50);

    // Not one Op, so not one undo entry either: a gesture ending where it began
    // must not cost the Author a ⌘Z that appears to do nothing.
    expect(ops).toEqual([]);
    expect(editor.canUndo()).toBe(undoable);
  });

  it("evens out a container that does not add up, rather than refusing it", () => {
    // A Document written by hand, or one from a Consumer's own JSON. An Author
    // did not do this and must not be left with a row they cannot touch
    // (ADR-0006).
    const [first] = editor.getBlock(gridId)?.children ?? [];
    editor.applyExternalOps([
      {
        kind: "set-prop",
        origin: "remote",
        blockId: first?.id ?? "",
        prop: SHARE,
        value: 90,
        previousValue: 50,
      },
    ]);
    // 90/50 in the Document — the rules cannot be run on that.
    expect(editor.getDivision()?.shares.map((share) => share.width)).toEqual([
      50, 50,
    ]);
  });

  it("shows a drag against the row a peer has just changed", () => {
    const peer = createEditor({
      definitions: definitionsDividing,
      document: editor.getDocument(),
      createId: sequentialIds("peer"),
    });
    peer.onOp((op) => {
      editor.applyExternalOps([op]);
    });
    const [first] = editor.getBlock(gridId)?.children ?? [];
    editor.setPendingChange(first?.id ?? "", { [SHARE]: 70 });
    const shownShares = (): readonly unknown[] =>
      (
        editor
          .getDocumentWithPendingChange()
          .root.children?.find(({ id }) => id === gridId)?.children ?? []
      ).map((cell) => cell.props[SHARE]);
    expect(shownShares()).toEqual([70, 30]);

    // The peer's new cell is paid for out of the second, 50/40/10.
    peer.select(gridId);
    peer.getAddableChildren()[0]?.add();

    // The drag is shown on the row as it now stands, as the commit will be,
    // not on the row it opened on, which would total 110.
    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);
    expect(shownShares()).toEqual([70, 20, 10]);
    editor.commitPendingChange();
    expect(sharesOf(editor, gridId)).toEqual([70, 20, 10]);
  });
});

describe("every route a child takes into or out of a division", () => {
  let editor: Editor;
  let gridId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsDividing,
      rootType: "email",
      createId: sequentialIds(),
    });
    gridId = editor.insertBlock("grid", editor.getDocument().root.id) ?? "";
  });

  const cellOf = (parentId: string, index: number): string =>
    editor.getBlock(parentId)?.children?.[index]?.id ?? "";

  it("pays for a duplicate out of its row, as for any arrival", () => {
    editor.duplicateBlock(cellOf(gridId, 0));

    // The copy lands next to its original, and pays for itself from the
    // nearest child with room, as an added child does.
    expect(sharesOf(editor, gridId)).toEqual([50, 10, 40]);
  });

  it("gives a moved child's share back to the row it left, and pays for it in the one it joins", () => {
    const other =
      editor.insertBlock("grid", editor.getDocument().root.id) ?? "";
    editor.select(other);
    editor.getAddableChildren()[0]?.add();
    expect(sharesOf(editor, other)).toEqual([50, 40, 10]);

    editor.moveBlock(cellOf(other, 2), gridId, 0);

    expect(sharesOf(editor, other)).toEqual([50, 50]);
    expect(sharesOf(editor, gridId)).toEqual([10, 50, 40]);
  });

  it("gives the whole row to a child added to a row its children have left", () => {
    // A grid with no floor, since one with a floor keeps its last cells (#120).
    const floorless = createEditor({
      definitions: definitionsDividing.map((definition) =>
        definition.type === "grid"
          ? { ...definition, minChildren: undefined }
          : definition,
      ),
      rootType: "email",
      createId: sequentialIds(),
    });
    const root = floorless.getDocument().root.id;
    const from = floorless.insertBlock("grid", root) ?? "";
    const to = floorless.insertBlock("grid", root) ?? "";
    const first = floorless.insertBlock("cell", from) ?? "";
    const second = floorless.insertBlock("cell", from) ?? "";
    floorless.moveBlock(first, to, 0);
    floorless.moveBlock(second, to, 0);
    expect(floorless.getBlock(from)?.children).toEqual([]);

    floorless.insertBlock("cell", from, 0);

    // Written out, not left to the default of 50 (ADR-0016).
    expect(sharesOf(floorless, from)).toEqual([100]);
  });

  it("keeps a child's share when it moves within its own row", () => {
    setShare(editor, gridId, 0, 70);

    editor.moveBlock(cellOf(gridId, 0), gridId, 2);

    expect(sharesOf(editor, gridId)).toEqual([30, 70]);
  });

  it("refuses to unset a share, which would fall back to a default that knows no siblings", () => {
    expect(editor.setProp(cellOf(gridId, 0), SHARE, undefined)).toBe(false);
    expect(
      editor.setPendingChange(cellOf(gridId, 0), { [SHARE]: undefined }),
    ).toBe(false);
    expect(sharesOf(editor, gridId)).toEqual([50, 50]);
  });

  it("refuses a linked Pending Change with an unset share in it, all or nothing", () => {
    expect(
      editor.setPendingChange(cellOf(gridId, 0), {
        [SHARE]: undefined,
        padding: 8,
      }),
    ).toBe(false);
    expect(editor.getPendingChange()).toBeUndefined();
  });

  it("moves the neighbour for a share set on the mobile Stage, where it is the desktop value", () => {
    // The share opts out of Mobile Overrides, so the mobile Stage writes the
    // desktop value, and the row still divides.
    editor.setStage("mobile");

    setShare(editor, gridId, 0, 30);

    expect(sharesOf(editor, gridId)).toEqual([30, 70]);
    expect(editor.getBlock(cellOf(gridId, 0))?.mobile).toBeUndefined();
  });
});

describe("the Division a Consumer is handed", () => {
  let editor: Editor;
  let gridId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsDividing,
      rootType: "email",
      createId: sequentialIds(),
    });
    gridId = editor.insertBlock("grid", editor.getDocument().root.id) ?? "";
    editor.select(gridId);
    editor.getAddableChildren()[0]?.add();
  });

  it("names the prop the Definition chose, not one the core knows", () => {
    // The core recognises the Schema kind and never a name. A Consumer hiding
    // the width row from a list of controls asks the Division which one it is.
    expect(editor.getDivision()?.prop).toBe(SHARE);
  });

  it("describes one share per child, in the order they sit in", () => {
    const cellIds = (editor.getBlock(gridId)?.children ?? []).map(
      (cell) => cell.id,
    );

    expect(
      editor.getDivision()?.shares.map((share) => ({
        blockId: share.blockId,
        width: share.width,
      })),
    ).toEqual([
      { blockId: cellIds[0], width: 50 },
      { blockId: cellIds[1], width: 40 },
      { blockId: cellIds[2], width: 10 },
    ]);
  });

  it("tells the Consumer the ceiling before an Author leans on it", () => {
    // 50/40/10. The first can reach 80, because the second has 30 to give. The
    // second is already at its own ceiling: the third is on the floor and has
    // nothing. The last trades with the one before it rather than with a child
    // that is not there, so it can reach 40.
    expect(editor.getDivision()?.shares.map((share) => share.ceiling)).toEqual([
      80, 40, 40,
    ]);
  });

  it("carries the floor its Schema declared", () => {
    expect(editor.getDivision()?.shares.map((share) => share.floor)).toEqual([
      10, 10, 10,
    ]);
  });

  it("works out a set without writing or showing one", () => {
    const before = sharesOf(editor, gridId);

    expect(editor.getDivision()?.shares[0]?.widthsIf(60)).toEqual([60, 30, 10]);
    expect(sharesOf(editor, gridId)).toEqual(before);
    expect(editor.getPendingChange()).toBeUndefined();
  });

  it("works out the clamp too, so a strip never shows what a write would refuse", () => {
    // The same arithmetic the write does, which is the whole reason this is
    // here rather than in the Consumer.
    expect(editor.getDivision()?.shares[0]?.widthsIf(100)).toEqual([
      80, 10, 10,
    ]);
  });

  it("agrees with what setting actually does", () => {
    const division = editor.getDivision();
    for (const [index, share] of (division?.shares ?? []).entries()) {
      const previewed = share.widthsIf(100);
      const fresh = createEditor({
        definitions: definitionsDividing,
        rootType: "email",
        createId: sequentialIds(),
      });
      const freshGrid =
        fresh.insertBlock("grid", fresh.getDocument().root.id) ?? "";
      fresh.select(freshGrid);
      fresh.getAddableChildren()[0]?.add();
      setShare(fresh, freshGrid, index, 100);

      expect(sharesOf(fresh, freshGrid)).toEqual([...previewed]);
    }
  });

  it("writes through set, as the one action a rebalance is", () => {
    editor.getDivision()?.shares[0]?.set(60);

    expect(sharesOf(editor, gridId)).toEqual([60, 30, 10]);

    editor.undo();
    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);
  });

  it("does nothing at all when a set would move nothing", () => {
    // So a gesture that ends where it began needs no guard of the Consumer's
    // own: no Op, and no undo entry.
    const before = editor.canUndo();
    editor.getDivision()?.shares[0]?.set(50);

    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);
    expect(editor.canUndo()).toBe(before);
  });

  it("is the same object until something moves", () => {
    // Read on every change by an Inspector, so a fresh object per call would
    // re-render a panel describing a row nobody touched (ADR-0011).
    expect(editor.getDivision()).toBe(editor.getDivision());

    const first = editor.getDivision();
    editor.getDivision()?.shares[0]?.set(60);
    expect(editor.getDivision()).not.toBe(first);
  });

  it("is undefined for a container whose children divide nothing", () => {
    const sectionId =
      editor.insertBlock("section", editor.getDocument().root.id) ?? "";
    editor.insertBlock("text", sectionId);
    editor.select(sectionId);

    expect(editor.getDivision()).toBeUndefined();
  });

  it("is undefined for a container with no children at all", () => {
    const sectionId =
      editor.insertBlock("section", editor.getDocument().root.id) ?? "";
    editor.select(sectionId);

    expect(editor.getDivision()).toBeUndefined();
  });

  it("is undefined on the mobile Stage", () => {
    // A share there would be a Mobile Override, and a column stacks to the full
    // width of the phone anyway: offering a strip to drag would be offering to
    // move desktop widths from a Stage that cannot see them (ADR-0016).
    editor.setStage("mobile");

    expect(editor.getDivision()).toBeUndefined();
  });

  it("describes the root when nothing is selected, as the others do", () => {
    editor.select(undefined);

    // The root's children are a section and a grid, which divide nothing.
    expect(editor.getDivision()).toBeUndefined();
  });
});

describe("a Share dragged as a Pending Change", () => {
  let editor: Editor;
  let gridId: string;

  const shownSharesOf = (): readonly unknown[] =>
    (
      editor
        .getDocumentWithPendingChange()
        .root.children?.find((block) => block.id === gridId)?.children ?? []
    ).map((cell) => cell.props[SHARE]);

  beforeEach(() => {
    editor = createEditor({
      definitions: definitionsDividing,
      rootType: "email",
      createId: sequentialIds(),
    });
    gridId = editor.insertBlock("grid", editor.getDocument().root.id) ?? "";
    editor.select(gridId);
    editor.getAddableChildren()[0]?.add();
  });

  it("shows the pair on the Canvas and still returns the widths", () => {
    const saved = editor.getDocument();
    const share = editor.getDivision()?.shares[0];

    expect(share?.preview(100)).toEqual([80, 10, 10]);
    expect(shownSharesOf()).toEqual([80, 10, 10]);
    expect(editor.getDocument()).toBe(saved);
    expect(editor.getPendingChange()?.ops).toMatchObject([
      { prop: SHARE, value: 80 },
      { prop: SHARE, value: 10 },
    ]);
  });

  it("stores the pair as one undo step on commit", () => {
    const share = editor.getDivision()?.shares[0];
    share?.preview(55);
    share?.preview(60);
    share?.commit();

    expect(editor.getPendingChange()).toBeUndefined();
    expect(sharesOf(editor, gridId)).toEqual([60, 30, 10]);

    editor.undo();
    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);
  });

  it("leaves the Document untouched on cancel", () => {
    const saved = editor.getDocument();
    const before = editor.canUndo();
    const share = editor.getDivision()?.shares[0];
    share?.preview(60);
    share?.cancel();

    expect(editor.getPendingChange()).toBeUndefined();
    expect(editor.getDocument()).toBe(saved);
    expect(editor.canUndo()).toBe(before);
  });

  it("writes nothing for a drag that ends where it began", () => {
    const saved = editor.getDocument();
    const before = editor.canUndo();
    const share = editor.getDivision()?.shares[0];
    share?.preview(70);
    share?.preview(50);
    share?.commit();

    expect(editor.getDocument()).toBe(saved);
    expect(editor.canUndo()).toBe(before);
  });

  it("moves the neighbour when a width is previewed through its Control Descriptor", () => {
    const width = editor
      .getEditableChildren()[0]
      ?.controls.find((control) => control.name === SHARE);

    width?.preview(60);
    expect(shownSharesOf()).toEqual([60, 30, 10]);
    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);

    width?.commit();
    expect(sharesOf(editor, gridId)).toEqual([60, 30, 10]);

    editor.undo();
    expect(sharesOf(editor, gridId)).toEqual([50, 40, 10]);
  });
});

describe("the ceiling on a Control Descriptor", () => {
  /**
   * A dividing child an Author can select, and a container that holds them.
   *
   * Nothing ships one: a width sits on a Structural Block, which is why
   * `getControls` could hand back the Schema's raw `max` without anyone
   * noticing. That is a fact about which Definitions happen to exist rather
   * than a rule anything enforces, so both routes are pinned here.
   *
   * A container of its own, because `grid` declares `minChildren` and a
   * container that seeds needs exactly one structural type among the ones it
   * accepts — a selectable child cannot be that.
   */
  const slice: BlockDefinition = {
    ...dividingCell,
    type: "slice",
    label: "Slice",
    structural: false,
  };
  const strip: BlockDefinition = {
    ...grid,
    type: "strip",
    label: "Strip",
    accepts: ["slice"],
    minChildren: undefined,
  };
  const definitions: readonly BlockDefinition[] = [
    ...definitionsDividing.map((definition) =>
      definition.type === "email"
        ? { ...definition, accepts: [...(definition.accepts ?? []), "strip"] }
        : definition,
    ),
    strip,
    slice,
  ];

  let editor: Editor;
  let gridId: string;
  let stripId: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    const root = editor.getDocument().root.id;

    // The structural route: a grid seeds two cells, and a third is added.
    gridId = editor.insertBlock("grid", root) ?? "";
    editor.select(gridId);
    editor.getAddableChildren()[0]?.add();

    // The selectable route, brought to the same 50/40/10 split.
    stripId = editor.insertBlock("strip", root) ?? "";
    for (let count = 0; count < 3; count += 1) {
      editor.insertBlock("slice", stripId);
    }
    setShare(editor, stripId, 0, 50);
  });

  const maxOn = (
    controls: readonly {
      readonly name: string;
      readonly constraints?: Readonly<Record<string, unknown>>;
    }[],
  ): unknown =>
    controls.find((control) => control.name === SHARE)?.constraints?.["max"];

  it("reaches a width described through getEditableChildren", () => {
    editor.select(gridId);

    expect(
      editor.getEditableChildren().map((child) => maxOn(child.controls)),
    ).toEqual([80, 40, 40]);
  });

  it("reaches a width described through getControls", () => {
    // The same rule, the other route. The Schema says max 100 and the row says
    // 80, and `setProp` would clamp to 80 either way — so a slider offered 100
    // is a slider that stops moving the email a quarter of the way along.
    expect(sharesOf(editor, stripId)).toEqual([50, 40, 10]);

    const maxes = (editor.getBlock(stripId)?.children ?? []).map((child) => {
      editor.select(child.id);
      return maxOn(editor.getControls());
    });

    expect(maxes).toEqual([80, 40, 40]);
  });

  it("leaves every other control's constraints alone", () => {
    editor.select(gridId);
    const padding = editor
      .getEditableChildren()[0]
      ?.controls.find((control) => control.name === "padding");

    expect(padding?.constraints).toBeUndefined();
  });

  it("leaves the Schema's own max alone on the mobile Stage", () => {
    // A share there is an override rather than part of the division, so the
    // Schema's number is the honest one.
    const [first] = editor.getBlock(stripId)?.children ?? [];
    editor.select(first?.id ?? "");
    editor.setStage("mobile");

    // Not Overridable, so it is not described on that Stage at all.
    expect(maxOn(editor.getControls())).toBeUndefined();
  });
});
