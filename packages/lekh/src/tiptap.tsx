"use client";

/**
 * The Tiptap Text Engine — `lekh-editor/tiptap`.
 *
 * The shipped adapter for ADR-0005, behind its own entry point with Tiptap as
 * an *optional* peer dependency, the same shape as the react.email Preset
 * (ADR-0001). A Consumer who brings their own editor implements
 * {@link TextEngine} and {@link EditableText} and never installs any of this.
 *
 * Two halves of one object, because they have to agree: the core's
 * {@link TextEngine} owns history and knows nothing about React, and the
 * {@link EditableText} owns the contenteditable an Author points at.
 *
 * ```tsx
 * const text = createTiptapTextEngine();
 * const editor = createEditor({ definitions, rootType, textEngine: text });
 *
 * <EditorProvider editor={editor} editableText={text.EditableText}>
 *   <Canvas slots={{ textToolbar: MyToolbar }} />
 * </EditorProvider>
 * ```
 */

import {
  Editor as TiptapEditor,
  Extension,
  Node,
  wrappingInputRule,
} from "@tiptap/core";
import {
  closeHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
  history,
} from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { useEditor } from "./canvas/context";
import { rectOf, type Rect } from "./canvas/geometry";
import type {
  TextFormatting,
  TextSelection,
  EditableText,
  EditableTextProps,
} from "./canvas/text";
import type { TextEngine } from "./core/editor/text-engine";
import {
  sanitiseInlineMarkup,
  type ListKind,
  type TextShape,
} from "./core/markup/inline-markup";
import {
  listItemStyleAt,
  listStyleAt,
  paragraphStyleAt,
  type InlineMarkupOptions,
} from "./core/render/rich-text";

/** How the shipped engine behaves. Every option has a working default. */
export interface TiptapTextEngineOptions {
  /**
   * How long a pause ends a chunk of typing, in milliseconds. Undo removes one
   * chunk, so this is what decides whether ⌘Z takes back a word or a sentence.
   * Defaults to Tiptap's own 500.
   */
  readonly newGroupDelay?: number;
  /** How many undoable changes each Block keeps. Defaults to 100. */
  readonly depth?: number;
}

/**
 * A Text Engine and the editable text it renders.
 *
 * Pass the whole object to `createEditor` as `textEngine`, and
 * `EditableText` to `EditorProvider` as `editableText`.
 */
export interface TiptapTextEngine extends TextEngine {
  readonly EditableText: EditableText;
}

/**
 * Build a Text Engine backed by Tiptap.
 *
 * One per editor: the Blocks it holds histories for are that editor's, and
 * sharing an engine between two editors would let one undo the other's typing.
 */
