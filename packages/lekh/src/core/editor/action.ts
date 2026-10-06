import type { Op } from "./op";
import type { Store } from "./store";
import type { SuggestionEvent } from "./suggestion";

/** Drop a subscription. */
export type Unsubscribe = () => void;

/**
 * How an Action came about.
 *
 * - `pointer`: a press on the Canvas, or the Consumer's own surface saying so.
 * - `command`: a Command, from a key or the Consumer's button.
 * - `history`: an undo or a redo, however it was asked for.
 * - `api`: a call to the editor that said nothing else.
 * - `remote`: Ops from a peer, through `applyExternalOps`.
 */
export type ActionVia = "pointer" | "command" | "history" | "api" | "remote";

/**
 * One thing done to an editor, announced once however many Ops it took.
 *
 * Read it in a change listener to choose what to animate: a glide for a
 * pointer selection, a wash on the Blocks an undo changed.
 */
export interface Action {
  readonly via: ActionVia;
  /**
   * Every Block whose props, text or place changed, once each, in the order
   * they were first touched. A Block inserted or removed whole is named once,
   * not its descendants. Empty for an Action that only moved the selection.
   */
  readonly blocks: readonly string[];
  /** The Blocks this Action put in the Document, also in `blocks`. */
  readonly inserted: readonly string[];
}

export interface ActionKernelSetup {
  readonly store: Store;
  /**
   * Bring everything that follows the Document back into line, after it has
   * moved by these Ops and before anyone is told that it did.
   */
  settle(ops: readonly Op[]): void;
  /**
   * Drop what is described from the selection, the Stage or the Document, so
   * a getter read next builds it again. Called on every announcement, held or
   * not.
   */
  forget(): void;
}

/**
 * How a change gets into the Document and out to listeners (ADR-0014).
 *
 * One order for every action: apply, settle, Op listeners, change listeners,
 * pending listeners, Suggestion listeners, hover listeners, reveal. Nested actions announce
 * once, when the outermost one ends.
 */
export interface ActionKernel {
  /** Apply Ops, settle, then announce. */
  readonly run: (ops: readonly Op[], direction?: "undo" | "redo") => void;
  /** Run several changes as the one action they are. */
  readonly asOneAction: <TResult>(act: () => TResult) => TResult;
  /**
   * The same, saying how it came about. The outermost caller says, so a
   * Command that selects is a Command.
   */
  readonly actVia: <TResult>(via: ActionVia, act: () => TResult) => TResult;
  /**
   * The same, saying so whoever called: an undo is History and a peer's Ops
   * are remote, whoever asked for them.
   */
  readonly actAlwaysVia: <TResult>(
    via: ActionVia,
    act: () => TResult,
  ) => TResult;
  /** The last Action announced, or `undefined` before the first. */
  readonly lastAction: () => Action | undefined;
  /** Tell change listeners, or owe them a call if an action is open. */
  readonly announce: () => void;
  /** Tell pending listeners, or owe them a call if an action is open. */
  readonly tellPending: () => void;
  /**
   * Tell hover listeners, or owe them a call if an action is open. Hover is
   * never an Action: change listeners are not told, and `last` stays.
   */
  readonly tellHover: () => void;
  /** Tell Suggestion listeners, or hold the event if an action is open. */
  readonly tellSuggestions: (event: SuggestionEvent) => void;
  /** Ask for a Block to be brought into view, last of everything. */
  readonly reveal: (blockId: string) => void;

  readonly subscribe: (listener: () => void) => Unsubscribe;
  readonly onOp: (listener: (op: Op) => void) => Unsubscribe;
  readonly onReveal: (listener: (blockId: string) => void) => Unsubscribe;
  readonly subscribeToPendingChange: (listener: () => void) => Unsubscribe;
  readonly subscribeToSuggestions: (
    listener: (event: SuggestionEvent) => void,
  ) => Unsubscribe;
  readonly subscribeToHover: (listener: () => void) => Unsubscribe;
}

