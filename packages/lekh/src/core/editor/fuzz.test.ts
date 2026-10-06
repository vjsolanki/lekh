import * as fc from "fast-check";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import {
  type Asset,
  type Block,
  type BlockDefinition,
  type CommandName,
  createCommands,
  type DropTarget,
  type Edit as SuggestedEdit,
  type Editor,
  type EmailDocument,
  type ImagePlacement,
  type ImageRequest,
  type Op,
  renderDocument,
  SchemaKind,
  type Suggestion,
  toHtml,
} from "../../index";
import { createReactEmailPreset } from "../../blocks";
import {
  definitionsDividing,
  sequentialIds,
  unsubscribe,
} from "../../testing/blocks";
import { editorFor } from "../../testing/editor";

/**
 * Random sequences of Editor actions, with the ADR rules checked after every
 * step.
 *
 * Every hand-written test picks its own order. This one picks orders nobody
 * wrote, and when one breaks a rule, fast-check shrinks it to the fewest steps
 * that still do.
 *
 * Steps hold numbers, not ids: `{ do: "remove", block: 3 }` removes the fourth
 * Block of the Document as it stands then. So any step can follow any other,
 * and a shrunk sequence still means something. The failure message lists what
 * each step resolved to.
 *
 * There is no Text Engine here. Text lives outside the Op log (ADR-0009), so
 * the replica check could not hold for it, and without an engine no step ever
 * edits text.
 *
 * A peer editor makes random edits of its own. It hears every Op of ours as it
 * happens, and its Ops are fed into ours as external Ops straight after its
 * edit, so they can land while a Pending Change is open. The replica hears
 * those too, because the editor passes on every Op it applies.
 *
 * A fake resolver holds each Image Request until a step answers or fails the
 * oldest one still open, so an Asset can arrive after the Blocks around where
 * it was going have moved or gone. That is why a run is async.
 *
 * Suggestions join in as an Agent would make them: Edits built from the
 * Document as it stands, streamed or whole, then accepted or rejected. An
 * `overlap` step has the peer or us change a Block one touches, so some go
 * stale on purpose.
 *
 * Runs: `LEKH_FUZZ_RUNS` (100 by default), each with a fresh seed. To replay a
 * failure, set `LEKH_FUZZ_SEED` and `LEKH_FUZZ_PATH` from its message. Every
 * failure found becomes a named example in the last block below, with its
 * shrunk steps.
 */

const RUNS = Number(process.env["LEKH_FUZZ_RUNS"] ?? 100);
const SEED = process.env["LEKH_FUZZ_SEED"];
const PATH = process.env["LEKH_FUZZ_PATH"];

/** One step. Every number picks from what exists at the time, wrapping round. */
type Step =
  | Local
  | { do: "peer"; edit: Edit }
  | {
      do: "place-image";
      target:
        | { parent: number; index: number; reference: number | undefined }
        | undefined;
    }
  | { do: "replace-image"; target: number }
  | { do: "answer"; asset: number }
  | { do: "fail" }
  | Suggesting;

/** A step on the Suggestions. `suggestion` picks from those listed. */
type Suggesting =
  | { do: "suggest"; edits: readonly Recipe[]; streaming: boolean }
  | { do: "extend"; suggestion: number; edits: readonly Recipe[] }
  | { do: "finish"; suggestion: number }
  | { do: "accept"; suggestion: number }
  | { do: "reject"; suggestion: number }
  | {
      do: "overlap";
      /** Picks a Block some listed Suggestion touches and does not insert. */
      touch: number;
      peer: boolean;
      /** Set one of the props it sets, remove the Block, or move it. */
      how: "set-prop" | "remove" | "move";
      value: number;
    };

/**
 * One Edit of a Suggestion, by numbers. Blocks are picked from the Document
 * and from those the Edits before it insert, places from where the type may
 * go.
 */
type Recipe =
  | { kind: "set-prop"; block: number; prop: number; value: number }
  | {
      kind: "insert";
      type: number;
      place: number;
      side: number;
      named: boolean;
    }
  | { kind: "remove"; block: number }
  | { kind: "move"; block: number; place: number; side: number };

/** A step on one editor alone. */
type Local =
  | Edit
  | { do: "select"; block: number | undefined }
  | { do: "enter-text"; block: number }
  | { do: "command"; name: CommandName }
  | { do: "repair"; diagnostic: number };

const COMMANDS = [
  "undo",
  "redo",
  "delete",
  "duplicate",
  "moveUp",
  "moveDown",
  "stopEditing",
  "stepOut",
  "selectFirstChild",
  "selectPrevious",
  "selectNext",
] as const satisfies readonly CommandName[];

/** Never, so a new Command missing from the list fails the typecheck. */
type Unlisted = Exclude<CommandName, (typeof COMMANDS)[number]>;
const everyCommandListed: [Unlisted] extends [never] ? true : never = true;
void everyCommandListed;

/** A step a peer takes too. */
type Edit =
  | { do: "insert"; type: number; parent: number; index: number }
  | { do: "add-child"; child: number }
  | { do: "move"; block: number; parent: number; index: number }
  | { do: "duplicate"; block: number }
  | { do: "remove"; block: number }
  | { do: "set-prop"; block: number; prop: number; value: number }
  | { do: "clear-override"; block: number; prop: number }
  | { do: "set-stage"; mobile: boolean }
  | {
      do: "set-pending-change";
      block: number;
      props: readonly { prop: number; value: number }[];
    }
  | { do: "commit" }
  | { do: "cancel" }
  | { do: "undo" }
  | { do: "redo" };

const pick = fc.nat({ max: 1000 });

// Building steps weigh more, or the Document never grows past a Block or two
// and every other step has nothing to work on.
const edits: readonly fc.WeightedArbitrary<Edit>[] = [
  {
    weight: 6,
    arbitrary: fc.record({
      do: fc.constant("insert" as const),
      type: pick,
      parent: pick,
      index: pick,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      do: fc.constant("add-child" as const),
      child: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("move" as const),
      block: pick,
      parent: pick,
      index: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("duplicate" as const),
      block: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ do: fc.constant("remove" as const), block: pick }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      do: fc.constant("set-prop" as const),
      block: pick,
      prop: pick,
      value: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("clear-override" as const),
      block: pick,
      prop: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("set-stage" as const),
      mobile: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      do: fc.constant("set-pending-change" as const),
      block: pick,
      props: fc.array(fc.record({ prop: pick, value: pick }), {
        minLength: 1,
        maxLength: 2,
      }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ do: "commit" as const }) },
  { weight: 1, arbitrary: fc.constant({ do: "cancel" as const }) },
  { weight: 1, arbitrary: fc.constant({ do: "undo" as const }) },
  { weight: 1, arbitrary: fc.constant({ do: "redo" as const }) },
];

