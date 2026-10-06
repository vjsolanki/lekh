import { useMemo } from "react";

import { createCommands, type Commands } from "../core/editor/commands";
import { useEditor } from "./context";

/**
 * The command set for the surrounding {@link EditorProvider}'s editor.
 *
 * Every keybinding the Canvas honours is one of these, so a Consumer's own
 * toolbar button and the keystroke it advertises run the same code. One
 * exception: the key bound to `stopEditing`, pressed on the Canvas, first
 * cancels an open Pending Change. The button commits it, as any other action
 * does (ADR-0032).
 */
export function useCommands(): Commands {
  const editor = useEditor();
  return useMemo(() => createCommands(editor), [editor]);
}
