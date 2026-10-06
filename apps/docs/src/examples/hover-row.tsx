import type { ReactNode } from "react";
import type { Block } from "lekh";
import { useEditor, useEditorState } from "lekh/canvas";

/**
 * One row of your own Layers list. It lights when the pointer is over its
 * Block on the Canvas, and pointing at it outlines that Block there.
 */
export function HoverRow({ block }: { readonly block: Block }): ReactNode {
  const editor = useEditor();
  const hovered = useEditorState(
    (current) => current.getHovered() === block.id,
  );

  return (
    <div
      data-hovered={hovered}
      onPointerEnter={() => {
        editor.hover(block.id);
      }}
      onPointerLeave={() => {
        editor.hover(undefined);
      }}
    >
      {block.type}
    </div>
  );
}
