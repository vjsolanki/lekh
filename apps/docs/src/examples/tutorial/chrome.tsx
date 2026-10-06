import type {
  BlockChromeProps,
  CanvasSlots,
  DropIndicatorProps,
  TextToolbarProps,
} from "lekh-editor/canvas";

/**
 * Every Block-shaped Slot draws the same way: take the rectangle, put an
 * absolutely positioned box on it.
 *
 * The rectangle is already in the Canvas's coordinate space, so there is no
 * arithmetic to do and nothing to measure.
 */
const outline = (color: string): React.CSSProperties => ({
  position: "absolute",
  border: `2px solid ${color}`,
  borderRadius: 2,
  // The Slot layer ignores pointer events. An outline wants that: clicks
  // belong to the email underneath it.
  pointerEvents: "none",
});

function SelectionOutline({ rect }: BlockChromeProps) {
  return <div style={{ ...outline("#4f46e5"), ...rect }} />;
}

/** Only drawn on a Block that is not already selected, so it cannot double up. */
function HoverOutline({ rect }: BlockChromeProps) {
  return <div style={{ ...outline("#c7d2fe"), ...rect }} />;
}

/**
 * Where the Block in the air would land.
 *
 * An insertion between two Blocks is a zero-thickness rectangle along the
 * parent's layout axis, so this gives itself a minimum the right way round.
 * `position: "inside"` is a container rather than a line, and is filled.
 */
function DropIndicator({ target, rect }: DropIndicatorProps) {
  const horizontal = target.axis === "horizontal";
  const line = target.position !== "inside";

  return (
    <div
      style={{
        position: "absolute",
        ...rect,
        ...(line && horizontal ? { width: Math.max(rect.width, 3) } : {}),
        ...(line && !horizontal ? { height: Math.max(rect.height, 3) } : {}),
        background: line ? "#4f46e5" : "rgba(79, 70, 229, 0.12)",
        outline: line ? undefined : "2px dashed #4f46e5",
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * Drawn against the Author's text selection.
 *
 * `formatting` is what the selection already carries, so the buttons show a
 * pressed state rather than guessing, and `commands` leave the selection where
 * it was — a toolbar that ended the selection it acts on would be unusable.
 */
function TextToolbar({ rect, formatting, commands }: TextToolbarProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: rect.top - 36,
        left: rect.left,
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 4,
        background: "#1f2937",
        // This one is meant to be clicked, so it opts back in.
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        aria-pressed={formatting.bold}
        onClick={commands.toggleBold}
      >
        B
      </button>
      <button
        type="button"
        aria-pressed={formatting.italic}
        onClick={commands.toggleItalic}
      >
        I
      </button>
    </div>
  );
}

/**
 * The Chrome this editor draws over the email.
 *
 * Four of the twelve Slots. Leaving one out draws nothing, which is why an
 * editor with no Slots at all responds to everything and shows none of it.
 */
export const slots: CanvasSlots = {
  selection: SelectionOutline,
  hover: HoverOutline,
  dropIndicator: DropIndicator,
  textToolbar: TextToolbar,
};