export function createTiptapTextEngine(
  options: TiptapTextEngineOptions = {},
): TiptapTextEngine {
  /**
   * One Tiptap editor per Block, created by the surface when it mounts.
   *
   * Per Block rather than one for the whole email, because the interface the
   * store drives is scoped to a Block: it asks this engine to undo *in Block
   * X*, and a single shared editor would have no way to answer.
   */
  const instances = new Map<string, TiptapEditor>();

  /**
   * How deep each Block's Tiptap history was when the store last heard about
   * it.
   *
   * Comparing against it is how the adapter tells a change that started a new
   * history entry from one Tiptap folded into the entry it already had, which
   * is what the store needs in order to keep the two stacks the same depth.
   */
  const depths = new Map<string, number>();

  /**
   * What each Block's text may hold, as its surface was told on mounting.
   *
   * Kept because `getText` is asked by Block id alone, and the string it hands
   * back has to be the one the Document stores for that Block (ADR-0023).
   */
  const shapes = new Map<string, TextShape>();

  /**
   * True while the store is driving the engine.
   *
   * Undoing a marker makes Tiptap change its document, which would otherwise
   * come back through `onUpdate` as a fresh edit and push another marker onto
   * the stack we are in the middle of unwinding.
   */
  let driving = false;

  const drive = (blockId: string, act: (instance: TiptapEditor) => void) => {
    const instance = instances.get(blockId);
    if (!instance) return;
    driving = true;
    try {
      act(instance);
    } finally {
      driving = false;
      // Undoing moved the history, and the notification that would normally
      // record that was the one just suppressed. Left stale, the next thing an
      // Author typed would look like a continuation of a chunk that is no
      // longer there, and would get no undo entry at all.
      depths.set(blockId, undoDepth(instance.state));
    }
  };

  // Built once each and shared between Blocks: an extension is a description,
  // and every editor makes its own plugins from it.
  const lineExtensions = buildExtensions(options, "line");
  const paragraphExtensions = buildExtensions(options, "paragraphs");
  const listExtensions = buildExtensions(options, "lists");

  function EditableText({
    blockId,
    value,
    editable,
    onSelectionChange,
    linkColor,
    paragraphs = false,
    paragraphStyle,
    paragraphClassName,
    lists = false,
    listStyle,
    listItemStyle,
    listIndent,
    direction,
  }: EditableTextProps): ReactNode {
    const editor = useEditor();
    const host = useRef<HTMLElement | null>(null);
    // The stored text seeds the engine once. Re-seeding it on every change
    // would fight the Author: it would throw away the engine's history and
    // interrupt an input method mid-composition.
    const seed = useRef(value);
    // Read once, like the seed: the instance is built for one shape of text.
    const shape = useRef<TextShape>({
      paragraphs,
      lists: paragraphs && lists,
    });
    const report = useRef(onSelectionChange);
    report.current = onSelectionChange;

    useEffect(() => {
      const element = host.current;
      if (!element) return undefined;

      const publish = (instance: TiptapEditor): void => {
        report.current(
          describeSelection(blockId, instance, shape.current.lists === true),
        );
      };

      const instance = new TiptapEditor({
        // Mounted onto the element itself rather than appended inside it: a
        // wrapper `<div>` in the middle of a Block Definition's `<p>` is not
        // the email the Author is building.
        element: { mount: element },
        extensions:
          shape.current.lists === true
            ? listExtensions
            : shape.current.paragraphs === true
              ? paragraphExtensions
              : lineExtensions,
        content: seed.current,
        // Read-only until the Author asks for it. The effect below settles the
        // real answer in this same commit, so a Block mounting mid-edit — an
        // undo putting one back, say — comes up editable.
        editable: false,
        editorProps: {
          // Whatever a word processor put on the clipboard is reduced to the
          // supported subset before Tiptap's own parser ever sees it.
          transformPastedHTML: (html) =>
            sanitiseInlineMarkup(html, shape.current),
        },
        onCreate: ({ editor: current }) => {
          depths.set(blockId, undoDepth(current.state));
        },
        onUpdate: ({ editor: current }) => {
          if (driving) return;
          const now = undoDepth(current.state);
          // Tiptap folded this change into the history entry it already had,
          // so the document stack must not grow one of its own.
          const coalesce = now === depths.get(blockId);
          depths.set(blockId, now);
          editor.markTextEdit(blockId, { coalesce });
          publish(current);
        },
        onSelectionUpdate: ({ editor: current }) => {
          publish(current);
        },
        // Reported on focus rather than cleared on blur: a Consumer's toolbar
        // lives in the parent document, so clicking one of its buttons blurs
        // the Canvas and would take the toolbar away before the click landed.
        // Clicking into another Block reports that Block's own selection,
        // which is what actually closes the old toolbar.
        onFocus: ({ editor: current }) => {
          publish(current);
        },
      });

      instances.set(blockId, instance);
      shapes.set(blockId, shape.current);
      return () => {
        instances.delete(blockId);
        depths.delete(blockId);
        shapes.delete(blockId);
        report.current(undefined);
        instance.destroy();
      };
    }, [blockId, editor]);

    /**
     * Open and close the contenteditable as the Author enters and leaves.
     *
     * Declared after the effect that creates the instance, so on the commit a
     * surface mounts in, the instance this reaches for is already there.
     *
     * Focus is taken here rather than left to the press that asked for it: the
     * double-click landed on a surface that was not editable yet, so the
     * browser gave the element no caret of its own.
     */
    useEffect(() => {
      const instance = instances.get(blockId);
      const element = host.current;
      if (!instance || instance.isEditable === editable) return;
      instance.setEditable(editable);
      if (editable && element) enterText(instance, element);
      // The Author has left, so the empty paragraphs they were typing into are
      // gone from the Document. Taking them off the page too keeps the Canvas
      // showing what is stored (ADR-0023).
      if (!editable) drive(blockId, settleParagraphs);
    }, [blockId, editable]);

    /**
     * Draw the paragraphs and lists as the email does.
     *
     * A decoration rather than a node attribute, so a change of spacing never
     * reaches the text or its history. Keyed on the written-out CSS, because
     * the style objects are new ones on every render of the Block.
     */
    const look = [paragraphStyle, listStyle, listItemStyle]
      .map((style) => cssText(style ?? {}))
      .join("|");
    useEffect(() => {
      const instance = instances.get(blockId);
      if (!instance || shape.current.paragraphs !== true) return;
      const { tr } = instance.state;
      const next: ParagraphLook = {
        paragraphStyle,
        paragraphClassName,
        listStyle,
        listItemStyle,
        listIndent,
        direction,
      };
      instance.view.dispatch(
        tr.setMeta(PARAGRAPH_LOOK, next).setMeta("addToHistory", false),
      );
      // The style objects are read through `look`, their written-out form.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [blockId, look, paragraphClassName, listIndent, direction]);

    const Host = paragraphs ? "div" : "span";
    return (
      // The browser rings a focused `contenteditable`, and this one is inline:
      // the ring traces the text's line boxes, so a wrapped paragraph gets a
      // ragged second outline inside the one the Consumer draws through the
      // `selection` Slot. It says nothing that Slot has not already said, and
      // the frame is isolated (ADR-0003) — a Consumer's stylesheet cannot
      // reach in to remove a ring this adapter's own element brought with it.
      //
      // The link colour is a variable every link reads (see `LINK_COLOR`), so
      // a new one repaints the links without the engine re-rendering anything.
      // A `<div>` for paragraphs, since a `<p>` cannot sit inside a `<span>`.
      <Host
        ref={(element: HTMLElement | null) => {
          host.current = element;
        }}
        style={{ outline: "none", [LINK_COLOR]: linkColor } as CSSProperties}
      />
    );
  }

  return {
    EditableText,

    undo(blockId) {
      drive(blockId, (instance) => {
        undo(instance.state, instance.view.dispatch);
      });
    },

    redo(blockId) {
      drive(blockId, (instance) => {
        redo(instance.state, instance.view.dispatch);
      });
    },

    canUndo(blockId) {
      const instance = instances.get(blockId);
      return instance ? undoDepth(instance.state) > 0 : false;
    },

    canRedo(blockId) {
      const instance = instances.get(blockId);
      return instance ? redoDepth(instance.state) > 0 : false;
    },

    getText(blockId) {
      const instance = instances.get(blockId);
      // A Block whose surface is not mounted has no text to report, and the
      // Document keeps the last thing the engine said.
      return instance
        ? sanitiseInlineMarkup(instance.getHTML(), shapes.get(blockId))
        : undefined;
    },

    replaceText(blockId, text) {
      if (!instances.has(blockId)) return false;
      drive(blockId, (instance) => {
        // Its own entry on both sides: closed before, so it does not fold
        // into the Author's last chunk of typing, and after, so their next
        // chunk does not fold into it. Either would leave the engine one
        // entry short of the store.
        instance
          .chain()
          .command(({ tr }) => {
            closeHistory(tr);
            return true;
          })
          .setContent(text, { emitUpdate: false })
          .run();
        instance.view.dispatch(closeHistory(instance.state.tr));
      });
      return true;
    },
  };
}

/** The variable a surface's host sets to the colour its links are drawn in. */
const LINK_COLOR = "--lekh-link-color";

/**
 * The one thing a Block's text is: a line of formatted words.
 *
 * The document node holds inline content directly, with no paragraph inside
 * it. A Block *is* the paragraph — its Definition renders the element and owns
 * its typography as ordinary Schema props — so a second one nested in it would
 * be both invalid markup and a second place to set the same things.
 */
const InlineDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "inline*",
});

