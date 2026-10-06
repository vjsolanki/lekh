import type { DropRefusal, Editor } from "lekh";

/**
 * Say why a drop was turned down, in your product's voice.
 *
 * Branch on `code`, which is a closed set of three. `message` is the fallback,
 * composed from both Definitions' labels — keep it for the default branch so a
 * code added later still says something rather than nothing.
 */
export function refusalText(refusal: DropRefusal, editor: Editor): string {
  const container = editor.getBlock(refusal.blockId);
  // Labels are your own words, so treat them as names rather than nouns. It
  // saves choosing between "a" and "an" for a label you have never seen.
  const label = container
    ? (editor.getDefinition(container.type)?.label ?? "That container")
    : "That container";

  switch (refusal.code) {
    case "not-accepted": {
      return `${label} does not take that kind of Block.`;
    }

    case "at-capacity": {
      return `${label} is full. Remove something first.`;
    }

    case "own-subtree": {
      return "A Block cannot be dropped inside itself.";
    }

    default: {
      return refusal.message;
    }
  }
}

/**
 * The same question with no drag in flight, so a palette entry can look
 * disabled instead of failing when someone tries it.
 */
export function whyNot(
  editor: Editor,
  parentId: string,
  type: string,
): string | undefined {
  const refusal = editor.explainDropRefusal(parentId, type);
  return refusal ? refusalText(refusal, editor) : undefined;
}
