import { describe, expect, it } from "vitest";

import {
  SchemaKind,
  type BlockDefinition,
  type Edit,
  type Op,
} from "../../index";
import { definitions, text } from "../../testing/blocks";
import { editorFor, suggested } from "../../testing/editor";
import { createFakeTextEngine } from "../../testing/text-engine";
import { block, documentOf } from "../../testing/tree";

/** A set-prop Edit on a text Block's rich text. */
const reword = (blockId: string, value: string): Edit => ({
  kind: "set-prop",
  blockId,
  prop: "content",
  value,
});

/** The test Blocks, with the text Block's rich text opted in to more. */
function textHolding(constraints: Record<string, boolean>) {
  return definitions.map((definition): BlockDefinition =>
    definition === text
      ? {
          ...text,
          schema: {
            ...text.schema,
            content: { ...text.schema.content, constraints },
          },
        }
      : definition,
  );
}

/** One text Block, `a`, holding "Hello", and an engine that holds it too. */
function setup(blocks: readonly BlockDefinition[] = definitions) {
  const engine = createFakeTextEngine({ a: "Hello" });
  const editor = editorFor(
    documentOf(
      block("email", {}, [block("text", { id: "a", content: "Hello" })]),
    ),
    { definitions: blocks, textEngine: engine },
  );
  const content = () => editor.getBlock("a")?.props["content"];
  return { editor, engine, content };
}

// ADR-0037: the Text Engine takes text from outside.
describe("a Suggestion that rewords text", () => {
  it("hands the text to the engine and stores it on accept", () => {
    const { editor, engine, content } = setup();

    suggested(editor, [reword("a", "Hi <strong>there</strong>")]).accept();

    expect(engine.getText("a")).toBe("Hi <strong>there</strong>");
    expect(content()).toBe("Hi <strong>there</strong>");
  });

  it("leaves the engine alone until it is accepted", () => {
    const { editor, engine, content } = setup();

    suggested(editor, [reword("a", "Hi")]).reject();

    expect(engine.getText("a")).toBe("Hello");
    expect(engine.canUndo("a")).toBe(false);
    expect(content()).toBe("Hello");
  });

  it("writes a text-edit marker with the set, so the Op stream says the text moved", () => {
    const { editor } = setup();
    const ops: Op[] = [];
    editor.onOp((op) => ops.push(op));

    suggested(editor, [reword("a", "Hi")]).accept();

    expect(ops).toEqual([
      expect.objectContaining({
        kind: "set-prop",
        blockId: "a",
        prop: "content",
        value: "Hi",
        previousValue: "Hello",
      }),
      { kind: "text-edit", origin: "local", blockId: "a" },
    ]);
  });

  it("stores the text as the subset writes it", () => {
    const { editor, engine, content } = setup();

    suggested(editor, [reword("a", "Hi <b>there</b>")]).accept();

    expect(content()).toBe("Hi <strong>there</strong>");
    expect(engine.getText("a")).toBe("Hi <strong>there</strong>");
  });

  it("is taken back whole by one undo, then the Author's earlier typing", () => {
    const { editor, engine, content } = setup();
    engine.type("a", "Hello world");
    editor.markTextEdit("a");

    suggested(editor, [
      reword("a", "Hi"),
      { kind: "set-prop", blockId: "a", prop: "fontSize", value: 20 },
    ]).accept();
    expect(content()).toBe("Hi");

    editor.undo();
    expect(content()).toBe("Hello world");
    expect(engine.getText("a")).toBe("Hello world");
    expect(editor.getBlock("a")?.props["fontSize"]).toBeUndefined();

    editor.undo();
    expect(content()).toBe("Hello");
    expect(engine.getText("a")).toBe("Hello");
  });

  it("redoes the same way back", () => {
    const { editor, engine, content } = setup();
    engine.type("a", "Hello world");
    editor.markTextEdit("a");
    suggested(editor, [reword("a", "Hi")]).accept();
    editor.undo();
    editor.undo();

    editor.redo();
    expect(content()).toBe("Hello world");
    expect(engine.getText("a")).toBe("Hello world");

    editor.redo();
    expect(content()).toBe("Hi");
    expect(engine.getText("a")).toBe("Hi");
    expect(editor.canRedo()).toBe(false);
  });

  it("keeps the Author's typing after it as its own undo step", () => {
    const { editor, engine, content } = setup();
    suggested(editor, [reword("a", "Hi")]).accept();

    engine.type("a", "Hi you");
    editor.markTextEdit("a", { coalesce: true });

    editor.undo();
    expect(content()).toBe("Hi");
    editor.undo();
    expect(content()).toBe("Hello");
  });

  it("stores the prop alone when the engine holds no text for the Block", () => {
    // A Block scrolled out of the Canvas has no surface: it seeds from the
    // prop when it comes back.
    const engine = { ...createFakeTextEngine(), replaceText: () => false };
    const editor = editorFor(
      documentOf(
        block("email", {}, [block("text", { id: "a", content: "Hello" })]),
      ),
      { textEngine: engine },
    );
    const ops: Op[] = [];
    editor.onOp((op) => ops.push(op));

    suggested(editor, [reword("a", "Hi")]).accept();

    expect(editor.getBlock("a")?.props["content"]).toBe("Hi");
    expect(ops.map((op) => op.kind)).toEqual(["set-prop"]);
    editor.undo();
    expect(editor.getBlock("a")?.props["content"]).toBe("Hello");
  });

  it("stores the prop alone with no engine at all", () => {
    const editor = editorFor(
      documentOf(
        block("email", {}, [block("text", { id: "a", content: "Hello" })]),
      ),
    );

    suggested(editor, [reword("a", "Hi")]).accept();
    expect(editor.getBlock("a")?.props["content"]).toBe("Hi");

    editor.undo();
    expect(editor.getBlock("a")?.props["content"]).toBe("Hello");
  });

  it("does not reach the engine for the same text", () => {
    const { editor, engine } = setup();

    expect(suggested(editor, [reword("a", "Hello")]).accept()).toBe("accepted");

    expect(engine.canUndo("a")).toBe(false);
    expect(editor.canUndo()).toBe(false);
  });
});