const recipe: fc.Arbitrary<Recipe> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("set-prop" as const),
      block: pick,
      prop: pick,
      value: pick,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("insert" as const),
      type: pick,
      place: pick,
      side: pick,
      named: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("remove" as const), block: pick }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("move" as const),
      block: pick,
      place: pick,
      side: pick,
    }),
  },
);

const suggesting: readonly fc.WeightedArbitrary<Suggesting>[] = [
  {
    weight: 3,
    arbitrary: fc.record({
      do: fc.constant("suggest" as const),
      edits: fc.array(recipe, { minLength: 1, maxLength: 3 }),
      streaming: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("extend" as const),
      suggestion: pick,
      edits: fc.array(recipe, { minLength: 1, maxLength: 2 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("finish" as const),
      suggestion: pick,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      do: fc.constant("accept" as const),
      suggestion: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("reject" as const),
      suggestion: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("overlap" as const),
      touch: pick,
      peer: fc.boolean(),
      how: fc.constantFrom(
        "set-prop" as const,
        "remove" as const,
        "move" as const,
      ),
      value: pick,
    }),
  },
];

const step: fc.Arbitrary<Step> = fc.oneof(
  ...suggesting,
  ...edits,
  {
    weight: 2,
    arbitrary: fc.record({
      do: fc.constant("select" as const),
      block: fc.option(pick, { nil: undefined }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("enter-text" as const),
      block: pick,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      do: fc.constant("command" as const),
      name: fc.constantFrom(...COMMANDS),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("repair" as const),
      diagnostic: pick,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      do: fc.constant("peer" as const),
      edit: fc.oneof(...edits),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      do: fc.constant("place-image" as const),
      target: fc.option(
        fc.record({
          parent: pick,
          index: pick,
          reference: fc.option(pick, { nil: undefined }),
        }),
        { nil: undefined },
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      do: fc.constant("replace-image" as const),
      target: pick,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ do: fc.constant("answer" as const), asset: pick }),
  },
  { weight: 1, arbitrary: fc.constant({ do: "fail" as const }) },
);

const sequences = fc.array(step, { maxLength: 60, size: "max" });

// Dividing cells for the Width rules, and a Required Block for a Repair to put
// back.
function testBlocks(): readonly BlockDefinition[] {
  return [...definitionsDividing, unsubscribe()];
}

/** The Definition sets the test runs against, so a failure says which one broke. */
const SETS: readonly {
  name: string;
  definitions: () => readonly BlockDefinition[];
}[] = [
  {
    name: "the test Blocks",
    definitions: testBlocks,
  },
  { name: "the shipped Preset", definitions: () => createReactEmailPreset() },
];

describe("random Editor actions", () => {
  for (const set of SETS) {
    it(
      `keep the ADR rules after every step, on ${set.name}`,
      async () => {
        const seen = {
          midPendingChange: 0,
          lateAnswers: 0,
          accepted: 0,
          staleAccepts: 0,
        };
        await fc.assert(
          fc.asyncProperty(sequences, async (sequence) => {
            await run(set.definitions(), sequence, seen);
          }),
          {
            numRuns: RUNS,
            ...(SEED === undefined ? {} : { seed: Number(SEED) }),
            ...(PATH === undefined ? {} : { path: PATH }),
          },
        );
        // The orders hand-written tests reach least, so a change to the
        // weights above can't quietly stop generating them.
        if (RUNS >= 100 && PATH === undefined) {
          expect(
            seen.midPendingChange,
            "peer Ops mid-Pending Change",
          ).toBeGreaterThan(0);
          expect(
            seen.lateAnswers,
            "Image Requests answered late",
          ).toBeGreaterThan(0);
          expect(seen.accepted, "Suggestions accepted").toBeGreaterThan(0);
          expect(
            seen.staleAccepts,
            "stale Suggestions refusing an accept",
          ).toBeGreaterThan(0);
        }
      },
      // The nightly run asks for thousands.
      Math.max(30_000, RUNS * 300),
    );
  }
});

// Every failure the fuzz run has found, with its shrunk steps, so it cannot
// come back. Name each after the rule it broke.
describe("what random actions found", () => {
  it("a duplicated cell is paid for out of its row, so the Widths still total 100", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 116, parent: 0, index: 0 },
      { do: "duplicate", block: 302 },
    ]);
  });

  it("an unset Width is refused, so the Widths still total 100", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 898, parent: 0, index: 0 },
      { do: "insert", type: 0, parent: 491, index: 0 },
      { do: "set-prop", block: 434, prop: 589, value: 370 },
    ]);
  });

  it("a Width set on the mobile Stage still moves its neighbour", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 768, parent: 0, index: 0 },
      { do: "set-stage", mobile: true },
      { do: "set-prop", block: 447, prop: 163, value: 2 },
    ]);
  });

  it("a column moved to another row is paid for there and given back here", async () => {
    await run(createReactEmailPreset(), [
      { do: "insert", type: 826, parent: 0, index: 0 },
      { do: "insert", type: 298, parent: 0, index: 0 },
      { do: "move", block: 240, parent: 15, index: 0 },
    ]);
  });

  it("a Width drag is shown on the row a peer has just changed, so the Widths still total 100", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 108, parent: 0, index: 0 },
      { do: "insert", type: 0, parent: 0, index: 4 },
      {
        do: "set-pending-change",
        block: 878,
        props: [{ prop: 651, value: 146 }],
      },
      { do: "peer", edit: { do: "insert", type: 0, parent: 19, index: 0 } },
    ]);
  });

  it("a column added to a row its columns have left takes the whole row, so the Widths still total 100", async () => {
    await run(createReactEmailPreset(), [
      { do: "insert", type: 1, parent: 0, index: 0 },
      { do: "duplicate", block: 1 },
      { do: "move", block: 5, parent: 0, index: 0 },
      { do: "move", block: 6, parent: 0, index: 0 },
      { do: "insert", type: 0, parent: 6, index: 0 },
    ]);
  });

  it("a Block a peer removed stays removed through our undo and redo", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 0, parent: 0, index: 0 },
      { do: "peer", edit: { do: "remove", block: 1 } },
      { do: "undo" },
      { do: "redo" },
    ]);
  });

  it("a peer's undo across our duplicate works the row out again, so the Widths still total 100", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 473, parent: 0, index: 0 },
      { do: "peer", edit: { do: "insert", type: 0, parent: 1, index: 0 } },
      { do: "duplicate", block: 2 },
      { do: "peer", edit: { do: "undo" } },
    ]);
  });

  it("an undo whose Width writes name a Block a peer removed works the row out again", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 108, parent: 0, index: 0 },
      { do: "insert", type: 0, parent: 351, index: 0 },
      { do: "duplicate", block: 32 },
      { do: "remove", block: 151 },
      { do: "insert", type: 0, parent: 160, index: 0 },
      { do: "peer", edit: { do: "remove", block: 32 } },
    ]);
  });

  it("an undo that would leave a row under its minChildren is refused, as a delete is", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 473, parent: 0, index: 0 },
      { do: "peer", edit: { do: "duplicate", block: 482 } },
      { do: "remove", block: 32 },
      { do: "peer", edit: { do: "undo" } },
    ]);
  });

  it("undo takes a Block from where a peer moved it, so redo puts it back there", async () => {
    await run(testBlocks(), [
      { do: "insert", type: 0, parent: 0, index: 0 },
      { do: "insert", type: 0, parent: 0, index: 0 },
      { do: "peer", edit: { do: "move", block: 273, parent: 0, index: 221 } },
    ]);
  });

  it("a picture in a text prop is an error Diagnostic, so the render refuses rather than throws", async () => {
    await run(testBlocks(), [
      { do: "set-prop", block: 165, prop: 0, value: 875 },
    ]);
  });

  it("a number in the preview text is an error Diagnostic, so the render refuses rather than throws", async () => {
    await run(createReactEmailPreset(), [
      { do: "set-prop", block: 0, prop: 623, value: 174 },
    ]);
  });
});