/**
 * Text that holds paragraphs: one or more, and nothing else at the top.
 *
 * Each paragraph holds the same inline content a line does. The Block still
 * renders the element around them and owns their typography, so the
 * paragraphs carry no attributes of their own (ADR-0023).
 */
const ParagraphDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "paragraph+",
});

/**
 * Text that holds lists as well: paragraphs and lists, one level deep. An item
 * holds one paragraph, so no list can sit inside one and Tab has nothing to
 * indent (ADR-0029).
 */
const ListDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(paragraph | bulletList | orderedList)+",
});

/**
 * One item of a list: a single paragraph.
 *
 * Return makes a new item, or leaves the list from an empty one. Backspace at
 * the start of the first item turns it into a paragraph. Tab is left alone.
 */
const ListItem = Node.create({
  name: "listItem",
  // Ahead of the core keymap, which would join the first item into nothing
  // rather than lift it.
  priority: 1000,
  content: "paragraph",
  defining: true,
  parseHTML: () => [{ tag: "li" }],
  renderHTML: () => ["li", 0],
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from } = this.editor.state.selection;
        if ($from.node(-1).type !== this.type) return false;
        // An item with nothing but breaks in it is empty: it is never stored.
        return isBlankParagraph($from.parent)
          ? this.editor.commands.liftListItem(this.name)
          : this.editor.commands.splitListItem(this.name);
      },
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.node(-1).type !== this.type || $from.index(-2) !== 0) {
          return false;
        }
        return this.editor.commands.liftListItem(this.name);
      },
    };
  },
});

