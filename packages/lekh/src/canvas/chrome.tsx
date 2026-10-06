"use client";

import { DragOverlay } from "@dnd-kit/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import type { ImageRequestState } from "../core/document/assets";
import type { EmailDocument } from "../core/document/document";
import type {
  DropRefusal,
  DropTarget,
  Point,
} from "../core/editor/drop-target";
import type { Editor } from "../core/editor/editor";
import type { Suggestion } from "../core/editor/suggestion";
import type { Diagnostic } from "../core/validate/diagnostic";
import { collectBlocks } from "../core/document/tree";
import type { BoxEdge } from "./boxes";
import { isCanvasDrag, readDragPayload } from "./drag";
import { dropIndicatorRect, placementRect, type Rect } from "./geometry";
import type { Carrying, DragSession } from "./session";
import { touchedBlocks } from "./suggestions";
import type {
  BlockChromeProps,
  CanvasSlots,
  DraggedBlock,
  DragPreviewProps,
  DropRefusalProps,
} from "./slots";
import type { TextSelection } from "./text";

/**
 * What a Block being carried looks like, until a Consumer says otherwise.
 *
 * The first Slot to carry a default, and it draws it here rather than inside
 * the frame — which is the whole reason it can be replaced by an ordinary
 * component with an ordinary stylesheet (ADR-0008).
 *
 * A small label just below and right of the pointer, on purpose. It says which
 * Block is moving and stays off the drop indicator under the pointer, which is
 * the mark that says where it will land (ADR-0044). It cannot show the Block's
 * own appearance anyway — that lives in the email's stylesheet, inside the
 * frame, and does not reach out here.
 */
function DefaultDragPreview({ block }: DragPreviewProps): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        top: 8,
        padding: "4px 8px",
        border: "1px solid rgb(16 19 25 / 20%)",
        borderRadius: 4,
        background: "rgb(255 255 255 / 95%)",
        boxShadow: "0 4px 12px rgb(16 19 25 / 18%)",
        color: "rgb(16 19 25 / 80%)",
        font: "12px/1 ui-sans-serif, system-ui, sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      {block.type}
    </div>
  );
}

/**
 * What a refused drag says, until a Consumer says otherwise.
 *
 * The second Slot to carry a default, for the same reason as the first: a drop
 * that quietly does nothing reads as a broken editor rather than an
 * undecorated one. It was the whole of the bug this exists to fix.
 *
 * Drawn at the pointer rather than over the container it names, because the
 * pointer is where the Author is looking and the container can be the whole
 * email. `role="status"` because the element mounts with the message already
 * inside it — so it is announced, not merely displayed. A Consumer replacing
 * this owns that announcement along with everything else.
 */
function DefaultDropRefusal({ refusal, pointer }: DropRefusalProps): ReactNode {
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        left: pointer.x,
        top: pointer.y,
        // Clear of the cursor, which is already saying the same thing.
        transform: "translate(14px, 14px)",
        maxWidth: 220,
        boxSizing: "border-box",
        padding: "4px 8px",
        borderRadius: 4,
        background: "rgb(16 19 25 / 92%)",
        color: "rgb(255 255 255 / 95%)",
        font: "12px/1.4 ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {refusal.message}
    </div>
  );
}

/**
 * What a Block with nothing in it looks like, until a Consumer says otherwise.
 *
 * The third Slot to carry a default, and for the same reason as the other two:
 * the Canvas has just reserved forty pixels of room, and forty pixels of
 * nothing reads as a layout bug rather than as an invitation. Leaving it
 * undecorated would trade one thing an Author cannot make sense of for another.
 *
 * An outline and nothing else. No label, because a label is a sentence in one
 * language and the library has nowhere to translate it from — `dropRefusal`
 * composes English only out of labels the Consumer wrote themselves, and
 * "Drop content here" would be the library's own words.
 */
function DefaultEmptyBlock({ rect }: BlockChromeProps): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        boxSizing: "border-box",
        border: "1px dashed rgb(16 19 25 / 25%)",
        borderRadius: 4,
      }}
    />
  );
}

/** The Diagnostics that name a Block, gathered by Block, in their order. */
function byBlock(
  diagnostics: readonly Diagnostic[],
): ReadonlyMap<string, readonly Diagnostic[]> {
  const found = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.blockId === undefined) continue;
    const list = found.get(diagnostic.blockId);
    if (list) list.push(diagnostic);
    else found.set(diagnostic.blockId, [diagnostic]);
  }
  return found;
}

