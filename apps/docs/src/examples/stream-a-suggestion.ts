import type { Edit, EditRefusal, Editor } from "lekh";

/**
 * Show a first draft as your agent writes it, one batch of Edits at a time.
 *
 * Your users see it grow, and can accept it only once it is finished.
 */
export async function streamSuggestion(
  editor: Editor,
  batches: AsyncIterable<readonly Edit[]>,
): Promise<void> {
  const suggestion = editor.suggest([], {
    streaming: true,
    note: "First draft",
  });
  if (suggestion.status === "refused") return;

  for await (const edits of batches) {
    const grown = suggestion.extend(edits);
    // Your users rejected it, or changed what it touches: stop the agent.
    if (typeof grown === "string") return;
    // These Edits can't apply. It keeps what it had.
    if (grown.status === "refused") tellAgent(grown.reasons);
  }

  // Now your users can accept it.
  suggestion.finish();
}

declare function tellAgent(reasons: readonly EditRefusal[]): void;
