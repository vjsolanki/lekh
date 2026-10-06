import { useState } from "react";
import type { TextToolbarProps } from "lekh/canvas";

export function TextToolbar({ rect, formatting, commands }: TextToolbarProps) {
  const [linking, setLinking] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        // `rect` is already in the canvas's coordinates. No arithmetic needed.
        top: rect.top - 44,
        left: rect.left,
        // The slot layer ignores pointer events, so opt this one back in.
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

      {linking ? (
        <input
          autoFocus
          defaultValue={formatting.link ?? ""}
          onBlur={(event) => {
            // An empty box means unlink.
            commands.setLink(event.target.value || undefined);
            setLinking(false);
          }}
        />
      ) : (
        <button
          type="button"
          aria-pressed={formatting.link !== undefined}
          onClick={() => {
            setLinking(true);
          }}
        >
          Link
        </button>
      )}
    </div>
  );
}
