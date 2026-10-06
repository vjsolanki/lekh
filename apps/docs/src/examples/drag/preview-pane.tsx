import { useCallback, useSyncExternalStore } from "react";
import type { EmailDocument } from "lekh-editor";
import { useEditor } from "lekh-editor/canvas";

/**
 * The Document as the Canvas shows it, for your own preview pane.
 *
 * A drag tells only pending listeners, so listen to both. Never save what
 * this returns. Your users may still press Escape.
 */
export function useLiveDocument(): EmailDocument {
  const editor = useEditor();

  const subscribe = useCallback(
    (onChange: () => void) => {
      const stopChanges = editor.subscribe(onChange);
      const stopPending = editor.subscribeToPendingChange(onChange);
      return () => {
        stopChanges();
        stopPending();
      };
    },
    [editor],
  );

  const read = () => editor.getDocumentWithPendingChange();
  return useSyncExternalStore(subscribe, read, read);
}
