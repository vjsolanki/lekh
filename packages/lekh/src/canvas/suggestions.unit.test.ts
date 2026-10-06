import { describe, expect, it } from "vitest";

import { drawnDocument, keepRemoved, touchedBlocks } from "./suggestions";

type Block = Parameters<typeof keepRemoved>[0]["root"];
type Suggestion = Parameters<typeof touchedBlocks>[0];

const leaf = (id: string): Block => ({ id, type: "text", props: {} });
const box = (id: string, children: readonly Block[]): Block => ({
  id,
  type: "stack",
  props: {},
  children,
});
const documentOf = (...children: readonly Block[]) => ({
  root: box("root", children),
});

/** The tree as nested ids, so a test reads what was drawn at a glance. */
function shape(block: Block): unknown {
  return block.children ? { [block.id]: block.children.map(shape) } : block.id;
}

function suggestionOf(
  status: Suggestion["status"],
  touches: Suggestion["touches"],
): Suggestion {
  return {
    id: "suggestion",
    edits: [],
    note: undefined,
    meta: undefined,
    status,
    diagnostics: [],
    touches,
    accept: () => "gone",
    reject: () => false,
    extend: () => "gone",
    finish: () => "gone",
    toJSON: () => ({ edits: [], stage: "desktop", base: [] }),
  };
}

describe("keeping the Blocks a Suggestion removes on the Canvas", () => {
  const stored = documentOf(
    leaf("a"),
    leaf("b"),
    box("s", [leaf("c"), leaf("d")]),
  );

  it("puts one back right after the nearest earlier sibling still drawn", () => {
    const drawn = documentOf(
      leaf("a"),
      leaf("new"),
      box("s", [leaf("c"), leaf("d")]),
    );

    expect(shape(keepRemoved(drawn, stored, ["b"]).root)).toEqual({
      root: ["a", "b", "new", { s: ["c", "d"] }],
    });
  });

  it("puts a first child back first", () => {
    const drawn = documentOf(leaf("new"), leaf("b"), box("s", [leaf("d")]));

    expect(shape(keepRemoved(drawn, stored, ["a", "c"]).root)).toEqual({
      root: ["a", "new", "b", { s: ["c", "d"] }],
    });
  });

  it("puts a container back with what is in it, once", () => {
    const drawn = documentOf(leaf("a"), leaf("b"));

    expect(shape(keepRemoved(drawn, stored, ["d", "s"]).root)).toEqual({
      root: ["a", "b", { s: ["c", "d"] }],
    });
  });

  it("leaves a Block moved out of a removed container where it went", () => {
    const drawn = documentOf(leaf("a"), leaf("c"), leaf("b"));

    expect(shape(keepRemoved(drawn, stored, ["s"]).root)).toEqual({
      root: ["a", "c", "b", { s: ["d"] }],
    });
  });

  it("hands back the same Document when nothing is missing", () => {
    expect(keepRemoved(stored, stored, ["b"])).toBe(stored);
    expect(keepRemoved(stored, stored, [])).toBe(stored);
  });
});

describe("the Document the Canvas draws", () => {
  const stored = documentOf(leaf("a"), leaf("b"));
  const withSuggestions = documentOf(leaf("a"));

  it("keeps what an open Suggestion removes", () => {
    const drawn = drawnDocument({
      stored,
      withSuggestions,
      suggestions: [
        suggestionOf("open", [{ blockId: "b", change: "remove", props: [] }]),
      ],
      pending: undefined,
    });

    expect(shape(drawn.root)).toEqual({ root: ["a", "b"] });
  });

  it("puts the Pending Change on top", () => {
    const drawn = drawnDocument({
      stored,
      withSuggestions,
      suggestions: [
        suggestionOf("streaming", [
          { blockId: "b", change: "remove", props: [] },
        ]),
      ],
      pending: {
        blockId: "b",
        ops: [
          {
            kind: "set-prop",
            origin: "local",
            blockId: "b",
            prop: "padding",
            value: 4,
            previousValue: undefined,
          },
        ],
      },
    });

    expect(drawn.root.children?.[1]?.props).toEqual({ padding: 4 });
  });
});

describe("the Blocks the suggestion Slot is given", () => {
  it("names each touched Block drawn and measured, and leaves out the rest", () => {
    const drawn = documentOf(leaf("a"), leaf("new"));
    const rect = { top: 0, left: 0, width: 10, height: 10 };
    const suggestion = suggestionOf("open", [
      { blockId: "new", change: "insert", props: [] },
      { blockId: "a", change: "set", props: ["content"] },
      { blockId: "gone", change: "insert", props: [] },
    ]);

    expect(
      touchedBlocks(
        suggestion,
        drawn,
        new Map([
          ["new", rect],
          ["a", rect],
        ]),
      ),
    ).toEqual([
      { block: leaf("new"), rect, change: "insert", props: [] },
      { block: leaf("a"), rect, change: "set", props: ["content"] },
    ]);
  });
});
