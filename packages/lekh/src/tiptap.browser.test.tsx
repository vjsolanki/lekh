import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider, type TextToolbarProps } from "./canvas";
import {
  createEditor,
  defineBlock,
  RichText,
  type BlockDefinition,
  type Editor,
} from "./index";
import { sequentialIds } from "./testing/blocks";
import { doubleClickPointer, mount, whenRendered } from "./testing/browser";
import { createTiptapTextEngine, type TiptapTextEngineOptions } from "./tiptap";

/**
 * The Text Engine's browser seam, kept as thin as the Canvas's.
 *
 * Only what a real editor and a real layout engine are needed for: that the
 * adapter mounts inside the Canvas iframe, that a range selection produces a
 * toolbar rectangle in the Consumer's own coordinates across that boundary,
 * that applying a format changes what the Document stores, and that ⌘Z inside
 * a Block being typed into still reaches the one timeline.
 *
 * Ordering, delegation and the round trip are all about the store, and are
 * proved against a fake engine in the Node suite instead.
 */

const definitions: readonly BlockDefinition[] = [
  defineBlock<Record<string, never>>({
    type: "email",
    label: "Email",
    accepts: ["text", "copy", "list"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock<{ content: string; fontSize: number; linkColor: string }>({
    type: "text",
    label: "Text",
    schema: {
      content: { kind: "rich-text", label: "Content", defaultValue: "Text" },
      fontSize: { kind: "number", label: "Font size", defaultValue: 16 },
      linkColor: { kind: "color", label: "Links", defaultValue: "#ff6600" },
    },
    render: ({ props }) => (
      <p style={{ margin: 0, fontSize: props.fontSize }}>
        <RichText value={props.content} linkColor={props.linkColor} />
      </p>
    ),
  }),
  // Text that holds paragraphs, spaced by a prop (ADR-0023).
  defineBlock<{ content: string; spacing: number }>({
    type: "copy",
    label: "Copy",
    schema: {
      content: {
        kind: "rich-text",
        label: "Content",
        defaultValue: "",
        constraints: { paragraphs: true },
      },
      spacing: { kind: "number", label: "Spacing", defaultValue: 12 },
    },
    render: ({ props }) => (
      <div>
        <RichText
          value={props.content}
          paragraphStyle={{ marginTop: 0, marginBottom: props.spacing }}
          paragraphClassName="para"
        />
      </div>
    ),
  }),
  // Text that holds paragraphs and lists (ADR-0029).
  defineBlock<{ content: string; itemSpacing: number }>({
    type: "list",
    label: "List",
    schema: {
      content: {
        kind: "rich-text",
        label: "Content",
        defaultValue: "",
        constraints: { paragraphs: true, lists: true },
      },
      itemSpacing: { kind: "number", label: "Item spacing", defaultValue: 6 },
    },
    render: ({ props }) => (
      <div>
        <RichText
          value={props.content}
          paragraphStyle={{ marginTop: 0, marginBottom: 12 }}
          listStyle={{ marginTop: 0, marginBottom: 12 }}
          listItemStyle={{ marginTop: 0, marginBottom: props.itemSpacing }}
          listIndent={30}
        />
      </div>
    ),
  }),
];

interface Mounted {
  readonly host: HTMLElement;
  readonly editor: Editor;
  readonly blockId: string;
  readonly frame: HTMLIFrameElement;
  readonly frameDocument: Document;
  readonly editable: HTMLElement;
}

/** A Canvas with one text Block, its Text Engine mounted and ready to type in. */
async function mountEditor(
  content: string,
  slots: { readonly textToolbar?: typeof Toolbar } = {},
  options: TiptapTextEngineOptions = {},
  type: "text" | "copy" | "list" = "text",
): Promise<Mounted> {
  const text = createTiptapTextEngine(options);
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds("block"),
    textEngine: text,
  });
  const blockId =
    editor.insertBlock(type, editor.getDocument().root.id, undefined, {
      content,
    }) ?? "";

  const host = mount(
    <EditorProvider editor={editor} editableText={text.EditableText}>
      <Canvas slots={slots} />
    </EditorProvider>,
  );

  // Text takes no keystrokes until an Author asks for it, and every test below
  // is about what happens once they have. The asking itself — the double-click,
  // and what it costs the drag — is tested on its own.
  editor.edit(blockId);

  const { frame, frameDocument } = await whenRendered(host);
  const editable = await vi.waitFor(() => {
    const found = frameDocument.querySelector<HTMLElement>(
      "[contenteditable='true']",
    );
    if (!found) throw new Error("The Text Engine has not mounted yet.");
    return found;
  });
  return { host, editor, blockId, frame, frameDocument, editable };
}

/** Select `length` characters from the start of the Block's text. */
function selectFromStart(mounted: Mounted, length: number): void {
  select(mounted, 0, length);
}

/** Put the caret between two characters, selecting nothing. */
function placeCaret(mounted: Mounted, at: number): void {
  select(mounted, at, at);
}

function select(mounted: Mounted, from: number, to: number): void {
  const walker = mounted.frameDocument.createTreeWalker(
    mounted.editable,
    NodeFilter.SHOW_TEXT,
  );
  const textNode = walker.nextNode();
  if (!textNode) throw new Error("The editable holds no text.");

  mounted.editable.focus();
  const range = mounted.frameDocument.createRange();
  range.setStart(textNode, from);
  range.setEnd(textNode, to);

  const selection = mounted.frameDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Type at the end of the Block's text, the way an Author would. */
function typeAtEnd(mounted: Mounted, text: string): void {
  caretAtEnd(mounted);
  // Goes through the browser's own editing pipeline, so ProseMirror sees the
  // same input events an Author's keyboard would produce.
  mounted.frameDocument.execCommand("insertText", false, text);
}

/** Put the caret after the last character of the Block's text. */
function caretAtEnd(mounted: Mounted): void {
  const walker = mounted.frameDocument.createTreeWalker(
    mounted.editable,
    NodeFilter.SHOW_TEXT,
  );
  let last = walker.nextNode();
  while (walker.nextNode() !== null) last = walker.currentNode;
  if (!last) throw new Error("The editable holds no text.");

  mounted.editable.focus();
  const range = mounted.frameDocument.createRange();
  range.setStart(last, last.textContent?.length ?? 0);
  range.collapse(true);
  const selection = mounted.frameDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Type wherever the caret already is. */
function typeHere(mounted: Mounted, text: string): void {
  mounted.frameDocument.execCommand("insertText", false, text);
}

/** Paste HTML at the caret, the way a clipboard would. */
function paste(mounted: Mounted, html: string): void {
  const view = mounted.frameDocument.defaultView ?? window;
  const data = new view.DataTransfer();
  data.setData("text/html", html);
  mounted.editable.dispatchEvent(
    new view.ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Type something, wait for the Document to catch up, then pause long enough
 * that the next thing typed is a chunk of its own.
 */
async function typeChunk(
  mounted: Mounted,
  text: string,
  expected: string,
): Promise<void> {
  typeAtEnd(mounted, text);
  await vi.waitFor(() => {
    expect(contentOf(mounted)).toBe(expected);
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
}

let latest: TextToolbarProps | undefined;

function Toolbar(props: TextToolbarProps): ReactNode {
  latest = props;
  return (
    <div
      data-testid="text-toolbar"
      style={{
        position: "absolute",
        top: props.rect.top,
        left: props.rect.left,
        width: props.rect.width,
        height: props.rect.height,
        pointerEvents: "auto",
      }}
    />
  );
}

beforeEach(() => {
  latest = undefined;
});

const contentOf = (mounted: Mounted): unknown =>
  mounted.editor.getBlock(mounted.blockId)?.props["content"];

describe("the Tiptap Text Engine", () => {
  it("mounts inside the Canvas iframe, seeded with the stored text", async () => {
    const mounted = await mountEditor("Hello <strong>world</strong>");

    expect(mounted.editable.ownerDocument).toBe(mounted.frameDocument);
    expect(mounted.editable.textContent).toBe("Hello world");
    expect(mounted.editable.querySelector("strong")).not.toBeNull();
    // Mounted onto the Block's own markup rather than into a wrapper, so the
    // Canvas still shows the email the Author is building.
    expect(mounted.editable.closest("p")).not.toBeNull();
  });

  it("puts the toolbar's rectangle over the selected range, in parent coordinates", async () => {
    const mounted = await mountEditor("Hello world", { textToolbar: Toolbar });
    selectFromStart(mounted, 5);

    const toolbar = await vi.waitFor(() => {
      const element = mounted.host.querySelector(
        "[data-testid='text-toolbar']",
      );
      if (!element) throw new Error("No toolbar yet.");
      return element;
    });

    await vi.waitFor(() => {
      const drawn = toolbar.getBoundingClientRect();
      const range = mounted.frameDocument
        .getSelection()
        ?.getRangeAt(0)
        .getBoundingClientRect();
      const frame = mounted.frame.getBoundingClientRect();
      if (!range) throw new Error("The selection went away.");

      // Measured inside the frame, drawn outside it: the two only line up if
      // the translation happened (ADR-0003).
      expect(drawn.left).toBeCloseTo(frame.left + range.left, 0);
      expect(drawn.top).toBeCloseTo(frame.top + range.top, 0);
      expect(drawn.width).toBeCloseTo(range.width, 0);
    });
  });

  it("reports the formatting the selection already carries", async () => {
    const mounted = await mountEditor("<strong>Hello</strong> world", {
      textToolbar: Toolbar,
    });
    selectFromStart(mounted, 3);

    await vi.waitFor(() => {
      expect(latest?.formatting.bold).toBe(true);
      expect(latest?.formatting.italic).toBe(false);
      expect(latest?.formatting.link).toBeUndefined();
    });
  });

  it("stores the formatting a toolbar applies to the selection", async () => {
    const mounted = await mountEditor("Hello world", { textToolbar: Toolbar });
    selectFromStart(mounted, 5);

    await vi.waitFor(() => {
      if (!latest) throw new Error("No toolbar yet.");
    });
    latest?.commands.toggleBold();

    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<strong>Hello</strong> world");
    });
  });

  it("stores a link a toolbar applies, and takes it away again", async () => {
    const mounted = await mountEditor("Hello world", { textToolbar: Toolbar });
    selectFromStart(mounted, 5);

    await vi.waitFor(() => {
      if (!latest) throw new Error("No toolbar yet.");
    });
    latest?.commands.setLink("https://example.com");

    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe(
        '<a href="https://example.com">Hello</a> world',
      );
    });

    latest?.commands.setLink(undefined);
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("Hello world");
    });
  });

  it("draws its links in the color the Block writes on them", async () => {
    const mounted = await mountEditor(
      'Read <a href="https://example.com">this</a>.',
    );
    const link = (): HTMLAnchorElement | null =>
      mounted.editable.querySelector("a");

    await vi.waitFor(() => {
      expect(getComputedStyle(link() ?? mounted.editable).color).toBe(
        "rgb(255, 102, 0)",
      );
    });

    // An Author changing the email's link colour while the text is mounted.
    mounted.editor.setProp(mounted.blockId, "linkColor", "#00aa00");
    await vi.waitFor(() => {
      expect(getComputedStyle(link() ?? mounted.editable).color).toBe(
        "rgb(0, 170, 0)",
      );
    });

    // The colour is the Block's to write, never part of the stored text.
    typeAtEnd(mounted, "!");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe(
        'Read <a href="https://example.com">this</a>.!',
      );
    });
  });

  it("reverts the last thing that happened, not the last thing typed", async () => {
    const mounted = await mountEditor("Hello world", { textToolbar: Toolbar });
    selectFromStart(mounted, 5);

    await vi.waitFor(() => {
      if (!latest) throw new Error("No toolbar yet.");
    });
    latest?.commands.toggleBold();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<strong>Hello</strong> world");
    });

    // A document action after the text edit. Undo must take this back first,
    // even though focus is still inside the Block (ADR-0005).
    mounted.editor.setProp(mounted.blockId, "fontSize", 32);
    mounted.editable.focus();

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(mounted.editor.getBlock(mounted.blockId)?.props["fontSize"]).toBe(
        undefined,
      );
      expect(contentOf(mounted)).toBe("<strong>Hello</strong> world");
    });

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("Hello world");
    });
  });

  it("gives typing that follows an undo an undo entry of its own", async () => {
    // A pause is what ends a chunk of typing, so the test pauses. Shortened
    // from the usual half second only so the test is not spent waiting.
    const mounted = await mountEditor("Hello", {}, { newGroupDelay: 10 });

    await typeChunk(mounted, "A", "HelloA");
    await typeChunk(mounted, "B", "HelloAB");

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("HelloA");
    });

    // The engine's history is one entry shallower than it was. Typing now
    // starts an entry in both stacks, and they only stay the same depth if the
    // adapter noticed that the undo it was driven through moved the history.
    await typeChunk(mounted, "C", "HelloAC");

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("HelloA");
    });

    // The entry that proves it: a document stack one short of the engine's
    // runs out first and starts undoing the Block itself with typing still
    // left to take back.
    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("Hello");
    });
    expect(mounted.editor.getBlock(mounted.blockId)).toBeDefined();
  });

  it("offers the toolbar for a caret inside a link, so it can be corrected", async () => {
    const mounted = await mountEditor(
      '<a href="https://example.com">Hello</a> world',
      { textToolbar: Toolbar },
    );
    placeCaret(mounted, 2);

    await vi.waitFor(() => {
      expect(latest?.formatting.link).toBe("https://example.com");
    });

    // Correcting a link is done with the cursor in it, not by re-selecting
    // the words first.
    latest?.commands.setLink(undefined);
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("Hello world");
    });
  });

  it("takes the caret on a double-click, over the word that was pressed", async () => {
    const mounted = await mountEditor("Hello world");
    // Back out of the edit `mountEditor` arranged, so the gesture itself is
    // what puts the Author back in.
    mounted.editor.edit(undefined);
    await vi.waitFor(() => {
      expect(mounted.editable.isContentEditable).toBe(false);
    });

    const word = mounted.editable.getBoundingClientRect();
    const frame = mounted.frame.getBoundingClientRect();
    await doubleClickPointer({
      // Well inside the first word, whatever the font measures.
      x: frame.left + word.left + 8,
      y: frame.top + word.top + word.height / 2,
    });

    await vi.waitFor(() => {
      expect(mounted.editor.getEditing()).toBe(mounted.blockId);
      expect(mounted.editable.isContentEditable).toBe(true);
    });

    // The word the browser selected is the word the engine now holds, so the
    // next keystroke replaces it rather than landing somewhere else.
    await vi.waitFor(() => {
      expect(mounted.frameDocument.getSelection()?.toString()).toBe("Hello");
    });
    mounted.frameDocument.execCommand("insertText", false, "Goodbye");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("Goodbye world");
    });
  });

  it("leaves Backspace to the Author rather than deleting the Block", async () => {
    const mounted = await mountEditor("Hello world");
    // Selected as well as focused: without the selection the command would be
    // refused anyway, and the test would prove nothing.
    mounted.editor.select(mounted.blockId);
    mounted.editable.focus();

    press(mounted.editable, "Backspace");

    await vi.waitFor(() => {
      expect(mounted.editor.getBlock(mounted.blockId)).toBeDefined();
    });
  });
});

