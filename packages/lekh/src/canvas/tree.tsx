import { isElement } from "@dnd-kit/dom/utilities";
import {
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { richTextPropOf } from "../core/document/definition";
import type { Block } from "../core/document/document";
import type { Editor } from "../core/editor/editor";
import { renderTree, type RenderCache } from "../core/render/render-tree";
import { MOBILE_ONLY_HIDING } from "../core/layout/responsive";
import {
  renderInlineMarkup,
  EditableRichTextProvider,
  type EditableRichText,
} from "../core/render/rich-text";
import type { TextSelection, EditableText } from "./text";

/** Marks the element a Block rendered to, so the Canvas can measure it. */
export const BLOCK_ID_ATTRIBUTE = "data-block-id";

/** Marks the stand-in the Canvas renders for a Block it cannot render. */
export const UNREGISTERED_ATTRIBUTE = "data-block-unregistered";

/** Marks the box the Canvas gives a Block that would otherwise have none. */
export const STAND_IN_ATTRIBUTE = "data-block-stand-in";

/**
 * How much room a Block with nothing to show is given.
 *
 * Enough to read as a place rather than as a gap: two empty columns side by
 * side make a row this tall, and a row thinner than a line of text does not
 * look like somewhere an Author is invited to put something.
 *
 * It is the height of a *child*, not a floor on the container, so a container's
 * own padding sits outside it. Every empty container therefore offers the same
 * room whatever its padding — and `min-height` on a `<td>` is honoured by
 * hardly anyone, which rules the alternative out anyway.
 */
const STAND_IN_MIN_HEIGHT = 40;

/** The attribute on a stand-in, as props any element can be cloned with. */
const STAND_IN_MARKER: Record<string, string> = {
  [STAND_IN_ATTRIBUTE]: "true",
};

/**
 * Render a Document for the Canvas.
 *
 * Unlike the render path this is forgiving: an unregistered Block becomes an
 * empty stand-in rather than an error, because an Author must still be able to
 * see, move and delete something the editor does not understand (ADR-0006).
 * The Consumer explains it in their own words through the
 * `unregisteredBlock` Slot, which draws over the stand-in.
 *
 * Every rendered Block carries its id as an attribute. That is what makes the
 * tree measurable, selectable and draggable without the library needing to
 * know anything about the markup a Block Definition chose to emit.
 *
 * Responsive behaviour goes through exactly the same collection the render path
 * uses, so the mobile Stage shows the stylesheet a recipient would get rather
 * than an approximation of it. Nothing here narrows anything — the Canvas does
 * that by narrowing the frame, and the media queries then fire for real.
 */
export function renderCanvasBlock(
  root: Block,
  editor: Editor,
  text?: CanvasText,
  cache?: RenderCache,
): ReactNode {
  return renderTree(root, {
    cache,
    lookup: (type) => editor.getDefinition(type),

    unregistered: (unregisteredBlock, children) =>
      createElement(
        "div",
        {
          [BLOCK_ID_ATTRIBUTE]: unregisteredBlock.id,
          [UNREGISTERED_ATTRIBUTE]: "true",
          // Given some height so it can be seen, hovered and dropped onto even
          // when it renders nothing of its own.
          style: { minHeight: 24 },
        },
        children,
      ),

    // Nothing visible: the Consumer draws that through the `emptyBlock` Slot.
    // This is only the room to draw in, and the surface a pointer can find.
    // A Definition with a stand-in of its own gets that, marked the same way.
    standIn: (_block, _definition, own) =>
      own
        ? cloneElement(own, STAND_IN_MARKER)
        : createElement("div", {
            ...STAND_IN_MARKER,
            style: { minHeight: STAND_IN_MIN_HEIGHT },
          }),

    // The same wrapper the email gets, with what is inside left live, so the
    // Canvas can still measure, select and edit it. No comment: the Canvas is
    // never Outlook.
    mobileOnly: (element, className) =>
      createElement("div", { className, style: MOBILE_ONLY_HIDING }, element),

    // Nothing to add: the Canvas is never Outlook.
    outlook: (element) => element,

    decorate: (element, drawn, definition) => {
      const marked = withBlockId(element, drawn.id);
      // A Block with no rich-text prop, or a Canvas with no Text Engine behind
      // it, draws its text the same way the render path would: read-only.
      if (!text?.editableText || richTextPropOf(definition) === undefined) {
        return marked;
      }

      return createElement(
        EditableRichTextProvider,
        {
          value: editableRichText(
            text.editableText,
            drawn.id,
            text.editing === drawn.id,
            text.report,
          ),
        },
        marked,
      );
    },
  });
}

/**
 * What the Canvas needs in order to make a Block's text editable.
 *
 * Threaded through the recursion rather than read from a context, so
 * rendering the tree stays one pure function call.
 */
export interface CanvasText {
  readonly editableText: EditableText;
  /**
   * The Block the Author has entered, if any. Every other Block's text is
   * mounted but not editable — it is something to look at, press and drag.
   */
  readonly editing: string | undefined;
  readonly report: (selection: TextSelection | undefined) => void;
}

/** Draw a Block's rich text as the Text Engine's Editable Text. */
function editableRichText(
  Editable: EditableText,
  blockId: string,
  editable: boolean,
  report: (selection: TextSelection | undefined) => void,
): EditableRichText {
  return (value, options, shape) =>
    typeof value === "string" || value === undefined
      ? createElement(Editable, {
          blockId,
          value: value ?? "",
          editable,
          onSelectionChange: report,
          linkColor: options.linkColor,
          ...(shape.paragraphs === true
            ? {
                paragraphs: true,
                paragraphStyle: options.paragraphStyle,
                paragraphClassName: options.paragraphClassName,
              }
            : {}),
          ...(shape.lists === true
            ? {
                lists: true,
                listStyle: options.listStyle,
                listItemStyle: options.listItemStyle,
                listIndent: options.listIndent,
                direction: options.direction,
              }
            : {}),
        })
      : // A prop holding something other than text is not something an engine
        // can be handed; it is drawn as the render path would draw it.
        renderInlineMarkup(value, options, shape);
}

/**
 * Attach a Block's id to the element it rendered to.
 *
 * The attribute is added to the Block's own outermost element rather than to a
 * wrapper, because a wrapper would change the markup — and a `<div>` around a
 * `<tr>` is not the email the Author is building.
 */
function withBlockId(element: ReactElement, blockId: string): ReactNode {
  // A Fragment has no element to carry the attribute; such a Block is simply
  // not measurable, and so not selectable or draggable.
  if (!isValidElement(element) || element.type === Fragment) return element;
  // A data attribute rather than a prop, so a Block Definition's own props
  // type is untouched by being rendered in the Canvas.
  const marker: Record<string, string> = { [BLOCK_ID_ATTRIBUTE]: blockId };
  return cloneElement(element, marker);
}

/**
 * Every rendered Block's element.
 *
 * One element per Block, which used not to be true: the backend lifted the
 * Block being carried out of the flow and cloned a stand-in into its place, so
 * for the length of a gesture the same Block was in the document twice and
 * every reader had to say which copy it meant. The Canvas now renders the
 * preview into a Slot of its own outside the frame (ADR-0008), which leaves
 * the Block itself untouched where it sits — so there is one copy again, and
 * its rectangle is true throughout the drag.
 */
export function blockElementsIn(
  frameDocument: Document,
): readonly (readonly [string, Element])[] {
  const found: (readonly [string, Element])[] = [];
  for (const element of frameDocument.querySelectorAll(
    `[${BLOCK_ID_ATTRIBUTE}]`,
  )) {
    const blockId = element.getAttribute(BLOCK_ID_ATTRIBUTE);
    if (blockId !== null) found.push([blockId, element]);
  }
  return found;
}

/**
 * Every Block the Canvas had to give a box to.
 *
 * Read off the rendered tree rather than worked out from the Document, because
 * only half of it is knowable in advance: a container with no children is plain
 * to see, but a Definition that renders to nothing has to be asked, and asking
 * means rendering. The Canvas already reads what it drew in order to measure it.
 *
 * A container's filler carries no id of its own, so the Block it belongs to is
 * the nearest one above it — which for a Block that rendered nothing is the
 * stand-in element itself, since `decorate` marked it.
 */
export function standInBlockIdsIn(
  frameDocument: Document,
): ReadonlySet<string> {
  const found = new Set<string>();
  for (const element of frameDocument.querySelectorAll(
    `[${STAND_IN_ATTRIBUTE}]`,
  )) {
    const blockId = element
      .closest(`[${BLOCK_ID_ATTRIBUTE}]`)
      ?.getAttribute(BLOCK_ID_ATTRIBUTE);
    if (blockId !== null && blockId !== undefined) found.add(blockId);
  }
  return found;
}

/**
 * The id of the nearest Block at or above an event's target.
 *
 * Tested with dnd-kit's guard rather than `instanceof`. The target sits in the
 * iframe, but not every element there was made by it: a Text Engine may build
 * its nodes with the parent page's `document`, as ProseMirror does, and
 * `instanceof` against either window is false for the other's (ADR-0003).
 */
export function blockIdAt(target: EventTarget | null): string | undefined {
  if (!isElement(target)) return undefined;
  const element = target.closest(`[${BLOCK_ID_ATTRIBUTE}]`);
  return element?.getAttribute(BLOCK_ID_ATTRIBUTE) ?? undefined;
}