interface ChromeInput {
  readonly editor: Editor;
  readonly emailDocument: EmailDocument;
  readonly rects: ReadonlyMap<string, Rect>;
  /** The Blocks the Canvas gave a box to, because they had nothing to show. */
  readonly standIns: ReadonlySet<string>;
  readonly selection: string | undefined;
  /** The Block the Author is typing into, if one is. */
  readonly editing: string | undefined;
  readonly hovered: string | undefined;
  /** The edges of the selected Block's Boxes. */
  readonly boxEdges: readonly BoxEdge[];
  /** The Block in the air, if one is. */
  readonly carried: DraggedBlock | undefined;
  readonly dropTarget: DropTarget | undefined;
  /** Every place the drag in flight may land. Empty when nothing is carried. */
  readonly dropTargets: readonly DropTarget[];
  /** The refusal the drag is currently meeting, if it is meeting one. */
  readonly refusal: DropRefusal | undefined;
  /** The drag in flight, which says where the pointer is. */
  readonly session: DragSession;
  readonly textSelection: TextSelection | undefined;
  readonly textRect: Rect | undefined;
  readonly imageRequests: readonly ImageRequestState[];
  readonly suggestions: readonly Suggestion[];
  readonly diagnostics: readonly Diagnostic[];
  readonly slots: CanvasSlots;
}

/**
 * Every Slot the current state calls for, each with its rectangle: the Chrome
 * the Canvas draws over the email.
 */
