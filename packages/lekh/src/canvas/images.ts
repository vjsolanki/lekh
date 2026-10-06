"use client";

import { useEffect } from "react";

import { NO_FILES } from "../core/document/assets";
import type { Point } from "../core/editor/drop-target";
import type { Editor } from "../core/editor/editor";
import type { DragSession } from "./session";

/** What it takes to notice an image arriving from outside the editor. */
export interface ArrivingImagesSetup {
  readonly editor: Editor;
  readonly frameDocument: Document | null;
  /** The drag a file is followed by, as a Block drag is. */
  readonly session: DragSession;
  /**
   * A point in the frame's own viewport, in the Canvas's coordinate space.
   * Absent when the Canvas is not there to measure against.
   */
  readonly pointerAt: (clientX: number, clientY: number) => Point | undefined;
}

/**
 * Images arriving from the platform: a file dragged in from the desktop, and a
 * screenshot pasted from the clipboard.
 *
 * Both are native browser event streams with no Block behind them, so the drag
 * backend never sees either (ADR-0008), and both end in an ask rather than an
 * edit — the Consumer produces an Asset and only then does a Block appear.
 */
export function useArrivingImages({
  editor,
  frameDocument,
  session,
  pointerAt,
}: ArrivingImagesSetup): void {
  useEffect(() => {
    if (!frameDocument) return undefined;
    const view = frameDocument.defaultView;

    // An editor with no `resolveImage`, or no Definition holding an Asset, has
    // nowhere to put a file. Claiming the event anyway would swallow an
    // Author's JPEG without a word, so the drop is left to the browser.
    const takesImages = (): boolean => editor.getImageBlockType() !== undefined;

    /**
     * Follow a file drag the same way a Block drag is followed. A file has no
     * Block behind it, but it lands as one — so the session carries the type
     * about to appear, and no existing Block is moving.
     */
    const follow = (event: DragEvent): void => {
      const type = editor.getImageBlockType();
      if (type === undefined) return;
      if (session.getCarrying()?.source !== "file") {
        session.start({ source: "file", blockType: type });
      }
      const pointer = pointerAt(event.clientX, event.clientY);
      if (pointer) session.move(pointer);
    };

    // A native drag over the email reports itself every few frames, even
    // with the pointer still. One that falls silent has gone without saying
    // so — Escape, or the system taking it back, ends it with no event the
    // frame is sure to hear — so it is abandoned rather than left in the air.
    let silence = 0;
    const abandon = (): void => {
      silence = 0;
      if (session.getCarrying()?.source === "file") session.cancel();
    };
    const listen = (): void => {
      if (silence !== 0) view?.clearTimeout(silence);
      silence = view?.setTimeout(abandon, FILE_DRAG_SILENCE) ?? 0;
    };

    const onDragOver = (event: DragEvent): void => {
      if (!takesImages() || !carriesImage(event.dataTransfer)) return;
      // Without this the browser opens the file instead of offering a drop.
      event.preventDefault();

      follow(event);
      listen();
      // The platform's own refusal cursor, which is more dependable during a
      // native file drag than any cursor the page can ask for.
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect =
          session.getRefusal() === undefined ? "copy" : "none";
      }
    };

    const onDragLeave = (event: DragEvent): void => {
      // A drag crossing between elements leaves each one it passes, so the
      // indicator only goes once the pointer has left the email itself.
      const gone =
        !view ||
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= view.innerWidth ||
        event.clientY >= view.innerHeight;
      if (gone) abandon();
    };

    const onDrop = (event: DragEvent): void => {
      const files = imageFilesOf(event.dataTransfer);
      if (files.length === 0 || !takesImages()) return;
      event.preventDefault();

      // Resolved where it was let go, like any other drag. A container that
      // will not take an image says so rather than having the file land
      // somewhere the Author was not aiming — honest only because the drag
      // said the same thing the whole way in.
      if (silence !== 0) view?.clearTimeout(silence);
      silence = 0;
      follow(event);
      session.drop(pointerAt(event.clientX, event.clientY), files);
    };

    const onPaste = (event: ClipboardEvent): void => {
      const files = imageFilesOf(event.clipboardData);
      if (files.length === 0 || !takesImages()) return;

      // Where a pasted screenshot goes is the library's rule, not this
      // listener's: it is the same question a clicked palette entry asks.
      if (editor.place({ reason: "paste", files }).status === "refused") return;

      // Claimed in the capture phase, so a Text Engine's typing surface never
      // sees it: a pasted screenshot is a Block of its own, not characters in
      // a paragraph.
      event.preventDefault();
      event.stopPropagation();
    };

    frameDocument.addEventListener("dragover", onDragOver);
    frameDocument.addEventListener("dragleave", onDragLeave);
    frameDocument.addEventListener("drop", onDrop);
    frameDocument.addEventListener("paste", onPaste, true);
    return () => {
      if (silence !== 0) view?.clearTimeout(silence);
      frameDocument.removeEventListener("dragover", onDragOver);
      frameDocument.removeEventListener("dragleave", onDragLeave);
      frameDocument.removeEventListener("drop", onDrop);
      frameDocument.removeEventListener("paste", onPaste, true);
    };
  }, [editor, frameDocument, session, pointerAt]);
}

/**
 * How long a file drag may go unheard before it counts as gone, in ms.
 *
 * Browsers repeat `dragover` every 50 to 350ms while a drag is over an
 * element, so this is comfortably longer than the slowest of them.
 */
const FILE_DRAG_SILENCE = 1000;

/**
 * Whether a drag in flight is carrying an image file.
 *
 * Asked during `dragover`, where the files themselves are deliberately out of
 * reach — only each item's kind and MIME type are exposed until the drop.
 */
function carriesImage(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  return [...transfer.items].some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
}

/** The image files a drop or a paste actually carried. */
function imageFilesOf(transfer: DataTransfer | null): readonly File[] {
  if (!transfer) return NO_FILES;
  return [...transfer.files].filter((file) => file.type.startsWith("image/"));
}
