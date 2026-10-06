import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider } from "../canvas";
import type {
  BlockChromeProps,
  CanvasSlots,
  SuggestionChromeProps,
} from "../canvas";
import {
  createEditor,
  defineBlock,
  type BlockDefinition,
  type Edit,
  type Editor,
  type Suggestion,
} from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { sequentialIds } from "../testing/blocks";
import {
  blockElement,
  centreOfBlock,
  doubleClickPointer,
  dragPointer,
  mount,
  pathBetween,
  pointOnBlock,
  whenRendered,
  type MountedCanvas,
} from "../testing/browser";
import { createTiptapTextEngine } from "../tiptap";

/**
 * The `suggestion` Slot, and the Canvas drawing the Document plus every open
 * Suggestion (ADR-0035).
 *
 * Assertions are on what is on screen: which Blocks the frame draws, where,
 * and where the Slot's own elements land.
 */

const BLOCK_HEIGHT = 60;

const definitions: readonly BlockDefinition[] = [
  defineBlock<Record<string, never>>({
    type: "email",
    label: "Email",
    accepts: ["stack", "text"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock<Record<string, never>>({
    type: "stack",
    label: "Stack",
    accepts: ["text"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock<{ content: string }>({
    type: "text",
    label: "Text",
    schema: {
      content: { kind: "text", label: "Content", defaultValue: "Text" },
    },
    render: ({ props }) => (
      <p
        style={{
          margin: 0,
          height: BLOCK_HEIGHT,
          lineHeight: `${String(BLOCK_HEIGHT)}px`,
        }}
      >
        {props.content}
      </p>
    ),
  }),
];

const textBlock = (id: string) => ({
  id,
  type: "text",
  props: { content: id.toUpperCase() },
});

/** An email of text Blocks `a`, `b`, `c` and `d`, and a Stack `s` holding `e`. */
function editorOf(): Editor {
  return createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds("added"),
    document: {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          textBlock("a"),
          textBlock("b"),
          textBlock("c"),
          textBlock("d"),
          { id: "s", type: "stack", props: {}, children: [textBlock("e")] },
        ],
      },
    },
  });
}

function suggest(editor: Editor, ...edits: Edit[]): Suggestion {
  const suggestion = editor.suggest(edits);
  if (!("id" in suggestion)) throw new Error("The Suggestion was refused.");
  return suggestion;
}

/**
 * Draws each Suggestion as a box per touched Block, marked with the Block, how
 * it was touched and the Suggestion's status, so a test can find them.
 */
function SuggestionMarks({
  suggestion,
  blocks,
}: SuggestionChromeProps): ReactNode {
  return (
    <div data-suggestion={suggestion.id} data-status={suggestion.status}>
      {blocks.map(({ block, change, props, rect }) => (
        <div
          key={block.id}
          data-touched={block.id}
          data-change={change}
          data-props={props.join(" ")}
          style={{
            position: "absolute",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
  );
}

function SelectionOutline({ rect }: BlockChromeProps): ReactNode {
  return (
    <div
      data-testid="selection"
      style={{ position: "absolute", top: rect.top, left: rect.left }}
    />
  );
}

function HoverOutline({ block }: BlockChromeProps): ReactNode {
  return <div data-testid="hover" data-block={block.id} />;
}

const MARKS: CanvasSlots = { suggestion: SuggestionMarks };

async function mountWith(
  editor: Editor,
  slots: CanvasSlots = MARKS,
): Promise<{ readonly host: HTMLElement; readonly mounted: MountedCanvas }> {
  const host = mount(
    <EditorProvider editor={editor}>
      <Canvas slots={slots} />
    </EditorProvider>,
  );
  const mounted = await whenRendered(host);
  return { host, mounted };
}

/** The ids of a parent's Blocks, in the order the frame draws them. */
function drawnOrder(mounted: MountedCanvas, parentId: string): string[] {
  const parent = blockElement(mounted, parentId);
  return [
    ...parent.querySelectorAll<HTMLElement>(":scope > [data-block-id]"),
  ].map((child) => child.dataset.blockId ?? "");
}

const marksOf = (host: HTMLElement, suggestionId: string) =>
  host.querySelector<HTMLElement>(`[data-suggestion="${suggestionId}"]`);

function markFor(
  host: HTMLElement,
  suggestionId: string,
  blockId: string,
): HTMLElement {
  const mark = marksOf(host, suggestionId)?.querySelector<HTMLElement>(
    `[data-touched="${blockId}"]`,
  );
  if (!mark) throw new Error(`No mark for Block ${blockId}.`);
  return mark;
}

/** That a Slot's box sits exactly over the Block the frame drew. */
function expectOver(
  mark: Element,
  mounted: MountedCanvas,
  blockId: string,
): void {
  const chrome = mark.getBoundingClientRect();
  const block = blockElement(mounted, blockId).getBoundingClientRect();
  const frame = mounted.frame.getBoundingClientRect();
  expect(chrome.left).toBeCloseTo(frame.left + block.left, 0);
  expect(chrome.top).toBeCloseTo(frame.top + block.top, 0);
  expect(chrome.width).toBeCloseTo(block.width, 0);
  expect(chrome.height).toBeCloseTo(block.height, 0);
}

describe("an open Suggestion on the Canvas", () => {
  it("draws an inserted Block in place, taking room", async () => {
    const editor = editorOf();
    const { mounted } = await mountWith(editor);
    const before = blockElement(mounted, "b").getBoundingClientRect().top;

    suggest(editor, {
      kind: "insert",
      type: "text",
      id: "new",
      after: "a",
      props: { content: "Suggested" },
    });

    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toEqual([
        "a",
        "new",
        "b",
        "c",
        "d",
        "s",
      ]);
      expect(blockElement(mounted, "new").textContent).toBe("Suggested");
      expect(blockElement(mounted, "b").getBoundingClientRect().top).toBe(
        before + BLOCK_HEIGHT,
      );
    });
    // Drawn, not stored.
    expect(editor.getBlock("new")).toBeUndefined();
  });

  it("still draws a removed Block, where it was, until accepted", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor);

    const suggestion = suggest(
      editor,
      { kind: "remove", blockId: "b" },
      { kind: "remove", blockId: "e" },
    );

    await vi.waitFor(() => {
      expectOver(markFor(host, suggestion.id, "b"), mounted, "b");
      expectOver(markFor(host, suggestion.id, "e"), mounted, "e");
    });
    expect(drawnOrder(mounted, "root")).toEqual(["a", "b", "c", "d", "s"]);
    expect(drawnOrder(mounted, "s")).toEqual(["e"]);

    suggestion.accept();

    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toEqual(["a", "c", "d", "s"]);
      expect(drawnOrder(mounted, "s")).toEqual([]);
      expect(marksOf(host, suggestion.id)).toBeNull();
    });
  });

  it("gives the Slot the Suggestion and a rectangle for each Block it touches", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor);

    const suggestion = suggest(
      editor,
      { kind: "insert", type: "text", id: "new", after: "a" },
      { kind: "remove", blockId: "b" },
      { kind: "move", blockId: "d", parent: "s" },
      { kind: "set-prop", blockId: "c", prop: "content", value: "Changed" },
    );

    await vi.waitFor(() => {
      const marks = marksOf(host, suggestion.id);
      expect(marks?.dataset.status).toBe("open");
      const changes: Record<string, string | undefined> = {};
      for (const mark of marks?.querySelectorAll<HTMLElement>(
        "[data-touched]",
      ) ?? []) {
        changes[mark.dataset.touched ?? ""] = mark.dataset.change;
      }
      expect(changes).toEqual({
        new: "insert",
        b: "remove",
        d: "move",
        c: "set",
      });
      expect(markFor(host, suggestion.id, "c").dataset.props).toBe("content");
      // Each where the frame draws it: the moved one in its new place.
      expect(drawnOrder(mounted, "s")).toEqual(["e", "d"]);
      for (const blockId of ["new", "b", "c", "d"]) {
        expectOver(markFor(host, suggestion.id, blockId), mounted, blockId);
      }
    });
    expect(blockElement(mounted, "c").textContent).toBe("Changed");
  });

  it("draws one Slot for each open Suggestion", async () => {
    const editor = editorOf();
    const { host } = await mountWith(editor);

    const first = suggest(editor, {
      kind: "set-prop",
      blockId: "a",
      prop: "content",
      value: "One",
    });
    const second = suggest(editor, {
      kind: "set-prop",
      blockId: "d",
      prop: "content",
      value: "Two",
    });

    await vi.waitFor(() => {
      expect(host.querySelectorAll("[data-suggestion]")).toHaveLength(2);
      expect(markFor(host, first.id, "a")).toBeTruthy();
      expect(markFor(host, second.id, "d")).toBeTruthy();
    });
  });

  it("stays drawn as the selection moves, over Blocks neither selected nor hovered", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor, {
      suggestion: SuggestionMarks,
      selection: SelectionOutline,
    });
    const suggestion = suggest(editor, {
      kind: "set-prop",
      blockId: "b",
      prop: "content",
      value: "Changed",
    });

    for (const selected of ["a", "c", undefined]) {
      editor.select(selected);
      await vi.waitFor(() => {
        expectOver(markFor(host, suggestion.id, "b"), mounted, "b");
      });
    }
  });

  it("draws nothing extra when the Slot is left out", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor, {});

    suggest(
      editor,
      { kind: "insert", type: "text", id: "new", after: "a" },
      { kind: "remove", blockId: "b" },
    );

    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toContain("new");
    });
    // The frame, and the empty layer Chrome is drawn into.
    const layer = mounted.frame.nextElementSibling;
    expect(layer?.childElementCount).toBe(0);
    expect(host.querySelectorAll("[data-suggestion]")).toHaveLength(0);
  });

  it("takes the Slot away on reject, and the inserted Block with it", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor);
    const suggestion = suggest(editor, {
      kind: "insert",
      type: "text",
      id: "new",
      after: "a",
    });
    await vi.waitFor(() => {
      expect(marksOf(host, suggestion.id)).not.toBeNull();
    });

    suggestion.reject();

    await vi.waitFor(() => {
      expect(marksOf(host, suggestion.id)).toBeNull();
      expect(drawnOrder(mounted, "root")).toEqual(["a", "b", "c", "d", "s"]);
    });
  });

  it("takes the Slot away on accept, leaving the Blocks it wrote", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor);
    const suggestion = suggest(editor, {
      kind: "insert",
      type: "text",
      id: "new",
      after: "a",
    });
    await vi.waitFor(() => {
      expect(marksOf(host, suggestion.id)).not.toBeNull();
    });

    expect(suggestion.accept()).toBe("accepted");

    await vi.waitFor(() => {
      expect(marksOf(host, suggestion.id)).toBeNull();
      expect(drawnOrder(mounted, "root")).toEqual([
        "a",
        "new",
        "b",
        "c",
        "d",
        "s",
      ]);
    });
  });

  it("draws it again as stale, without what it would insert", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor);
    const suggestion = suggest(
      editor,
      { kind: "insert", type: "text", id: "new", after: "a" },
      { kind: "set-prop", blockId: "c", prop: "content", value: "Theirs" },
    );
    await vi.waitFor(() => {
      expect(marksOf(host, suggestion.id)?.dataset.status).toBe("open");
    });

    editor.setProp("c", "content", "Mine");

    await vi.waitFor(() => {
      expect(marksOf(host, suggestion.id)?.dataset.status).toBe("stale");
      expect(drawnOrder(mounted, "root")).not.toContain("new");
      expect(blockElement(mounted, "c").textContent).toBe("Mine");
      expectOver(markFor(host, suggestion.id, "c"), mounted, "c");
    });
    expect(
      marksOf(host, suggestion.id)?.querySelector('[data-touched="new"]'),
    ).toBeNull();
  });

  it("grows as a streaming Suggestion grows", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor);
    const suggestion = editor.suggest([], { streaming: true });
    if (!("id" in suggestion)) throw new Error("The Suggestion was refused.");

    await vi.waitFor(() => {
      expect(marksOf(host, suggestion.id)?.dataset.status).toBe("streaming");
    });

    suggestion.extend([
      { kind: "insert", type: "text", id: "new", parent: "s" },
    ]);

    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "s")).toEqual(["e", "new"]);
      expectOver(markFor(host, suggestion.id, "new"), mounted, "new");
    });
  });
});

