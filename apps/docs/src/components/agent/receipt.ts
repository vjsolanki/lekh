/**
 * When the receipt under an accepted Suggestion still offers Undo.
 *
 * Accepting is one undo step. Undo on the receipt is right only while that
 * step is the newest, so it never takes back something else. Any later Action
 * that changed a Block, yours, a peer's or an undo, puts a step on top or
 * takes this one off. One that only moved the selection does neither.
 */

import type { Action } from "lekh";

/** Whether Undo still applies, given every Action since the accept. */
export function canUndoAccept(after: readonly Action[]): boolean {
  return after.every((action) => action.blocks.length === 0);
}
