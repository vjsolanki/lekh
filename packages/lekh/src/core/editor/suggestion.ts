import type { EmailDocument } from "../document/document";
import type { Edit } from "../document/edit";
import { findBlock, findLocation } from "../document/tree";
import type { Stage } from "../layout/responsive";
import type { Diagnostic } from "../validate/diagnostic";
import type { CarryOutResult, EditRefusal, SuggestionTouch } from "./carry-out";
import type { Op } from "./op";
import type { Store } from "./store";

/**
 * A change suggested to the Author rather than made by them, by an Agent
 * most often (ADR-0035).
 *
 * Shown on the Canvas, and not in the Document. It waits through selection
 * and other edits, and several may be open at once. The Author accepts it
 * whole, as one undo step, or rejects it, leaving nothing behind.
 *
 * A snapshot. Once it grows, finishes or goes stale,
 * {@link Editor.getSuggestions} holds a new copy. Once accepted or rejected it
 * leaves the list, and the event carries a copy with the new status.
 * `accept`, `reject`, `extend` and `finish` act on the Suggestion, whichever
 * copy they are called on. `toJSON` saves the copy it is called on.
 */
export interface Suggestion {
  readonly id: string;
  readonly edits: readonly Edit[];
  /** What the Agent says about it, for the Author to read. */
  readonly note: string | undefined;
  /** The Consumer's own data. Stored and handed back, never read. */
  readonly meta: unknown;
  /**
   * `streaming` while it is still arriving, until {@link Suggestion.finish}.
   * Then `open` until it is accepted or rejected, or goes `stale`: once anyone
   * sets a prop it sets, or removes or moves a Block it touches, or it no
   * longer applies at all. A change to another prop of the same Block leaves
   * it open. A stale one stays listed, so the Author can still see it, but is
   * no longer drawn in {@link Editor.getDocumentWithSuggestions} and refuses
   * to be accepted. It never opens again. A streaming one goes stale the
   * same way.
   */
  readonly status: SuggestionStatus;
  /**
   * The Diagnostics of the Document as it would read after accepting, read
   * when it was suggested. They never stop it being accepted: an Author may
   * make the same change by hand (ADR-0006). None when it was restored stale
   * because it no longer applies.
   */
  readonly diagnostics: readonly Diagnostic[];
  /** Every Block it inserts, removes, moves or sets props on, and which props. */
  readonly touches: readonly SuggestionTouch[];
  /**
   * Write it into the Document, as one undo step. An open Pending Change is
   * stored first, as its own step: accepting is an action (ADR-0032).
   *
   * Edits that change nothing write nothing, and leave nothing to undo.
   *
   * Says what happened. Anything but `accepted` writes nothing of its own:
   * `stale` when it has gone stale, the Pending Change stored first included,
   * and `gone` once it has been accepted or rejected. The Pending Change is
   * still stored then: the Author acted. `streaming` while it is still
   * arriving, and then nothing is stored at all: half of one is never taken.
   */
  accept(): AcceptOutcome;
  /**
   * Drop it, stale, streaming or not. No Op, nothing to undo. False once it
   * has gone.
   */
  reject(): boolean;
  /**
   * Add Edits to the end of a streaming one, as the Agent writes them, and
   * hand back the grown copy. They are carried out after the ones it has,
   * against the Document as it is now, held to what `suggest` holds a new one
   * to.
   *
   * Refused when any of them cannot apply, with a reason for each, indexed
   * into these Edits. It keeps what it had, and still grows after.
   *
   * Otherwise says why it no longer grows: `finished` once it is finished,
   * `stale` once it went stale, and `gone` once accepted or rejected. Stop the
   * Agent then.
   */
  extend(edits: readonly Edit[]): ExtendOutcome;
  /**
   * The Agent is done: a streaming one opens, and may be accepted. Says the
   * status it is left in, or `gone` once accepted or rejected.
   */
  finish(): FinishOutcome;
  /**
   * What to save to restore it later: `suggest(json.edits, json)`. Plain data,
   * safe through `JSON.stringify`.
   */
  toJSON(): SuggestionJSON;
}

export type SuggestionStatus =
  "streaming" | "open" | "stale" | "accepted" | "rejected";