describe("the Canvas with a Suggestion open", () => {
  it("still selects and hovers with the pointer", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor, {
      suggestion: SuggestionMarks,
      hover: HoverOutline,
    });
    suggest(editor, { kind: "insert", type: "text", id: "new", after: "a" });
    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toContain("new");
    });

    await dragPointer([
      centreOfBlock(mounted, "c"),
      centreOfBlock(mounted, "c"),
    ]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("c");
    });

    await dragPointer([
      centreOfBlock(mounted, "d"),
      centreOfBlock(mounted, "d"),
    ]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("d");
    });
    // Hover follows the pointer: over `d`, which is selected, so none.
    expect(host.querySelector("[data-testid='hover']")).toBeNull();
  });

  it("selects a Block it removes, which is still stored, and not one it inserts", async () => {
    const editor = editorOf();
    const { mounted } = await mountWith(editor);
    suggest(
      editor,
      { kind: "insert", type: "text", id: "new", after: "a" },
      { kind: "remove", blockId: "b" },
    );
    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toContain("new");
    });

    await dragPointer([
      centreOfBlock(mounted, "b"),
      centreOfBlock(mounted, "b"),
    ]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBe("b");
    });

    // Not in the Document yet, so there is nothing to select.
    await dragPointer([
      centreOfBlock(mounted, "new"),
      centreOfBlock(mounted, "new"),
    ]);
    await vi.waitFor(() => {
      expect(editor.getSelection()).toBeUndefined();
    });
  });

  it("still moves a Block by dragging, and the Suggestion stays open", async () => {
    const editor = editorOf();
    const { host, mounted } = await mountWith(editor);
    const suggestion = suggest(editor, {
      kind: "insert",
      type: "text",
      id: "new",
      after: "a",
    });
    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toContain("new");
    });

    await dragPointer(
      pathBetween(centreOfBlock(mounted, "c"), pointOnBlock(mounted, "d", 0.8)),
    );

    await vi.waitFor(() => {
      expect(
        (editor.getDocument().root.children ?? []).map((block) => block.id),
      ).toEqual(["a", "b", "d", "c", "s"]);
      expect(drawnOrder(mounted, "root")).toEqual([
        "a",
        "new",
        "b",
        "d",
        "c",
        "s",
      ]);
    });
    expect(marksOf(host, suggestion.id)?.dataset.status).toBe("open");
  });

  it("still lets the Author into a Block's words", async () => {
    const text = createTiptapTextEngine();
    const editor = createEditor({
      definitions: createReactEmailPreset({ contentWidth: 600 }),
      rootType: REACT_EMAIL_ROOT_TYPE,
      createId: sequentialIds("added"),
      textEngine: text,
      document: {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: { contentWidth: 600 },
          children: [
            {
              id: "section",
              type: "section",
              props: { paddingY: 16, paddingX: 24 },
              children: [
                {
                  id: "paragraph",
                  type: "text",
                  props: { content: "Type a word.", fontSize: 15 },
                },
              ],
            },
          ],
        },
      },
    });
    const host = mount(
      <EditorProvider editor={editor} editableText={text.EditableText}>
        <Canvas slots={{ suggestion: SuggestionMarks }} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const suggestion = suggest(editor, {
      kind: "insert",
      type: "text",
      id: "new",
      before: "paragraph",
      props: { content: "Suggested words." },
    });
    await vi.waitFor(() => {
      expectOver(markFor(host, suggestion.id, "new"), mounted, "new");
      if (!blockElement(mounted, "paragraph").querySelector(".ProseMirror")) {
        throw new Error("The Text Engine has not mounted yet.");
      }
    });

    await doubleClickPointer(centreOfBlock(mounted, "paragraph"));

    await vi.waitFor(() => {
      expect(editor.getEditing()).toBe("paragraph");
    });
    expect(marksOf(host, suggestion.id)?.dataset.status).toBe("open");
  });
});

