import { createEditor, type EmailDocument } from "lekh";

import { definitions, rootType } from "./definitions";

/** Open an email that was saved earlier. */
export function openSaved(saved: EmailDocument) {
  return createEditor({ definitions, rootType, document: saved });
}

/** Save the whole email, at most once every two seconds. */
export function autosave(editor: ReturnType<typeof openSaved>) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return editor.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void saveToYourDatabase(editor.getDocument());
    }, 2000);
  });
}

// Your own code.
declare function saveToYourDatabase(document: EmailDocument): Promise<void>;