/** What {@link Suggestion.accept} did, or why it did nothing. */
export type AcceptOutcome = "accepted" | "stale" | "streaming" | "gone";

/** What {@link Suggestion.extend} did, or why it did nothing. */
export type ExtendOutcome =
  Suggestion | SuggestionRefusal | "finished" | "stale" | "gone";

/** What {@link Suggestion.finish} left it as. */
export type FinishOutcome = "open" | "stale" | "gone";

/**
 * A Block a Suggestion touches, as it read when the Suggestion was made: what
 * a restored one is checked against to tell whether it still fits.
 */
export interface SuggestionBase extends SuggestionTouch {
  /**
   * The id of the Block it sat in. Absent for the root, and for a Block the
   * Suggestion inserts, which was not there to read.
   */
  readonly parentId?: string;
  /**
   * Each prop in `props`, as stored: its desktop value and its Mobile
   * Override. Absent for a Block the Suggestion inserts.
   */
  readonly values?: Readonly<Record<string, SuggestionBaseValue>>;
}

/** One prop as a Block stores it: its desktop value and its Mobile Override. */
export interface SuggestionBaseValue {
  readonly desktop?: unknown;
  readonly mobile?: unknown;
}

/** A saved Suggestion. Pass it as the options to `suggest` to restore it. */
export interface SuggestionJSON {
  readonly edits: readonly Edit[];
  readonly note?: string;
  readonly meta?: unknown;
  readonly stage: Stage;
  readonly base: readonly SuggestionBase[];
  /** Present once it has gone stale, so it comes back stale. */
  readonly stale?: true;
  /** Present while it streams, so it comes back unfinished. */
  readonly streaming?: true;
}

/**
 * What `suggest` gives back when an Edit cannot be carried out. Nothing is
 * shown, and nobody is told.
 *
 * One reason for each Edit that cannot apply, so all of them can go back to
 * the Agent at once. None when there were no Edits.
 */
export interface SuggestionRefusal {
  readonly status: "refused";
  readonly reasons: readonly EditRefusal[];
}

export interface SuggestOptions {
  readonly note?: string;
  readonly meta?: unknown;
  /**
   * The Stage a `set-prop` Edit with none is written on. The Stage the editor
   * shows when left out.
   */
  readonly stage?: Stage;
  /**
   * What the touched Blocks read when it was first suggested, from
   * {@link Suggestion.toJSON}. Given, the Suggestion is a restored one: it
   * comes back `stale` rather than refused when it no longer fits, as it
   * would have gone stale had it stayed open.
   */
  readonly base?: readonly SuggestionBase[];
  /** Restore it stale, as it was saved: a stale one never opens again. */
  readonly stale?: boolean;
  /**
   * It is still arriving: a first draft the Agent is writing. It may start
   * with no Edits, grows with {@link Suggestion.extend}, and refuses to be
   * accepted until {@link Suggestion.finish}.
   */
  readonly streaming?: boolean;
}

/**
 * What a Suggestion subscriber is told.
 *
 * Accepted Ops carry the editor's own origin, as an Author's do. The accept
 * event is the one place that says an Agent suggested them, for an audit log.
 */
export type SuggestionEvent =
  | { readonly kind: "suggest"; readonly suggestion: Suggestion }
  | { readonly kind: "extend"; readonly suggestion: Suggestion }
  | { readonly kind: "finish"; readonly suggestion: Suggestion }
  | {
      readonly kind: "accept";
      readonly suggestion: Suggestion;
      readonly ops: readonly Op[];
    }
  | { readonly kind: "reject"; readonly suggestion: Suggestion }
  | { readonly kind: "stale"; readonly suggestion: Suggestion };

export interface SuggestionSetup {
  readonly store: Store;
  readonly createId: () => string;
  /** The Stage an Edit with none is written on. */
  readonly stage: () => Stage;
  /**
   * Carry these Edits out on a copy of a Document, in order, each reading the
   * Document the ones before it left, held to what an Agent may write. New
   * Blocks an insert does not name take their ids from `createId`.
   */
  carryOut(
    edits: readonly Edit[],
    document: EmailDocument,
    stage: Stage,
    createId: () => string,
  ): CarryOutResult;
  /** The Diagnostics of a Document. */
  diagnose(document: EmailDocument): readonly Diagnostic[];
  /**
   * Hand the rich text these Ops set to the Text Engine, and give back the
   * Ops with a `text-edit` marker after each set it took (ADR-0037).
   */
  handOffText(ops: readonly Op[]): readonly Op[];
  /** Store Ops as one local action and one undo step. */
  write(ops: readonly Op[]): void;
  /**
   * Run a local action as one: an open Pending Change is stored first, as its
   * own step, and listeners hear the lot once.
   */
  act<TResult>(act: () => TResult): TResult;
  /** Tell subscribers, after the change listeners if an action is open. */
  tell(event: SuggestionEvent): void;
}

