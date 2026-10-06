import { describe, expect, it, vi } from "vitest";

import {
  type BlockDefinition,
  createEditor,
  type Editor,
  type EmailDocument,
  type Op,
  renderDocument,
  type TextEngine,
  toHtml,
} from "../../index";
import { definitions, sequentialIds, text } from "../../testing/blocks";
import { createFakeTextEngine } from "../../testing/text-engine";

/** An editor with a fake Text Engine and one text Block ready to type into. */
function setup(engine: TextEngine = createFakeTextEngine()): {
  editor: Editor;
  engine: TextEngine;
  blockId: string;
} {
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds(),
    textEngine: engine,
  });
  const blockId =
    editor.insertBlock("text", editor.getDocument().root.id) ?? "";
  return { editor, engine, blockId };
}

function contentOf(editor: Editor, blockId: string): unknown {
  return editor.getBlock(blockId)?.props["content"];
}

describe("recording a text edit", () => {
  it("pushes a marker Op", () => {
    const { editor, blockId } = setup();
    const ops: Op[] = [];
    editor.onOp((op) => ops.push(op));

    expect(editor.markTextEdit(blockId)).toBe(true);

    expect(ops).toEqual([{ kind: "text-edit", origin: "local", blockId }]);
  });

  it("stores the engine's text on the Block, so it can be saved", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "Hello <strong>world</strong>");
    editor.markTextEdit(blockId);

    expect(contentOf(editor, blockId)).toBe("Hello <strong>world</strong>");
  });

  it("stores only formatting an email can carry", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, '<p>A <b class="lead">word</b></p>');
    editor.markTextEdit(blockId);

    expect(contentOf(editor, blockId)).toBe("A <strong>word</strong>");
  });

  it("keeps the paragraphs of text that holds them", () => {
    // The same set, with the text Block opted in to paragraphs (ADR-0023).
    const paragraphed: readonly BlockDefinition[] = definitions.map(
      (definition) =>
        definition === text
          ? {
              ...text,
              schema: {
                ...text.schema,
                content: {
                  ...text.schema.content,
                  constraints: { paragraphs: true },
                },
              },
            }
          : definition,
    );
    const engine = createFakeTextEngine();
    const editor = createEditor({
      definitions: paragraphed,
      rootType: "email",
      createId: sequentialIds(),
      textEngine: engine,
    });
    const blockId =
      editor.insertBlock("text", editor.getDocument().root.id) ?? "";

    // An empty paragraph is what Return leaves while the Author is typing.
    engine.type(blockId, "<p>One</p><p></p><p>Two</p>");
    editor.markTextEdit(blockId);

    expect(contentOf(editor, blockId)).toBe("<p>One</p><p>Two</p>");
  });

  it("is refused for a Block that is not there", () => {
    const { editor } = setup();
    expect(editor.markTextEdit("nowhere")).toBe(false);
  });

  it("leaves the Document alone when there is no engine to read from", () => {
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    const blockId =
      editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    const before = editor.getDocument();

    expect(editor.markTextEdit(blockId)).toBe(true);
    expect(editor.getDocument()).toBe(before);
  });
});

