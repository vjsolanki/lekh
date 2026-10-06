import type { AcceptOutcome, EditRefusal, Editor } from "lekh-editor";

/**
 * Show your users a bigger font on one Block, and let them decide.
 *
 * `meta` is yours: the editor stores it and hands it back on every event.
 */
export function suggestBiggerText(
  editor: Editor,
  blockId: string,
  threadId: string,
): void {
  const suggestion = editor.suggest(
    [{ kind: "set-prop", blockId, prop: "fontSize", value: 20 }],
    { note: "Bigger headline", meta: { thread: threadId } },
  );
  // Refused: nothing is shown. Each reason says which Edit failed and why.
  if (suggestion.status === "refused") {
    tellAgent(suggestion.reasons);
    return;
  }

  // Wire these to your own Accept and Reject buttons. Accept says "stale"
  // if your users changed what it touches while it waited.
  showReview(suggestion.note, {
    onAccept: () => suggestion.accept(),
    onReject: () => suggestion.reject(),
  });
}

declare function showReview(
  note: string | undefined,
  actions: { onAccept: () => AcceptOutcome; onReject: () => boolean },
): void;

declare function tellAgent(reasons: readonly EditRefusal[]): void;
