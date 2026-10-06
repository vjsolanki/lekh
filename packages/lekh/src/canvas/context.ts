import { createContext, useContext } from "react";

import type { Editor } from "../core/editor/editor";

const EditorContext = createContext<Editor | undefined>(undefined);

export const EditorContextProvider = EditorContext.Provider;

/**
 * The editor the surrounding {@link EditorProvider} was given.
 *
 * Handy for wiring an Inspector or a toolbar next to the Canvas without
 * threading the editor through every component.
 */
export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) {
    throw new Error(
      "No editor found. Wrap the Canvas and the palette in <EditorProvider editor={…}>.",
    );
  }
  return editor;
}