/** Suggest a reword of the Block and accept it. */
function acceptReword(mounted: Mounted, value: string): void {
  const suggestion = mounted.editor.suggest([
    { kind: "set-prop", blockId: mounted.blockId, prop: "content", value },
  ]);
  if (suggestion.status === "refused") throw new Error("Refused.");
  expect(suggestion.accept()).toBe("accepted");
}

// ADR-0037: a Suggestion's text reaches the surface, and undo keeps working.
describe("the Tiptap Text Engine, taking text from outside", () => {
  it("shows accepted text in the surface it already has", async () => {
    const mounted = await mountEditor("Hello world");

    acceptReword(mounted, "Hi <em>there</em>");

    expect(mounted.editable.innerHTML).toBe("Hi <em>there</em>");
    expect(mounted.editable.isConnected).toBe(true);
    expect(contentOf(mounted)).toBe("Hi <em>there</em>");
  });

  it("undoes the reword, then the Author's earlier typing, and redoes both", async () => {
    // The default half second, so typing either side of the accept would
    // fold into it unless the engine keeps it apart.
    const mounted = await mountEditor("Hello");
    typeAtEnd(mounted, " world");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("Hello world");
    });

    acceptReword(mounted, "Goodbye");
    expect(mounted.editable.textContent).toBe("Goodbye");

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(mounted.editable.textContent).toBe("Hello world");
    });
    expect(contentOf(mounted)).toBe("Hello world");

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(mounted.editable.textContent).toBe("Hello");
    });
    expect(contentOf(mounted)).toBe("Hello");

    mounted.editor.redo();
    expect(mounted.editable.textContent).toBe("Hello world");
    mounted.editor.redo();
    expect(mounted.editable.textContent).toBe("Goodbye");
    expect(contentOf(mounted)).toBe("Goodbye");
  });

  it("shows accepted paragraphs in text that holds them, and undoes them", async () => {
    const mounted = await mountEditor("<p>One</p>", {}, {}, "copy");

    acceptReword(mounted, "<p>Two</p><p>Three</p>");

    expect(mounted.editable.querySelectorAll("p")).toHaveLength(2);
    expect(mounted.editable.textContent).toBe("TwoThree");
    expect(contentOf(mounted)).toBe("<p>Two</p><p>Three</p>");

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(mounted.editable.textContent).toBe("One");
    });
    expect(contentOf(mounted)).toBe("<p>One</p>");
  });

  it("gives typing straight after the reword an undo entry of its own", async () => {
    const mounted = await mountEditor("Hello");

    acceptReword(mounted, "Hi");
    typeAtEnd(mounted, " you");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("Hi you");
    });

    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(mounted.editable.textContent).toBe("Hi");
    });
    press(mounted.editable, "z", true);
    await vi.waitFor(() => {
      expect(mounted.editable.textContent).toBe("Hello");
    });
    expect(mounted.editor.getBlock(mounted.blockId)).toBeDefined();
  });
});