/** How often a run reached the orders hand-written tests reach least. */
interface Seen {
  /** Peer Ops that arrived while a Pending Change was open. */
  midPendingChange: number;
  /** Image Requests answered after the Blocks around their Placement changed. */
  lateAnswers: number;
  /** Suggestions accepted that wrote something. */
  accepted: number;
  /** Accepts a stale Suggestion refused. */
  staleAccepts: number;
}

/** An Image Request the fake resolver holds until a step settles it. */
interface Held {
  readonly request: ImageRequest;
  readonly answer: (asset: Asset | undefined) => void;
  readonly fail: (error: unknown) => void;
  /** The Blocks around its Placement when it was asked for. */
  readonly around: string;
}

/** Carry out the steps, checking every rule after each. */
async function run(
  definitions: readonly BlockDefinition[],
  sequence: readonly Step[],
  seen?: Seen,
): Promise<void> {
  // Oldest first. Settled ones leave, and aborted ones are skipped.
  const held: Held[] = [];
  const editor: Editor = editorFor(undefined, {
    definitions,
    resolveImage: (request) =>
      new Promise((answer, fail) => {
        held.push({
          request,
          answer,
          fail,
          around: around(editor.getDocument(), request.placement),
        });
      }),
  });
  const start = editor.getDocument();
  // A second editor that hears of every change only through the Op stream.
  const replica = editorFor(start, { definitions });
  // Its own ids, so its Blocks never collide with ours.
  const peer = editorFor(start, {
    definitions,
    createId: sequentialIds("peer"),
  });

  // Set while Ops pass from one editor to the other, so neither sends back
  // what it was just given.
  let relaying = false;
  const relay = (act: () => void): void => {
    relaying = true;
    try {
      act();
    } finally {
      relaying = false;
    }
  };
  // Every Op ours has passed on, so a step can tell whether it wrote one.
  let opsOut = 0;
  editor.onOp((op) => {
    opsOut += 1;
    replica.applyExternalOps([op]);
    if (!relaying) {
      relay(() => {
        peer.applyExternalOps([op]);
      });
    }
  });
  const outbox: Op[] = [];
  peer.onOp((op) => {
    if (!relaying) outbox.push(op);
  });
  // Once a peer's Op is in, undo cannot reach the start, #121.
  let heardPeer = false;
  // The ids an Agent names the Blocks it inserts by.
  const agentId = sequentialIds("agent");
  // The Ops the last accept wrote, as its event says.
  let acceptedOps: readonly Op[] = [];
  editor.subscribeToSuggestions((event) => {
    if (event.kind === "accept") acceptedOps = event.ops;
  });

  const oldestOpen = (): Held | undefined => {
    while (held[0]?.request.signal.aborted === true) held.shift();
    return held.shift();
  };

  /** Feed the Ops of an edit the peer just made into ours. */
  const fromPeer = (did: string): string => {
    const ops = outbox.splice(0);
    if (ops.length === 0) return `peer: ${did}`;
    const midPendingChange = editor.getPendingChange() !== undefined;
    if (midPendingChange && seen) seen.midPendingChange += 1;
    heardPeer = true;
    relay(() => {
      editor.applyExternalOps(ops);
    });
    return `peer: ${did}, ${String(ops.length)} Ops in${midPendingChange ? " while a Pending Change is open" : ""}`;
  };

  /**
   * A step that leaves no trace in the Document, the Op stream or the
   * history: a Suggestion is shown, not stored (ADR-0035).
   */
  const leavesNoTrace = (act: () => string): string => {
    const trace = (): readonly unknown[] => [
      editor.getDocument(),
      editor.getPendingChange(),
      editor.getSelection(),
      editor.canUndo(),
      editor.canRedo(),
      opsOut,
    ];
    const before = trace();
    const did = act();
    expect(trace(), `${did} left a trace`).toStrictEqual(before);
    return did;
  };

  /** Accept one, checking it writes one undo step, or nothing when it may not. */
  const accept = (suggestion: Suggestion): string => {
    const { id, status } = suggestion;
    const before = editor.getDocument();
    const pending = editor.getPendingChange();
    // What storing an open Pending Change first leaves.
    const stored = editor.getDocumentWithPendingChange();
    const ops = opsOut;
    const history = [editor.canUndo(), editor.canRedo()];
    acceptedOps = [];
    const outcome = suggestion.accept();
    const said = `accept(${id}, ${status}) → ${outcome}`;
    const after = editor.getDocument();
    const listed = editor.getSuggestions().find((each) => each.id === id);
    if (status === "streaming") {
      // ADR-0035: half of one is never taken, and nothing is stored at all.
      expect(outcome, said).toBe("streaming");
      expect(after, said).toBe(before);
      expect(editor.getPendingChange(), said).toBe(pending);
      expect(opsOut, said).toBe(ops);
      return said;
    }
    if (status === "stale") expect(outcome, said).toBe("stale");
    if (outcome !== "accepted") {
      // A stale one is never applied. Only the Pending Change is stored.
      expect(outcome, said).toBe("stale");
      if (seen) seen.staleAccepts += 1;
      expect(after, said).toEqual(stored);
      expect(listed?.status, `${said}, and stays listed stale`).toBe("stale");
      return said;
    }
    expect(listed, `${said}, and leaves the list`).toBeUndefined();
    if (pending === undefined) {
      // What went out is what the event says it wrote, and nothing else.
      expect(opsOut - ops, `${said}, Ops out`).toBe(acceptedOps.length);
    }
    if (acceptedOps.length === 0) {
      expect(after, `${said}, writing nothing`).toEqual(stored);
      if (pending === undefined) {
        expect(
          [editor.canUndo(), editor.canRedo()],
          `${said}, writing nothing, leaves nothing to undo`,
        ).toEqual(history);
      }
      return `${said}, writing nothing`;
    }
    if (seen) seen.accepted += 1;
    // One undo takes all of it back, and only it. Once a peer's Op is in,
    // undo is not ours to check (#121).
    if (!heardPeer) {
      const selected = editor.getSelection();
      const stage = editor.getStage();
      expect(editor.undo(), `${said}, then undo`).toBe(true);
      expect(editor.getDocument(), `${said}, one undo step`).toEqual(stored);
      expect(editor.redo(), `${said}, then redo`).toBe(true);
      expect(editor.getDocument(), `${said}, redo`).toEqual(after);
      editor.select(selected);
      editor.setStage(stage);
    }
    return said;
  };

  /**
   * Have the peer or us change a Block a Suggestion touches, as an Author
   * working on while it waits would.
   */
  const overlap = (each: Extract<Step, { do: "overlap" }>): string => {
    const touches = editor
      .getSuggestions()
      .flatMap((suggestion) =>
        suggestion.touches
          .filter((touch) => touch.change !== "insert")
          .map((touch) => ({ suggestion, touch })),
      );
    if (touches.length === 0) return "overlap: nothing touched";
    const { suggestion, touch } = at(touches, each.touch);
    const blocks = blocksOf(editor.getDocument().root);
    const block = blocks.findIndex(({ id }) => id === touch.blockId);
    if (block === -1) return `overlap ${touch.blockId}: gone`;
    const actor = each.peer ? peer : editor;
    const names = Object.keys(
      editor.getDefinition(at(blocks, block).type)?.schema ?? {},
    );
    const prop = names.indexOf(at([...touch.props, ""], each.value));
    const local: Local =
      each.how === "set-prop" && prop !== -1
        ? { do: "set-prop", block, prop, value: each.value }
        : each.how === "move"
          ? { do: "move", block, parent: each.value, index: each.value }
          : { do: "remove", block };
    const did = `overlap ${suggestion.id} (${suggestion.status}): ${carryOut(actor, local)}`;
    return each.peer ? fromPeer(did) : did;
  };

  async function carryOutStep(each: Step): Promise<string> {
    switch (each.do) {
      case "peer":
        return fromPeer(carryOut(peer, each.edit));
      case "suggest":
        return leavesNoTrace(() => {
          const made = editsFrom(editor, each.edits, agentId);
          const result = editor.suggest(made, {
            streaming: each.streaming,
          });
          const said = `suggest(${show(made)}${each.streaming ? ", streaming" : ""})`;
          if (result.status === "refused") return `${said} → refused`;
          expect(result.status, said).toBe(
            each.streaming ? "streaming" : "open",
          );
          expect(editor.getSuggestions(), said).toContain(result);
          return `${said} → ${result.id}`;
        });
      case "extend":
      case "finish":
      case "reject": {
        const listed = editor.getSuggestions();
        if (listed.length === 0) return `${each.do}: none open`;
        const suggestion = at(listed, each.suggestion);
        const said = `${each.do}(${suggestion.id}, ${suggestion.status})`;
        return leavesNoTrace(() => {
          if (each.do === "finish") return `${said} → ${suggestion.finish()}`;
          if (each.do === "reject") {
            const done = suggestion.reject();
            expect(done, said).toBe(true);
            expect(
              editor.getSuggestions().map(({ id }) => id),
              `${said}, and leaves the list`,
            ).toEqual(
              listed
                .filter(({ id }) => id !== suggestion.id)
                .map(({ id }) => id),
            );
            return `${said} → ${String(done)}`;
          }
          const made = editsFrom(editor, each.edits, agentId);
          const outcome = suggestion.extend(made);
          return `${said} with ${show(made)} → ${typeof outcome === "string" ? outcome : outcome.status}`;
        });
      }
      case "accept": {
        const listed = editor.getSuggestions();
        if (listed.length === 0) return "accept: none open";
        return accept(at(listed, each.suggestion));
      }
      case "overlap":
        return overlap(each);
      case "place-image": {
        const target = dropTarget(editor, each.target);
        const outcome = editor.place({
          reason: "insert",
          ...(target === undefined ? {} : { target }),
        });
        return `place(${show(target)}) → ${outcome.status}`;
      }
      case "replace-image": {
        const props = blocksOf(editor.getDocument().root).flatMap((block) =>
          Object.entries(editor.getDefinition(block.type)?.schema ?? {})
            .filter(([, entry]) => entry.kind === SchemaKind.asset)
            .map(([prop]) => ({ block, prop })),
        );
        if (props.length === 0) return "replaceImage: no Asset props";
        const { block, prop } = at(props, each.target);
        const done = editor.replaceImage(block.id, "replace", prop);
        return `replaceImage(${block.id}, replace, ${prop}) → ${String(done)}`;
      }
      case "answer":
      case "fail": {
        const oldest = oldestOpen();
        if (!oldest) return `${each.do}: none open`;
        const placement = show(oldest.request.placement);
        const late =
          around(editor.getDocument(), oldest.request.placement) !==
          oldest.around;
        if (late && seen) seen.lateAnswers += 1;
        let said: string;
        if (each.do === "answer") {
          const asset = at([...ASSETS, undefined], each.asset);
          oldest.answer(asset);
          said = `answer ${placement} with ${show(asset)}`;
        } else {
          oldest.fail(new Error("The resolver gave up."));
          said = `fail ${placement}`;
        }
        await settled();
        return `${said}${late ? ", after the Blocks around it changed" : ""}`;
      }
      case "undo":
      case "redo":
      case "insert":
      case "add-child":
      case "move":
      case "duplicate":
      case "remove":
      case "set-prop":
      case "clear-override":
      case "set-stage":
      case "set-pending-change":
      case "commit":
      case "cancel":
      case "select":
      case "enter-text":
      case "command":
      case "repair":
        return carryOut(editor, each);
      default:
        return unknownStep(each);
    }
  }

  // The Blocks every Action a step announces says it touched.
  const named = new Set<string>();
  editor.subscribe(() => {
    for (const blockId of editor.getLastAction()?.blocks ?? []) {
      named.add(blockId);
    }
  });

  const log: string[] = [];
  try {
    check(editor, replica, start, heardPeer);
    for (const each of sequence) {
      // Stands in for the step until it says what it did, in case it fails.
      log.push(`${show(each)}, which failed`);
      const before = isLocalAction(each) ? stateOf(editor) : undefined;
      const documentBefore = editor.getDocument();
      const suggestionsBefore = editor.getSuggestions();
      named.clear();
      log[log.length - 1] = await carryOutStep(each);
      // 11. The step's Actions name every Block that changed. Before `check`,
      // whose undo and redo are Actions of their own.
      checkActions(documentBefore, editor.getDocument(), named);
      check(editor, replica, start, heardPeer);
      checkSuggestions(editor, documentBefore, suggestionsBefore);
      checkCommands(editor, definitions);
      // 7. ADR-0032: a local action that changed something committed the
      // Pending Change first, so none is open after it.
      if (before !== undefined && !sameState(before, stateOf(editor))) {
        expect(
          editor.getPendingChange(),
          "a local action that changed something left a Pending Change open",
        ).toBeUndefined();
      }
      // Not a rule, but a peer that has drifted makes edits that mean less.
      expect(peer.getDocument(), "the peer holds ours").toEqual(
        editor.getDocument(),
      );
    }
  } catch (error) {
    const steps = log.map((line, index) => `  ${String(index + 1)}. ${line}`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n\nSteps:\n${steps.join("\n")}`,
      { cause: error },
    );
  }
}

/** Every Block in a Document, with the ids of the Blocks above it. */
function blocksWithPaths(
  document: EmailDocument,
): Map<string, { block: Block; path: readonly string[] }> {
  const found = new Map<string, { block: Block; path: readonly string[] }>();
  const walk = (block: Block, path: readonly string[]): void => {
    found.set(block.id, { block, path });
    for (const child of block.children ?? []) {
      walk(child, [...path, block.id]);
    }
  };
  walk(document.root, []);
  return found;
}

function childIds(block: Block | undefined): string[] {
  return (block?.children ?? []).map((child) => child.id);
}

/**
 * Every Block whose props or parent changed is named, and so is every Block
 * that came or went, or the Block it came or went whole inside of. Where the
 * Blocks still under one parent changed order, one of them is named.
 */
function checkActions(
  before: EmailDocument,
  after: EmailDocument,
  named: ReadonlySet<string>,
): void {
  const was = blocksWithPaths(before);
  const is = blocksWithPaths(after);
  for (const id of new Set([...was.keys(), ...is.keys()])) {
    const then = was.get(id);
    const now = is.get(id);
    if (then && now) {
      const changed =
        !isDeepStrictEqual(then.block.props, now.block.props) ||
        !isDeepStrictEqual(then.block.mobile, now.block.mobile) ||
        then.path.at(-1) !== now.path.at(-1);
      if (changed) expect(named, `the Action names ${id}`).toContain(id);
      continue;
    }
    // Named itself, or inside a Block that came or went whole with it.
    const doc = then ? is : was;
    const path = (then ?? now)?.path ?? [];
    expect(
      [id, ...path.filter((each) => !doc.has(each))].some((each) =>
        named.has(each),
      ),
      `the Action names ${id}, which ${then ? "went" : "came"}, or what held it`,
    ).toBe(true);
  }
  for (const [id, now] of is) {
    const childrenThen = childIds(was.get(id)?.block);
    const childrenNow = childIds(now.block);
    const stayed = (ids: string[]): string[] =>
      ids.filter(
        (child) => childrenThen.includes(child) && childrenNow.includes(child),
      );
    if (stayed(childrenThen).join() === stayed(childrenNow).join()) continue;
    expect(
      stayed(childrenNow).some((child) => named.has(child)),
      `the Action names one of ${id}'s reordered children`,
    ).toBe(true);
  }
}

