import { invertOp, type Op, type SetPropOp } from "./op";

/**
 * Whether the Text Engine can still perform a Block's part of an entry.
 *
 * A `text-edit` marker carries no text of its own (ADR-0009) — it orders the
 * change in history and delegates back to the engine. The engine's history for
 * a Block goes when its surface unmounts, so a marker can outlive the thing
 * that would carry it out. Only the engine can say, and it is asked rather
 * than assumed.
 *
 * `canRedo` is separate from `canUndo` because they are different questions:
 * an engine that has just undone a Block's only edit reports `canUndo` false
 * while the redo is perfectly available. Reusing one for the other would step
 * over every redoable text edit there is.
 */
export interface TextLiveness {
  canUndo(blockId: string): boolean;
  canRedo(blockId: string): boolean;
}

export interface HistorySetup {
  /** Stamped onto the inverted Ops `undo` produces. */
  readonly origin: string;
  readonly text: TextLiveness;
  /**
   * The part of a step that can still be carried out against the Document as
   * it is now, rewritten to say where things are (#121). Empty when a peer has
   * changed everything it touches. The History asks rather than knowing,
   * because only the Document can say.
   */
  readonly replay: (ops: readonly Op[]) => readonly Op[];
  /**
   * How long a pause ends a run of sets on one prop, in milliseconds. Read
   * against `Date.now`, so a test can move time with fake timers.
   */
  readonly newGroupDelay: number;
}

/**
 * How an entry joins the History.
 *
 * `alone` is its own entry. `coalesce` is typing coalescence: the engine
 * decides what a chunk of typing is, and a change it folded into its own last
 * entry folds into ours, so the two stacks stay the same depth. `fold` is a
 * `set` a Consumer may be calling on every move of a control (ADR-0032).
 */
export type Grouping = "alone" | "coalesce" | "fold";

/**
 * The one timeline, and the only thing that writes it.
 *
 * The library owns document history and the Text Engine owns text history, so
 * a text edit pushes a marker here and undoing that marker delegates back to
 * the engine (ADR-0005). Keeping both stacks behind this interface is what
 * makes that one writer rather than a convention: there is nowhere else a
 * redo future can be quietly dropped.
 *
 * It knows Ops and it knows how to invert them — ADR-0004's "undo is the
 * inverse Op" is a statement about history — and it knows nothing about the
 * Document, the store or the engine. Which is why the awkward cases can be
 * proved here without any of them.
 */
export interface History {
  /**
   * Add an action, and drop the redo future — an edit made after an undo is a
   * new future, whether or not it folded into the entry above it.
   *
   * `coalesce` applies only to a lone `text-edit` marker sitting on another
   * for the same Block. `fold` applies only to a lone `set-prop` sitting on a
   * folded one for the same Block, prop and Stage, made within
   * `newGroupDelay` of it. The merged entry keeps the first `previousValue`
   * and the last `value`, and is dropped when the two are equal: undo should
   * never spend a keystroke on nothing. Anything else gets its own entry
   * however it is asked.
   */
  record(ops: readonly Op[], grouping?: Grouping): void;
  /**
   * Ops that landed from elsewhere. A remote set on the prop a run is folding
   * ends the run, so the Author's undo never reaches past a peer's
   * value to the one before it.
   */
  remoteOps(ops: readonly Op[]): void;
  /**
   * The Ops that undo the most recent action it can still carry out, reversed
   * and inverted, or `undefined` when there is none. Only the part still ours:
   * whatever a peer has changed since is left as the peer left it (#121).
   *
   * Entries it cannot carry out are dropped rather than moved across: a dead
   * marker can never come back, because a remounted surface seeds a fresh
   * engine with an empty history, so keeping one would only put a no-op in the
   * Author's way in the other direction. An entry a peer has undone the whole
   * of is dropped the same way, so redo cannot bring back what the peer took
   * away.
   */
  undo(): readonly Op[] | undefined;
  /** The next action to reapply, as much of it as is still ours. */
  redo(): readonly Op[] | undefined;
  /** Whether {@link undo} would do something. */
  canUndo(): boolean;
  /** Whether {@link redo} would do something. */
  canRedo(): boolean;
}