/** A list whose items hold their own content, as `<ul>` or `<ol>`. */
function listNode(name: string, tag: "ul" | "ol", find: RegExp): Node {
  return Node.create({
    name,
    group: "block list",
    content: "listItem+",
    // Attributes such as `start` are not read: the stored form has none.
    parseHTML: () => [{ tag }],
    renderHTML: () => [tag, 0],
    addInputRules() {
      return [wrappingInputRule({ find, type: this.type })];
    },
  });
}

/** `- ` or `* ` at the start of a paragraph starts a bullet list. */
const BulletList = listNode("bulletList", "ul", /^\s*([-*])\s$/u);

/** `1. ` at the start of a paragraph starts a numbered one. */
const OrderedList = listNode("orderedList", "ol", /^\s*1\.\s$/u);

/** Which kind each list node is. */
const LIST_KINDS: Readonly<Record<string, ListKind>> = {
  bulletList: "bullet",
  orderedList: "numbered",
};

/** Where a surface keeps the style and class its paragraphs are drawn in. */
const PARAGRAPH_LOOK = new PluginKey<ParagraphLook>("paragraphLook");

type ParagraphLook = Pick<
  InlineMarkupOptions,
  | "paragraphStyle"
  | "paragraphClassName"
  | "listStyle"
  | "listItemStyle"
  | "listIndent"
  | "direction"
>;

/**
 * Draw every paragraph and list in the Block's style, the last with no space
 * below it, as `RichText` writes them in the email. An item's own paragraph
 * takes no margin, since the stored item has none.
 */
