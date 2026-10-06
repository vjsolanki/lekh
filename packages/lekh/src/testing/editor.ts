import {
  createEditor,
  type Edit,
  type EditorOptions,
  type Editor,
  type EmailDocument,
  type SuggestOptions,
  type Suggestion,
} from "../index";

import { definitions, sequentialIds } from "./blocks";

/**
 * An editor on a Document, the way most tests want one.
 *
 * The test Blocks, ids a test can predict (`id-1`, `id-2`, …), and the root
 * type taken from the Document — or a blank `email` when there is none. Any
 * option the editor takes can be passed and wins over these.
 */
export function editorFor(
  document?: EmailDocument,
  options: Partial<EditorOptions> = {},
): Editor {
  return createEditor({
    definitions,
    createId: sequentialIds(),
    ...(document ? { document } : { rootType: "email" }),
    ...options,
  });
}

/**
 * Suggest Edits, failing the test with the reasons when they are refused, so
 * a test about an open Suggestion reads as one.
 */
export function suggested(
  editor: Editor,
  edits: readonly Edit[],
  options?: SuggestOptions,
): Suggestion {
  const result = editor.suggest(edits, options);
  if (result.status === "refused") {
    throw new Error(`Refused: ${JSON.stringify(result.reasons)}`);
  }
  return result;
}

/** An Edit that sets one prop, the one most Suggestion tests start from. */
export function setProp(blockId: string, prop: string, value: unknown): Edit {
  return { kind: "set-prop", blockId, prop, value };
}
