import type { ReactNode } from "react";
import { Canvas, type SuggestionChromeProps } from "lekh/canvas";

/**
 * Draw each open Suggestion: a dashed outline on every Block it touches, and
 * Accept and Reject under the first one.
 *
 * The Canvas hands you a rectangle for each Block, selected or not. The
 * buttons call the Suggestion's own methods.
 */
export function SuggestionMark({
  suggestion,
  blocks,
}: SuggestionChromeProps): ReactNode {
  const first = blocks.at(0);
  return (
    <>
      {blocks.map(({ block, rect, change }) => (
        <div
          key={block.id}
          style={{
            position: "absolute",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            outline: `2px dashed ${change === "remove" ? "crimson" : "rebeccapurple"}`,
            opacity: suggestion.status === "stale" ? 0.4 : 1,
            pointerEvents: "none",
          }}
        />
      ))}
      {first === undefined ? null : (
        <div
          style={{
            position: "absolute",
            top: first.rect.top + first.rect.height + 4,
            left: first.rect.left,
            // The Slot layer ignores the pointer. Buttons take it back.
            pointerEvents: "auto",
          }}
        >
          {suggestion.note}{" "}
          {/* Refused while it streams or once it is stale, so hide it then. */}
          {suggestion.status === "open" ? (
            <button
              type="button"
              onClick={() => {
                suggestion.accept();
              }}
            >
              Accept
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              suggestion.reject();
            }}
          >
            {suggestion.status === "stale" ? "Dismiss" : "Reject"}
          </button>
        </div>
      )}
    </>
  );
}

export function EmailCanvas(): ReactNode {
  return <Canvas slots={{ suggestion: SuggestionMark }} />;
}
