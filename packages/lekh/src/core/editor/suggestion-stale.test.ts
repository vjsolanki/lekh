import { beforeEach, describe, expect, it } from "vitest";

import {
  createEditor,
  type Edit,
  type Editor,
  type Op,
  type SuggestionEvent,
  type SuggestionJSON,
} from "../../index";
import { editorFor, setProp, suggested } from "../../testing/editor";
import { definitions, newsletter } from "../../testing/preset";
import { createFakeTextEngine } from "../../testing/text-engine";
import { block, documentOf } from "../../testing/tree";

/** A copy made through JSON, as a Consumer saving it would get it back. */
const throughJson = <TValue>(value: TValue): TValue => {
  const copy: TValue = JSON.parse(JSON.stringify(value));
  return copy;
};

// ADR-0035: a Suggestion that waits can't clobber the Author.
describe("a stale Suggestion", () => {
  describe("on the newsletter's button", () => {
    let editor: Editor;

    beforeEach(() => {
      editor = createEditor({ definitions, document: newsletter });
    });

    it("goes stale when the Author types the label it sets", () => {
      const suggestion = suggested(editor, [
        setProp("cta", "label", "Shop now"),
      ]);

      editor.setProp("cta", "label", "Buy it");

      expect(editor.getSuggestions()).toMatchObject([
        { id: suggestion.id, status: "stale" },
      ]);
    });

    it("stays open when the Author changes the button's colour", () => {
      const suggestion = suggested(editor, [
        setProp("cta", "label", "Shop now"),
      ]);

      editor.setProp("cta", "color", "#000000");

      expect(editor.getSuggestions()).toMatchObject([
        { id: suggestion.id, status: "open" },
      ]);
      expect(suggestion.accept()).toBe("accepted");
      expect(editor.getBlock("cta")?.props).toMatchObject({
        label: "Shop now",
        color: "#000000",
      });
    });

    it("goes stale when the Author removes the button", () => {
      suggested(editor, [setProp("cta", "label", "Shop now")]);

      editor.removeBlock("cta");

      expect(editor.getSuggestions()).toMatchObject([{ status: "stale" }]);
    });

    it("goes stale when a peer removes the button", () => {
      suggested(editor, [setProp("cta", "label", "Shop now")]);
      const cta = editor.getBlock("cta");
      if (!cta) throw new Error("No button");

      editor.applyExternalOps([
        {
          kind: "remove",
          origin: "peer",
          parentId: "row",
          index: 2,
          block: cta,
        },
      ]);

      expect(editor.getSuggestions()).toMatchObject([{ status: "stale" }]);
    });
  });

  describe("overlap", () => {
    let editor: Editor;
    let events: SuggestionEvent[];

    beforeEach(() => {
      editor = editorFor(
        documentOf(
          block("email", {}, [
            block("text", { id: "a", fontSize: 14 }),
            block("text", { id: "b", fontSize: 14 }),
            block("section", { id: "s" }, [block("text", { id: "c" })]),
          ]),
        ),
      );
      events = [];
      editor.subscribeToSuggestions((event) => {
        events.push(event);
      });
    });

    const statusOf = (id: string) =>
      editor.getSuggestions().find((suggestion) => suggestion.id === id)
        ?.status;

    it("from a peer's Op on the prop it sets", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);

      editor.applyExternalOps([
        {
          kind: "set-prop",
          origin: "peer",
          blockId: "a",
          prop: "fontSize",
          value: 30,
          previousValue: 14,
        },
      ]);

      expect(statusOf(suggestion.id)).toBe("stale");
    });

    it("from accepting another Suggestion that sets the same prop", () => {
      const first = suggested(editor, [setProp("a", "fontSize", 20)]);
      const second = suggested(editor, [setProp("a", "fontSize", 30)]);

      expect(first.accept()).toBe("accepted");

      expect(statusOf(second.id)).toBe("stale");
    });

    it("from a mobile override of the prop it sets", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);

      editor.setStage("mobile");
      editor.setProp("a", "fontSize", 12);

      expect(statusOf(suggestion.id)).toBe("stale");
    });

    it("when a Block it touches is moved, even within its parent", () => {
      const suggestion = suggested(editor, [setProp("b", "fontSize", 20)]);

      editor.moveBlock("b", editor.getDocument().root.id, 0);

      expect(statusOf(suggestion.id)).toBe("stale");
    });

    it("when the parent of a Block it touches is removed", () => {
      const suggestion = suggested(editor, [setProp("c", "fontSize", 20)]);

      editor.removeBlock("s");

      expect(statusOf(suggestion.id)).toBe("stale");
    });

    it("when a Block it places an insert by is removed", () => {
      const suggestion = suggested(editor, [
        { kind: "insert", type: "text", after: "b" },
      ]);

      editor.removeBlock("b");

      expect(statusOf(suggestion.id)).toBe("stale");
    });

    it("when its own Block's text is typed", () => {
      const engine = createFakeTextEngine();
      editor = editorFor(
        documentOf(block("email", {}, [block("text", { id: "a" })])),
        { textEngine: engine },
      );
      const suggestion = suggested(editor, [setProp("a", "content", "New")]);

      engine.type("a", "Typed");
      editor.markTextEdit("a");

      expect(statusOf(suggestion.id)).toBe("stale");
    });

    it("but not from an edit to another prop, another Block, or an insert beside it", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);

      editor.setProp("a", "content", "Words");
      editor.setProp("b", "fontSize", 30);
      editor.insertBlock("text", editor.getDocument().root.id, 0);
      editor.moveBlock("b", "s", 0);
      editor.undo();

      expect(statusOf(suggestion.id)).toBe("open");
    });

    it("stays stale when the change is undone", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);

      editor.setProp("a", "fontSize", 30);
      editor.undo();

      expect(statusOf(suggestion.id)).toBe("stale");
    });

    it("tells subscribers once, after the change listeners", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);
      events = [];
      const order: string[] = [];
      editor.subscribe(() => {
        order.push("change");
      });
      editor.subscribeToSuggestions(() => {
        order.push("suggestion");
      });

      editor.setProp("a", "fontSize", 30);
      editor.setProp("a", "fontSize", 40);

      expect(events).toMatchObject([
        { kind: "stale", suggestion: { id: suggestion.id, status: "stale" } },
      ]);
      expect(events).toHaveLength(1);
      expect(order).toEqual(["change", "suggestion", "change"]);
    });

    it("tells of an accept before the Suggestions it left stale", () => {
      const first = suggested(editor, [setProp("a", "fontSize", 20)]);
      suggested(editor, [setProp("a", "fontSize", 30)]);
      events = [];

      first.accept();

      expect(events.map((event) => event.kind)).toEqual(["accept", "stale"]);
    });
  });

  describe("once stale", () => {
    let editor: Editor;
    let ops: Op[];

    beforeEach(() => {
      editor = editorFor(
        documentOf(
          block("email", {}, [block("text", { id: "a", fontSize: 14 })]),
        ),
      );
      ops = [];
      editor.onOp((op) => {
        ops.push(op);
      });
    });

    it("is refused on accept, applying nothing and saying why", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);
      editor.setProp("a", "fontSize", 30);
      ops = [];

      expect(suggestion.accept()).toBe("stale");

      expect(ops).toEqual([]);
      expect(editor.getBlock("a")?.props["fontSize"]).toBe(30);
      expect(editor.getSuggestions()).toHaveLength(1);
    });

    it("is refused on accept when the Pending Change stored first makes it stale", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);
      editor.setPendingChange("a", { fontSize: 40 });

      expect(suggestion.accept()).toBe("stale");

      expect(ops).toMatchObject([{ blockId: "a", value: 40 }]);
    });

    it("can still be rejected", () => {
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);
      editor.setProp("a", "fontSize", 30);

      expect(suggestion.reject()).toBe(true);

      expect(editor.getSuggestions()).toEqual([]);
    });

    it("is no longer drawn over the Author's own change", () => {
      suggested(editor, [setProp("a", "fontSize", 20)]);
      editor.setProp("a", "fontSize", 30);

      expect(editor.getDocumentWithSuggestions()).toBe(editor.getDocument());
    });
  });
});

