/**
 * What the agent is doing, in words: the newest Edit of a Suggestion that is
 * still arriving. The line comes from Edits only, never from the agent.
 */

import type { Edit, Editor } from "lekh-editor";

/** How the line names things. Each gives nothing for what it doesn't know. */
export interface Names {
  /** A stored Block's type, by its id. */
  readonly typeOf: (blockId: string) => string | undefined;
  readonly blockLabel: (type: string) => string | undefined;
  readonly propLabel: (type: string, prop: string) => string | undefined;
}

/** Names read from an editor's stored Blocks and their Definitions. */
export function namesOf(editor: Editor): Names {
  return {
    typeOf: (blockId) => editor.getBlock(blockId)?.type,
    blockLabel: (type) => editor.getDefinition(type)?.label,
    propLabel: (type, prop) => editor.getDefinition(type)?.schema[prop]?.label,
  };
}

/** "a Button", "an Image". */
function article(label: string): string {
  return /^[aeiou]/iu.test(label) ? `an ${label}` : `a ${label}`;
}

export function workingLine(edits: readonly Edit[], names: Names): string {
  const edit = edits.at(-1);
  if (edit === undefined) return "Reading your request";

  // A Block an earlier Edit added is not stored yet, so its insert names it.
  const typeOf = (blockId: string): string | undefined =>
    edits.find(
      (earlier): earlier is Extract<Edit, { kind: "insert" }> =>
        earlier.kind === "insert" && earlier.id === blockId,
    )?.type ?? names.typeOf(blockId);
  const label = (type: string | undefined): string =>
    (type === undefined ? undefined : names.blockLabel(type)) ?? "block";

  switch (edit.kind) {
    case "insert": {
      return `Adding ${article(label(edit.type))}`;
    }
    case "set-prop": {
      const type = typeOf(edit.blockId);
      const prop =
        (type === undefined ? undefined : names.propLabel(type, edit.prop)) ??
        edit.prop;
      return `Setting the ${label(type)}'s ${prop.toLowerCase()}`;
    }
    case "remove": {
      return `Removing ${article(label(typeOf(edit.blockId)))}`;
    }
    case "move": {
      return `Moving ${article(label(typeOf(edit.blockId)))}`;
    }
    default: {
      return "Reading your request";
    }
  }
}
