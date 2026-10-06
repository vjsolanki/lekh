import type { TextEngine } from "../index";

/**
 * A Text Engine with no editor behind it.
 *
 * The point of the seam is that the store never learns which editor is on the
 * other side of it, so ordering, delegation and the round trip can all be
 * proved without one — they are about the store, not the editor. A real one
 * would only make those assertions slower and less exact.
 *
 * History is a list of the text after each undoable change, with a cursor —
 * which is what every editor's history amounts to, minus the parts that make
 * it fast.
 */
export interface FakeTextEngine extends TextEngine {
  /** An undoable change: what an Author typing a new word would produce. */
  type(blockId: string, text: string): void;
  /**
   * A change the engine folded into the entry it already has, the way typing
   * coalescence does.
   */
  amend(blockId: string, text: string): void;
}

interface History {
  steps: string[];
  at: number;
}

/** A Text Engine whose history is a list of strings and a cursor. */
export function createFakeTextEngine(
  initial: Readonly<Record<string, string>> = {},
): FakeTextEngine {
  const histories = new Map<string, History>();

  const historyOf = (blockId: string): History => {
    let history = histories.get(blockId);
    if (!history) {
      history = { steps: [initial[blockId] ?? ""], at: 0 };
      histories.set(blockId, history);
    }
    return history;
  };

  /** A new undoable step, dropping whatever was undone past. */
  const push = (blockId: string, text: string): void => {
    const history = historyOf(blockId);
    history.steps = [...history.steps.slice(0, history.at + 1), text];
    history.at = history.steps.length - 1;
  };

  return {
    undo(blockId) {
      const history = historyOf(blockId);
      if (history.at > 0) history.at -= 1;
    },

    redo(blockId) {
      const history = historyOf(blockId);
      if (history.at < history.steps.length - 1) history.at += 1;
    },

    canUndo: (blockId) => historyOf(blockId).at > 0,

    canRedo: (blockId) => {
      const history = historyOf(blockId);
      return history.at < history.steps.length - 1;
    },

    getText: (blockId) => historyOf(blockId).steps[historyOf(blockId).at],

    type: push,

    replaceText(blockId, text) {
      push(blockId, text);
      return true;
    },

    amend(blockId, text) {
      const history = historyOf(blockId);
      history.steps[history.at] = text;
    },
  };
}
