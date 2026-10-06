import { beforeEach, describe, expect, it } from "vitest";

import type {
  Edit,
  Editor,
  Op,
  SuggestionEvent,
  SuggestOptions,
} from "../../index";
import { editorFor, suggested } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/** A set-prop Edit on a text Block's font size. */
const fontSize = (blockId: string, value: number) =>
  ({ kind: "set-prop", blockId, prop: "fontSize", value }) as const;

// ADR-0035: a Suggestion is shown, not stored, and accepted whole.
describe("a Suggestion", () => {
  let editor: Editor;
  let ops: Op[];
  let events: SuggestionEvent[];

  const shown = (blockId: string, prop: string) =>
    editor
      .getDocumentWithSuggestions()
      .root.children?.find((child) => child.id === blockId)?.props[prop];

  const stored = (blockId: string, prop: string) =>
    editor.getBlock(blockId)?.props[prop];

  const suggest = (edits: readonly Edit[], options?: SuggestOptions) =>
    suggested(editor, edits, options);

  beforeEach(() => {
    editor = editorFor(
      documentOf(
        block("email", {}, [
          block("text", { id: "a", fontSize: 14 }),
          block("text", { id: "b", fontSize: 14 }),
        ]),
      ),
    );
    ops = [];
    editor.onOp((op) => {
      ops.push(op);
    });
    events = [];
    editor.subscribeToSuggestions((event) => {
      events.push(event);
    });
  });

  it("is shown without being stored", () => {
    const saved = editor.getDocument();
    let changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });

    const suggestion = suggest([fontSize("a", 20), fontSize("b", 22)]);

    expect(suggestion.status).toBe("open");
    expect(editor.getSuggestions()).toEqual([suggestion]);
    expect(shown("a", "fontSize")).toBe(20);
    expect(shown("b", "fontSize")).toBe(22);
    expect(editor.getDocument()).toBe(saved);
    expect(ops).toEqual([]);
    expect(changes).toBe(0);
    expect(editor.canUndo()).toBe(false);
  });

  it("keeps the note and the meta it was given, and its own copy of the Edits", () => {
    const meta = { thread: "t-1" };
    const edits = [fontSize("a", 20)];

    const suggestion = suggest(edits, { note: "Bigger", meta });

    expect(suggestion).toMatchObject({ note: "Bigger", edits });
    expect(suggestion.meta).toBe(meta);
    expect(typeof suggestion.id).toBe("string");
  });

  it("tells subscribers it was suggested", () => {
    const suggestion = suggest([fontSize("a", 20)]);

    expect(events).toEqual([{ kind: "suggest", suggestion }]);
  });

  it("leaves the Diagnostics on the stored Document", () => {
    const before = editor.getDiagnostics();

    suggest([{ kind: "set-prop", blockId: "a", prop: "content", value: "" }]);

    expect(editor.getDiagnostics()).toBe(before);
  });

  it("returns the same Document when none is open", () => {
    expect(editor.getDocumentWithSuggestions()).toBe(editor.getDocument());
  });

  it("is refused, showing nothing, when an Edit cannot apply", () => {
    const refused = editor.suggest([
      fontSize("a", 20),
      fontSize("missing", 20),
    ]);

    expect(refused).toMatchObject({
      status: "refused",
      reasons: [{ index: 1, code: "missing-block" }],
    });
    expect(editor.getSuggestions()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("is refused when it holds no Edits", () => {
    expect(editor.suggest([])).toEqual({ status: "refused", reasons: [] });
  });

  describe("accepted", () => {
    it("writes ordinary Ops with the editor's origin, as one undo step", () => {
      const suggestion = suggest([fontSize("a", 20), fontSize("b", 22)]);

      expect(suggestion.accept()).toBe("accepted");

      expect(ops).toEqual([
        {
          kind: "set-prop",
          origin: "local",
          blockId: "a",
          prop: "fontSize",
          value: 20,
          previousValue: 14,
        },
        {
          kind: "set-prop",
          origin: "local",
          blockId: "b",
          prop: "fontSize",
          value: 22,
          previousValue: 14,
        },
      ]);
      expect(stored("a", "fontSize")).toBe(20);
      expect(editor.getSuggestions()).toEqual([]);

      editor.undo();
      expect(stored("a", "fontSize")).toBe(14);
      expect(stored("b", "fontSize")).toBe(14);
      expect(editor.canUndo()).toBe(false);

      editor.redo();
      expect(stored("a", "fontSize")).toBe(20);
      expect(stored("b", "fontSize")).toBe(22);
    });

    it("chains two Edits on the same prop, so undo goes back to the first value", () => {
      suggest([fontSize("a", 20), fontSize("a", 30)]).accept();

      expect(stored("a", "fontSize")).toBe(30);
      editor.undo();
      expect(stored("a", "fontSize")).toBe(14);
    });

    it("tells subscribers once, with the Suggestion and the Ops it wrote", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      events = [];
      const order: string[] = [];
      editor.onOp(() => {
        order.push("op");
      });
      editor.subscribe(() => {
        order.push("change");
      });
      editor.subscribeToSuggestions(() => {
        order.push("suggestion");
      });

      suggestion.accept();

      expect(events).toEqual([
        {
          kind: "accept",
          suggestion: { ...suggestion, status: "accepted" },
          ops,
        },
      ]);
      expect(order).toEqual(["op", "change", "suggestion"]);
    });

    it("is no longer shown once it is in the Document", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      let seen: unknown[] = [];
      editor.subscribe(() => {
        seen = [shown("a", "fontSize"), editor.getSuggestions().length];
      });

      suggestion.accept();

      expect(seen).toEqual([20, 0]);
      expect(editor.getDocumentWithSuggestions()).toBe(editor.getDocument());
    });

    it("commits an open Pending Change first, as its own step", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      editor.setPendingChange("b", { fontSize: 40 });

      suggestion.accept();

      expect(ops).toMatchObject([
        { blockId: "b", value: 40 },
        { blockId: "a", value: 20 },
      ]);
      editor.undo();
      expect(stored("a", "fontSize")).toBe(14);
      expect(stored("b", "fontSize")).toBe(40);
    });

    it("leaves the others open", () => {
      const first = suggest([fontSize("a", 20)]);
      const second = suggest([fontSize("b", 22)]);

      first.accept();

      expect(editor.getSuggestions()).toEqual([second]);
      expect(shown("b", "fontSize")).toBe(22);
    });

    it("happens once", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      suggestion.accept();
      ops = [];

      expect(suggestion.accept()).toBe("gone");
      expect(suggestion.reject()).toBe(false);
      expect(ops).toEqual([]);
    });

    it("writes the Stage it was suggested on", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      editor.setStage("mobile");

      suggestion.accept();

      expect(stored("a", "fontSize")).toBe(20);
      expect(editor.getBlock("a")?.mobile).toBeUndefined();
    });

    it("is refused whole when an Edit no longer applies", () => {
      const suggestion = suggest([fontSize("a", 20), fontSize("b", 22)]);
      editor.removeBlock("b");
      ops = [];

      expect(suggestion.accept()).toBe("stale");
      expect(ops).toEqual([]);
      expect(stored("a", "fontSize")).toBe(14);
    });

    it("still stores an open Pending Change when it is refused", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      editor.removeBlock("a");
      editor.setPendingChange("b", { fontSize: 40 });
      ops = [];

      expect(suggestion.accept()).toBe("stale");

      expect(ops).toMatchObject([{ blockId: "b", value: 40 }]);
      expect(editor.getSuggestions()).toMatchObject([
        { id: suggestion.id, status: "stale" },
      ]);
    });

    it("writes nothing, and leaves nothing to undo, when it changes nothing", () => {
      const suggestion = suggest([fontSize("a", 14)]);
      events = [];

      expect(suggestion.accept()).toBe("accepted");

      expect(ops).toEqual([]);
      expect(editor.canUndo()).toBe(false);
      expect(events).toMatchObject([{ kind: "accept", ops: [] }]);
    });
  });

  describe("rejected", () => {
    it("writes nothing and leaves nothing to undo", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      events = [];

      expect(suggestion.reject()).toBe(true);

      expect(ops).toEqual([]);
      expect(editor.canUndo()).toBe(false);
      expect(editor.getSuggestions()).toEqual([]);
      expect(editor.getDocumentWithSuggestions()).toBe(editor.getDocument());
      expect(events).toEqual([
        { kind: "reject", suggestion: { ...suggestion, status: "rejected" } },
      ]);
    });

    it("leaves an open Pending Change open", () => {
      const suggestion = suggest([fontSize("a", 20)]);
      editor.setPendingChange("b", { fontSize: 40 });

      suggestion.reject();

      expect(editor.getPendingChange()?.blockId).toBe("b");
    });
  });

  describe("waiting", () => {
    it("stays open while the selection moves and other edits land", () => {
      const suggestion = suggest([fontSize("a", 20)]);

      editor.select("a");
      editor.select("b");
      editor.setProp("b", "fontSize", 18);
      editor.undo();
      editor.setStage("mobile");

      expect(editor.getSuggestions()).toEqual([suggestion]);
      expect(shown("a", "fontSize")).toBe(20);
      expect(suggestion.accept()).toBe("accepted");
      expect(stored("a", "fontSize")).toBe(20);
    });

    it("shows several at once", () => {
      suggest([fontSize("a", 20)]);
      suggest([fontSize("b", 22)]);

      expect(editor.getSuggestions()).toHaveLength(2);
      expect(shown("a", "fontSize")).toBe(20);
      expect(shown("b", "fontSize")).toBe(22);
    });

    it("hands back the same list and Document until something moves", () => {
      suggest([fontSize("a", 20)]);

      expect(editor.getSuggestions()).toBe(editor.getSuggestions());
      expect(editor.getDocumentWithSuggestions()).toBe(
        editor.getDocumentWithSuggestions(),
      );
    });

    it("leaves a Pending Change working as before", () => {
      suggest([fontSize("a", 20)]);
      editor.setPendingChange("a", { fontSize: 40 });

      expect(
        editor.getDocumentWithPendingChange().root.children?.[0]?.props,
      ).toMatchObject({ fontSize: 40 });
      expect(editor.commitPendingChange()).toBe(true);
      expect(stored("a", "fontSize")).toBe(40);
    });
  });
});
