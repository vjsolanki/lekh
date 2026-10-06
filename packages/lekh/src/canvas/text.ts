import {
  createContext,
  useContext,
  type ComponentType,
  type CSSProperties,
} from "react";

import type { Direction } from "../core/document/typography";
import type { Rect } from "./geometry";

/**
 * Which inline formatting the Author's current selection carries.
 *
 * Handed to the toolbar Slot so a Consumer's buttons can show accurate
 * pressed states rather than guessing.
 */
export interface TextFormatting {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  /** Where the selection links to, or `undefined` when it is not a link. */
  readonly link: string | undefined;
  /**
   * The kind of list the selection is in, or `undefined` when it is in none.
   * Always `undefined` in text that does not hold lists (ADR-0029).
   */
  readonly list: "bullet" | "numbered" | undefined;
}

/**
 * What a formatting toolbar can do to the current selection.
 *
 * Each one applies to the range the Author has selected, and leaves focus
 * where it was — a toolbar button must not end the selection it acts on.
 */
export interface TextCommands {
  readonly toggleBold: () => void;
  readonly toggleItalic: () => void;
  readonly toggleUnderline: () => void;
  readonly toggleStrike: () => void;
  /** Link the selection, or unlink it when the destination is `undefined`. */
  readonly setLink: (href: string | undefined) => void;
  /**
   * Make the paragraphs the selection touches a bullet list, or turn a bullet
   * list back into paragraphs. Block-level, so it acts on a caret as well as a
   * range. Does nothing in text that does not hold lists.
   */
  readonly toggleBulletList: () => void;
  /** As `toggleBulletList`, for a numbered list. */
  readonly toggleNumberedList: () => void;
}

/**
 * What the Editable Text reports when an Author selects a range — or, in
 * text that holds lists, puts the caret anywhere, since a list is toggled on
 * the paragraph the caret is in.
 *
 * The rectangle is asked for rather than given: the Canvas re-measures on
 * every scroll and resize, and a range that has moved with the email must
 * take the toolbar with it (ADR-0003).
 */
export interface TextSelection {
  readonly blockId: string;
  readonly formatting: TextFormatting;
  readonly commands: TextCommands;
  /**
   * Where the selected range is now, in the Canvas frame's own viewport. The
   * Canvas translates it into parent coordinates before any Slot sees it.
   */
  measure(): Rect | undefined;
}

/**
 * What the Canvas hands an Editable Text.
 *
 * No prop name among them: the Block is the unit the engine is scoped to, and
 * the store already knows which prop the text belongs in — telling the
 * component too would be a second place for the two to disagree.
 */
export interface EditableTextProps {
  readonly blockId: string;
  /** The stored text, for the engine to start from. */
  readonly value: string;
  /**
   * Whether the Author is in this Block's text.
   *
   * False for every Block until one is double-clicked, and true for at most
   * one at a time. One that is not editable takes no keystrokes and no caret:
   * the press belongs to the Canvas, which selects the Block and, if the
   * Author keeps moving, drags it.
   *
   * It turning true is the cue to take focus. The browser has already
   * selected the word that was double-clicked, so one that puts its caret
   * there rather than wherever it last was lets the Author type over the
   * word — which is what a double-click means everywhere else.
   */
  readonly editable: boolean;
  /** Called with the current range, or `undefined` when there is none. */
  readonly onSelectionChange: (selection: TextSelection | undefined) => void;
  /**
   * The colour the Block writes on its links, when it writes one.
   *
   * The render path puts it inline on every `<a>`. The Editable Text draws
   * its links in it too, so the email an Author edits is the email that is
   * sent (ADR-0022). It can change while the Editable Text is mounted — an
   * Author picking the email's link colour — and the links should follow.
   */
  readonly linkColor?: string;
  /**
   * Whether the Block's text holds paragraphs, as its Schema entry declares
   * (ADR-0023). If it does, Return starts a paragraph and Shift+Return breaks
   * the line. If not, Return breaks the line. Fixed for the life of an
   * Editable Text, since a Block's Schema does not change under it.
   */
  readonly paragraphs?: boolean;
  /**
   * The style the Block writes on every paragraph, with the last one's bottom
   * margin zeroed as the render path does. The Editable Text draws its
   * paragraphs in it so the spacing an Author sees is the email's. Only given
   * when the text holds paragraphs, and it can change while it is mounted.
   */
  readonly paragraphStyle?: CSSProperties;
  /** The class the Block writes on every paragraph. */
  readonly paragraphClassName?: string;
  /**
   * Whether the Block's text holds bullet and numbered lists (ADR-0029). Only
   * given with `paragraphs`, and fixed for as long as `paragraphs` is.
   */
  readonly lists?: boolean;
  /**
   * How the Block writes its lists, given only when the text holds them. The
   * Editable Text draws them through `listStyleAt` and `listItemStyleAt`, as
   * the render path does, so the indent and spacing an Author sees are the
   * email's.
   */
  readonly listStyle?: CSSProperties;
  /** The style the Block writes on every list item. */
  readonly listItemStyle?: CSSProperties;
  /** How far the Block indents a list, in pixels. */
  readonly listIndent?: number;
  /** Which way the Block's text runs. */
  readonly direction?: Direction;
}

/**
 * The editable text a Text Engine adapter mounts inside the Canvas.
 *
 * The Canvas half of ADR-0005: the core's {@link TextEngine} owns history and
 * knows nothing about React, and this owns the part an Author points at. An
 * adapter supplies both, and a Consumer supplying their own editor supplies
 * both too.
 */
export type EditableText = ComponentType<EditableTextProps>;

const EditableTextContext = createContext<EditableText | undefined>(undefined);

/** Puts an Editable Text within reach of every Block the Canvas renders. */
export const EditableTextContextProvider = EditableTextContext.Provider;

/** The Editable Text the surrounding `EditorProvider` was given, if any. */
export function useEditableText(): EditableText | undefined {
  return useContext(EditableTextContext);
}
