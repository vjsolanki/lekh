import type { DropRefusal, DropTarget } from "./drop-target";
import type { Editor } from "./editor";
import { unreachable } from "./unreachable";

/**
 * What a drop is putting down: a Block already in the email, a new Block of a
 * type, or files an Author brought from outside the editor.
 */
export type Dropped =
  | {
      readonly kind: "move";
      readonly blockId: string;
      readonly blockType: string;
    }
  | { readonly kind: "insert"; readonly blockType: string }
  | { readonly kind: "files"; readonly files: readonly File[] };

/** What became of a drop. A refusal carries its sentence when one exists. */
export type DropApplied =
  | { readonly status: "applied" }
  | { readonly status: "refused"; readonly refusal?: DropRefusal };

/**
 * Put down what a drop is carrying, at the place it resolved to.
 *
 * The one apply step for every gesture that ends in a Block landing: a drag
 * from the Canvas or the palette, a file from the desktop, and a keyboard
 * nudge, which is a drop one sibling along. Files may land with no target —
 * an Author who let go of an image beside the email still meant to add it —
 * and the library picks the place, as it does for a paste.
 *
 * A refusal here is one resolution did not see coming: the gesture resolved,
 * and the Document moved underneath it before it landed. Asking why turns it
 * back into the same sentence the drag would have shown.
 */
export function applyDrop(
  editor: Editor,
  dropped: Dropped,
  target: DropTarget | undefined,
): DropApplied {
  switch (dropped.kind) {
    case "move": {
      if (target === undefined) return { status: "refused" };
      if (editor.moveBlock(dropped.blockId, target.parentId, target.index)) {
        return { status: "applied" };
      }
      return refusedAt(
        editor.explainDropRefusal(
          target.parentId,
          dropped.blockType,
          dropped.blockId,
        ),
      );
    }
    case "insert": {
      if (target === undefined) return { status: "refused" };
      // Whether this asks for an Asset first or inserts straight away is not
      // the drop's business — an Author put a Block here, and that is the
      // whole of what this knows.
      const placed = editor.place({
        reason: "insert",
        type: dropped.blockType,
        target,
      });
      if (placed.status !== "refused") return { status: "applied" };
      return refusedAt(
        editor.explainDropRefusal(target.parentId, dropped.blockType),
      );
    }
    case "files": {
      // Not explained when refused. `place` turns files down for reasons
      // that are no container's fault, and blaming one would be a lie.
      const placed = editor.place({
        reason: "drop",
        files: dropped.files,
        ...(target ? { target } : {}),
      });
      return placed.status === "refused"
        ? { status: "refused" }
        : { status: "applied" };
    }
    default:
      return unreachable(dropped);
  }
}

function refusedAt(refusal: DropRefusal | undefined): DropApplied {
  return refusal ? { status: "refused", refusal } : { status: "refused" };
}