export function renderChrome({
  editor,
  emailDocument,
  rects,
  standIns,
  selection,
  editing,
  hovered,
  boxEdges,
  carried,
  dropTarget,
  dropTargets,
  refusal,
  session,
  textSelection,
  textRect,
  imageRequests,
  suggestions,
  diagnostics,
  slots,
}: ChromeInput): ReactNode {
  const {
    selection: Selection,
    boxEdges: BoxEdges,
    hover: Hover,
    dropIndicator: DropIndicator,
    dropTarget: DropTargetChrome,
    textToolbar: TextToolbar,
    unregisteredBlock: UnregisteredBlock,
    pendingImage: PendingImageChrome,
    failedImage: FailedImageChrome,
    draggingBlock: DraggingBlock,
    suggestion: SuggestionChrome,
    diagnostic: DiagnosticChrome,
  } = slots;

  // A range the Author has left is not a range to format. The surface reports
  // what it last had and keeps it, because a toolbar button in the parent
  // document blurs the Canvas the moment it is pressed — so which Block is
  // being edited is what says whether the range is still live, and asking here
  // rather than making the surface retract it keeps the two out of a race.
  const textBlock =
    textSelection === undefined || textSelection.blockId !== editing
      ? undefined
      : editor.getBlock(textSelection.blockId);

  // While a Block is in the air the Canvas has one question on it, and the
  // Chrome that answers the others stands down: an outline around the Block
  // being carried, a toolbar over the position it is leaving and a hover
  // outline chasing the pointer all compete with the one mark that says where
  // it lands. They come back the moment the drag ends.
  const settled = carried === undefined;

  const selected =
    selection === undefined || !settled
      ? undefined
      : editor.getBlock(selection);
  const selectedRect =
    selection === undefined ? undefined : rects.get(selection);
  // Hovering the Block already outlined as selected would draw two outlines
  // over the same Block.
  const hoveredId = hovered === selection || !settled ? undefined : hovered;
  const hoveredBlock =
    hoveredId === undefined ? undefined : editor.getBlock(hoveredId);
  const hoveredRect =
    hoveredId === undefined ? undefined : rects.get(hoveredId);
  const indicator = dropTarget && dropIndicatorRect(dropTarget, rects);
  const landingIn = dropTarget && rects.get(dropTarget.parentId);

  // The counterpart to the indicator: at most one of the two is ever drawn,
  // because a drag is either landing somewhere or being turned away.
  const DropRefusalChrome = slots.dropRefusal ?? DefaultDropRefusal;
  const refusedBlock = refusal && editor.getBlock(refusal.blockId);
  const refusedRect = refusal && rects.get(refusal.blockId);

  // The Block being carried has not moved: the preview under the pointer is a
  // separate element outside the frame, so this rectangle is the Block's real
  // one for the whole gesture.
  const draggingId = carried?.blockId;
  const draggingBlock =
    draggingId === undefined ? undefined : editor.getBlock(draggingId);
  const draggingRect =
    draggingId === undefined ? undefined : rects.get(draggingId);

  const unregistered = collectBlocks(emailDocument.root).filter(
    (block) => editor.getDefinition(block.type) === undefined,
  );

  // Every Block with nothing to show stays marked while a drag is in flight —
  // unlike the Chrome that chases the pointer, these are stationary facts about
  // the Document, and during a drag they are the most useful thing on screen:
  // they are where the Block can go. The exception is the container the drag is
  // landing inside, where `dropIndicator` is already drawing on the identical
  // rectangle, and two marks over one rect say less than either alone.
  const EmptyBlockChrome = slots.emptyBlock ?? DefaultEmptyBlock;
  const landingInside =
    dropTarget?.position === "inside" ? dropTarget.parentId : undefined;
  const empty = [...standIns].filter((blockId) => blockId !== landingInside);

  return (
    <>
      {empty.map((blockId) => {
        const block = editor.getBlock(blockId);
        const rect = rects.get(blockId);
        return block && rect ? (
          <EmptyBlockChrome key={blockId} block={block} rect={rect} />
        ) : null;
      })}
      {/* Stationary facts too, so they stay up through selection, hover and
          drag alike, and sit under the Chrome that follows the Author. */}
      {SuggestionChrome
        ? suggestions.map((suggestion) => (
            <SuggestionChrome
              key={suggestion.id}
              suggestion={suggestion}
              blocks={touchedBlocks(suggestion, emailDocument, rects)}
            />
          ))
        : null}
      {DiagnosticChrome
        ? [...byBlock(diagnostics)].map(([blockId, found]) => {
            const block = editor.getBlock(blockId);
            const rect = rects.get(blockId);
            return block && rect ? (
              <DiagnosticChrome
                key={blockId}
                block={block}
                rect={rect}
                diagnostics={found}
              />
            ) : null;
          })
        : null}
      {Hover && hoveredBlock && hoveredRect ? (
        <Hover block={hoveredBlock} rect={hoveredRect} />
      ) : null}
      {DraggingBlock && draggingBlock && draggingRect ? (
        <DraggingBlock block={draggingBlock} rect={draggingRect} />
      ) : null}
      {DropTargetChrome && carried
        ? dropTargets.map((target) => {
            const rect = dropIndicatorRect(target, rects);
            return rect ? (
              <DropTargetChrome
                key={`${target.parentId}:${String(target.index)}`}
                target={target}
                dragged={carried}
                rect={rect}
                current={sameIndex(target, dropTarget)}
              />
            ) : null;
          })
        : null}
      {DropIndicator && dropTarget && carried && indicator && landingIn ? (
        <DropIndicator
          target={dropTarget}
          dragged={carried}
          rect={indicator}
          parentRect={landingIn}
        />
      ) : null}
      {refusal && refusedBlock && refusedRect ? (
        <RefusalAtPointer
          Chrome={DropRefusalChrome}
          session={session}
          refusal={refusal}
          block={refusedBlock}
          rect={refusedRect}
        />
      ) : null}
      {/* After hover, so actions hung over the Block above stay on top of
          that Block's hover outline. Nothing drawn during a drag comes into
          it: the selection has stood down by then. */}
      {Selection && selected && selectedRect ? (
        <Selection block={selected} rect={selectedRect} />
      ) : null}
      {BoxEdges && selected && selectedRect && boxEdges.length > 0 ? (
        <BoxEdges block={selected} rect={selectedRect} edges={boxEdges} />
      ) : null}
      {TextToolbar && textSelection && textBlock && textRect ? (
        <TextToolbar
          block={textBlock}
          rect={textRect}
          formatting={textSelection.formatting}
          commands={textSelection.commands}
        />
      ) : null}
      {UnregisteredBlock
        ? unregistered.map((block) => {
            const rect = rects.get(block.id);
            return rect ? (
              <UnregisteredBlock key={block.id} block={block} rect={rect} />
            ) : null;
          })
        : null}
      {imageRequests.map((request) => {
        const rect = placementRect(request.placement, rects);
        if (!rect) return null;
        if (request.status === "failed") {
          return FailedImageChrome ? (
            <FailedImageChrome key={request.id} failure={request} rect={rect} />
          ) : null;
        }
        return PendingImageChrome ? (
          <PendingImageChrome key={request.id} pending={request} rect={rect} />
        ) : null;
      })}
    </>
  );
}

