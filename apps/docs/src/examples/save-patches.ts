import type { Editor, EmailDocument, Op } from "lekh-editor";

/**
 * Save one small patch per change instead of the whole email.
 *
 * Ops arrive in order, one per change, before anything reacts to the state
 * they produced. Append them and you can rebuild the email from the start.
 */
export function saveEveryChange(editor: Editor, emailId: string) {
  return editor.onOp((op) => {
    void appendPatch(emailId, op);
  });
}

/**
 * Save the whole email, but at most once every two seconds.
 *
 * Simpler than patches, and enough for most products. `subscribe` fires once
 * per action, not once per Op.
 */
export function saveWhenIdle(editor: Editor, emailId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return editor.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void saveDocument(emailId, editor.getDocument());
    }, 2000);
  });
}

/** Apply changes somebody else made. They never enter your undo stack. */
export function applyTheirChanges(editor: Editor, ops: readonly Op[]) {
  editor.applyExternalOps(ops.filter((op) => op.origin !== "local"));
}

// Your own code.
declare function appendPatch(emailId: string, op: Op): Promise<void>;
declare function saveDocument(
  emailId: string,
  document: EmailDocument,
): Promise<void>;
