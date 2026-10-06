import { beforeEach, describe, expect, it } from "vitest";

import type {
  Edit,
  Editor,
  EmailDocument,
  Op,
  Suggestion,
  SuggestionEvent,
  SuggestionJSON,
} from "../../index";
import { editorFor, suggested } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

const childIds = (document: EmailDocument): readonly string[] =>
  (document.root.children ?? []).map((child) => child.id);

/** An insert of a text Block at the end of the root. */
const paragraph = (id: string): Edit => ({
  kind: "insert",
  type: "text",
  parent: "root",
  id,
});

/** The grown Suggestion, failing the test on anything else. */
const grown = (suggestion: Suggestion, edits: readonly Edit[]): Suggestion => {
  const result = suggestion.extend(edits);
  if (typeof result === "string" || result.status === "refused") {
    throw new Error(`Not grown: ${JSON.stringify(result)}`);
  }
  return result;
};

// ADR-0035: a first draft streams in as one Suggestion that grows, and cannot
// be accepted until it is finished.
describe("a streaming Suggestion", () => {
  let editor: Editor;
  let ops: Op[];
  let events: SuggestionEvent[];

  const shownIds = () => childIds(editor.getDocumentWithSuggestions());
  const storedIds = () => childIds(editor.getDocument());

  const streaming = (edits: readonly Edit[] = []) =>
    suggested(editor, edits, { streaming: true });

  beforeEach(() => {
    editor = editorFor(
      documentOf(
        block("email", { id: "root" }, [
          block("text", { id: "a", fontSize: 14 }),
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

  it("starts with no Edits, streaming", () => {
    const suggestion = streaming();

    expect(suggestion.status).toBe("streaming");
    expect(suggestion.edits).toEqual([]);
    expect(suggestion.touches).toEqual([]);
    expect(editor.getSuggestions()).toEqual([suggestion]);
    expect(events).toEqual([{ kind: "suggest", suggestion }]);
  });

  it("grows on the Canvas with each extend, and is not stored", () => {
    const suggestion = streaming();

    const once = grown(suggestion, [paragraph("p")]);
    expect(once.status).toBe("streaming");
    expect(once.id).toBe(suggestion.id);
    expect(once.edits).toEqual([paragraph("p")]);
    expect(shownIds()).toEqual(["a", "p"]);

    const twice = grown(once, [
      paragraph("q"),
      { kind: "set-prop", blockId: "p", prop: "fontSize", value: 20 },
    ]);
    expect(twice.edits).toHaveLength(3);
    expect(twice.touches.map((touch) => touch.blockId)).toEqual(["p", "q"]);
    expect(editor.getSuggestions()).toEqual([twice]);
    expect(shownIds()).toEqual(["a", "p", "q"]);

    expect(storedIds()).toEqual(["a"]);
    expect(ops).toEqual([]);
    expect(editor.canUndo()).toBe(false);
  });

  it("tells subscribers of each extend, so a Canvas can redraw", () => {
    const suggestion = streaming();
    events = [];

    const once = grown(suggestion, [paragraph("p")]);
    const twice = grown(once, [paragraph("q")]);

    expect(events).toEqual([
      { kind: "extend", suggestion: once },
      { kind: "extend", suggestion: twice },
    ]);
  });

  it("grows from an older copy of itself too", () => {
    const suggestion = streaming();
    grown(suggestion, [paragraph("p")]);

    const twice = grown(suggestion, [paragraph("q")]);

    expect(twice.edits).toEqual([paragraph("p"), paragraph("q")]);
  });

  it("refuses an extend that cannot apply, and keeps what it had", () => {
    const suggestion = grown(streaming(), [paragraph("p")]);
    events = [];

    const result = suggestion.extend([
      paragraph("q"),
      { kind: "set-prop", blockId: "nope", prop: "fontSize", value: 20 },
    ]);

    expect(result).toMatchObject({
      status: "refused",
      reasons: [{ index: 1, code: "missing-block" }],
    });
    expect(editor.getSuggestions()).toEqual([suggestion]);
    expect(shownIds()).toEqual(["a", "p"]);
    expect(events).toEqual([]);

    // It still grows after.
    expect(grown(suggestion, [paragraph("q")]).edits).toHaveLength(2);
  });

  it("refuses an extend inserting an id another Suggestion inserts", () => {
    suggested(editor, [paragraph("p")]);

    const result = streaming().extend([paragraph("p")]);

    expect(result).toMatchObject({
      status: "refused",
      reasons: [{ index: 0, code: "duplicate-id" }],
    });
  });

  it("keeps the ids it drew for unnamed inserts as it grows", () => {
    const suggestion = grown(streaming(), [
      { kind: "insert", type: "text", parent: "root" },
    ]);
    const first = shownIds()[1];

    grown(suggestion, [{ kind: "insert", type: "text", parent: "root" }]);

    expect(shownIds()[1]).toBe(first);
    expect(shownIds()).toHaveLength(3);
  });

  it("is refused on accept while streaming, writing nothing", () => {
    const suggestion = grown(streaming(), [paragraph("p")]);

    expect(suggestion.accept()).toBe("streaming");
    expect(storedIds()).toEqual(["a"]);
    expect(editor.getSuggestions()).toEqual([suggestion]);
    expect(ops).toEqual([]);
  });

  it("can be rejected while streaming, leaving nothing", () => {
    const suggestion = grown(streaming(), [paragraph("p")]);

    expect(suggestion.reject()).toBe(true);

    expect(editor.getSuggestions()).toEqual([]);
    expect(shownIds()).toEqual(["a"]);
    expect(editor.canUndo()).toBe(false);
    expect(events.at(-1)).toMatchObject({
      kind: "reject",
      suggestion: { status: "rejected" },
    });
    expect(suggestion.extend([paragraph("q")])).toBe("gone");
    expect(suggestion.finish()).toBe("gone");
  });

  describe("finished", () => {
    it("opens, tells subscribers, and grows no more", () => {
      const suggestion = grown(streaming(), [paragraph("p")]);
      events = [];

      expect(suggestion.finish()).toBe("open");

      const [finished] = editor.getSuggestions();
      expect(finished).toMatchObject({ id: suggestion.id, status: "open" });
      expect(events).toEqual([{ kind: "finish", suggestion: finished }]);
      expect(suggestion.extend([paragraph("q")])).toBe("finished");
      expect(suggestion.finish()).toBe("open");
      expect(events).toHaveLength(1);
    });

    it("is accepted as one undo step", () => {
      const suggestion = grown(grown(streaming(), [paragraph("p")]), [
        paragraph("q"),
      ]);
      suggestion.finish();

      expect(suggestion.accept()).toBe("accepted");
      expect(storedIds()).toEqual(["a", "p", "q"]);

      editor.undo();
      expect(storedIds()).toEqual(["a"]);
      expect(editor.canUndo()).toBe(false);
    });

    it("stays stale once it went stale while streaming", () => {
      const suggestion = grown(streaming(), [
        { kind: "set-prop", blockId: "a", prop: "fontSize", value: 20 },
      ]);

      editor.setProp("a", "fontSize", 18);

      expect(editor.getSuggestions()[0]?.status).toBe("stale");
      expect(suggestion.extend([paragraph("p")])).toBe("stale");
      expect(suggestion.finish()).toBe("stale");
      expect(suggestion.accept()).toBe("stale");
    });
  });

  it("goes stale while streaming when a Block it touches is removed", () => {
    const suggestion = grown(streaming(), [
      { kind: "insert", type: "text", after: "a", id: "p" },
    ]);
    events = [];

    editor.removeBlock("a");

    expect(events).toMatchObject([
      { kind: "stale", suggestion: { id: suggestion.id, status: "stale" } },
    ]);
    expect(shownIds()).toEqual([]);
  });

  it("comes back streaming when saved while streaming", () => {
    const suggestion = grown(streaming(), [paragraph("p")]);
    const json = suggestion.toJSON();
    suggestion.reject();

    expect(json).toMatchObject({ streaming: true });
    const saved: SuggestionJSON = JSON.parse(JSON.stringify(json));
    const restored = suggested(editor, saved.edits, saved);

    expect(restored.status).toBe("streaming");
    expect(restored.accept()).toBe("streaming");
    expect(restored.finish()).toBe("open");
    expect(editor.getSuggestions()[0]?.toJSON()).not.toHaveProperty(
      "streaming",
    );
  });
});