describe("the Canvas holding a Suggestion back", () => {
  /**
   * A Canvas whose `showOriginal` the test sets from outside, as an Author's
   * held button would.
   */
  async function mountHolding(editor: Editor) {
    let hold: ((id: string | undefined) => void) | undefined;
    function Holding(): ReactNode {
      const [held, setHeld] = useState<string | undefined>();
      hold = setHeld;
      return <Canvas slots={MARKS} showOriginal={held} />;
    }
    const host = mount(
      <EditorProvider editor={editor}>
        <Holding />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    return { host, mounted, hold: (id: string | undefined) => hold?.(id) };
  }

  it("draws the stored Document for that Suggestion, and the others as ever", async () => {
    const editor = editorOf();
    const { host, mounted, hold } = await mountHolding(editor);
    const inserting = suggest(editor, {
      kind: "insert",
      type: "text",
      id: "new",
      after: "a",
      props: { content: "Suggested" },
    });
    const setting = suggest(editor, {
      kind: "set-prop",
      blockId: "c",
      prop: "content",
      value: "Changed",
    });
    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toContain("new");
    });
    const stored = editor.getDocument();
    const changes = vi.fn();
    editor.subscribe(changes);
    const told = vi.fn();
    editor.subscribeToSuggestions(told);

    hold(inserting.id);

    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toEqual(["a", "b", "c", "d", "s"]);
      expect(marksOf(host, inserting.id)).toBeNull();
    });
    expect(blockElement(mounted, "c").textContent).toBe("Changed");
    expect(marksOf(host, setting.id)).not.toBeNull();
    // View only: nothing stored, nothing announced, both still open.
    expect(editor.getDocument()).toBe(stored);
    expect(changes).not.toHaveBeenCalled();
    expect(told).not.toHaveBeenCalled();
    expect(editor.getSuggestions().map((each) => each.status)).toEqual([
      "open",
      "open",
    ]);

    hold(setting.id);

    await vi.waitFor(() => {
      expect(blockElement(mounted, "c").textContent).toBe("C");
      expect(drawnOrder(mounted, "root")).toContain("new");
    });

    hold(undefined);

    await vi.waitFor(() => {
      expect(blockElement(mounted, "c").textContent).toBe("Changed");
      expect(marksOf(host, inserting.id)).not.toBeNull();
      expect(marksOf(host, setting.id)).not.toBeNull();
    });
  });

  it("draws everything for an id that is not open", async () => {
    const editor = editorOf();
    const { mounted, hold } = await mountHolding(editor);
    suggest(editor, { kind: "insert", type: "text", id: "new", after: "a" });

    hold("gone");

    await vi.waitFor(() => {
      expect(drawnOrder(mounted, "root")).toContain("new");
    });
  });
});