const ParagraphLookExtension = Extension.create({
  name: "paragraphLook",
  addProseMirrorPlugins: () => [
    new Plugin<ParagraphLook>({
      key: PARAGRAPH_LOOK,
      state: {
        init: () => ({}),
        apply: (tr, look) => {
          const next: unknown = tr.getMeta(PARAGRAPH_LOOK);
          return isParagraphLook(next) ? next : look;
        },
      },
      props: {
        decorations: (state) => {
          const look = PARAGRAPH_LOOK.getState(state) ?? {};
          const last = state.doc.childCount - 1;
          const decorations: Decoration[] = [];
          state.doc.forEach((stretch, offset, index) => {
            const end = offset + stretch.nodeSize;
            const kind = LIST_KINDS[stretch.type.name];
            if (kind === undefined) {
              decorations.push(
                Decoration.node(offset, end, {
                  style: cssText(paragraphStyleAt(look, index === last)),
                  ...(look.paragraphClassName === undefined
                    ? {}
                    : { class: look.paragraphClassName }),
                }),
              );
              return;
            }
            decorations.push(
              Decoration.node(offset, end, {
                style: cssText(listStyleAt(look, kind, index === last)),
                ...(look.direction === "rtl" ? { dir: "rtl" } : {}),
              }),
            );
            stretch.forEach((item, itemOffset, itemIndex) => {
              const at = offset + 1 + itemOffset;
              const lastItem = itemIndex === stretch.childCount - 1;
              decorations.push(
                Decoration.node(at, at + item.nodeSize, {
                  style: cssText(listItemStyleAt(look, kind, lastItem)),
                }),
                Decoration.node(at + 1, at + item.nodeSize - 1, {
                  style: "margin: 0",
                }),
              );
            });
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    }),
  ],
});

/** Whether a transaction's meta is a new look, which only a surface sets. */
function isParagraphLook(value: unknown): value is ParagraphLook {
  return typeof value === "object" && value !== null;
}

/** Properties whose bare numbers mean a number, as React writes them. */
const UNITLESS = new Set([
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "widows",
  "zIndex",
]);

/**
 * A style object written out as a `style` attribute, the way React would write
 * it: a bare number is pixels unless the property is a plain number.
 */
function cssText(style: CSSProperties): string {
  return Object.entries(style)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([name, value]: [string, unknown]) => {
      const property = name.startsWith("--")
        ? name
        : name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
      const written =
        typeof value === "number" && value !== 0 && !UNITLESS.has(name)
          ? `${String(value)}px`
          : String(value);
      return `${property}: ${written}`;
    })
    .join("; ");
}

/**
 * Take off what the Document will not store: empty paragraphs, empty list
 * items, lists left with no items, and line breaks at either end of each.
 *
 * Kept out of the history, since the text the Author can undo to is the same
 * text either way. A text holding nothing keeps one empty paragraph, for the
 * caret to go in.
 */
function settleParagraphs(instance: TiptapEditor): void {
  const { doc, tr, schema } = instance.state;
  if (doc.type.contentMatch.defaultType?.name !== "paragraph") return;

  const ranges: { from: number; to: number }[] = [];
  let kept = 0;
  doc.forEach((stretch, offset) => {
    if (LIST_KINDS[stretch.type.name] === undefined) {
      if (isBlankParagraph(stretch)) {
        ranges.push({ from: offset, to: offset + stretch.nodeSize });
      } else {
        kept += 1;
        ranges.push(...edgeBreaks(stretch, offset));
      }
      return;
    }
    const items: { from: number; to: number }[] = [];
    const trims: { from: number; to: number }[] = [];
    stretch.forEach((item, itemOffset) => {
      const at = offset + 1 + itemOffset;
      const paragraph = item.firstChild;
      if (!paragraph || isBlankParagraph(paragraph)) {
        items.push({ from: at, to: at + item.nodeSize });
      } else {
        trims.push(...edgeBreaks(paragraph, at + 1));
      }
    });
    if (items.length === stretch.childCount) {
      ranges.push({ from: offset, to: offset + stretch.nodeSize });
      return;
    }
    kept += 1;
    ranges.push(...items, ...trims);
  });

  if (kept === 0) {
    // Everything is blank: one empty paragraph is all that is left.
    const only = doc.firstChild;
    if (doc.childCount === 1 && only?.type.name === "paragraph") {
      if (only.content.size > 0) tr.delete(1, 1 + only.content.size);
    } else {
      const paragraph = schema.nodes["paragraph"]?.create();
      if (paragraph) tr.replaceWith(0, doc.content.size, paragraph);
    }
  } else {
    for (const range of ranges.toSorted((a, b) => b.from - a.from)) {
      tr.delete(range.from, range.to);
    }
  }
  if (!tr.docChanged) return;
  instance.view.dispatch(tr.setMeta("addToHistory", false));
}

/** The line breaks at either end of a paragraph that starts at `offset`. */
function edgeBreaks(
  paragraph: ProseMirrorNode,
  offset: number,
): { from: number; to: number }[] {
  // Where each child starts, so the breaks at either end can be cut out.
  const starts: number[] = [];
  paragraph.forEach((_child, childOffset) => {
    starts.push(offset + 1 + childOffset);
  });
  const isBreak = (at: number): boolean =>
    paragraph.maybeChild(at)?.type.name === "hardBreak";

  let start = 0;
  while (isBreak(start)) start += 1;
  let end = paragraph.childCount;
  while (end > start && isBreak(end - 1)) end -= 1;

  const contentEnd = offset + 1 + paragraph.content.size;
  const ranges: { from: number; to: number }[] = [];
  if (end < paragraph.childCount) {
    ranges.push({ from: starts[end] ?? contentEnd, to: contentEnd });
  }
  if (start > 0) {
    ranges.push({ from: offset + 1, to: starts[start] ?? contentEnd });
  }
  return ranges;
}

/** A paragraph with nothing in it but breaks and spaces. */
function isBlankParagraph(paragraph: ProseMirrorNode): boolean {
  let blank = true;
  paragraph.forEach((child) => {
    if (child.type.name === "hardBreak") return;
    if (child.isText && /^[\t\n\f\r ]*$/u.test(child.text ?? "")) return;
    blank = false;
  });
  return blank;
}

/**
 * History, without the keyboard.
 *
 * Tiptap's own undo extension binds ⌘Z, and this is precisely the conflict
 * ADR-0005 warns about: it would take back a character while the document
 * stack still held a drag. The plugin is kept for its grouping and its depth,
 * and the keystroke is left to the Canvas, which routes it through the one
 * timeline.
 */
function buildHistory(options: TiptapTextEngineOptions): Extension {
  return Extension.create({
    name: "documentHistory",
    addProseMirrorPlugins: () => [
      history({
        newGroupDelay: options.newGroupDelay ?? 500,
        depth: options.depth ?? 100,
      }),
    ],
  });
}

/**
 * Text without paragraphs is one line, so Return breaks the line rather than
 * starting a paragraph there is no room for.
 */
const LineKeymap = Extension.create({
  name: "lineKeymap",
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.setHardBreak(),
    };
  },
});

/** What a Block's text may hold, as the engine builds for it. */
type TextKind = "line" | "paragraphs" | "lists";

function buildExtensions(options: TiptapTextEngineOptions, kind: TextKind) {
  const paragraphs = kind !== "line";
  return [
    {
      line: InlineDocument,
      paragraphs: ParagraphDocument,
      lists: ListDocument,
    }[kind],
    StarterKit.configure({
      // Everything a Block cannot contain. What is left is the supported
      // inline set — bold, italic, underline, strike, link — plus a hard
      // break, the text itself, and paragraphs where the Block holds them.
      // Tiptap's own keymap then splits a paragraph on Return, and its hard
      // break takes Shift+Return. Lists are this adapter's own, below, so an
      // item can hold one paragraph and nothing nests.
      document: false,
      ...(paragraphs ? {} : { paragraph: false }),
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      code: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      undoRedo: false,
      link: {
        openOnClick: false,
        // Drawing only: the stored text keeps nothing but the href. With no
        // colour from the Block, a link keeps the browser's own blue, as the
        // render path leaves it to each client.
        HTMLAttributes: { style: `color: var(${LINK_COLOR}, LinkText)` },
      },
    }),
    buildHistory(options),
    paragraphs ? ParagraphLookExtension : LineKeymap,
    ...(kind === "lists" ? [ListItem, BulletList, OrderedList] : []),
  ];
}

/**
 * Take the caret, putting it where the Author was already looking.
 *
 * The double-click that asked for this landed on ordinary text — the surface
 * only became editable a moment later — so the browser has selected the word
 * under the pointer in the frame's own document. Carrying that range into the
 * engine is what makes the first keystroke replace the word, the way a
 * double-click does everywhere else.
 *
 * Where there is no such range the caret goes to the end: a Consumer calling
 * `edit()` from a menu has selected nothing, and starting at the end of the
 * sentence is the one position that never overwrites anything.
 */
function enterText(instance: TiptapEditor, element: HTMLElement): void {
  const range = clickedRange(instance, element);
  const chain = instance.chain();
  void (
    range ? chain.setTextSelection(range).focus() : chain.focus("end")
  ).run();
}

/** The browser's own selection, in the engine's positions, if it is in here. */
function clickedRange(
  instance: TiptapEditor,
  element: HTMLElement,
): { from: number; to: number } | undefined {
  const selection = element.ownerDocument.getSelection();
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  if (!selection || !anchor || !focus) return undefined;
  // A selection left over in some other Block — or in the Consumer's page —
  // says nothing about where this Author just pressed.
  if (!element.contains(anchor) || !element.contains(focus)) return undefined;

  try {
    const from = instance.view.posAtDOM(anchor, selection.anchorOffset);
    const to = instance.view.posAtDOM(focus, selection.focusOffset);
    if (from < 0 || to < 0) return undefined;
    return { from: Math.min(from, to), to: Math.max(from, to) };
  } catch {
    // A node the view cannot place has no position to offer, and a caret at
    // the end of the text is better than a thrown error.
    return undefined;
  }
}

/** What the toolbar Slot needs, or nothing when there is no range to format. */
function describeSelection(
  blockId: string,
  instance: TiptapEditor,
  lists: boolean,
): TextSelection | undefined {
  // A caret inside a link counts as something to format even with no range
  // selected, because correcting a link is done by putting the cursor in it —
  // and the commands below already extend to the whole mark. So does any
  // caret in text that holds lists, since a list is toggled on the paragraph
  // the caret is in (ADR-0029).
  if (instance.state.selection.empty && !lists && !instance.isActive("link")) {
    return undefined;
  }
  const toggleList = (name: string) => () => {
    if (lists) void instance.chain().focus().toggleList(name, "listItem").run();
  };

  const formatting: TextFormatting = {
    bold: instance.isActive("bold"),
    italic: instance.isActive("italic"),
    underline: instance.isActive("underline"),
    strike: instance.isActive("strike"),
    link: linkHref(instance),
    list: lists ? listKindAt(instance) : undefined,
  };

  return {
    blockId,
    formatting,
    commands: {
      toggleBold: () => void instance.chain().focus().toggleBold().run(),
      toggleItalic: () => void instance.chain().focus().toggleItalic().run(),
      toggleUnderline: () =>
        void instance.chain().focus().toggleUnderline().run(),
      toggleStrike: () => void instance.chain().focus().toggleStrike().run(),
      setLink: (href) => {
        const chain = instance.chain().focus().extendMarkRange("link");
        void (href === undefined || href === ""
          ? chain.unsetLink().run()
          : chain.setLink({ href }).run());
      },
      toggleBulletList: toggleList("bulletList"),
      toggleNumberedList: toggleList("orderedList"),
    },
    measure: () => measureSelection(instance),
  };
}

/** The kind of list the selection is in, if any. */
function listKindAt(instance: TiptapEditor): ListKind | undefined {
  if (instance.isActive("bulletList")) return "bullet";
  if (instance.isActive("orderedList")) return "numbered";
  return undefined;
}

function linkHref(instance: TiptapEditor): string | undefined {
  const href: unknown = instance.getAttributes("link")["href"];
  return typeof href === "string" && href !== "" ? href : undefined;
}

/**
 * Where the selected range is, in the Canvas frame's own viewport.
 *
 * The live range first, because it is the only thing that gets a selection
 * spanning wrapped lines right. Position coordinates are the fallback for when
 * the range has moved out of the DOM — which is what happens the moment focus
 * goes to a toolbar button in the parent document.
 */
function measureSelection(instance: TiptapEditor): Rect | undefined {
  const { view } = instance;
  const { from, to } = instance.state.selection;

  const domSelection = view.dom.ownerDocument.getSelection();
  if (domSelection && domSelection.rangeCount > 0) {
    const rect = domSelection.getRangeAt(0).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rectOf(rect);
  }

  try {
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    return {
      top: Math.min(start.top, end.top),
      left: Math.min(start.left, end.left),
      width: Math.abs(
        Math.max(start.right, end.right) - Math.min(start.left, end.left),
      ),
      height: Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top),
    };
  } catch {
    // A position that is no longer in the document has no coordinates, and a
    // toolbar with nowhere to go is better than a thrown error.
    return undefined;
  }
}
