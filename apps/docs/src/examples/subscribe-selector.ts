import { useCallback, useSyncExternalStore } from "react";
import type { Editor } from "lekh";

/**
 * `useEditorState` over an editor you hold yourself, for when there is no
 * `EditorProvider` above the component.
 *
 * Every getter on `Editor` answers with the same value until that value moves,
 * so a selector is all this needs to be. What it must not do is build the value
 * it returns — composing two getters into an object hands back a new reference
 * on every call, and React reads that as a change that never settles.
 */
export function useEditorValue<TValue>(
  editor: Editor,
  select: (editor: Editor) => TValue,
): TValue {
  // Held between renders, or React tears the subscription down and rebuilds it
  // on each one. An arrow rather than `editor.subscribe`: passing the method
  // unbound trips strict lint rules, and this costs nothing.
  const subscribe = useCallback(
    (onChange: () => void) => editor.subscribe(onChange),
    [editor],
  );

  const read = (): TValue => select(editor);

  return useSyncExternalStore(subscribe, read, read);
}
