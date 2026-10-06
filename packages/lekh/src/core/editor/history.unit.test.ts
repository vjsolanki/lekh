import { describe, expect, it } from "vitest";

import { createHistory, type History, type TextLiveness } from "./history";
import type { Op } from "../../index";

/**
 * The one timeline.
 *
 * The awkward cases here are all about a `text-edit` marker outliving the
 * engine's memory of the Block it names, and none of them need a Document, a
 * Text Engine or a live editor to state: liveness is a predicate, so it can
 * simply be told. Reaching them through `createEditor` meant a fake engine, a
 * Document to hang Blocks off and a marker deep enough in a stack to matter,
 * which is why three of the four were never reached at all.
 */
const insert: Op = {
  kind: "insert",
  origin: "local",
  parentId: "root",
  index: 0,
  block: { id: "a", type: "text", props: {} },
};

const textEdit = (blockId: string): Op => ({
  kind: "text-edit",
  origin: "local",
  blockId,
});

/**
 * What the Text Engine can carry out, and how that moves.
 *
 * Liveness is not a fixed property of a Block: the store driving an undo is
 * what turns a redoable marker into an undoable one and back, and an unmount
 * takes both away at once. A predicate that could not move would let every
 * test here pass for the wrong reason.
 */
function engine() {
  const undoable = new Set<string>();
  const redoable = new Set<string>();

  return {
    text: {
      canUndo: (blockId: string) => undoable.has(blockId),
      canRedo: (blockId: string) => redoable.has(blockId),
    } satisfies TextLiveness,
    /** An Author typed: there is something to take back, and no future. */
    typed(blockId: string) {
      undoable.add(blockId);
      redoable.delete(blockId);
    },
    /** The store delegated an undo, so the engine now holds a redo instead. */
    undone(blockId: string) {
      undoable.delete(blockId);
      redoable.add(blockId);
    },
    /** The Block's surface unmounted, and its history went with it. */
    unmounted(blockId: string) {
      undoable.delete(blockId);
      redoable.delete(blockId);
    },
  };
}

// Every Op is still ours: what a peer's edit does to a step is the editor's
// to test, since only a Document can say.
const setup = (text: TextLiveness): History =>
  createHistory({
    origin: "local",
    text,
    newGroupDelay: 500,
    replay: (ops) => ops,
  });

describe("recording", () => {
  it("reports an entry it can carry out", () => {
    const history = setup(engine().text);
    history.record([insert]);

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("returns the reversed inverse of the entry", () => {
    const history = setup(engine().text);
    history.record([insert]);

    expect(history.undo()).toEqual([{ ...insert, kind: "remove" }]);
  });

  it("returns a redone entry exactly as it was recorded", () => {
    const history = setup(engine().text);
    history.record([insert]);
    history.undo();

    expect(history.redo()).toEqual([insert]);
  });

  it("drops the redo future when a new action arrives", () => {
    const history = setup(engine().text);
    history.record([insert]);
    history.undo();
    history.record([insert]);

    expect(history.canRedo()).toBe(false);
  });
});

describe("typing coalescence", () => {
  it("folds a marker into the one above it for the same Block", () => {
    const text = engine();
    const history = setup(text.text);
    text.typed("a");
    history.record([textEdit("a")]);
    history.record([textEdit("a")], "coalesce");

    history.undo();
    text.undone("a");
    expect(history.canUndo()).toBe(false);
  });

  it("gives a marker for a different Block its own entry", () => {
    const text = engine();
    const history = setup(text.text);
    text.typed("a");
    history.record([textEdit("a")]);
    text.typed("b");
    history.record([textEdit("b")], "coalesce");

    history.undo();
    text.undone("b");
    expect(history.canUndo()).toBe(true);
  });

  it("will not fold onto an entry that is not a lone marker", () => {
    const text = engine();
    const history = setup(text.text);
    history.record([insert]);
    text.typed("a");
    history.record([textEdit("a")], "coalesce");

    history.undo();
    text.undone("a");
    expect(history.canUndo()).toBe(true);
  });

  it("drops the redo future even when it folds", () => {
    // Typing again writes a different future, whether or not the engine
    // folded the change into an entry it already had.
    const text = engine();
    const history = setup(text.text);
    text.typed("a");
    history.record([textEdit("a")]);
    history.record([textEdit("a")]);
    history.undo();
    text.undone("a");
    expect(history.canRedo()).toBe(true);

    text.typed("a");
    history.record([textEdit("a")], "coalesce");
    expect(history.canRedo()).toBe(false);
  });
});

describe("a marker the engine can no longer carry out", () => {
  it("is not counted by canUndo", () => {
    // The Block scrolled out of the Canvas and its surface unmounted, so the
    // engine's history for it went. An undo button lit for this would spend
    // the Author's keystroke on nothing.
    const text = engine();
    const history = setup(text.text);
    text.typed("a");
    history.record([textEdit("a")]);
    text.unmounted("a");

    expect(history.canUndo()).toBe(false);
  });

  it("is stepped over to reach the action beneath it", () => {
    const text = engine();
    const history = setup(text.text);
    history.record([insert]);
    text.typed("a");
    history.record([textEdit("a")]);
    text.unmounted("a");

    expect(history.undo()).toEqual([{ ...insert, kind: "remove" }]);
  });

  it("does not strand the actions beneath it when nothing is live", () => {
    // The bug this replaces: undo walked the whole stack looking for a live
    // entry and moved every dead one across on the way, so one keystroke
    // emptied the undo stack into a redo stack of pure no-ops, leaving an
    // Author with a lit redo button and no way back.
    const text = engine();
    const history = setup(text.text);
    text.typed("a");
    history.record([textEdit("a")]);
    text.typed("b");
    history.record([textEdit("b")]);
    text.unmounted("a");
    text.unmounted("b");

    expect(history.undo()).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("is dropped rather than kept, because it can never come back", () => {
    // A remounted surface seeds a fresh engine with an empty history, so a
    // dead marker stays dead. Keeping one would only put a no-op in the way
    // of the redo beneath it.
    const text = engine();
    const history = setup(text.text);
    history.record([insert]);
    text.typed("a");
    history.record([textEdit("a")]);
    text.unmounted("a");
    history.undo();

    expect(history.redo()).toEqual([insert]);
  });

  it("survives in an entry that also changed the Document", () => {
    const text = engine();
    const history = setup(text.text);
    history.record([insert, textEdit("a")]);
    text.unmounted("a");

    expect(history.canUndo()).toBe(true);
  });
});

describe("redo asks its own question", () => {
  it("keeps a marker the engine can still redo", () => {
    // canUndo is the wrong question, and this is the case that proves it: an
    // engine that has just undone a Block's only edit reports canUndo false
    // while the redo is perfectly available. One predicate for both would
    // step over every redoable text edit there is.
    const text = engine();
    const history = setup(text.text);
    text.typed("a");
    history.record([textEdit("a")]);

    history.undo();
    text.undone("a");
    expect(text.text.canUndo("a")).toBe(false);

    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toEqual([textEdit("a")]);
  });

  it("steps over a marker that died on the redo stack", () => {
    const text = engine();
    const history = setup(text.text);
    history.record([insert]);
    text.typed("a");
    history.record([textEdit("a")]);

    history.undo();
    text.undone("a");
    history.undo();

    // The Block scrolled away while its edit sat on the redo stack.
    text.unmounted("a");
    expect(history.redo()).toEqual([insert]);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeUndefined();
  });
});
