import type { ComponentType } from "react";

import type { FailedImage, PendingImage } from "../core/document/assets";
import type { Block } from "../core/document/document";
import type {
  DropRefusal,
  DropTarget,
  Point,
} from "../core/editor/drop-target";
import type { SuggestionTouch } from "../core/editor/carry-out";
import type { Suggestion } from "../core/editor/suggestion";
import type { Diagnostic } from "../core/validate/diagnostic";
import type { BoxEdge } from "./boxes";
import type { Rect } from "./geometry";
import type { TextCommands, TextFormatting } from "./text";

/**
 * What every Block-shaped Slot receives: the Block itself and where it is.
 *
 * The rectangle is already in the Canvas's coordinate space, so a Slot is a
 * `position: absolute` element and four numbers. The Canvas renders Slots into
 * a layer that ignores pointer events; Chrome a Consumer wants to be clickable
 * — a toolbar, say — sets `pointer-events: auto` on itself.
 */
export interface BlockChromeProps {
  readonly block: Block;
  readonly rect: Rect;
}

/**
 * The Block a drag is carrying.
 *
 * `blockId` is the difference between the two gestures an indicator can be
 * drawn for: absent when a Block is being added from a palette, present when
 * one already in the email is being moved. Nothing of the drag backend is in
 * here (ADR-0008) — it is the Block, and where it came from.
 */
export interface DraggedBlock {
  readonly type: string;
  /** The Block being moved. Absent when a new one is being added. */
  readonly blockId?: string;
}

/**
 * What the drag preview Slot receives.
 *
 * The Block in the air, and nothing else. Its size is not here on purpose: the
 * preview is rendered into an element the backend has already sized to the
 * Block being carried, so a rectangle would be a second answer to a question
 * that already has one. A preview that wants to be a different size says so in
 * its own styles.
 *
 * Only a Block moving within the email arrives here. A Block dragged from a
 * palette lifts the Consumer's own palette entry, in the Consumer's own markup,
 * so there is nothing for a preview to improve on.
 */
export interface DragPreviewProps {
  readonly block: Block;
}

/** What the drop indicator Slot receives. */
export interface DropIndicatorProps {
  /** Where the drop would land: a parent, a position and which way round. */
  readonly target: DropTarget;
  /** What is being carried, so the indicator can name it. */
  readonly dragged: DraggedBlock;
  /**
   * The line the Block will land on, or the container it will land in.
   *
   * An insertion between Blocks is degenerate along the parent's layout axis:
   * zero height under a parent that stacks its children, and zero width beside
   * one that lays them out in a row. `target.axis` says which, so an indicator
   * can give itself a minimum thickness the right way round.
   */
  readonly rect: Rect;
  /**
   * The container the Block will land in: `target.parentId`, as it is drawn.
   *
   * The line says where among the children. This says which children — the
   * level the Block lands at, which is what an Author cannot tell apart when
   * a column sits inside a row inside a Section. The same as `rect` for a drop
   * `inside`.
   */
  readonly parentRect: Rect;
}

/**
 * What the Drop Target Slot receives: one place the drag may land.
 *
 * Every valid place is drawn from the moment a drag starts, so an Author can
 * see where they may drop before aiming. `current` marks the one the pointer
 * resolves to now, which `dropIndicator` is drawing too — draw it however
 * suits that, or not at all.
 */
export interface DropTargetProps {
  readonly target: DropTarget;
  readonly dragged: DraggedBlock;
  /** As `dropIndicator` gets it: a line between Blocks, or the container. */
  readonly rect: Rect;
  /** Whether the pointer resolves to this place now. */
  readonly current: boolean;
}

/**
 * What the drop refusal Slot receives.
 *
 * The one Slot given a pointer as well as a rectangle, because a refusal has
 * two positions and they are rarely the same one. It is *about* a container —
 * possibly a full-width Section, possibly the whole email — and it has to be
 * *read* at the cursor, which is where the Author is looking. Handing over
 * only one of the two would settle a question that belongs to the Consumer:
 * outlining the offending container and putting a tip under the pointer are
 * both reasonable house styles.
 *
 * The pointer is always inside `rect` — the container reported is an ancestor
 * of whatever is under the cursor — so the two are near each other even when
 * they are not the same place.
 */