/**
 * Whether a step is an action of ours that must commit an open Pending Change
 * if it changes anything. Not a peer's edit, which leaves it open, and not
 * `setPendingChange`, which opens or moves one, and not an overlap the peer
 * makes. An answered Image Request lands as ours.
 */
function isLocalAction(each: Step): boolean {
  if (each.do === "overlap") return !each.peer;
  return each.do !== "peer" && each.do !== "set-pending-change";
}

/** What a local action can change, to tell whether it did. */
function stateOf(editor: Editor): readonly unknown[] {
  return [
    editor.getDocument(),
    editor.getSelection(),
    editor.getEditing(),
    editor.getStage(),
  ];
}

function sameState(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.every((value, index) => Object.is(value, b[index]));
}

/** Let a settled Image Request reach the editor. */
async function settled(): Promise<void> {
  for (let tick = 0; tick < 3; tick += 1) await Promise.resolve();
}

/**
 * Where a placed image goes: in a Block that takes it, before or after one of
 * its children, or at an index of them. Or nowhere, and the editor decides.
 */
function dropTarget(
  editor: Editor,
  target: Extract<Step, { do: "place-image" }>["target"],
): DropTarget | undefined {
  if (target === undefined) return undefined;
  const type = editor.getImageBlockType();
  const blocks = blocksOf(editor.getDocument().root);
  const parents =
    type === undefined
      ? []
      : blocks.filter((block) => editor.canInsert(type, block.id));
  const parent = at(parents.length > 0 ? parents : blocks, target.parent);
  const children = parent.children ?? [];
  if (target.reference === undefined || children.length === 0) {
    return {
      parentId: parent.id,
      index: target.index % (children.length + 1),
      position: "inside",
    };
  }
  const reference = at(children, target.reference);
  const after = target.index % 2 === 1;
  return {
    parentId: parent.id,
    index: children.indexOf(reference) + (after ? 1 : 0),
    position: after ? "after" : "before",
    referenceBlockId: reference.id,
  };
}

