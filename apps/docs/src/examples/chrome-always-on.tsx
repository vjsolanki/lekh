import type { CSSProperties, ReactNode } from "react";
import {
  useCommands,
  useEditor,
  type BlockChromeProps,
  type CanvasSlots,
  type Rect,
} from "lekh-editor/canvas";

/**
 * Every Block-shaped Slot draws the same way: take the rectangle, put an
 * absolutely positioned box on it.
 *
 * The rectangle arrives in the Canvas's own coordinate space, so there is
 * nothing to measure and nothing to add up.
 */
const box = (rect: Rect): CSSProperties => ({
  position: "absolute",
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
  // The Slot layer ignores pointer events, and a mark wants that: the click
  // belongs to the email underneath it.
  pointerEvents: "none",
});

/**
 * The selected Block: its outline, and what it can do.
 *
 * One component draws both. The toolbar comes after the outline, so it paints
 * on top of it.
 *
 * Every button runs a command, so the toolbar and the matching keystroke can
 * never drift apart. Each is disabled by its command's `can` check rather than
 * hidden when it would do nothing: somebody is better told the unsubscribe
 * link cannot go than left hunting for the button.
 */
function Selection({ block, rect }: BlockChromeProps): ReactNode {
  const editor = useEditor();
  const commands = useCommands();

  return (
    <>
      <div style={{ ...box(rect), outline: "2px solid #4f46e5" }}>
        <span style={{ position: "absolute", bottom: "100%", left: 0 }}>
          {editor.getDefinition(block.type)?.label ?? block.type}
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          // Hung above the Block's trailing corner, clear of the label on the
          // leading one. The floor keeps it on screen when the Block is the
          // first thing in the email.
          top: Math.max(rect.top - 32, 2),
          left: rect.left + rect.width,
          transform: "translateX(-100%)",
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: 4,
          borderRadius: 6,
          background: "#1a2030",
          color: "#f4f5f8",
          // This one is meant to be clicked, so it opts back in.
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          disabled={!commands.can.moveUp()}
          onClick={commands.moveUp}
        >
          ↑
        </button>
        <button
          type="button"
          disabled={!commands.can.moveDown()}
          onClick={commands.moveDown}
        >
          ↓
        </button>
        <button
          type="button"
          disabled={!commands.can.duplicate()}
          onClick={commands.duplicate}
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={!commands.can.delete()}
          onClick={commands.delete}
        >
          Delete
        </button>
      </div>
    </>
  );
}

/** Only asked for on a Block that is not already selected, so it cannot double up. */
function HoverOutline({ rect }: BlockChromeProps): ReactNode {
  return <div style={{ ...box(rect), outline: "2px solid #c7d2fe" }} />;
}

/**
 * A Block with nothing to show: a container with no children, or one whose
 * Definition rendered nothing at all.
 *
 * The Canvas has already reserved the room, so this draws into space that
 * exists. Quieter than the outlines above on purpose — it is drawn on every
 * empty container at once, and anything heavier reads as a page full of
 * warnings rather than a page full of places.
 */
function EmptyBlock({ block, rect }: BlockChromeProps): ReactNode {
  const editor = useEditor();

  return (
    <div
      style={{
        ...box(rect),
        display: "grid",
        placeItems: "center",
        outline: "1px dashed rgb(0 0 0 / 20%)",
        background: "rgb(0 0 0 / 3%)",
      }}
    >
      <span>{editor.getDefinition(block.type)?.label ?? block.type}</span>
    </div>
  );
}

/**
 * A Block this editor has no Definition for.
 *
 * The only sign that a saved Document is holding a type your build no longer
 * registers. Nothing is drawn without this Slot, so the Block is simply a gap.
 */
function UnregisteredBlock({ block, rect }: BlockChromeProps): ReactNode {
  return (
    <div
      style={{
        ...box(rect),
        outline: "2px dashed #b91c1c",
        background: "rgb(185 28 28 / 8%)",
      }}
    >
      <span>No Definition for “{block.type}”</span>
    </div>
  );
}

/**
 * The Chrome that is on screen when nothing is happening.
 *
 * Four of the twelve Slots. The other eight answer a gesture — a drag, an
 * upload, a text selection — and belong to the guide for that gesture.
 */
export const slots: CanvasSlots = {
  selection: Selection,
  hover: HoverOutline,
  emptyBlock: EmptyBlock,
  unregisteredBlock: UnregisteredBlock,
};