/** The open Suggestions an editor holds, and their lifecycle. */
export interface Suggestions {
  readonly suggest: (
    edits: readonly Edit[],
    options?: SuggestOptions,
  ) => Suggestion | SuggestionRefusal;
  /** The open ones, oldest first. The same array until one comes or goes. */
  readonly list: () => readonly Suggestion[];
  /**
   * The open ones touching a Block, front first: finished and open, then
   * still arriving, then stale, the newest first within each. The same array
   * until one comes, goes or changes.
   */
  readonly at: (blockId: string) => readonly Suggestion[];
  /**
   * The stored Document with every open Suggestion applied, or every one but
   * `without`.
   */
  readonly shown: (without?: string) => EmailDocument;
  /**
   * The stored Document with this one Suggestion alone applied: what
   * accepting it would store now. None once it has gone, or when it does not
   * apply.
   */
  readonly applied: (id: string) => EmailDocument | undefined;
  /**
   * The Document has just moved by these Ops, from wherever they came. Any
   * open Suggestion they overlap goes stale.
   */
  readonly settle: (ops: readonly Op[]) => void;
}

const NONE_OPEN: readonly Suggestion[] = [];

/** Where each status sorts at a Block: the one that can be accepted first. */
const FRONT_RANK: Readonly<Record<SuggestionStatus, number>> = {
  open: 0,
  streaming: 1,
  stale: 2,
  accepted: 3,
  rejected: 3,
};

/**
 * Ids for the Blocks a Suggestion inserts without naming, the same ones each
 * time it is carried out. Otherwise the Canvas would see new Blocks on every
 * redraw, and accepting would store different ones from those shown.
 *
 * Each call starts a fresh run over the same ids, drawing more as needed.
 */
function sameIds(createId: () => string): () => () => string {
  const drawn: string[] = [];
  return () => {
    let at = 0;
    return () => {
      const id = drawn[at] ?? createId();
      drawn[at] = id;
      at += 1;
      return id;
    };
  };
}

/** What a Suggestion holds, apart from its id and methods. */
type SuggestionFields = Pick<
  Suggestion,
  "edits" | "note" | "meta" | "status" | "diagnostics" | "touches"
>;

interface Entry {
  readonly suggestion: Suggestion;
  readonly stage: Stage;
  readonly ids: () => () => string;
  readonly base: readonly SuggestionBase[];
}

/** What the Blocks some Edits touch read now, before any of it is carried out. */
function baseOf(
  touches: readonly SuggestionTouch[],
  document: EmailDocument,
): readonly SuggestionBase[] {
  return touches.map((touch) => readTouch(touch, document) ?? touch);
}

/**
 * A touched Block as it reads in this Document: where it sits, and each prop
 * it sets. The touch alone for a Block the Edits insert. None when the Block
 * is not there.
 */
function readTouch(
  touch: SuggestionTouch,
  document: EmailDocument,
): SuggestionBase | undefined {
  const { blockId, change, props } = touch;
  if (change === "insert") return { blockId, change, props };
  const block = findBlock(document.root, blockId);
  if (!block) return undefined;
  const parentId = findLocation(document.root, blockId)?.parent.id;
  return {
    blockId,
    change,
    props,
    ...(parentId === undefined ? {} : { parentId }),
    values: Object.fromEntries(
      props.map((prop): [string, SuggestionBaseValue] => [
        prop,
        { desktop: block.props[prop], mobile: block.mobile?.[prop] },
      ]),
    ),
  };
}

/**
 * Whether every Block a Suggestion touches still reads as it did: there, in
 * the same parent, each prop it sets as it was on both Stages.
 */