/** The Blocks around a Placement, as a string to compare later. */
function around(document: EmailDocument, placement: ImagePlacement): string {
  const blocks = blocksOf(document.root);
  if (placement.kind === "insert") {
    const parent = blocks.find(({ id }) => id === placement.target.parentId);
    return show(parent?.children?.map(({ id }) => id) ?? "gone");
  }
  const parent = blocks.find((block) =>
    (block.children ?? []).some(({ id }) => id === placement.blockId),
  );
  return show(
    parent ? [parent.id, parent.children?.map(({ id }) => id)] : "gone",
  );
}

/** Carry out one step, saying what it resolved to. */
function carryOut(editor: Editor, each: Local): string {
  const document = editor.getDocument();
  const blocks = blocksOf(document.root);
  const blockAt = (index: number): Block => at(blocks, index);

  switch (each.do) {
    case "insert": {
      // A type the parent takes, when it takes any, so most inserts land.
      const parent = blockAt(each.parent);
      const types = editor.getDefinitions().map(({ type }) => type);
      const taken = types.filter((type) => editor.canInsert(type, parent.id));
      const type = at(taken.length > 0 ? taken : types, each.type);
      const index = each.index % ((parent.children?.length ?? 0) + 1);
      const id = editor.insertBlock(type, parent.id, index);
      return `insertBlock(${type}, ${parent.id}, ${String(index)}) → ${String(id)}`;
    }
    case "add-child": {
      const addable = editor.getAddableChildren();
      if (addable.length === 0) return "add a child: none offered";
      const child = at(addable, each.child);
      child.add();
      return `add a ${child.type} to ${editor.getSelection() ?? document.root.id}`;
    }
    case "move": {
      // A parent that takes it, when one does, so most moves land.
      const moved = blockAt(each.block);
      const parents = blocks.filter((block) =>
        editor.canInsert(moved.type, block.id),
      );
      const parent =
        parents.length > 0 ? at(parents, each.parent) : blockAt(each.parent);
      const siblings = (parent.children ?? []).filter(
        (child) => child.id !== moved.id,
      ).length;
      const index = each.index % (siblings + 1);
      const done = editor.moveBlock(moved.id, parent.id, index);
      return `moveBlock(${moved.id}, ${parent.id}, ${String(index)}) → ${String(done)}`;
    }
    case "duplicate": {
      const block = blockAt(each.block);
      return `duplicateBlock(${block.id}) → ${String(editor.duplicateBlock(block.id))}`;
    }
    case "remove": {
      const block = blockAt(each.block);
      return `removeBlock(${block.id}) → ${String(editor.removeBlock(block.id))}`;
    }
    case "set-prop": {
      const block = blockAt(each.block);
      const write = propWrite(editor, block.type, each.prop, each.value);
      if (!write) return `setProp on ${block.id}: no props`;
      const done = editor.setProp(block.id, write.prop, write.value);
      return `setProp(${block.id}, ${write.prop}, ${show(write.value)}) → ${String(done)}`;
    }
    case "clear-override": {
      // Most Blocks have no override, so this picks among those that do.
      const overridden = blocks.filter(
        (block) => Object.keys(block.mobile ?? {}).length > 0,
      );
      if (overridden.length === 0) return "clearMobileOverride: none stored";
      const block = at(overridden, each.block);
      const prop = at(Object.keys(block.mobile ?? {}), each.prop);
      const done = editor.clearMobileOverride(block.id, prop);
      return `clearMobileOverride(${block.id}, ${prop}) → ${String(done)}`;
    }
    case "set-stage": {
      const stage = each.mobile ? "mobile" : "desktop";
      editor.setStage(stage);
      return `setStage(${stage})`;
    }
    case "set-pending-change": {
      const block = blockAt(each.block);
      const props: Record<string, unknown> = {};
      for (const entry of each.props) {
        const write = propWrite(editor, block.type, entry.prop, entry.value);
        if (write) props[write.prop] = write.value;
      }
      const before = editor.getPendingChange();
      const shownBefore = editor.getDocumentWithPendingChange();
      const done = editor.setPendingChange(block.id, props);
      if (done) {
        // ADR-0032: what is open is shown, not stored. An open change on
        // another Block was committed first, as what was shown; one on this
        // Block is replaced, and stores nothing.
        expect(editor.getDocument()).toEqual(
          before === undefined || before.blockId === block.id
            ? document
            : shownBefore,
        );
      }
      return `setPendingChange(${block.id}, ${show(props)}) → ${String(done)}`;
    }
    case "commit":
      return `commitPendingChange() → ${String(editor.commitPendingChange())}`;
    case "cancel": {
      const canUndo = editor.canUndo();
      const canRedo = editor.canRedo();
      const done = editor.cancelPendingChange();
      // ADR-0032: a cancel leaves nothing behind.
      expect(editor.getDocument()).toBe(document);
      expect(editor.getDocumentWithPendingChange()).toBe(document);
      expect(editor.getPendingChange()).toBeUndefined();
      expect([editor.canUndo(), editor.canRedo()]).toEqual([canUndo, canRedo]);
      return `cancelPendingChange() → ${String(done)}`;
    }
    case "undo":
      return `undo() → ${String(editor.undo())}`;
    case "redo":
      return `redo() → ${String(editor.redo())}`;
    case "select": {
      const id = each.block === undefined ? undefined : blockAt(each.block).id;
      return `select(${String(id)}) → ${String(editor.select(id))}`;
    }
    case "enter-text": {
      const block = blockAt(each.block);
      return `edit(${block.id}) → ${String(editor.edit(block.id))}`;
    }
    case "command":
      return `${each.name}() → ${String(createCommands(editor)[each.name]())}`;
    case "repair": {
      const repairs = editor
        .getDiagnostics()
        .flatMap((diagnostic) =>
          diagnostic.repair
            ? [{ code: diagnostic.code, repair: diagnostic.repair }]
            : [],
        );
      if (repairs.length === 0) return "applyRepair: none offered";
      const { code, repair } = at(repairs, each.diagnostic);
      return `applyRepair(${code}) → ${String(editor.applyRepair(repair))}`;
    }
    default:
      return unknownStep(each);
  }
}