describe("one chronological timeline", () => {
  it("reverts the document action before the earlier text edit", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "typed");
    editor.markTextEdit(blockId);
    editor.setProp(blockId, "fontSize", 30);

    // The headline case from ADR-0005: an Author who types, drags, then hits
    // undo must get the drag back, not lose a character.
    editor.undo();
    expect(editor.getBlock(blockId)?.props["fontSize"]).toBeUndefined();
    expect(contentOf(editor, blockId)).toBe("typed");

    editor.undo();
    expect(contentOf(editor, blockId)).toBe("");
  });

  it("carries on from a document action back into earlier typing", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "one");
    editor.markTextEdit(blockId);
    engine.type(blockId, "one two");
    editor.markTextEdit(blockId);
    editor.setProp(blockId, "fontSize", 30);

    editor.undo();
    editor.undo();
    expect(contentOf(editor, blockId)).toBe("one");

    editor.undo();
    expect(contentOf(editor, blockId)).toBe("");
  });

  it("redoes the text edit the engine undid", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "typed");
    editor.markTextEdit(blockId);
    editor.undo();
    editor.redo();

    expect(contentOf(editor, blockId)).toBe("typed");
  });

  it("undoes a text edit with nothing selected, so a toolbar button works", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "typed");
    editor.markTextEdit(blockId);
    editor.select(undefined);

    expect(editor.getSelection()).toBeUndefined();
    expect(editor.canUndo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(contentOf(editor, blockId)).toBe("");
  });

  it("folds a coalesced edit into the entry the engine already has", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "H");
    editor.markTextEdit(blockId);
    engine.amend(blockId, "Hello");
    editor.markTextEdit(blockId, { coalesce: true });

    expect(contentOf(editor, blockId)).toBe("Hello");

    // One entry on the stack, so undo removes the word rather than the letter,
    // and the undo after it is already back at the Block's insertion.
    editor.undo();
    expect(contentOf(editor, blockId)).toBe("");

    editor.undo();
    expect(editor.getBlock(blockId)).toBeUndefined();
  });

  it("still records an entry when there is no earlier text edit to fold into", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "typed");
    editor.markTextEdit(blockId, { coalesce: true });

    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(contentOf(editor, blockId)).toBe("");
  });

  it("does not fold an edit into a different Block's entry", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);
    const other =
      editor.insertBlock("text", editor.getDocument().root.id) ?? "";

    engine.type(blockId, "first");
    editor.markTextEdit(blockId);
    engine.type(other, "second");
    editor.markTextEdit(other, { coalesce: true });

    editor.undo();
    expect(contentOf(editor, other)).toBe("");
    expect(contentOf(editor, blockId)).toBe("first");
  });

  it("steps over a marker the engine no longer has the history for", () => {
    // A Block whose surface unmounted: the marker outlived the engine's
    // memory of it, and spending the Author's keystroke on nothing is worse
    // than moving on to the action before it.
    const engine = { ...createFakeTextEngine(), canUndo: () => false };
    const undo = vi.spyOn(engine, "undo");
    const { editor, blockId } = setup(engine);

    editor.markTextEdit(blockId);

    expect(editor.undo()).toBe(true);
    expect(undo).not.toHaveBeenCalled();
    expect(editor.getBlock(blockId)).toBeUndefined();
  });

  it("reports it cannot undo a marker the engine can no longer carry out", () => {
    // The store asks the engine rather than counting its own stack, so an
    // Author is never offered an undo that would do nothing — and pressing it
    // never costs them the actions underneath.
    const engine = {
      ...createFakeTextEngine(),
      canUndo: () => false,
      canRedo: () => false,
    };
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
      textEngine: engine,
    });
    const blockId =
      editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.markTextEdit(blockId);
    editor.markTextEdit(blockId);

    expect(editor.canUndo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getBlock(blockId)).toBeUndefined();
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(true);
  });

  it("drops the redo future when a coalesced edit arrives after an undo", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "one");
    editor.markTextEdit(blockId);
    engine.type(blockId, "one two");
    editor.markTextEdit(blockId);

    editor.undo();
    expect(editor.canRedo()).toBe(true);

    // Typing again writes a different future, so the old one is gone —
    // whether or not the engine folded this change into an existing entry.
    engine.amend(blockId, "one three");
    editor.markTextEdit(blockId, { coalesce: true });

    expect(editor.canRedo()).toBe(false);
    expect(contentOf(editor, blockId)).toBe("one three");
  });
});

describe("saving and reloading", () => {
  it("keeps a Block's formatted text unchanged through the round trip", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    const typed =
      'Hello <strong>world</strong>, see <a href="https://example.com">this</a>.';
    engine.type(blockId, typed);
    editor.markTextEdit(blockId);

    // Through a database column and back, not a copy: a Document is plain
    // serialisable data, and the text has to survive being treated as such.
    const saved = structuredClone(editor.getDocument());
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);

    const reloaded = createEditor({ definitions, document: saved });

    expect(reloaded.getBlock(blockId)?.props["content"]).toBe(typed);
    expect(markupOf(reloaded.getDocument())).toBe(
      markupOf(editor.getDocument()),
    );
  });

  it("renders the stored text as email-safe inline markup", () => {
    const engine = createFakeTextEngine();
    const { editor, blockId } = setup(engine);

    engine.type(blockId, "Hello <strong>world</strong>");
    editor.markTextEdit(blockId);

    expect(markupOf(editor.getDocument())).toContain(
      '<strong style="font-weight:bold">world</strong>',
    );
  });
});

function markupOf(document: EmailDocument): string {
  return toHtml(renderDocument(document, { definitions }), { doctype: false });
}