export interface DropRefusalProps {
  /** Why the drop will not happen, with a code to say it your own way. */
  readonly refusal: DropRefusal;
  /** The container that refused. */
  readonly block: Block;
  /** The container's rectangle, in the Canvas's coordinate space. */
  readonly rect: Rect;
  /** The pointer, in the same space. */
  readonly pointer: Point;
}

/**
 * What the Box edges Slot receives: the selected Block, and the edges of its
 * Boxes (ADR-0040).
 *
 * Each edge is one side's padding band, at the drawn size, naming the prop a
 * grip there writes. A button hands its outer padding and the room around its
 * label as two Boxes, so a grip on its outer edge moves the outer padding.
 * Read `box` to group the sides; whether a Box is locked is read from the
 * Block's Control Descriptors, not from here.
 */
export interface BoxEdgesProps extends BlockChromeProps {
  readonly edges: readonly BoxEdge[];
}

/**
 * What the formatting toolbar Slot receives.
 *
 * Everything needed to draw an accurate toolbar and nothing else: where the
 * Author's selection is, what formatting it already carries — so buttons can
 * show pressed states — and the commands those buttons run.
 */
export interface TextToolbarProps {
  /** The Block being typed into. */
  readonly block: Block;
  /**
   * The selected range, in the Canvas's coordinate space. Editing happens
   * inside the frame and the toolbar is drawn outside it, so this rectangle
   * has already been translated (ADR-0003).
   */
  readonly rect: Rect;
  readonly formatting: TextFormatting;
  readonly commands: TextCommands;
}

/**
 * What the pending-image Slot receives.
 *
 * The placeholder an Author watches while their image is fetched or uploaded.
 * None of it is in the Document — that is the point — so the Consumer draws
 * whatever their design system says a pending image looks like, reads
 * `progress` when they reported one, and wires their close button to
 * `cancel`.
 */
export interface PendingImageProps {
  readonly pending: PendingImage;
  /** Where the image will land, in the Canvas's coordinate space. */
  readonly rect: Rect;
}

/** What the failed-image Slot receives. The Document is untouched. */
export interface FailedImageProps {
  readonly failure: FailedImage;
  readonly rect: Rect;
}

/**
 * A Block a Suggestion touches, where the Canvas drew it, and how it was
 * touched: `insert`, `remove`, `move` or `set`, and which props.
 *
 * `block` is the Block as drawn. One the Suggestion inserts is not in the
 * Document yet, so the editor has no answer for its id.
 */
export interface TouchedBlock extends BlockChromeProps {
  readonly change: SuggestionTouch["change"];
  /** The props it sets on the Block. Empty when it sets none. */
  readonly props: readonly string[];
}

/**
 * What the suggestion Slot receives: one open Suggestion, and every Block it
 * touches that the Canvas drew.
 *
 * Inserted Blocks are drawn in place and take room. Removed ones are still
 * drawn where they are until it is accepted. Moved ones are drawn where they
 * would go. So each has a rectangle. A stale one no longer draws what it
 * would insert, so those Blocks are left out of `blocks`.
 */
export interface SuggestionChromeProps {
  /** Read `status` to tell streaming, open and stale apart. */
  readonly suggestion: Suggestion;
  readonly blocks: readonly TouchedBlock[];
}

/**
 * One Block with something wrong with it, and every Diagnostic that names it,
 * in the order `getDiagnostics` lists them.
 */