/** The rules every step must keep, numbered as in #100, then #120. Rule 7 needs the step, so it sits in `run`. */
function check(
  editor: Editor,
  replica: Editor,
  start: EmailDocument,
  heardPeer: boolean,
): void {
  const document = editor.getDocument();

  // 1. ADR-0016: a container's Widths total 100, none under its floor. On the
  // Canvas too, while a Width is being dragged.
  checkWidths(editor, document.root);
  checkWidths(editor, editor.getDocumentWithPendingChange().root);

  // 8. #120: a container declaring `minChildren` keeps that many. No step
  // takes the last ones away, whether by a removal or a move.
  checkMinimums(editor, document.root);

  // 2. ADR-0004: every Op says all of what changed, so a replica fed only the
  // Op stream, ours and the peer's, holds the same Document.
  expect(replica.getDocument()).toEqual(document);

  // 5. ADR-0032: nothing pending means the Canvas shows the stored Document.
  // What an open change does to the stored Document is checked at the steps
  // that open, replace and cancel one.
  if (editor.getPendingChange() === undefined) {
    expect(editor.getDocumentWithPendingChange()).toBe(document);
  }

  // 4. ADR-0006: a Document with no blocking Diagnostic renders.
  if (!editor.getDiagnostics().some((d) => d.severity === "error")) {
    expect(() =>
      toHtml(renderDocument(document, editor.getRenderOptions())),
    ).not.toThrow();
  }

  // 6. The selection is nothing, or a selectable Block that exists.
  const selected = editor.getSelection();
  if (selected !== undefined) {
    expect(editor.getBlock(selected)).toBeDefined();
    expect(editor.getSelectable(selected)).toBe(selected);
  }

  // 3. Every Op's inverse is right: undo to the start gives the start, and redo
  // back gives this Document again. Once a peer's Op is in, undo leaves the
  // peer's edits where they are (#121), so only the redo back is checked.
  // Skipped while a Pending Change is open, because undo commits it first,
  // which would change what is being checked, and while a Suggestion is open,
  // because the undo would leave it stale for good. Last, because redo hands
  // back an equal Document, not the same object.
  if (
    editor.getPendingChange() === undefined &&
    editor.getSuggestions().every(({ status }) => status === "stale")
  ) {
    checkHistory(editor, heardPeer ? undefined : start);
  }
}