// ADR-0023: text that holds paragraphs.
describe("the Tiptap Text Engine, in text that holds paragraphs", () => {
  it("starts a paragraph on Return and breaks the line on Shift+Return", async () => {
    const mounted = await mountEditor("<p>One</p>", {}, {}, "copy");

    caretAtEnd(mounted);
    press(mounted.editable, "Enter");
    typeHere(mounted, "Two");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<p>One</p><p>Two</p>");
    });

    press(mounted.editable, "Enter", false, true);
    typeHere(mounted, "Three");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<p>One</p><p>Two<br />Three</p>");
    });
  });

  it("breaks the line on Return in text that holds no paragraphs", async () => {
    const mounted = await mountEditor("One");

    caretAtEnd(mounted);
    press(mounted.editable, "Enter");
    typeHere(mounted, "Two");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("One<br />Two");
    });
  });

  it("keeps pasted paragraphs apart, and joins them where there are none", async () => {
    const copy = await mountEditor("", {}, {}, "copy");
    copy.editable.focus();
    paste(copy, "<p>a</p><p>b</p>");
    await vi.waitFor(() => {
      expect(contentOf(copy)).toBe("<p>a</p><p>b</p>");
    });

    const line = await mountEditor("");
    line.editable.focus();
    paste(line, "<p>a</p><p>b</p>");
    await vi.waitFor(() => {
      expect(contentOf(line)).toBe("a<br />b");
    });
  });

  it("spaces the paragraphs as the email does, and follows the spacing", async () => {
    const mounted = await mountEditor("<p>One</p><p>Two</p>", {}, {}, "copy");
    const gaps = (): string[] =>
      [...mounted.editable.querySelectorAll("p")].map(
        (paragraph) => getComputedStyle(paragraph).marginBottom,
      );

    await vi.waitFor(() => {
      expect(gaps()).toEqual(["12px", "0px"]);
      expect(mounted.editable.querySelector("p")?.className).toBe("para");
    });

    mounted.editor.setProp(mounted.blockId, "spacing", 30);
    await vi.waitFor(() => {
      expect(gaps()).toEqual(["30px", "0px"]);
    });
  });

  it("shows what is stored once the Author leaves the text", async () => {
    const mounted = await mountEditor("<p>One</p>", {}, {}, "copy");

    caretAtEnd(mounted);
    press(mounted.editable, "Enter");
    press(mounted.editable, "Enter");
    typeHere(mounted, "Two");
    // The empty paragraphs are there while typing, and never stored.
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<p>One</p><p>Two</p>");
    });
    press(mounted.editable, "Enter");
    await vi.waitFor(() => {
      expect(mounted.editable.querySelectorAll("p")).toHaveLength(4);
    });

    mounted.editor.edit(undefined);
    await vi.waitFor(() => {
      expect(
        [...mounted.editable.querySelectorAll("p")].map((p) => p.textContent),
      ).toEqual(["One", "Two"]);
    });
    expect(contentOf(mounted)).toBe("<p>One</p><p>Two</p>");
  });
});