describe("rich text an Edit may carry", () => {
  const refusal = (
    blocks: readonly BlockDefinition[] | undefined,
    value: string,
  ) => {
    const { editor } = setup(blocks);
    const result = editor.suggest([reword("a", value)]);
    return result.status === "refused" ? result.reasons : undefined;
  };

  it.each([
    "Plain words",
    "<strong>b</strong> <b>b</b> <em>i</em> <i>i</i> <u>u</u> <s>s</s>",
    'A <a href="https://example.com">link</a>',
    "One<br>two",
    "<!-- a note --> words",
  ])("takes the inline subset: %s", (value) => {
    expect(refusal(undefined, value)).toBeUndefined();
  });

  it.each([
    ["<h1>Title</h1>", "<h1>"],
    ['<span style="color:red">red</span>', "<span>"],
    ["<p>One</p><p>Two</p>", "<p>"],
    ["<ul><li>One</li></ul>", "<ul>"],
    ["<img src=x>", "<img>"],
  ])("refuses a tag the prop does not hold: %s", (value, tag) => {
    expect(refusal(undefined, value)).toEqual([
      {
        index: 0,
        code: "unsupported-markup",
        message: expect.stringContaining(tag),
      },
    ]);
  });

  it("refuses a link that goes nowhere safe", () => {
    expect(refusal(undefined, '<a href="javascript:alert(1)">x</a>')).toEqual([
      {
        index: 0,
        code: "unsupported-markup",
        message: expect.stringContaining("javascript:"),
      },
    ]);
  });

  it("takes paragraphs only where the prop opts in", () => {
    const paragraphs = textHolding({ paragraphs: true });
    expect(refusal(paragraphs, "<p>One</p><p>Two</p>")).toBeUndefined();
    expect(refusal(paragraphs, "<ul><li>One</li></ul>")).toEqual([
      expect.objectContaining({ code: "unsupported-markup" }),
    ]);
  });

  it("takes lists only where the prop opts in", () => {
    const lists = textHolding({ paragraphs: true, lists: true });
    expect(
      refusal(lists, "<p>One</p><ol><li>Two</li></ol><ul><li>3</li></ul>"),
    ).toBeUndefined();
  });

  it("holds each rich-text prop to its own constraints", () => {
    // A second rich-text prop, opted in to paragraphs where the first is not.
    const twoTexts = definitions.map((definition): BlockDefinition =>
      definition === text
        ? {
            ...text,
            schema: {
              ...text.schema,
              footnote: {
                kind: SchemaKind.richText,
                label: "Footnote",
                defaultValue: "",
                constraints: { paragraphs: true },
              },
            },
          }
        : definition,
    );
    const { editor } = setup(twoTexts);
    const paragraphs = "<p>One</p><p>Two</p>";

    expect(
      editor.suggest([
        { kind: "set-prop", blockId: "a", prop: "footnote", value: paragraphs },
      ]).status,
    ).toBe("open");
    expect(editor.suggest([reword("a", paragraphs)]).status).toBe("refused");
  });

  it("holds an insert's rich text to the same subset", () => {
    const { editor } = setup();
    const result = editor.suggest([
      {
        kind: "insert",
        type: "text",
        after: "a",
        props: { content: "<h2>x</h2>" },
      },
    ]);
    expect(result).toEqual({
      status: "refused",
      reasons: [expect.objectContaining({ code: "unsupported-markup" })],
    });
  });

  it("leaves setProp as forgiving as it was", () => {
    const { editor, content } = setup();
    expect(editor.setProp("a", "content", "<h1>Title</h1>")).toBe(true);
    expect(content()).toBe("<h1>Title</h1>");
  });
});