export interface DiagnosticChromeProps {
  readonly block: Block;
  readonly rect: Rect;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The Chrome a Consumer renders over the Canvas.
 *
 * The library renders none of it. Every Slot is optional; one left out simply
 * draws nothing — except `dragPreview` and `dropRefusal`, which are the two
 * gestures that look broken rather than merely undecorated when nothing draws
 * them: a Block carried with no preview, and a drop that quietly does nothing.
 * Both fall back to a plain default, and passing your own replaces that
 * default entirely — including with a component that renders `null`, which is
 * how you turn one off.
 */
export interface CanvasSlots {
  /**
   * Drawn over the selected Block — its outline and its own actions alike.
   *
   * One Slot rather than an outline and a toolbar apart: both are about the
   * same Block, at the same moment, in the same rectangle, and two components
   * sharing one rectangle end up negotiating over it. Inside one component,
   * whatever renders later paints on top, so a toolbar written after the
   * outline sits over it with no help from the Canvas.
   */
  readonly selection?: ComponentType<BlockChromeProps>;
  /**
   * Drawn over the selected Block when it has a Box, for grips that drag its
   * padding. Drawn after `selection`, so grips sit over its outline.
   *
   * A grip previews through a Pending Change and commits on release, so a
   * drag is one undo step. The edges follow the preview as it is drawn.
   */
  readonly boxEdges?: ComponentType<BoxEdgesProps>;
  /**
   * Drawn over the hovered Block, unless it is already selected. The pointer
   * on the Canvas sets it, and so can your own tree, through `editor.hover`.
   */
  readonly hover?: ComponentType<BlockChromeProps>;
  /** Drawn where a dragged Block would land. */
  readonly dropIndicator?: ComponentType<DropIndicatorProps>;
  /**
   * Drawn once for each place a drag may land, from the moment it starts.
   * Drawn under `dropIndicator`.
   *
   * The places come from `editor.getDropTargets`, on the same rules a drop
   * is resolved by, so none is a place a drop would be refused at.
   */
  readonly dropTarget?: ComponentType<DropTargetProps>;
  /**
   * Drawn while a drag is over somewhere that will not take it. Has a default.
   *
   * The counterpart to `dropIndicator`: one of the two is drawn whenever a
   * drag is over the email, and neither when it is somewhere else entirely —
   * which is how an Author cancels, and is not a refusal.
   */
  readonly dropRefusal?: ComponentType<DropRefusalProps>;
  /**
   * Drawn under the pointer while a Block is carried. Has a default.
   *
   * It renders in the Consumer's own document rather than inside the frame, so
   * an ordinary stylesheet reaches it — which is why the Canvas no longer has
   * an opinion about what a carried Block looks like.
   *
   * Its top-left corner is placed on the pointer, and it is given no size
   * (ADR-0044). Move it off the pointer with your own CSS, so it does not sit
   * on the drop indicator the pointer is aiming at.
   */
  readonly dragPreview?: ComponentType<DragPreviewProps>;
  /**
   * Drawn over the Block a drag is carrying, where it still sits.
   *
   * The Block does not move while it is being carried, so this is the Slot
   * that says one is leaving — a scrim, a dashed outline, whatever a Consumer
   * reads as "this one is in the air". Nothing is drawn without it.
   */
  readonly draggingBlock?: ComponentType<BlockChromeProps>;
  /** Drawn against the Author's text selection, for inline formatting. */
  readonly textToolbar?: ComponentType<TextToolbarProps>;
  /** Drawn where an image being fetched or uploaded is going to land. */
  readonly pendingImage?: ComponentType<PendingImageProps>;
  /** Drawn where an image that failed to resolve was going to land. */
  readonly failedImage?: ComponentType<FailedImageProps>;
  /** Drawn over each Block whose type this editor has no Definition for. */
  readonly unregisteredBlock?: ComponentType<BlockChromeProps>;
  /**
   * Drawn over each Block that has nothing to show. Has a default.
   *
   * Two states wear one face here, because from the outside they are one
   * sentence — this Block is showing nothing, here is its box. A container with
   * no children is the common one; a Block whose Definition rendered nothing at
   * all is the other. A Consumer who wants to tell them apart can ask the
   * editor for the Block's Definition, but most will not want to.
   *
   * The Canvas has already given the Block room, so this draws into space that
   * exists. It has a default for the same reason `dragPreview` and
   * `dropRefusal` do: reserved space with nothing in it reads as a bug rather
   * than as an affordance nobody decorated.
   *
   * Stands down on the container a drag is currently landing inside, where
   * `dropIndicator` is drawing on the very same rectangle.
   */
  readonly emptyBlock?: ComponentType<BlockChromeProps>;
  /**
   * Drawn once for each open Suggestion, stale and streaming ones too, over
   * every Block it touches (ADR-0035).
   *
   * Not tied to selection or hover: it stays up while the Author works
   * elsewhere, and during a drag. Without it the Canvas still draws the
   * Document plus the Suggestions, inserted Blocks and all, and nothing over
   * them. Accept and reject buttons call the Suggestion's own methods.
   */
  readonly suggestion?: ComponentType<SuggestionChromeProps>;
  /**
   * Drawn once over each Block a Diagnostic names, for a badge an Author
   * spots while looking at the email.
   *
   * Like `suggestion`, it is not tied to selection, hover or a drag. A
   * Diagnostic about the email as a whole names no Block, and is not drawn.
   * A Block the Stage hides has no rectangle, and is not drawn either.
   */
  readonly diagnostic?: ComponentType<DiagnosticChromeProps>;
}
