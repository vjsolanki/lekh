"use client";

import {
  Accessibility,
  Cursor,
  Feedback,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
  PreventSelection,
} from "@dnd-kit/dom";
import { isElement } from "@dnd-kit/dom/utilities";
import { DragDropProvider } from "@dnd-kit/react";
import { useState, type ReactNode } from "react";

import type { Editor } from "../core/editor/editor";
import { EditorContextProvider } from "./context";
import { createDragHandleRegistry, DragHandleContextProvider } from "./handles";
import { createDragSession, DragSessionContextProvider } from "./session";
import { EditableTextContextProvider, type EditableText } from "./text";

export interface EditorProviderProps {
  readonly editor: Editor;
  /**
   * The editable text a Text Engine adapter mounts for rich text. Leave it
   * out and text on the Canvas is drawn but not typed into.
   *
   * The engine's other half — history — goes to `createEditor` as
   * `textEngine`. An adapter supplies one object for both.
   */
  readonly editableText?: EditableText;
  readonly children?: ReactNode;
}

/**
 * The region of an application the editor is active in.
 *
 * Wrap the Canvas and the palette in it: a drag starts in one and finishes in
 * the other, and they are usually far apart in a Consumer's layout.
 */
export function EditorProvider({
  editor,
  editableText,
  children,
}: EditorProviderProps): ReactNode {
  // The drag in flight. The Canvas feeds it and the palette reads it, and the
  // two are usually far apart in a Consumer's layout — the same reason the
  // drag backend's own provider sits here.
  const [session] = useState(createDragSession);
  // A grip is drawn in the Chrome, or anywhere else in the Consumer's layout,
  // and the Block it moves is registered by the Canvas.
  const [handles] = useState(createDragHandleRegistry);

  return (
    <EditorContextProvider value={editor}>
      <EditableTextContextProvider value={editableText}>
        <DragSessionContextProvider value={session}>
          <DragHandleContextProvider value={handles}>
            <DragDropProvider plugins={PLUGINS} sensors={SENSORS}>
              {children}
            </DragDropProvider>
          </DragHandleContextProvider>
        </DragSessionContextProvider>
      </EditableTextContextProvider>
    </EditorContextProvider>
  );
}

/**
 * dnd-kit's defaults, with the dragged element cloned rather than moved.
 *
 * This settles palette drags only. A Canvas drag renders its own preview
 * through a Slot, and the Canvas mounts the overlay that draws it — which
 * makes the overlay the feedback element and leaves the Block itself alone
 * (ADR-0008), whatever this says. A palette drag has no overlay, so it lands
 * here: cloning leaves the Consumer's entry in their palette while a copy of
 * it follows the pointer, where moving it would take the entry away.
 *
 * The drop animation is off. It flies the Block an Author is carrying back to
 * the position it was picked up from, and by the time it plays the Document
 * has already moved that Block somewhere else — so the animation shows the
 * opposite of what happened. Landing at once is both truthful and quicker.
 *
 * dnd-kit's auto-scroller is left out: it scrolls an ancestor of the dragged
 * element, which for a Block coming from the palette is the Consumer's page
 * rather than the email. The Canvas scrolls itself instead.
 */
const PLUGINS = [
  Accessibility,
  Cursor,
  Feedback.configure({ feedback: "clone", dropAnimation: null }),
  PreventSelection,
];

/**
 * A drag begins after five pixels of movement with a pointer, a quarter of a
 * second's hold with a finger, or Space on a focused Block.
 *
 * The default would also start one after a fifth of a second's hold with a
 * mouse, which makes a click that lingers land a Block somewhere an Author
 * never intended. Holding still is how a finger is told apart from a scroll,
 * so touch keeps it.
 */
const SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: pressedSomethingOfItsOwn,
  }),
  // Space picks a Block up. Enter is left to the keymap, which steps into the
  // Block instead; once a Block is up, Enter still puts it down.
  KeyboardSensor.configure({
    keyboardCodes: {
      start: ["Space"],
      cancel: ["Escape"],
      end: ["Space", "Enter", "Tab"],
      up: ["ArrowUp"],
      down: ["ArrowDown"],
      left: ["ArrowLeft"],
      right: ["ArrowRight"],
    },
  }),
];

/**
 * The elements a press belongs to rather than to the Block around them.
 *
 * dnd-kit's own list, minus the link. An email is mostly links, and a press
 * on one in the Canvas means "pick this Block up" — never "follow it", which
 * the Canvas swallows for the same reason. Left in, a linked image or a button
 * could be selected but not moved, unless the anchor happened to be the
 * Block's outermost element, which is the one case the default exempts.
 *
 * A Text Engine's editable surface stays on the list, along with any form
 * control a Consumer's Block might draw: a press on those is a press on them.
 *
 * A press on a drag handle is never one of these. A grip is naturally a
 * `<button>`, and with a handle the draggable's element is still the Block, so
 * without this the grip would read as a control of the Block's own.
 */
const OWN_PRESS_SELECTOR = [
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  '[contenteditable]:not([contenteditable="false"])',
].join(",");

function pressedSomethingOfItsOwn(
  event: PointerEvent,
  source: { readonly element?: Element; readonly handle?: Element },
): boolean {
  const { target } = event;
  // dnd-kit's own guard rather than `instanceof Element`: the Canvas renders
  // into a frame, whose elements belong to another realm (ADR-0003).
  if (!isElement(target)) return false;
  if (source.handle?.contains(target) === true) return false;
  const own = target.closest(OWN_PRESS_SELECTOR);
  return own !== null && own !== source.element;
}
