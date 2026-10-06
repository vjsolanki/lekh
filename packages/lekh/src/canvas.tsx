"use client";

/**
 * The Canvas — `lekh/canvas`.
 *
 * The browser half of the editor: the Document rendered into an isolated
 * iframe, Drop Targets resolved from real geometry, selection tracked and
 * keystrokes bound in both documents. It renders no Chrome — every outline,
 * indicator and toolbar comes from the Consumer through a Slot.
 *
 * Separate from `lekh` because this is the only part that
 * needs a browser, and the only part carrying a client-only directive.
 */

export { Canvas } from "./canvas/canvas";
export type { CanvasProps } from "./canvas/canvas";

export { EditorProvider } from "./canvas/provider";
export type { EditorProviderProps } from "./canvas/provider";

export { useEditor } from "./canvas/context";

export { useEditorState } from "./canvas/state";

export { usePalette, usePaletteDrag } from "./canvas/palette";
export { useBlockDrag } from "./canvas/block-drag";
export type { BlockDrag } from "./canvas/block-drag";
export type {
  DragHandleProps,
  PaletteDrag,
  PaletteEntry,
} from "./canvas/palette";

export { useCommands } from "./canvas/commands";

export { defaultKeymap } from "./canvas/keymap";
export type { Keymap } from "./canvas/keymap";

export { useEditableText } from "./canvas/text";
export type {
  TextCommands,
  TextFormatting,
  TextSelection,
  EditableText,
  EditableTextProps,
} from "./canvas/text";

export type { Rect } from "./canvas/geometry";
export type { BoxEdge } from "./canvas/boxes";
export type {
  BlockChromeProps,
  BoxEdgesProps,
  CanvasSlots,
  DiagnosticChromeProps,
  DraggedBlock,
  DragPreviewProps,
  DropIndicatorProps,
  DropTargetProps,
  DropRefusalProps,
  FailedImageProps,
  PendingImageProps,
  SuggestionChromeProps,
  TextToolbarProps,
  TouchedBlock,
} from "./canvas/slots";