/**
 * What a drag is carrying, in the terms a Slot is given it in.
 *
 * The payload's `source` says where the gesture began, which is the drag
 * backend's business; what the Chrome needs is whether a Block is moving, and
 * that is `blockId` being there or not (ADR-0008).
 */
export function carriedBlockOf(
  payload: Carrying | undefined,
): DraggedBlock | undefined {
  if (!payload) return undefined;
  return payload.source === "canvas"
    ? { type: payload.blockType, blockId: payload.blockId }
    : { type: payload.blockType };
}

const NO_POINTER = { x: 0, y: 0 };

/**
 * The refusal Slot, following the pointer.
 *
 * Its own component, so that a pointer moving while the refusal holds redraws
 * this and nothing else: the session wakes only pointer listeners for it.
 */
function RefusalAtPointer({
  Chrome,
  session,
  ...props
}: Omit<DropRefusalProps, "pointer"> & {
  readonly Chrome: ComponentType<DropRefusalProps>;
  readonly session: DragSession;
}): ReactNode {
  const subscribe = useCallback(
    (onChange: () => void) => session.subscribeToPointer(onChange),
    [session],
  );
  const pointer = useSyncExternalStore(
    subscribe,
    session.getPointer,
    session.getPointer,
  );
  return <Chrome {...props} pointer={pointer ?? NO_POINTER} />;
}

/**
 * The Block under the pointer, drawn out here in the Consumer's own document
 * rather than lifted out of the frame (ADR-0008). Mounting this is what stops
 * the backend cloning a stand-in into the email: the Block stays where it is,
 * so its rectangle stays true for the whole gesture.
 *
 * Switched off for a palette drag, which lifts the Consumer's own entry —
 * already their markup, already wearing their styles.
 */
export function CarriedPreview({
  editor,
  slots,
  pointer,
}: {
  readonly editor: Editor;
  readonly slots: CanvasSlots;
  /** Where the pointer is now, in the parent's viewport. */
  readonly pointer: () => Point | undefined;
}): ReactNode {
  return (
    <DragOverlay disabled={(source) => !isCanvasDrag(source?.data)}>
      {(source) => {
        const payload = readDragPayload(source.data);
        const block =
          payload?.source === "canvas"
            ? editor.getBlock(payload.blockId)
            : undefined;
        if (!block) return null;
        const Preview = slots.dragPreview ?? DefaultDragPreview;
        return (
          <AtPointer pointer={pointer}>
            <Preview block={block} />
          </AtPointer>
        );
      }}
    </DragOverlay>
  );
}

/**
 * Puts the preview's top-left corner on the pointer, with no size of its own
 * (ADR-0044).
 *
 * The overlay around it is sized to the Block and placed by the backend at the
 * offset the press started from, which for a grip outside the Block is nowhere
 * near the pointer. So the anchor is put back on the pointer every frame,
 * against wherever the overlay is now: the backend places the overlay after
 * this mounts, so a gap read once at mount would be read too early.
 *
 * On a zoomed Canvas the backend also scales the overlay to the Block as it is
 * drawn. The anchor undoes that scale, so the preview is the Consumer's markup
 * at the Consumer's size, and its offsets are in their pixels.
 */
function AtPointer({
  pointer,
  children,
}: {
  readonly pointer: () => Point | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const anchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) return undefined;
    let frame = 0;
    const place = (): void => {
      const overlay = element.parentElement;
      const at = pointer();
      if (overlay && at) {
        const box = overlay.getBoundingClientRect();
        const scaleX = box.width / overlay.offsetWidth || 1;
        const scaleY = box.height / overlay.offsetHeight || 1;
        element.style.left = `${String((at.x - box.left) / scaleX)}px`;
        element.style.top = `${String((at.y - box.top) / scaleY)}px`;
        element.style.transform = `scale(${String(1 / scaleX)}, ${String(1 / scaleY)})`;
      }
      frame = view.requestAnimationFrame(place);
    };
    place();
    return () => {
      view.cancelAnimationFrame(frame);
    };
  }, [pointer]);
  return (
    <div
      ref={anchor}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        transformOrigin: "0 0",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Whether two Drop Targets land at the same index. Resolving names a gap from
 * the nearer neighbour and the list from one of them, so the sides are not
 * compared.
 */
function sameIndex(a: DropTarget, b: DropTarget | undefined): boolean {
  return b !== undefined && a.parentId === b.parentId && a.index === b.index;
}