function checkWidths(editor: Editor, block: Block): void {
  const children = block.children ?? [];
  const widths = children.flatMap((child) => {
    const schema = editor.getDefinition(child.type)?.schema ?? {};
    const name = Object.keys(schema).find(
      (key) => schema[key]?.kind === SchemaKind.width,
    );
    const entry = name === undefined ? undefined : schema[name];
    if (name === undefined || entry === undefined) return [];
    const value = child.props[name] ?? entry.defaultValue;
    return [{ id: child.id, value, floor: entry.constraints?.["min"] }];
  });
  if (widths.length > 0) {
    const total = widths.reduce(
      (sum, { value }) =>
        sum + (typeof value === "number" ? value : Number.NaN),
      0,
    );
    expect(total, `Widths in ${block.id}: ${show(widths)}`).toBeCloseTo(100);
    for (const { id, value, floor } of widths) {
      if (typeof floor === "number") {
        expect(
          value,
          `${id}'s Width is under its floor`,
        ).toBeGreaterThanOrEqual(floor);
      }
    }
  }
  for (const child of children) checkWidths(editor, child);
}

function checkMinimums(editor: Editor, block: Block): void {
  const children = block.children ?? [];
  const minimum = editor.getDefinition(block.type)?.minChildren;
  if (minimum !== undefined) {
    expect(
      children.length,
      `${block.id} is under its minChildren`,
    ).toBeGreaterThanOrEqual(minimum);
  }
  for (const child of children) checkMinimums(editor, child);
}

/**
 * The Suggestion rules, numbered after #120's (#133), given the Document
 * and the listed Suggestions as they were before the step.
 */
function checkSuggestions(
  editor: Editor,
  documentBefore: EmailDocument,
  suggestionsBefore: readonly Suggestion[],
): void {
  const document = editor.getDocument();
  const listed = editor.getSuggestions();
  const live = listed.filter(({ status }) => status !== "stale");
  const stored = new Set(blocksOf(document.root).map(({ id }) => id));

  // 9. ADR-0035: a Suggestion is shown, not stored. No Block an open one
  // inserts is in the Document. That it writes no Op is checked at the steps
  // that make, grow, finish and reject one.
  for (const suggestion of live) {
    for (const touch of suggestion.touches) {
      if (touch.change === "insert") {
        expect(
          stored.has(touch.blockId),
          `${suggestion.id} inserts ${touch.blockId}, already stored`,
        ).toBe(false);
      }
    }
  }

  // 10. A stale Suggestion is never drawn: with none open but stale ones,
  // the Canvas shows the stored Document. What is drawn keeps the Widths.
  const shown = editor.getDocumentWithSuggestions();
  if (live.length === 0) {
    expect(shown, "a stale Suggestion is drawn").toBe(document);
  }
  checkWidths(editor, shown.root);

  // 11. ADR-0035: one that was open goes stale once a Block it touches is
  // removed or moved out of its parent, or a prop it sets changes, whoever
  // did it. So accepting it never overwrites them.
  for (const suggestion of live) {
    if (!suggestionsBefore.some(({ id }) => id === suggestion.id)) continue;
    for (const touch of suggestion.touches) {
      if (touch.change === "insert") continue;
      expect(
        reading(document, touch),
        `${suggestion.id} is still ${suggestion.status} after ${touch.blockId} changed`,
      ).toBe(reading(documentBefore, touch));
    }
  }
}

/** What a touched Block reads that a Suggestion depends on, as a string. */
function reading(
  document: EmailDocument,
  touch: Suggestion["touches"][number],
): string {
  const parent = blocksOf(document.root).find((block) =>
    (block.children ?? []).some(({ id }) => id === touch.blockId),
  );
  const block = blocksOf(document.root).find(({ id }) => id === touch.blockId);
  if (!block) return "gone";
  return show([
    parent?.id,
    touch.props.map((prop) => [block.props[prop], block.mobile?.[prop]]),
  ]);
}

/**
 * Edits from recipes, against the Document as it stands. Later ones may name
 * Blocks earlier ones insert, as an Agent's do.
 */
function editsFrom(
  editor: Editor,
  recipes: readonly Recipe[],
  agentId: () => string,
): readonly SuggestedEdit[] {
  const document = editor.getDocument();
  const stored = blocksOf(document.root);
  const pool: { id: string; type: string }[] = stored.map(({ id, type }) => ({
    id,
    type,
  }));
  const inserted: string[] = [];

  /** Where a Block of a type may go: in a parent that takes it, or beside a Block. */
  const place = (
    type: string,
    pickPlace: number,
    side: number,
    except?: string,
  ): Place => {
    const parents = stored.filter((block) => editor.canInsert(type, block.id));
    const parent = at(parents.length > 0 ? parents : stored, pickPlace);
    const beside = [
      ...(parent.children ?? []).map(({ id }) => id),
      ...inserted,
    ].filter((id) => id !== except);
    const places: Place[] = [
      { parent: parent.id },
      ...beside.flatMap((id) => [{ after: id }, { before: id }]),
    ];
    return at(places, side);
  };

  return recipes.flatMap((each): readonly SuggestedEdit[] => {
    switch (each.kind) {
      case "set-prop": {
        const block = at(pool, each.block);
        const write = propWrite(editor, block.type, each.prop, each.value);
        if (!write) return [];
        return [
          {
            kind: "set-prop",
            blockId: block.id,
            prop: write.prop,
            value: write.value,
          },
        ];
      }
      case "insert": {
        const types = editor.getDefinitions().map(({ type }) => type);
        const type = at(types, each.type);
        const id = each.named ? agentId() : undefined;
        if (id !== undefined) {
          pool.push({ id, type });
          inserted.push(id);
        }
        return [
          {
            kind: "insert",
            type,
            ...(id === undefined ? {} : { id }),
            ...place(type, each.place, each.side),
          },
        ];
      }
      case "remove":
        return [{ kind: "remove", blockId: at(pool, each.block).id }];
      case "move": {
        const block = at(pool, each.block);
        return [
          {
            kind: "move",
            blockId: block.id,
            ...place(block.type, each.place, each.side, block.id),
          },
        ];
      }
      default:
        return unknownRecipe(each);
    }
  });
}