export function createHistory(setup: HistorySetup): History {
  const undoStack: (readonly Op[])[] = [];
  const redoStack: (readonly Op[])[] = [];
  /**
   * The run of sets the top entry is, and when it last grew. Only an entry
   * recorded to fold may be folded into, so a commit of a real Pending Change
   * stays its own step on both sides. Anything that touches the stacks ends
   * the run.
   */
  let openRun: { readonly op: SetPropOp; readonly at: number } | undefined;

  /**
   * What this entry would still do in that direction: the Ops to apply, which
   * is nothing when it is dead.
   *
   * Text markers go first, by asking the engine. The rest is the Document's to
   * say, since a peer may have changed what the entry names. An action that
   * touched both survives either half going dead.
   */
  const stillDoes = (
    entry: readonly Op[],
    direction: "undo" | "redo",
  ): readonly Op[] => {
    const oriented =
      direction === "undo"
        ? entry.toReversed().map((op) => invertOp(op, setup.origin))
        : entry;
    return setup.replay(
      oriented.filter((op) => {
        if (op.kind !== "text-edit") return true;
        return direction === "undo"
          ? setup.text.canUndo(op.blockId)
          : setup.text.canRedo(op.blockId);
      }),
    );
  };

  /**
   * Whether anything on a stack is live.
   *
   * Walked from the top, because `canUndo` is read on every render through a
   * selector (ADR-0011) and the entry an Author is about to reach is almost
   * always the newest one.
   */
  const anyLive = (
    stack: readonly (readonly Op[])[],
    direction: "undo" | "redo",
  ): boolean => {
    for (let at = stack.length - 1; at >= 0; at -= 1) {
      const entry = stack[at];
      if (entry && stillDoes(entry, direction).length > 0) return true;
    }
    return false;
  };

  /**
   * Discard dead entries from the top until a live one is on it, and hand back
   * what it still does.
   */
  const takeLive = (
    stack: (readonly Op[])[],
    direction: "undo" | "redo",
  ): readonly Op[] | undefined => {
    while (stack.length > 0) {
      const entry = stack.pop();
      const ops = entry ? stillDoes(entry, direction) : [];
      if (ops.length > 0) return ops;
    }
    return undefined;
  };

  /** Whether the top of the stack is a lone text marker for this Block. */
  const foldsInto = (ops: readonly Op[]): boolean => {
    const incoming = ops.length === 1 ? ops[0] : undefined;
    if (incoming?.kind !== "text-edit") return false;

    const entry = undoStack.at(-1);
    const last = entry?.length === 1 ? entry[0] : undefined;
    return last?.kind === "text-edit" && last.blockId === incoming.blockId;
  };

  /** Record a lone set: folded into the run on top if it continues it, else a new run. */
  const recordSet = (ops: readonly Op[], at: number): boolean => {
    const incoming = ops.length === 1 ? ops[0] : undefined;
    if (incoming?.kind !== "set-prop") return false;

    const last = openRun;
    const continues =
      last !== undefined &&
      at - last.at <= setup.newGroupDelay &&
      last.op.blockId === incoming.blockId &&
      last.op.prop === incoming.prop &&
      last.op.stage === incoming.stage;
    if (!continues) {
      undoStack.push([incoming]);
      openRun = { op: incoming, at };
      return true;
    }

    undoStack.pop();
    const merged: SetPropOp = {
      ...incoming,
      previousValue: last.op.previousValue,
    };
    if (Object.is(merged.value, merged.previousValue)) {
      openRun = undefined;
      return true;
    }
    undoStack.push([merged]);
    openRun = { op: merged, at };
    return true;
  };

  return {
    record(ops, grouping = "alone") {
      const handled = grouping === "fold" && recordSet(ops, Date.now());
      if (!handled) {
        openRun = undefined;
        if (!(grouping === "coalesce" && foldsInto(ops))) {
          undoStack.push([...ops]);
        }
      }
      redoStack.length = 0;
    },

    remoteOps(ops) {
      const folding = openRun?.op;
      if (
        folding !== undefined &&
        ops.some(
          (op) =>
            op.kind === "set-prop" &&
            op.blockId === folding.blockId &&
            op.prop === folding.prop,
        )
      ) {
        openRun = undefined;
      }
    },

    undo() {
      openRun = undefined;
      const ops = takeLive(undoStack, "undo");
      if (!ops) return undefined;
      // What redo gets back is what this undo did, not what was recorded, so
      // a step that left out a peer's Block does not bring it back on redo.
      redoStack.push(ops.toReversed().map((op) => invertOp(op, setup.origin)));
      return ops;
    },

    redo() {
      openRun = undefined;
      const ops = takeLive(redoStack, "redo");
      if (!ops) return undefined;
      undoStack.push(ops);
      return ops;
    },

    canUndo: () => anyLive(undoStack, "undo"),
    canRedo: () => anyLive(redoStack, "redo"),
  };
}