export function createActionKernel(setup: ActionKernelSetup): ActionKernel {
  const changeListeners = new Set<() => void>();
  const opListeners = new Set<(op: Op) => void>();
  const revealListeners = new Set<(blockId: string) => void>();
  const pendingListeners = new Set<() => void>();
  const suggestionListeners = new Set<(event: SuggestionEvent) => void>();
  const hoverListeners = new Set<() => void>();

  /**
   * How deep we are inside an action, and whether one is owed an announcement.
   *
   * Only the change channel is held. Ops go out one at a time and in order
   * however they are nested, because a Consumer persisting patches from the
   * stream (ADR-0004) is recording edits, not actions.
   */
  let depth = 0;
  let owed = false;
  /**
   * The Block this action wants brought into view, if any.
   *
   * One per action: an action puts the Author in one place, and a second
   * reveal inside the same one is the later thought, not the earlier.
   */
  let owedReveal: string | undefined;
  /** Whether pending listeners are owed a call when this action ends. */
  let owedPending = false;
  /** Whether hover listeners are owed a call when this action ends. */
  let owedHover = false;
  /** Suggestion events this action has raised, in order. */
  let owedSuggestions: SuggestionEvent[] = [];
  /** How this action came about, once someone has said. */
  let via: ActionVia | undefined;
  /** The Blocks this action's Ops touched, and the ones it inserted. */
  let touched = new Set<string>();
  let inserted = new Set<string>();
  let last: Action | undefined;

  const touch = (op: Op): void => {
    switch (op.kind) {
      case "insert":
        touched.add(op.block.id);
        inserted.add(op.block.id);
        return;
      case "remove":
        touched.add(op.block.id);
        return;
      case "move":
      case "set-prop":
      case "text-edit":
        touched.add(op.blockId);
    }
  };

  const announce = (): void => {
    // Before the depth check rather than after it. An action that announces
    // once still moves the Document several times on the way, and a getter
    // read in between must not answer from a description of where it was.
    //
    // Every path that changes what these describe arrives here — `run` for the
    // Document, `select` and `edit` for the selection, `setStage` for the
    // Stage — so this is the only place they are dropped, and there is nowhere
    // else to forget to.
    setup.forget();

    if (depth > 0) {
      owed = true;
      return;
    }
    // Hover and a drag in flight never come through here, so neither is one.
    last = { via: via ?? "api", blocks: [...touched], inserted: [...inserted] };
    touched = new Set();
    inserted = new Set();
    // Said and spent: a listener that selects starts an Action of its own.
    via = undefined;
    for (const listener of changeListeners) listener();
  };

  const tellPending = (): void => {
    if (depth > 0) {
      owedPending = true;
      return;
    }
    for (const listener of pendingListeners) listener();
  };

  const tellHover = (): void => {
    if (depth > 0) {
      owedHover = true;
      return;
    }
    for (const listener of hoverListeners) listener();
  };

  const tellSuggestions = (event: SuggestionEvent): void => {
    if (depth > 0) {
      owedSuggestions.push(event);
      return;
    }
    for (const listener of suggestionListeners) listener(event);
  };

  const reveal = (blockId: string): void => {
    if (depth > 0) {
      owedReveal = blockId;
      return;
    }
    for (const listener of revealListeners) listener(blockId);
  };

  /**
   * The Document is settled before any listener runs, so an Op subscriber
   * persisting a patch and a change subscriber re-reading the Document always
   * agree about what the email now is.
   */
  const run = (ops: readonly Op[], direction?: "undo" | "redo"): void => {
    // As one action, so whatever settling raises — a Suggestion gone stale —
    // is told after the change listeners rather than before them.
    asOneAction(() => {
      setup.store.apply(ops, direction);
      setup.settle(ops);

      for (const op of ops) touch(op);
      for (const op of ops) {
        for (const listener of opListeners) listener(op);
      }
      announce();
    });
  };

  /**
   * A Block landing from an upload is an insertion, a selection and a request
   * leaving the list, and a subscriber told about each in turn would see a
   * state no action produced — the new Block in the Document, the old Block
   * still selected. Nested calls collapse into the outermost, so a composite
   * built out of other composites still announces once.
   */
  const asOneAction = <TResult>(act: () => TResult): TResult => {
    depth += 1;
    try {
      return act();
    } finally {
      depth -= 1;
      if (depth === 0) {
        if (owed) {
          owed = false;
          announce();
        }
        // After the change listeners, so a surface drawing the Pending Change
        // is told it is gone once the Document already holds what it showed.
        if (owedPending) {
          owedPending = false;
          tellPending();
        }
        // After both, so an accept event reaches a listener once the
        // Document already holds what the Suggestion showed.
        const events = owedSuggestions;
        owedSuggestions = [];
        for (const event of events) tellSuggestions(event);
        // After the Document is settled and announced, so a hover that left
        // with its Block is told once that Block is gone everywhere.
        if (owedHover) {
          owedHover = false;
          tellHover();
        }
        // Last, so a Consumer scrolling to the Block is asked for it after
        // everything that renders the Document has been told it moved.
        const blockId = owedReveal;
        owedReveal = undefined;
        via = undefined;
        if (blockId !== undefined) reveal(blockId);
      }
    }
  };

  const actVia = <TResult>(said: ActionVia, act: () => TResult): TResult =>
    asOneAction(() => {
      via ??= said;
      return act();
    });

  const actAlwaysVia = <TResult>(
    said: ActionVia,
    act: () => TResult,
  ): TResult =>
    asOneAction(() => {
      via = said;
      return act();
    });

  const listen =
    <TListener>(listeners: Set<TListener>) =>
    (listener: TListener): Unsubscribe => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };

  return {
    run,
    asOneAction,
    actVia,
    actAlwaysVia,
    lastAction: () => last,
    announce,
    tellPending,
    tellHover,
    tellSuggestions,
    reveal,
    subscribe: listen(changeListeners),
    onOp: listen(opListeners),
    onReveal: listen(revealListeners),
    subscribeToPendingChange: listen(pendingListeners),
    subscribeToSuggestions: listen(suggestionListeners),
    subscribeToHover: listen(hoverListeners),
  };
}