/** Where an insert or a move puts a Block: one of these. */
type Place = { after: string } | { before: string } | { parent: string };

function unknownRecipe(each: never): never {
  throw new Error(`No such recipe: ${JSON.stringify(each)}`);
}

/**
 * Undo everything, then redo as much, and put the selection and Stage back as
 * they were, so the check leaves no mark on the steps after it. `start` is
 * where undo should end up, when it can be known.
 */
function checkHistory(editor: Editor, start: EmailDocument | undefined): void {
  const now = editor.getDocument();
  const selected = editor.getSelection();
  const editing = editor.getEditing();
  const stage = editor.getStage();
  const canRedo = editor.canRedo();

  // Each step on the way keeps the rows whole, not only the two ends.
  const whole = (): void => {
    checkWidths(editor, editor.getDocument().root);
    checkMinimums(editor, editor.getDocument().root);
  };

  // 10. #141: `can.undo` and `can.redo` say what undo and redo then do.
  const { can } = createCommands(editor);
  let undone = 0;
  for (;;) {
    const said = can.undo();
    const done = editor.undo();
    expect(done, "undo does what can.undo said").toBe(said);
    if (!done) break;
    undone += 1;
    whole();
  }
  if (start !== undefined) {
    expect(editor.getDocument(), "undo to the start").toEqual(start);
  }
  for (let index = 0; index < undone; index += 1) {
    expect(can.redo(), "can.redo on the way back").toBe(true);
    expect(editor.redo(), "redo back").toBe(true);
    whole();
  }
  expect(editor.getDocument(), "redo back to now").toEqual(now);
  expect(editor.canRedo()).toBe(canRedo);
  if (!can.redo())
    expect(editor.redo(), "redo when can.redo is no").toBe(false);

  editor.select(selected);
  if (editing !== undefined) editor.edit(editing);
  editor.setStage(stage);
}

/**
 * 10. #141: each Command's `can` says whether running it changes anything.
 *
 * Run on a copy, so the run carries on from where it was. Running one commits
 * an open Pending Change first, so the copy starts from what is shown. Undo and
 * redo need the history, so `checkHistory` checks those on the editor itself.
 */
function checkCommands(
  editor: Editor,
  definitions: readonly BlockDefinition[],
): void {
  const { can } = createCommands(editor);
  const selected = editor.getSelection();
  const editing = editor.getEditing();
  const copy = (): Editor => {
    const forked = editorFor(editor.getDocumentWithPendingChange(), {
      definitions,
      createId: sequentialIds("copy"),
    });
    forked.select(selected);
    if (editing !== undefined) forked.edit(editing);
    forked.setStage(editor.getStage());
    return forked;
  };

  let forked = copy();
  for (const name of COMMANDS) {
    if (name === "undo" || name === "redo") continue;
    const said = can[name]();
    const before = stateOf(forked);
    const done = createCommands(forked)[name]();
    const changed = !sameState(before, stateOf(forked));
    expect(done, `${name}() does what can.${name} said`).toBe(said);
    expect(
      changed,
      `${name}() changes something when can.${name} says so`,
    ).toBe(said);
    if (changed) forked = copy();
  }
}

/**
 * A prop of the Block and a value to write to it, from what its Schema
 * declares: the default, the options, the bounds and past them, odd values of
 * the default's shape (an unsafe link, a colour that is not one), and values of
 * the wrong shape, which validation must stop before the render does (#119).
 */
function propWrite(
  editor: Editor,
  type: string,
  propPick: number,
  valuePick: number,
): { prop: string; value: unknown } | undefined {
  const schema = editor.getDefinition(type)?.schema ?? {};
  const names = Object.keys(schema);
  if (names.length === 0) return undefined;
  const prop = at(names, propPick);
  const entry = schema[prop];
  const fallback = entry?.defaultValue;
  const constraints = entry?.constraints ?? {};
  const candidates: unknown[] = [fallback, undefined];
  const options = constraints["options"];
  if (Array.isArray(options)) candidates.push(...(options as unknown[]));
  const min = constraints["min"];
  const max = constraints["max"];
  if (typeof min === "number") candidates.push(min, min - 1);
  if (typeof max === "number") candidates.push(max, max + 1);
  if (typeof min === "number" && typeof max === "number") {
    candidates.push(Math.round((min + max) / 2));
  }
  if (entry?.kind === SchemaKind.asset) candidates.push(...ASSETS);
  else if (fallback !== undefined) {
    candidates.push(
      ...ODD_VALUES.filter((value) => typeof value === typeof fallback),
    );
  }
  candidates.push(...WRONG_SHAPES);
  return { prop, value: at(candidates, valuePick) };
}

/** Values a prop might be handed, picked from by the default's shape. */
const ODD_VALUES: readonly unknown[] = [
  0,
  33,
  true,
  false,
  "",
  "#336699",
  "red",
  "not a color",
  "center",
  "https://example.com",
  "javascript:alert(1)",
  "<b>Hi</b>",
];

/** Values no Schema kind takes, or only some do. */
const WRONG_SHAPES: readonly unknown[] = [
  null,
  { src: "https://cdn.example.com/a.png", width: 600, height: 400 },
  ["a"],
  "a",
  7,
  true,
];

const ASSETS: readonly Asset[] = [
  { src: "https://cdn.example.com/a.png", width: 600, height: 400, alt: "A" },
  { src: "https://cdn.example.com/b.png", width: 1, height: 1 },
];

function blocksOf(block: Block): readonly Block[] {
  return [block, ...(block.children ?? []).flatMap((child) => blocksOf(child))];
}

function unknownStep(each: never): never {
  throw new Error(`No such step: ${JSON.stringify(each)}`);
}

/** The item a number picks, wrapping round. `undefined` may be one of them. */
function at<T>(items: readonly T[], index: number): T {
  if (items.length === 0) throw new Error("Nothing to pick from.");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return items[index % items.length] as T;
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}
