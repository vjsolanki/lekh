import type { Block, EmailDocument } from "../document/document";
import { applyOp, type SetPropOp } from "./op";
import type { Store } from "./store";

/**
 * A change the Author is making and has not finished: a drag in the Inspector
 * (ADR-0032).
 *
 * Shown on the Canvas, and not in the Document. `ops` are built by the same
 * rule `setProp` uses, so a Consumer showing the live value elsewhere reads it
 * off the Op's `value`. A commit builds them again, so the `previousValue` it
 * writes is the stored value at that moment, not the one here.
 */
export interface PendingChange {
  readonly blockId: string;
  readonly ops: readonly SetPropOp[];
}

export interface PendingChangeSetup {
  readonly store: Store;
  /**
   * The Ops a Pending Change on these props would commit, or `undefined` when
   * it may not open.
   */
  opsFor(
    blockId: string,
    props: Readonly<Record<string, unknown>>,
  ): readonly SetPropOp[] | undefined;
  /** Store Ops as one undoable local action. */
  commit(ops: readonly SetPropOp[]): void;
  asOneAction<TResult>(act: () => TResult): TResult;
  tellPending(): void;
}

/** The one Pending Change an editor may hold, and its lifecycle. */
export interface PendingChanges {
  /** The open Pending Change, the same object until it moves. */
  readonly get: () => PendingChange | undefined;
  /** Whether the open Pending Change is one control's drag of this prop. */
  readonly isOwnDrag: (blockId: string, prop: string) => boolean;
  /**
   * Open or move the Pending Change. One on another Block is committed first,
   * as its own step. False, opening nothing, when the props may not open one.
   */
  readonly open: (
    blockId: string,
    props: Readonly<Record<string, unknown>>,
  ) => boolean;
  /** Store it as one ordinary change. False when nothing is pending. */
  readonly commit: () => boolean;
  /** Drop it. False when nothing is pending. */
  readonly cancel: () => boolean;
  /** The stored Document with the Pending Change applied. */
  readonly shown: () => EmailDocument;
  /**
   * Bring it back into line once the Document has moved: dropped when its
   * Block has gone, rebuilt when what it would write has changed.
   */
  readonly reconcile: () => void;
  /**
   * Run a local action after storing the Pending Change, as its own step. The
   * Author saw the dragged value, so no action of theirs may lose it.
   *
   * Call it once per action. A write calls it before its own checks, so a
   * write the editor then refuses still stores the drag: the Author acted. A
   * select, edit or Stage switch that would change nothing is no action at
   * all, so those check first and call it only when they would.
   */
  readonly commitFirst: <TResult>(act: () => TResult) => TResult;
}

export function createPendingChanges(
  setup: PendingChangeSetup,
): PendingChanges {
  const { store } = setup;

  /**
   * The drag in flight, if any: the props it would set, and the snapshot
   * handed to Consumers.
   *
   * The props are kept beside the Ops because a commit rebuilds its Ops from
   * them. The Ops in the snapshot were built when the drag last moved, and
   * `previousValue` has to be read when it lands.
   */
  let pending:
    | {
        readonly props: Readonly<Record<string, unknown>>;
        readonly change: PendingChange;
      }
    | undefined;
  /** The Document with the Pending Change applied, and what it was built from. */
  let shown:
    | {
        readonly saved: EmailDocument;
        readonly change: PendingChange;
        readonly document: EmailDocument;
      }
    | undefined;

  /** Open, move or drop it, and tell pending listeners. */
  const set = (
    next:
      | {
          readonly blockId: string;
          readonly props: Readonly<Record<string, unknown>>;
          readonly ops: readonly SetPropOp[];
        }
      | undefined,
  ): void => {
    pending =
      next === undefined
        ? undefined
        : {
            props: { ...next.props },
            change: { blockId: next.blockId, ops: next.ops },
          };
    setup.tellPending();
  };

  const commit = (): boolean => {
    if (pending === undefined) return false;
    const { props, change } = pending;
    return setup.asOneAction(() => {
      // Gone before anything runs, so no listener sees the drag twice: once
      // in the Document and once on top of it.
      set(undefined);
      const ops = setup.opsFor(change.blockId, props);
      if (ops === undefined) return false;
      if (ops.length > 0) setup.commit(ops);
      return true;
    });
  };

  const commitFirst = <TResult>(act: () => TResult): TResult => {
    if (pending === undefined) return act();
    // One action, so listeners hear the commit and the action once.
    return setup.asOneAction(() => {
      commit();
      return act();
    });
  };

  return {
    get: () => pending?.change,

    isOwnDrag: (blockId, prop) =>
      pending?.change.blockId === blockId &&
      Object.keys(pending.props).length === 1 &&
      Object.hasOwn(pending.props, prop),

    open(blockId, props) {
      const ops = setup.opsFor(blockId, props);
      if (ops === undefined) return false;

      // On the same Block these props replace the open ones, so a linked
      // control can drop a side mid-drag. The same value again moves nothing,
      // so the snapshot holds still.
      if (pending?.change.blockId === blockId) {
        if (!sameProps(pending.props, props)) set({ blockId, props, ops });
        return true;
      }

      // A drag on another Block is a different change: keep it as its own
      // step, then open this one. Only one is ever pending. Its Ops are read
      // again, after the commit has moved the Document.
      return commitFirst(() => {
        const now = setup.opsFor(blockId, props);
        if (now === undefined) return false;
        set({ blockId, props, ops: now });
        return true;
      });
    },

    commit,

    cancel() {
      if (pending === undefined) return false;
      set(undefined);
      return true;
    },

    shown() {
      const saved = store.get();
      if (pending === undefined || pending.change.ops.length === 0) {
        shown = undefined;
        return saved;
      }
      const { change } = pending;
      if (shown?.saved !== saved || shown.change !== change) {
        // The pure application every Op gets, run on a copy: the store is not
        // touched, so nothing here can reach the Document.
        const root = change.ops.reduce<Block>(applyOp, saved.root);
        shown = { saved, change, document: { ...saved, root } };
      }
      return shown.document;
    },

    reconcile() {
      if (pending === undefined) return;
      // A peer deleting the Block under a drag leaves nothing to commit it to.
      // Only a peer can: every local action commits the drag first. Any other
      // remote Op leaves it open: the commit reads its previous value when it
      // lands, so it wins and undo goes back to the peer's (ADR-0032). It is
      // shown as that commit will make it too: a peer adding a cell to the row
      // under a Width drag changes what the neighbours are paid.
      const { props, change } = pending;
      const ops = store.block(change.blockId)
        ? setup.opsFor(change.blockId, props)
        : undefined;
      if (ops === undefined) {
        set(undefined);
      } else if (!sameWrites(ops, change.ops)) {
        set({ blockId: change.blockId, props, ops });
      }
    },

    commitFirst,
  };
}

/** Whether two sets of props hold the same values, by `Object.is`. */
function sameProps(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  return (
    sameKeys(a, b) && Object.keys(a).every((key) => Object.is(a[key], b[key]))
  );
}

/**
 * Whether two lists of sets write the same values to the same places. What
 * each one overwrites is left out, because a commit reads that afresh.
 */
function sameWrites(a: readonly SetPropOp[], b: readonly SetPropOp[]): boolean {
  return (
    a.length === b.length &&
    a.every((op, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        op.blockId === other.blockId &&
        op.prop === other.prop &&
        op.stage === other.stage &&
        Object.is(op.value, other.value)
      );
    })
  );
}

/** Whether two sets of props name the same props, whatever their values. */
function sameKeys(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key))
  );
}