function matchesBase(
  base: readonly SuggestionBase[],
  document: EmailDocument,
): boolean {
  return base.every((then) => {
    const now = readTouch(then, document);
    return (
      now !== undefined &&
      now.parentId === then.parentId &&
      sameValue(now.values, then.values)
    );
  });
}

/**
 * The same value, however it was copied. A key holding `undefined` reads as
 * one left out, since a restored base has been through JSON, and key order
 * does not count, since a database may not keep it.
 */
export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftFields: Readonly<Record<string, unknown>> = { ...left };
  const rightFields: Readonly<Record<string, unknown>> = { ...right };
  const keys = new Set([
    ...Object.keys(leftFields),
    ...Object.keys(rightFields),
  ]);
  return [...keys].every((key) => sameValue(leftFields[key], rightFields[key]));
}

export function createSuggestions(setup: SuggestionSetup): Suggestions {
  const { store } = setup;

  /**
   * Each open Suggestion with the Stage it was made on. Without that, one
   * suggested on desktop and accepted on mobile would write Mobile Overrides
   * nobody asked for: an Edit means the same thing later or nothing.
   */
  let open: readonly Entry[] = [];
  let list: readonly Suggestion[] = NONE_OPEN;
  /** The Document with them applied, and what it was built from. */
  let shown:
    | {
        readonly saved: EmailDocument;
        readonly list: readonly Suggestion[];
        readonly document: EmailDocument;
      }
    | undefined;

  /** The Document without one of them, for a Canvas holding it back. */
  let shownWithout:
    | {
        readonly saved: EmailDocument;
        readonly list: readonly Suggestion[];
        readonly without: string;
        readonly document: EmailDocument;
      }
    | undefined;

  /** Each Block's answer to `at`, kept until the list changes. */
  let atBlock = new Map<string, readonly Suggestion[]>();

  const relist = (next: readonly Entry[]): void => {
    open = next;
    list =
      open.length === 0 ? NONE_OPEN : open.map((entry) => entry.suggestion);
    atBlock = new Map();
  };

  const leave = (id: string): void => {
    relist(open.filter((entry) => entry.suggestion.id !== id));
  };

  const entryOf = (id: string) =>
    open.find((entry) => entry.suggestion.id === id);

  const carry = (entry: Entry, document: EmailDocument): CarryOutResult =>
    setup.carryOut(entry.suggestion.edits, document, entry.stage, entry.ids());

  /**
   * These Suggestions applied to a Document, in order. Carried out on copies:
   * nothing here can reach the store. Each reads the Document the ones before
   * it left. A stale one is left out, or it would be drawn over the change
   * that made it so.
   */
  const applyAll = (
    entries: readonly Entry[],
    document: EmailDocument,
  ): EmailDocument =>
    entries.reduce<EmailDocument>((current, entry) => {
      if (entry.suggestion.status === "stale") return current;
      const carried = carry(entry, current);
      return "refused" in carried ? current : carried.document;
    }, document);

  /** Whether it could still be accepted against this Document as it is. */
  const fits = (entry: Entry, document: EmailDocument): boolean =>
    matchesBase(entry.base, document) && !("refused" in carry(entry, document));

  /** A Suggestion as its fields read, and the methods that act on it. */
  const make = (
    id: string,
    fields: SuggestionFields,
    stage: Stage,
    base: readonly SuggestionBase[],
  ): Suggestion => ({
    id,
    edits: fields.edits,
    note: fields.note,
    meta: fields.meta,
    status: fields.status,
    diagnostics: fields.diagnostics,
    touches: fields.touches,
    accept: () => accept(id),
    reject: () => reject(id),
    extend: (edits) => extend(id, edits),
    finish: () => finish(id),
    toJSON: () => ({
      edits: [...fields.edits],
      ...(fields.note === undefined ? {} : { note: fields.note }),
      ...(fields.meta === undefined ? {} : { meta: fields.meta }),
      stage,
      base,
      ...(fields.status === "stale" ? { stale: true } : {}),
      ...(fields.status === "streaming" ? { streaming: true } : {}),
    }),
  });

  /** The entry with a new copy of its Suggestion, put in its place. */
  const restamp = (
    entry: Entry,
    changes: Partial<SuggestionFields>,
    base = entry.base,
  ): Entry => {
    const next: Entry = {
      ...entry,
      base,
      suggestion: make(
        entry.suggestion.id,
        { ...entry.suggestion, ...changes },
        entry.stage,
        base,
      ),
    };
    relist(
      open.map((each) =>
        each.suggestion.id === entry.suggestion.id ? next : each,
      ),
    );
    return next;
  };

  const accept = (id: string): AcceptOutcome => {
    const waiting = entryOf(id);
    if (!waiting) return "gone";
    if (waiting.suggestion.status === "streaming") return "streaming";
    return setup.act(() => {
      // Read again: storing the Pending Change may have left it stale.
      const entry = entryOf(id);
      if (!entry) return "gone";
      if (entry.suggestion.status === "stale") return "stale";
      // Read against the Document as it is now, not as it was suggested.
      // Nothing is written unless all of it applies, which an open one does.
      const carried = carry(entry, store.get());
      if ("refused" in carried) return "stale";
      // The engine takes the text before anyone hears, so the accept event
      // carries the markers the write does.
      const ops = setup.handOffText(carried.ops);
      // Gone before anything runs, so no listener sees it twice: once in the
      // Document and once on top of it.
      leave(id);
      // Told before the Ops are written, so a listener hears of the accept
      // before the Suggestions it leaves stale.
      setup.tell({
        kind: "accept",
        suggestion: { ...entry.suggestion, status: "accepted" },
        ops,
      });
      if (ops.length > 0) setup.write(ops);
      return "accepted";
    });
  };

  const reject = (id: string): boolean => {
    const entry = entryOf(id);
    if (!entry) return false;
    leave(id);
    setup.tell({
      kind: "reject",
      suggestion: { ...entry.suggestion, status: "rejected" },
    });
    return true;
  };

  /**
   * An insert naming an id another open Suggestion's insert names too. Both
   * could not be accepted, and the later would never show.
   */
  const clashingInsert = (
    edits: readonly Edit[],
    touches: readonly SuggestionTouch[],
    except?: string,
  ): EditRefusal | undefined => {
    const taken = new Set(
      open.flatMap((entry) =>
        entry.suggestion.id === except
          ? []
          : entry.suggestion.touches
              .filter((touch) => touch.change === "insert")
              .map((touch) => touch.blockId),
      ),
    );
    const clash = touches.find(
      (touch) => touch.change === "insert" && taken.has(touch.blockId),
    );
    if (!clash) return undefined;
    return {
      index: edits.findIndex(
        (edit) => edit.kind === "insert" && edit.id === clash.blockId,
      ),
      code: "duplicate-id",
      message: `Another open Suggestion inserts a Block with the id "${clash.blockId}".`,
    };
  };

  const extend = (id: string, edits: readonly Edit[]): ExtendOutcome => {
    const entry = entryOf(id);
    if (!entry) return "gone";
    const { status } = entry.suggestion;
    if (status === "stale") return "stale";
    if (status !== "streaming") return "finished";
    if (edits.length === 0) return entry.suggestion;
    const all = [...entry.suggestion.edits, ...edits];
    const document = store.get();
    // All of it again, not the new ones on top of what was shown: each Edit
    // reads the Document the ones before it left, as on accept.
    const carried = setup.carryOut(all, document, entry.stage, entry.ids());
    // Only the new ones can be refused: had the Document moved under the
    // old ones, it would have gone stale.
    const offset = entry.suggestion.edits.length;
    const refuse = (reasons: readonly EditRefusal[]): SuggestionRefusal => ({
      status: "refused",
      reasons: reasons.map((reason) => ({
        ...reason,
        index: reason.index - offset,
      })),
    });
    if ("refused" in carried) return refuse(carried.refused);
    const clash = clashingInsert(all, carried.touches, id);
    if (clash) return refuse([clash]);
    // Read now, for the old touches too: still open, they read as they did.
    const next = restamp(
      entry,
      {
        edits: all,
        touches: carried.touches,
        diagnostics: setup.diagnose(carried.document),
      },
      baseOf(carried.touches, document),
    );
    setup.tell({ kind: "extend", suggestion: next.suggestion });
    return next.suggestion;
  };

  const finish = (id: string): FinishOutcome => {
    const entry = entryOf(id);
    if (!entry) return "gone";
    const { status } = entry.suggestion;
    if (status !== "streaming") return status === "stale" ? "stale" : "open";
    const next = restamp(entry, { status: "open" });
    setup.tell({ kind: "finish", suggestion: next.suggestion });
    return "open";
  };

  return {
    suggest(edits, options = {}) {
      const stage = options.stage ?? setup.stage();
      const streaming = options.streaming === true;
      if (edits.length === 0 && !streaming) {
        return { status: "refused", reasons: [] };
      }
      const ids = sameIds(setup.createId);
      const document = store.get();
      const carried = setup.carryOut(edits, document, stage, ids());
      const restoring = options.base !== undefined;
      // A restored one that no longer applies would have gone stale had it
      // stayed open, so it comes back stale, touching what it touched. Only
      // Edits that were never Edits are refused, whatever the Document.
      if (
        "refused" in carried &&
        (!restoring ||
          carried.refused.some((reason) => reason.code === "malformed"))
      ) {
        return { status: "refused", reasons: carried.refused };
      }
      const touches =
        "refused" in carried
          ? (options.base ?? []).map(({ blockId, change, props }) => ({
              blockId,
              change,
              props,
            }))
          : carried.touches;
      // A restored one that clashes could never be accepted either.
      const clash = clashingInsert(edits, touches);
      if (clash && !restoring) return { status: "refused", reasons: [clash] };

      const base = options.base ?? baseOf(touches, document);
      const stale =
        options.stale === true ||
        clash !== undefined ||
        "refused" in carried ||
        !matchesBase(base, document);
      const suggestion = make(
        setup.createId(),
        {
          edits: [...edits],
          note: options.note,
          meta: options.meta,
          status: stale ? "stale" : streaming ? "streaming" : "open",
          diagnostics:
            "refused" in carried ? [] : setup.diagnose(carried.document),
          touches,
        },
        stage,
        base,
      );
      relist([...open, { suggestion, stage, ids, base }]);
      setup.tell({ kind: "suggest", suggestion });
      return suggestion;
    },

    list: () => list,

    at(blockId) {
      const cached = atBlock.get(blockId);
      if (cached) return cached;
      const touching = list
        .filter((suggestion) =>
          suggestion.touches.some((touch) => touch.blockId === blockId),
        )
        .toReversed();
      // A stable sort, so the newest stays first within each status.
      const front =
        touching.length === 0
          ? NONE_OPEN
          : touching.toSorted(
              (a, b) => FRONT_RANK[a.status] - FRONT_RANK[b.status],
            );
      atBlock.set(blockId, front);
      return front;
    },

    shown(without) {
      const saved = store.get();
      if (without !== undefined && entryOf(without)) {
        if (
          shownWithout?.saved !== saved ||
          shownWithout.list !== list ||
          shownWithout.without !== without
        ) {
          shownWithout = {
            saved,
            list,
            without,
            document: applyAll(
              open.filter((entry) => entry.suggestion.id !== without),
              saved,
            ),
          };
        }
        return shownWithout.document;
      }
      if (open.length === 0) {
        shown = undefined;
        return saved;
      }
      if (shown?.saved !== saved || shown.list !== list) {
        shown = { saved, list, document: applyAll(open, saved) };
      }
      return shown.document;
    },

    applied(id) {
      const entry = entryOf(id);
      if (!entry) return undefined;
      const carried = carry(entry, store.get());
      return "refused" in carried ? undefined : carried.document;
    },

    settle(ops) {
      if (open.every((entry) => entry.suggestion.status === "stale")) return;
      const document = store.get();
      // A Block moved within its parent still reads as it did. The Op is the
      // only sign.
      const moved = new Set(
        ops.flatMap((op) => (op.kind === "move" ? [op.blockId] : [])),
      );
      const goingStale = open.filter((entry) => {
        if (entry.suggestion.status === "stale") return false;
        const wasMoved = entry.base.some(
          (touch) => touch.change !== "insert" && moved.has(touch.blockId),
        );
        return wasMoved || !fits(entry, document);
      });
      const nowStale = goingStale.map(
        (entry) => restamp(entry, { status: "stale" }).suggestion,
      );
      for (const suggestion of nowStale)
        setup.tell({ kind: "stale", suggestion });
    },
  };
}