describe("a saved Suggestion", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = editorFor(
      documentOf(
        block("email", {}, [
          block("text", { id: "a", fontSize: 14 }),
          block("text", { id: "b", fontSize: 14 }),
        ]),
      ),
    );
  });

  it("gives its Edits, note and meta as JSON", () => {
    const edits = [setProp("a", "fontSize", 20)];
    const suggestion = suggested(editor, edits, {
      note: "Bigger",
      meta: { thread: "t-1" },
    });

    expect(throughJson(suggestion.toJSON())).toMatchObject({
      edits,
      note: "Bigger",
      meta: { thread: "t-1" },
    });
  });

  it("comes back open when it still fits", () => {
    const saved = throughJson(
      suggested(editor, [setProp("a", "fontSize", 20)], {
        note: "Bigger",
      }).toJSON(),
    );
    const later = editorFor(editor.getDocument());

    const restored = suggested(later, saved.edits, saved);

    expect(restored).toMatchObject({ status: "open", note: "Bigger" });
    expect(restored.accept()).toBe("accepted");
    expect(later.getBlock("a")?.props["fontSize"]).toBe(20);
  });

  it("comes back open after a change to another prop or Block", () => {
    const saved = throughJson(
      suggested(editor, [setProp("a", "fontSize", 20)]).toJSON(),
    );
    editor.setProp("a", "content", "Words");
    editor.setProp("b", "fontSize", 30);
    const later = editorFor(editor.getDocument());

    expect(suggested(later, saved.edits, saved).status).toBe("open");
  });

  it("comes back stale when the prop it sets has changed since", () => {
    const saved = throughJson(
      suggested(editor, [setProp("a", "fontSize", 20)]).toJSON(),
    );
    editor.setProp("a", "fontSize", 30);
    const later = editorFor(editor.getDocument());

    const restored = suggested(later, saved.edits, saved);

    expect(restored.status).toBe("stale");
    expect(restored.accept()).toBe("stale");
  });

  it("comes back stale, not refused, when a Block it touches has gone", () => {
    const saved = throughJson(
      suggested(editor, [setProp("b", "fontSize", 20)]).toJSON(),
    );
    editor.removeBlock("b");
    const later = editorFor(editor.getDocument());

    const restored = later.suggest(saved.edits, saved);

    expect(restored).toMatchObject({
      status: "stale",
      touches: [{ blockId: "b", change: "set", props: ["fontSize"] }],
      diagnostics: [],
    });
  });

  it("comes back stale when a Block it touches has moved to another parent", () => {
    editor = editorFor(
      documentOf(
        block("email", {}, [
          block("text", { id: "a" }),
          block("section", { id: "s" }),
        ]),
      ),
    );
    const saved = throughJson(
      suggested(editor, [setProp("a", "fontSize", 20)]).toJSON(),
    );
    editor.moveBlock("a", "s", 0);
    const later = editorFor(editor.getDocument());

    expect(suggested(later, saved.edits, saved).status).toBe("stale");
  });

  it("comes back stale when it was saved stale, even after an undo", () => {
    const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);
    editor.setProp("a", "fontSize", 30);
    editor.undo();
    const saved = throughJson(
      editor
        .getSuggestions()
        .find((open) => open.id === suggestion.id)
        ?.toJSON(),
    );
    if (!saved) throw new Error("Not listed");
    const later = editorFor(editor.getDocument());

    expect(suggested(later, saved.edits, saved).status).toBe("stale");
  });

  it("comes back stale, not refused, when its insert's id is another open one's", () => {
    const edits: Edit[] = [
      { kind: "insert", type: "text", id: "p", after: "a" },
    ];
    const saved = throughJson(suggested(editor, edits).toJSON());

    expect(suggested(editor, saved.edits, saved).status).toBe("stale");
  });

  it("is still refused when an Edit is not an Edit", () => {
    const saved = throughJson(
      suggested(editor, [setProp("a", "fontSize", 20)]).toJSON(),
    );
    const later = editorFor(editor.getDocument());

    // A method's parameters compare both ways, so this takes anything.
    const unchecked: {
      suggest(
        edits: readonly unknown[],
        options: SuggestionJSON,
      ): ReturnType<Editor["suggest"]>;
    } = later;
    const restored = unchecked.suggest([{ kind: "explode" }], saved);

    expect(restored).toMatchObject({
      status: "refused",
      reasons: [{ code: "malformed" }],
    });
  });

  it("writes the Stage it was suggested on", () => {
    const saved = throughJson(
      suggested(editor, [setProp("a", "fontSize", 20)]).toJSON(),
    );
    const later = editorFor(editor.getDocument());
    later.setStage("mobile");

    suggested(later, saved.edits, saved).accept();

    expect(later.getBlock("a")?.props["fontSize"]).toBe(20);
    expect(later.getBlock("a")?.mobile).toBeUndefined();
  });
});