/**
 * Let one keystroke land before the next, as an Author's do. Calls made back
 * to back are read as one change, and an input rule never sees `- ` alone.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

// ADR-0029: text that holds lists.
describe("the Tiptap Text Engine, in text that holds lists", () => {
  it("starts a bullet list on a dash, and a new item on Return", async () => {
    const mounted = await mountEditor("<p>Intro</p>", {}, {}, "list");

    caretAtEnd(mounted);
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    typeHere(mounted, "- ");
    await settle();
    typeHere(mounted, "One");
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    typeHere(mounted, "Two");
    await settle();
    press(mounted.editable, "Enter", false, true);
    await settle();
    typeHere(mounted, "more");
    await settle();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe(
        "<p>Intro</p><ul><li>One</li><li>Two<br />more</li></ul>",
      );
    });
  });

  it("starts a bullet list on an asterisk and a numbered one on 1.", async () => {
    const mounted = await mountEditor("", {}, {}, "list");

    mounted.editable.focus();
    await settle();
    typeHere(mounted, "* ");
    await settle();
    typeHere(mounted, "a");
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    typeHere(mounted, "1. ");
    await settle();
    typeHere(mounted, "b");
    await settle();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
    });
  });

  it("leaves the list on Return in an empty item", async () => {
    const mounted = await mountEditor("<ul><li>One</li></ul>", {}, {}, "list");

    caretAtEnd(mounted);
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    typeHere(mounted, "After");
    await settle();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<ul><li>One</li></ul><p>After</p>");
    });
  });

  it("turns the first item into a paragraph on Backspace at its start", async () => {
    const mounted = await mountEditor("<p>Intro</p>", {}, {}, "list");

    caretAtEnd(mounted);
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    typeHere(mounted, "- ");
    await vi.waitFor(() => {
      expect(mounted.editable.querySelector("li")).not.toBeNull();
    });
    press(mounted.editable, "Backspace");
    await settle();
    typeHere(mounted, "One");
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<p>Intro</p><p>One</p>");
    });
  });

  it("does not nest an item on Tab", async () => {
    const mounted = await mountEditor(
      "<ul><li>One</li><li>Two</li></ul>",
      {},
      {},
      "list",
    );

    caretAtEnd(mounted);
    await settle();
    press(mounted.editable, "Tab");
    await settle();
    typeHere(mounted, "!");
    await settle();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<ul><li>One</li><li>Two!</li></ul>");
    });
  });

  it("offers the list toggles with only a caret, and stores what they do", async () => {
    const mounted = await mountEditor(
      "<p>One</p>",
      { textToolbar: Toolbar },
      {},
      "list",
    );

    placeCaret(mounted, 1);
    await settle();
    await vi.waitFor(() => {
      expect(latest?.formatting.list).toBeUndefined();
      expect(latest?.commands.toggleBulletList).toBeTypeOf("function");
    });

    latest?.commands.toggleBulletList();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<ul><li>One</li></ul>");
      expect(latest?.formatting.list).toBe("bullet");
    });

    latest?.commands.toggleNumberedList();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<ol><li>One</li></ol>");
      expect(latest?.formatting.list).toBe("numbered");
    });

    latest?.commands.toggleNumberedList();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<p>One</p>");
      expect(latest?.formatting.list).toBeUndefined();
    });
  });

  it("offers no toolbar for a caret in text that does not hold lists", async () => {
    const mounted = await mountEditor(
      "<p>One</p>",
      { textToolbar: Toolbar },
      {},
      "copy",
    );

    placeCaret(mounted, 1);
    await settle();
    await settle();
    expect(latest).toBeUndefined();
  });

  it("keeps lists as paragraphs in text that does not hold them", async () => {
    const mounted = await mountEditor("<p>One</p>", {}, {}, "copy");

    caretAtEnd(mounted);
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    typeHere(mounted, "- ");
    await settle();
    typeHere(mounted, "Two");
    await settle();
    await vi.waitFor(() => {
      expect(contentOf(mounted)).toBe("<p>One</p><p>- Two</p>");
    });
  });

  it("indents and spaces the lists as the email does", async () => {
    const mounted = await mountEditor(
      "<ul><li>One</li><li>Two</li></ul><p>After</p>",
      {},
      {},
      "list",
    );
    const list = (): HTMLElement | null => mounted.editable.querySelector("ul");
    const gaps = (): string[] =>
      [...mounted.editable.querySelectorAll("li")].map(
        (item) => getComputedStyle(item).marginBottom,
      );

    await vi.waitFor(() => {
      const style = getComputedStyle(list() ?? mounted.editable);
      expect(style.marginLeft).toBe("30px");
      expect(style.paddingLeft).toBe("0px");
      expect(style.marginBottom).toBe("12px");
      expect(gaps()).toEqual(["6px", "0px"]);
    });

    mounted.editor.setProp(mounted.blockId, "itemSpacing", 20);
    await vi.waitFor(() => {
      expect(gaps()).toEqual(["20px", "0px"]);
    });
  });

  it("drops empty items once the Author leaves the text", async () => {
    const mounted = await mountEditor("<ul><li>One</li></ul>", {}, {}, "list");

    caretAtEnd(mounted);
    await settle();
    press(mounted.editable, "Enter");
    await settle();
    await vi.waitFor(() => {
      expect(mounted.editable.querySelectorAll("li")).toHaveLength(2);
    });

    mounted.editor.edit(undefined);
    await vi.waitFor(() => {
      expect(mounted.editable.querySelectorAll("li")).toHaveLength(1);
    });
    expect(contentOf(mounted)).toBe("<ul><li>One</li></ul>");
  });
});

/** A keystroke aimed at an element inside the frame, the way an Author makes one. */
function press(
  element: HTMLElement,
  key: string,
  mod = false,
  shift = false,
): void {
  const view = element.ownerDocument.defaultView ?? window;
  // The editor's own platform check: ⌘ on Apple, Ctrl everywhere else.
  const apple = /mac|iphone|ipad|ipod/iu.test(view.navigator.platform);
  element.dispatchEvent(
    new view.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      metaKey: mod && apple,
      ctrlKey: mod && !apple,
      shiftKey: shift,
    }),
  );
}
