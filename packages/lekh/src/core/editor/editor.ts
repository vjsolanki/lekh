import {
  createImageRequests,
  NO_FILES,
  NO_IMAGE_REQUESTS,
  assetOf,
  type Asset,
  type ImagePlacement,
  type ImageRequestReason,
  type ImageRequestState,
  type ImageRequests,
  type ImageResolver,
} from "../document/assets";
import {
  createActionKernel,
  type Action,
  type ActionVia,
  type Unsubscribe,
} from "./action";
import {
  describeControls,
  type ControlActions,
  type ControlDescriptor,
  type SuggestedBlock,
} from "./controls";
import {
  createDivisions,
  type Division,
  type Divisions,
} from "../layout/division";
import { propWrite, type Fallback } from "./prop-write";
import type { Stage } from "../layout/responsive";
import {
  SchemaKind,
  assetPropOf,
  richTextPropOf,
  type BlockDefinition,
} from "../document/definition";
import type {
  Diagnostic,
  SeverityOverrides,
  ValidationSetup,
  Validator,
} from "../validate/diagnostic";
import type { Block, EmailDocument } from "../document/document";
import type {
  DropOutcome,
  DropRefusal,
  DropTarget,
  DropTargetQuery,
  DropTargetsQuery,
} from "./drop-target";
import {
  explainDropRefusal,
  getDropTargets,
  resolveDropTarget,
} from "./drop-target";
import { createHistory, type Grouping } from "./history";
import { createDefaultIdFactory } from "../document/id";
import { migrateDocument } from "../document/migrate";
import { resolveProps, rootPropsOf } from "../document/props";
import { surfaceBehind, type Painted } from "../document/behind";
import {
  carryOut,
  planInsert,
  planMove,
  planRemove,
  type CarryOutSetup,
} from "./carry-out";
import { LOCAL_ORIGIN, type Op, type SetPropOp } from "./op";
import { decidePlacement, reindex, type PlacementIntent } from "./placement";
import type { Edit } from "../document/edit";
import { knownRepair, type Repair } from "../validate/repair";
import { createReplay } from "./replay";
import {
  assertUsableConfiguration,
  canInsertInto,
  createRegistry,
  hasCapacity,
  structuralChildrenOf,
} from "../document/registry";
import { createPendingChanges, type PendingChange } from "./pending-change";
import { seedDocument } from "./seed";
import { createStore } from "./store";
import {
  createSuggestions,
  type SuggestOptions,
  type Suggestion,
  type SuggestionEvent,
  type SuggestionRefusal,
} from "./suggestion";
import type { TextEditOptions, TextEngine } from "./text-engine";
import {
  ancestorsOf,
  childrenOf,
  cloneWithNewIds,
  collectBlocks,
  findBlock,
  findLocation,
} from "../document/tree";
import { unreachable } from "./unreachable";
import { collectDiagnostics } from "../validate/validate";

export type { Action, ActionVia, Unsubscribe } from "./action";
export type { PendingChange } from "./pending-change";
export type {
  AcceptOutcome,
  ExtendOutcome,
  FinishOutcome,
  SuggestOptions,
  Suggestion,
  SuggestionBase,
  SuggestionBaseValue,
  SuggestionJSON,
  SuggestionEvent,
  SuggestionRefusal,
  SuggestionStatus,
} from "./suggestion";
export type {
  EditRefusal,
  EditRefusalCode,
  SuggestionTouch,
} from "./carry-out";

export interface EditorOptions {
  /** The Block Definitions this editor offers. Composed by the Consumer. */
  readonly definitions: readonly BlockDefinition[];
  /**
   * The type of the Document's root Block. Defaults to the root type of
   * `document` when one is supplied.
   */
  readonly rootType?: string;
  /**
   * An existing Document. Omit to start a new one, seeded with the Required
   * Blocks so an Author never begins in an invalid state.
   */
  readonly document?: EmailDocument;
  /** Extra Validators, for constraints the library knows nothing about. */
  readonly validators?: readonly Validator[];
  /** Raise or lower a Diagnostic's severity by code. */
  readonly severities?: SeverityOverrides;
  /** Stamped onto every Op this editor produces. Defaults to `"local"`. */
  readonly origin?: string;
  /**
   * Which Stage the editor opens in. Defaults to `"desktop"`.
   *
   * A mobile-first team can start on the mobile Stage; a product that does not
   * want the concept at all simply never offers a way to leave the default, and
   * nothing about Mobile Overrides ever surfaces.
   */
  readonly stage?: Stage;
  readonly createId?: () => string;
  readonly textEngine?: TextEngine;
  /**
   * Produce an Asset when the editor needs an image — an image Block dropped
   * from the palette, a file dragged onto the Canvas, a screenshot pasted.
   *
   * The one hook for every route, so a Consumer has a single place to decide
   * what happens: open an asset gallery, upload directly, or behave
   * differently per reason. Leave it out and image Blocks are inserted empty
   * for the Consumer's own controls to fill in.
   */
  readonly resolveImage?: ImageResolver;
  /**
   * How long a pause ends a run of sets on one prop, in milliseconds. Defaults
   * to 500, the same as the Text Engine's option of the same name.
   *
   * A Consumer who calls `set` on every move of a control still gets one undo
   * step per drag: sets on the same Block, prop and Stage that arrive within
   * this delay of each other undo together. Each still sends its own Op.
   */
  readonly newGroupDelay?: number;
}

/** What became of a placement. */
export type PlaceOutcome =
  /** The Block is in the Document. */
  | { readonly status: "inserted"; readonly blockId: string }
  /**
   * An Asset was asked for, and the Block appears once one arrives. Nothing is
   * in the Document yet, and nothing may ever be — the Author can cancel.
   */
  | { readonly status: "requested" }
  /** Nothing happened, and no Op was recorded. */
  | { readonly status: "refused" };

const REFUSED: PlaceOutcome = { status: "refused" };

const REQUESTED: PlaceOutcome = { status: "requested" };

/**
 * A child the Author can only get by asking the Block that owns it.
 *
 * Data with nothing renderable in it (ADR-0002): the Consumer draws the button
 * and supplies the verb. The `label` is the child's own — "Column" — so a
 * sidebar can offer "Add column" while knowing nothing about what a column is.
 *
 * Deliberately not a `ControlDescriptor`. That type describes a prop — `value`,
 * `overridable`, `origin`, `clearOverride` — and every one of those would
 * be a lie in a field that carries an action.
 */
export interface AddableChild {
  readonly type: string;
  /** The child's own label, for a Consumer to build a verb around. */
  readonly label: string;
  /**
   * Add one, after the Block's existing children.
   *
   * Returns nothing, and leaves the selection where it is — on the parent,
   * which is what put the affordance on screen in the first place. Selecting
   * the new child would take the affordance away with it, so an Author going
   * from two columns to four would have to reselect the row between clicks.
   */
  readonly add: () => void;
}

const NO_ADDABLE_CHILDREN: readonly AddableChild[] = [];

/**
 * A child the Author configures through the Block that owns it.
 *
 * The counterpart to {@link AddableChild}, and the other half of the same
 * bargain: a structural Block cannot be selected, so its props can never reach
 * {@link Editor.getControls}, which describes the selection and nothing else.
 * Without this a column's padding and width would be in the Document with no
 * route to an Inspector at all.
 *
 * `controls` are ordinary Control Descriptors for the child, on the Stage the
 * editor is on — the same ones the child would have produced when it was
 * selectable, so a Consumer renders them with the code they already have.
 *
 * The removal sits here rather than beside it because it is the same question
 * asked of the same Block: a row's panel is where a column is configured, and
 * deleting one is a thing done to a column.
 */
export interface EditableChild {
  readonly blockId: string;
  /** The child's own label — "Column" — for a Consumer to head a group with. */
  readonly label: string;
  readonly controls: readonly ControlDescriptor[];
  /**
   * Whether {@link EditableChild.remove} would do anything, from
   * {@link Editor.canRemove} — false for the last children a `minChildren`
   * holds in place, so the affordance disables rather than doing nothing.
   */
  readonly canRemove: boolean;
  /**
   * Delete this child.
   *
   * Leaves the selection where it is, on the parent — for the reason
   * {@link AddableChild.add} does. Taking the selection away would take the
   * panel the Author is working in away with it.
   */
  readonly remove: () => void;
}

const NO_EDITABLE_CHILDREN: readonly EditableChild[] = [];

/**
 * Holds the Document and is the only thing that changes it.
 *
 * The Document is not handed back on every keystroke — a Consumer reads it
 * when they choose and subscribes to Ops to persist patches (ADR-0004).
 */
export interface Editor {
  getDocument(): EmailDocument;
  getBlock(id: string): Block | undefined;
  getDefinition(type: string): BlockDefinition | undefined;
  /** Every Block Definition composed into this editor, for a palette. */
  getDefinitions(): readonly BlockDefinition[];

  /**
   * Called after any change to the Document, the selection, which Block is
   * being edited, or the Diagnostics.
   *
   * **Once per action, whatever it takes to carry out.** A Block landing from
   * an upload is an insertion, a selection and a request leaving the list, and
   * a subscriber is told when all three are done — never in between, where the
   * new Block is in the Document and the old one is still selected.
   *
   * Everything the editor reports has settled by the time a listener runs: the
   * Document, the selection, the outstanding Image Requests, and the history,
   * so `canUndo` inside a listener already accounts for the action that woke
   * it. Op subscribers have all run by then too.
   */
  subscribe(listener: () => void): Unsubscribe;
  /**
   * Called with every Op applied, local or external.
   *
   * Per Op and in order, including inside an action that announces once — a
   * Consumer persisting patches from this stream is recording edits, not
   * actions (ADR-0004). Runs before the change listeners for the same action,
   * so a patch is written before anything reacts to the state it produced.
   */
  onOp(listener: (op: Op) => void): Unsubscribe;
  /**
   * Called when a Block should be brought into view.
   *
   * Last of the three, after the change listeners for the same action, so
   * everything that renders the Document has already been told it moved.
   *
   * **The Block is not on the page yet.** The library is renderer-agnostic
   * (ADR-0001) and cannot know when a Consumer's framework has committed, so
   * a listener that looks the Block up straight away will not find one that
   * has just been inserted — and every reveal the library raises follows an
   * insertion. Defer a frame:
   *
   * ```ts
   * editor.onReveal((blockId) => {
   *   requestAnimationFrame(() => scrollTo(blockId));
   * });
   * ```
   */
  onReveal(listener: (blockId: string) => void): Unsubscribe;
  /**
   * The last Action: how it came about and which Blocks it touched, or
   * `undefined` before the first.
   *
   * Set before change listeners run, so a listener reads the Action that woke
   * it. The same object until the next one, so it can be selected from
   * directly (ADR-0011). Hovering and a drag in flight are not Actions. An undo
   * of text is, naming its Block, though no Op changed the Document.
   */
  getLastAction(): Action | undefined;

  /**
   * Set a prop on the Stage the editor is on.
   *
   * On the mobile Stage this writes a Mobile Override and leaves the desktop
   * value untouched — but only for a prop whose Schema opted in. Anything else
   * is not a mobile concept at all and is set on the desktop value wherever an
   * Author happens to be standing, which is what keeps a resolved image or a
   * text edit from becoming an override nobody asked for.
   *
   * Refused, leaving no Op and no undo entry, when the Block is unknown. Also
   * refused for an Asset prop that lists Assets, when the value is a new
   * picture that is not one of them: that comes through
   * {@link Editor.replaceImage} (ADR-0030).
   */
  setProp(blockId: string, prop: string, value: unknown): boolean;
  /**
   * Show a value on the Canvas without storing it: open or move the Pending
   * Change (ADR-0032).
   *
   * No Op, no undo entry, and no change announcement — only pending listeners
   * are told. The Document, `getControls()` and the Diagnostics all stay on
   * the stored value until {@link Editor.commitPendingChange}.
   *
   * Several props at once are one change, for a control that links them,
   * like padding on all four sides: one Op per prop that differs from the
   * stored value, one undo step. Calling it again on the same Block replaces the
   * open props rather than adding to them.
   *
   * Only one is ever open. Calling it on another Block commits the open one
   * first, as its own step. So does any other local action, undo and redo
   * included.
   *
   * Refused, opening nothing, if any prop is one `setProp` would refuse, one
   * the Block's Schema does not have, or, on the mobile Stage, one that is not
   * Overridable.
   */
  setPendingChange(
    blockId: string,
    props: Readonly<Record<string, unknown>>,
  ): boolean;
  /**
   * Store the Pending Change, as one ordinary change: the Ops `setProp` would
   * write, one undo step, one announcement. `previousValue` is read now, not
   * when the drag began.
   *
   * A drag that ends on the stored value writes nothing and leaves nothing to
   * undo. False when nothing is pending, and when the Block has gone.
   */
  commitPendingChange(): boolean;
  /** Drop the Pending Change. Nothing to undo. False when nothing is pending. */
  cancelPendingChange(): boolean;
  /**
   * The open Pending Change, or `undefined`. The same object until it moves,
   * so it can be selected from directly (ADR-0011).
   */
  getPendingChange(): PendingChange | undefined;
  /**
   * Called when a Pending Change opens, moves, is committed or is dropped.
   *
   * On a commit, after the Op and change listeners, so nobody is ever shown a
   * frame with neither the old value nor the new one.
   */
  subscribeToPendingChange(listener: () => void): Unsubscribe;
  /**
   * What the Canvas shows: the Document with the Pending Change applied.
   *
   * **Not saved, and not for saving.** Save `getDocument()` or the Op stream.
   * This is for a Consumer's own live preview pane. The same object as
   * `getDocument()` when nothing is pending.
   */
  getDocumentWithPendingChange(): EmailDocument;
  /**
   * Show a change to the Author without making it: open a Suggestion
   * (ADR-0035). Every change from an Agent comes this way.
   *
   * No Op, no undo entry, and no change announcement. Only Suggestion
   * subscribers are told. It waits through selection and other edits, and
   * leaves an open Pending Change alone.
   *
   * Inserts and moves are placed by `after`, `before` or `parent`, and
   * turned into indices only on accept, against the Document as it reads
   * then. Each Edit reads the Document the ones before it left, so a later
   * one may name a Block an earlier one inserted. An Edit without a `stage`
   * is written on the Stage the editor shows now, whenever it is accepted.
   *
   * Refused whole, showing nothing, when there are no Edits or any one of
   * them could not be carried out against the Document now, with a reason
   * for each one that could not. An Agent is held to more than `setProp`
   * is: only props the Schema has, each the shape its kind says, and a
   * resolved Asset rather than a URL. One that applies and leaves a problem
   * is shown, with its `diagnostics`.
   *
   * Pass a saved Suggestion's JSON as the options to restore it. One that no
   * longer fits comes back `stale` rather than refused.
   *
   * With `streaming`, a first draft the Agent is still writing: it may start
   * with no Edits, grows with `extend` as they arrive, and cannot be accepted
   * until `finish`. Rejecting it any time leaves nothing.
   */
  suggest(
    edits: readonly Edit[],
    options?: SuggestOptions,
  ): Suggestion | SuggestionRefusal;
  /**
   * The open Suggestions, stale ones too, oldest first. The same array until
   * one comes, goes or goes stale, so it can be selected from directly
   * (ADR-0011).
   */
  getSuggestions(): readonly Suggestion[];
  /**
   * The open Suggestions touching a Block, the one an Author would decide on
   * first (ADR-0042). Finished and open ones come first, then any still
   * arriving, then stale ones, the newest first within each. So a stale one
   * is never first while another can be accepted.
   *
   * The front Suggestion is the first of these for the selected Block, when
   * it is `open`. Its keys, its card and its rows all read it from here.
   * None when nothing open touches the Block.
   *
   * The same array until a Suggestion comes, goes or changes.
   */
  getSuggestionsAt(blockId: string): readonly Suggestion[];
  /**
   * Called when a Suggestion is made, grows, is finished, goes stale, is
   * accepted or rejected, with which.
   *
   * On accept, after the Op and change listeners, so the Document already
   * holds what the Suggestion showed. The event carries the Ops it wrote. On
   * going stale, after the change listeners for the change that did it.
   */
  subscribeToSuggestions(
    listener: (event: SuggestionEvent) => void,
  ): Unsubscribe;
  /**
   * The Document with every open Suggestion applied, each reading the
   * Document the ones before it left. A stale one is left out.
   *
   * Given `without`, every open one but that: the email as it would read had
   * that Suggestion never come, for an Author holding a button to compare.
   *
   * **Not saved, and not for saving**, like
   * {@link Editor.getDocumentWithPendingChange}. Diagnostics read the stored
   * Document. The same object as `getDocument()` when none is open, and the
   * same object for the same `without` until the Document or the Suggestions
   * move.
   */
  getDocumentWithSuggestions(options?: {
    readonly without?: string;
  }): EmailDocument;
  /**
   * Drop a Mobile Override, so the prop follows the desktop value again.
   *
   * Works from either Stage. Refused when there is no override to drop, and
   * for a prop that is not Overridable, whose stored override counts for
   * nothing.
   *
   * Given several props of one Block, such as every side of a Box, drops their
   * overrides as one undo step. The ones without an override are passed over.
   * Refused when none has one, and whole when any is not Overridable.
   */
  clearMobileOverride(
    blockId: string,
    prop: string | readonly string[],
  ): boolean;
  /** Returns the new Block's id, or `undefined` when the insertion is refused. */
  insertBlock(
    type: string,
    parentId: string,
    index?: number,
    props?: Readonly<Record<string, unknown>>,
  ): string | undefined;
  /**
   * Move a Block. `toIndex` is counted as the Document reads now — the space
   * `resolveDropTarget` reports in — so a resolved Drop Target can be handed
   * straight here. Refused when the Block would not move, and when it would
   * leave a parent already at its `minChildren`, as {@link Editor.removeBlock}
   * is.
   *
   * `via` says how, for {@link Editor.getLastAction}. Pass `"command"` from
   * your own "Move to…" menu, so the move animates like Move up does.
   * Defaults to `"api"`.
   */
  moveBlock(
    blockId: string,
    toParentId: string,
    toIndex: number,
    options?: { readonly via?: ActionVia },
  ): boolean;
  /** Whether {@link Editor.moveBlock} would do something, on the same terms. */
  canMove(blockId: string, toParentId: string, toIndex: number): boolean;
  /**
   * Copies the Block and everything under it, just after it. Returns the
   * copy's id, or `undefined` for the root and where the parent is full.
   */
  duplicateBlock(blockId: string): string | undefined;
  /** Whether {@link Editor.duplicateBlock} would do something. */
  canDuplicate(blockId: string): boolean;
  /**
   * Delete a Block.
   *
   * Refused, with no Op and no undo entry, for a Block whose Definition says
   * `deletable: false`, and for one whose parent is already at its
   * `minChildren` — the last two columns of a row hold each other in place.
   * Ask {@link Editor.canRemove} first, so an affordance can be disabled
   * rather than left to do nothing.
   */
  removeBlock(blockId: string): boolean;
  /**
   * Record that the Text Engine changed a Block's text.
   *
   * The edit notification the whole design turns on: it pushes a marker onto
   * the document stack so history stays one chronological timeline, and pulls
   * the engine's text onto the Block so the Document is saveable. The marker
   * carries no text of its own — text content is not covered by the Op log.
   */
  markTextEdit(blockId: string, options?: TextEditOptions): boolean;

  canInsert(type: string, parentId: string): boolean;
  /**
   * Where a drag hovering at a point would land — or why it would not.
   *
   * Reports a refusal rather than going quiet, so a Canvas can tell an Author
   * that a container will not take what they are carrying instead of leaving
   * the drop to do nothing without a word.
   */
  resolveDropTarget(query: DropTargetQuery): DropOutcome;
  /**
   * Every place a drag may land, before the pointer has gone anywhere.
   *
   * The same rules as {@link Editor.resolveDropTarget}, so a place listed is
   * never one a drop would be refused at, and a move never lists a place
   * inside the Block being moved. Pass the rectangles to learn each parent's
   * layout axis too.
   */
  getDropTargets(query: DropTargetsQuery): DropTarget[];
  /**
   * Why a parent would refuse a Block of this type, if it would.
   *
   * The pointerless form of the question above, for the moment after a drop
   * has already been refused: `place` reports that nothing happened, and this
   * says what to tell the Author about it.
   */
  explainDropRefusal(
    parentId: string,
    type: string,
    movedBlockId?: string,
  ): DropRefusal | undefined;

  /**
   * Put a Block in the email, asking the Consumer for an image first where
   * that is what the Block needs.
   *
   * The one way a Block enters the Document by an Author's gesture — a palette
   * entry dropped or clicked, a file dropped, a screenshot pasted. Leave
   * `target` out and it lands after the selected Block, or at the end of the
   * email, and is scrolled into view; give one and the Author is left where
   * they are, because they are already looking at the place they chose.
   *
   * For a Block holding an Asset, nothing enters the Document until one
   * resolves (ADR-0010): a Document saved while a request is outstanding can
   * never carry a local object URL that means nothing tomorrow. Cancellation
   * produces no Op, and a failure leaves the Document exactly as it was.
   *
   * Refused, with no Op, when the type is unregistered, when no place will
   * take it, and when files came with an editor that has no `resolveImage` to
   * turn them into an Asset — swallowing an Author's file would be worse than
   * declining it.
   */
  place(intent: PlacementIntent): PlaceOutcome;
  /**
   * Ask the Consumer for an image to put in a Block that already exists.
   *
   * The reason defaults to `"replace"`. `"add"` and `"replace"` are taken
   * as the same ask: the request says `"add"` when the prop holds no image
   * and `"replace"` when it does. Other reasons pass through.
   *
   * `prop` names the Asset prop it lands in, and defaults to the Block's
   * Primary Asset. Name it to set an optional Asset, such as a section's
   * background. Clearing an optional Asset needs no request: it is
   * `setProp(blockId, prop, undefined)` (ADR-0026).
   *
   * The Document is untouched until an Asset arrives, and untouched entirely
   * if the Author cancels. Refused when no `resolveImage` was supplied, and
   * when the prop is not an Asset prop of the Block — or, with no `prop`, when
   * the Block has no Primary Asset.
   */
  replaceImage(
    blockId: string,
    reason?: ImageRequestReason,
    prop?: string,
  ): boolean;
  /**
   * Every outstanding image resolution, pending or failed.
   *
   * Chrome, not content — the Consumer draws the placeholder, the progress and
   * the retry, positioned by the placement each one carries.
   */
  getImageRequests(): readonly ImageRequestState[];
  /**
   * The Block type a dropped or pasted file becomes: the first composed
   * Definition with a prop of kind `asset`.
   *
   * Undefined when there is no such Definition, and when no `resolveImage` was
   * supplied — either way there is nowhere for a file to go, and the Canvas
   * leaves the drop to the browser rather than swallowing it.
   */
  getImageBlockType(): string | undefined;

  undo(): boolean;
  redo(): boolean;
  /**
   * Whether {@link undo} would do something — not merely whether anything was
   * ever recorded.
   *
   * A `text-edit` marker whose Block has scrolled out of the Canvas cannot be
   * carried out any more: the engine's history went with the surface. Undo
   * steps over such an entry rather than spending the Author's keystroke on
   * nothing, and this reports what undo would actually find.
   */
  canUndo(): boolean;
  /** Whether {@link redo} would do something, on the same terms. */
  canRedo(): boolean;

  /**
   * Apply Ops produced elsewhere. They never enter the local undo stack, and
   * selection is reconciled if one removes the selected Block. Conflicts
   * resolve last-write-wins in arrival order.
   *
   * Our own undo then leaves them alone: a step skips whatever they changed
   * since, and redo does not bring back a Block they removed (#121).
   *
   * A Pending Change stays open, even when an Op sets the same prop, so the
   * drag wins on commit. One that removes its Block, or a Block it sits in,
   * drops it.
   *
   * Nesting rules are *not* re-checked: arrival order is the documented
   * contract, and re-deriving it here would break it. A shape that only a
   * remote peer could have produced surfaces as a Diagnostic, not a refusal.
   */
  applyExternalOps(ops: readonly Op[]): void;

  getSelection(): string | undefined;
  /**
   * What selecting this Block would actually select.
   *
   * The same id back for almost everything. A structural Block answers with
   * the Block that owns it, because an Author reaches one only through its
   * parent — and `undefined` where there is nothing to reach, which is an
   * unregistered Block or one that has left the Document.
   *
   * {@link Editor.select} applies this itself, so a Consumer never has to call
   * it to be correct. It is here for the surfaces that draw *before* the press:
   * a hover outline, or a tree row that wants to show it is not a target. Both
   * are promises about what a press would do, and both would otherwise be
   * making that promise out of their own copy of a rule the library owns.
   */
  getSelectable(blockId: string): string | undefined;
  /**
   * Refused for unregistered Blocks — nothing may half-edit unknown data.
   *
   * Resolved through {@link Editor.getSelectable} first, so a press anywhere
   * inside a column lands on the row however it was routed here. `true` means
   * a Block is now selected, not that it is the one asked for.
   *
   * `via` says how, for {@link Editor.getLastAction}. Pass `"pointer"` from
   * your own tree or list, so a click there animates like one on the Canvas.
   * Defaults to `"api"`.
   */
  select(
    blockId: string | undefined,
    options?: { readonly via?: ActionVia },
  ): boolean;

  /**
   * The Block whose text the Author has entered, if any.
   *
   * Always the selected Block while it is set: entering a Block's text selects
   * it, and selecting anything else leaves it. A surface therefore never has to
   * reconcile the two, and never has to ask whether an Author who is typing is
   * also about to drag.
   */
  getEditing(): string | undefined;
  /**
   * Enter a Block's text, or leave with `undefined`.
   *
   * Refused for a Block with no rich-text prop, and for one an Author cannot
   * select — a structural Block belongs to its parent, and typing into one
   * would be a fourth route around that (see {@link Editor.getSelectable}).
   * `true` means the Block is now being edited.
   *
   * Leaving keeps the selection where it is. An Author who presses Escape has
   * finished with the words, not with the Block.
   */
  edit(blockId: string | undefined): boolean;

  /**
   * The Block under the Author's pointer, on the Canvas or in your own list.
   *
   * One piece of state for every surface, so hovering a Layers row outlines
   * the Block on the Canvas and hovering the Canvas lights the row. Dropped when
   * the Block leaves the Document.
   */
  getHovered(): string | undefined;
  /**
   * Say which Block the pointer is over, or `undefined` when it is over none.
   *
   * Resolved through {@link Editor.getSelectable}, like {@link Editor.select},
   * because a hover outline promises what a press would select. Refused for a
   * Block an Author cannot reach, and then hover stays where it was. The root
   * hovers nothing, as its background does on the Canvas.
   *
   * Not an Action and not History: change listeners are not told, so nothing
   * animates on every pointer move. Hover listeners are.
   */
  hover(blockId: string | undefined): boolean;
  /** Called whenever {@link Editor.getHovered} moves, and only then. */
  subscribeToHover(listener: () => void): Unsubscribe;

  reveal(blockId: string): void;

  /** Which form factor the Author is editing. */
  getStage(): Stage;
  /**
   * Switch Stage.
   *
   * One piece of state for both surfaces the Stage changes — the Canvas narrows
   * its frame so media queries genuinely fire, and the Inspector describes the
   * overridable props — so the Consumer's own toggle is one call and the two can
   * never disagree.
   */
  setStage(stage: Stage): void;

  /**
   * The selected Block's editable props, or the root's when nothing is
   * selected, for the Stage the editor is on.
   *
   * The same array by identity until the Document, the selection, the Stage or
   * the open Suggestions move — so this can be selected from directly, and an
   * Author typing does not re-render an Inspector describing another Block
   * (ADR-0011). True of
   * {@link Editor.getAddableChildren} and {@link Editor.getEditableChildren}
   * too.
   */
  getControls(): readonly ControlDescriptor[];
  /**
   * The children the selected Block can be asked for — the root's when nothing
   * is selected, as {@link Editor.getControls} does.
   *
   * A sibling to that method, and shaped like it: no arguments, reads the
   * current selection, hands back data with nothing renderable in it. Entirely
   * derived — the accepted types declared structural, which is to say the ones
   * an Author has no other way to reach.
   *
   * Empty for a Block already at its `maxChildren`, so the affordance
   * disappears at the ceiling rather than sitting there refusing. Empty too for
   * everything whose accepted types are all in the palette, which is most
   * things.
   */
  getAddableChildren(): readonly AddableChild[];
  /**
   * The selected Block's structural children, each with its own props — the
   * root's when nothing is selected, as {@link Editor.getControls} does.
   *
   * The third method shaped the same way, and the one that keeps a structural
   * Block editable after it stops being selectable. A row of columns answers
   * with one entry per column; almost everything else answers with nothing.
   *
   * One level deep on purpose. Seeding is one level deep, so a structural Block
   * never holds another, and a panel that nested arbitrarily would be
   * describing a shape the editor cannot produce.
   */
  getEditableChildren(): readonly EditableChild[];
  /**
   * How the selected Block is divided between its children — the root's
   * division when nothing is selected, as {@link Editor.getControls} does.
   *
   * The fourth method shaped the same way, and the one that lets a Consumer
   * draw a row as the thing it adds up to rather than as a column of numbers.
   * Undefined for everything whose children divide nothing, which is almost
   * everything, and undefined on the mobile Stage — a width there would be a
   * Mobile Override, and a column stacks to the full width of the phone anyway
   * (ADR-0016).
   *
   * Every number a Consumer needs is on the `Share`s, including the ceiling
   * this row's siblings impose and a preview of a gesture in flight, so nothing
   * outside the library recomputes the arithmetic the write will do. A Share's
   * `set` takes the route a Control Descriptor's does, through the one
   * prop-write rule, so a width cannot enter the Document two ways.
   */
  getDivision(): Division | undefined;
  /**
   * Whether {@link Editor.removeBlock} would do something.
   *
   * A sibling to {@link Editor.canInsert}, so a Consumer can disable a delete
   * affordance rather than leave it to do nothing quietly.
   *
   * Not the same question as a Definition's `deletable`. That is a permanent
   * fact about a type — what a padlock or a "required" tag reports — while this
   * is about one Block where it currently sits, and answers `false` for a
   * column that is merely the last one standing.
   */
  canRemove(blockId: string): boolean;
  getDiagnostics(): readonly Diagnostic[];
  /**
   * Carry out a Diagnostic's Repair, as the one action it is.
   *
   * The only thing that runs one: validation describes a Repair wherever it
   * runs, including on the render path, and this is where the description
   * becomes a change (ADR-0015).
   *
   * Refused, with no Op, for a kind this library did not describe and for a
   * known kind whose detail is missing or the wrong type — a Repair is data
   * and may have come from anywhere, so nothing here trusts its shape. Also
   * refused when the Document has moved on and the Repair no longer applies,
   * which is the same answer `setProp` and `select` already give.
   *
   * A Consumer whose own Validator attached its own kind switches on it first
   * and leaves this as the default branch, so a kind added here later can
   * never quietly take over one of theirs.
   */
  applyRepair(repair: Repair): boolean;
  /**
   * This editor's Definitions and Validators, shaped to hand straight to
   * `renderDocument`, so the editor and the render path cannot disagree about
   * what is valid:
   *
   * ```ts
   * renderDocument(editor.getDocument(), editor.getRenderOptions());
   * ```
   */
  getRenderOptions(): ValidationSetup;
}

/** Runs something as one Action that came about this way. */
type Actor = <TResult>(via: ActionVia, act: () => TResult) => TResult;

/** Each editor this module made, and how to say how its Actions came about. */
const actors = new WeakMap<Editor, Actor>();

/**
 * Run as one Action that came about this way.
 *
 * For the library's own surfaces, which hold only the public `Editor`:
 * Commands say `command` and the Canvas says `pointer`. An editor this module
 * did not make has no way to be told, so its Actions stay `api`.
 */
export function actVia<TResult>(
  editor: Editor,
  via: ActionVia,
  act: () => TResult,
): TResult {
  const actor = actors.get(editor);
  return actor ? actor(via, act) : act();
}

/**
 * Build an empty Document, seeded with one of each Required Block.
 *
 * Exported so a Consumer can create and store a Document without standing up
 * an editor first.
 */
export function createDocument(options: {
  readonly definitions: readonly BlockDefinition[];
  readonly rootType: string;
  readonly createId?: () => string;
}): EmailDocument {
  const registry = createRegistry(options.definitions);
  assertUsableConfiguration(registry, options.rootType);
  return seedDocument(
    registry,
    options.rootType,
    options.createId ?? createDefaultIdFactory(),
  );
}

export function createEditor(options: EditorOptions): Editor {
  const registry = createRegistry(options.definitions);
  const rootType = options.rootType ?? options.document?.root.type;
  if (rootType === undefined) {
    throw new TypeError(
      "createEditor needs a rootType, or a document to take one from.",
    );
  }
  assertUsableConfiguration(registry, rootType);

  const createId = options.createId ?? createDefaultIdFactory();
  const origin = options.origin ?? LOCAL_ORIGIN;
  const textEngine = options.textEngine;

  const store = createStore({
    document: options.document
      ? migrateDocument(options.document, registry)
      : seedDocument(registry, rootType, createId),
    registry,
    textEngine,
  });
  let selection: string | undefined;
  /**
   * The Block whose text the Author is in, which is always the selected one.
   *
   * Held beside the selection rather than derived from it, because the two
   * answer different questions about the same Block: what the Inspector
   * describes, and whether the next press is a caret or a drag.
   */
  let editing: string | undefined;
  let stage: Stage = options.stage ?? "desktop";
  /**
   * The Block under the pointer. Beside the selection, not part of it: it
   * moves on every pointer crossing, so it has its own listeners and never
   * wakes the change ones.
   */
  let hovered: string | undefined;
  let diagnostics: readonly Diagnostic[] | undefined;
  /**
   * What an Inspector reads, held together because all three describe the same
   * Block — the selection, or the root when there is none.
   *
   * A getter that builds a fresh object on every call re-renders every
   * component that selects from it, whatever hook sits in front (ADR-0011).
   * All four build objects carrying closures, and they are what an Inspector
   * reads on every change, so they are the ones that cannot be left to rebuild.
   */
  let controls: readonly ControlDescriptor[] | undefined;
  let addableChildren: readonly AddableChild[] | undefined;
  let editableChildren: readonly EditableChild[] | undefined;
  /**
   * The open Suggestions the two above were described with. A Suggestion
   * coming or going announces nothing, so it is checked on read instead.
   */
  let describedWith: readonly Suggestion[] | undefined;
  /**
   * Undefined means "not built yet" for the three above, but it is also a real
   * answer here — almost every Block divides nothing. Hence the second flag:
   * without it a container with no division would be re-described on every
   * read, which is the one thing this memo exists to stop.
   */
  let division: Division | undefined;
  let divisionKnown = false;

  /** Everything about a container's children dividing it (ADR-0016). */
  const divisions: Divisions = createDivisions({
    store,
    registry,
    origin,
    stage: () => stage,
  });
  /** What every Edit, and every insert, move and remove, is planned with. */
  const planning: CarryOutSetup = { registry, origin, divisions };

  const history = createHistory({
    origin,
    newGroupDelay: options.newGroupDelay ?? 500,
    text: {
      canUndo: (blockId) => textEngine?.canUndo(blockId) === true,
      canRedo: (blockId) => textEngine?.canRedo(blockId) === true,
    },
    // Read late: the divisions are built further down, and nothing is undone
    // before the editor exists.
    replay: (ops) => replay(store.get().root, ops),
  });

  /** The Definition a resolved Asset becomes, if this editor has one. */
  const imageDefinition = registry.all.find(
    (definition) => assetPropOf(definition) !== undefined,
  );
  let imageRequests: ImageRequests | undefined;

  // Before the kernel, whose `settle` reconciles it. It reaches the kernel
  // only when it is used, by which time the kernel exists.
  const pendingChange = createPendingChanges({
    store,
    opsFor: (blockId, props) => pendingOps(blockId, props),
    commit: (ops) => {
      commit(ops);
    },
    asOneAction: (act) => kernel.asOneAction(act),
    tellPending: () => {
      kernel.tellPending();
    },
  });
  const { commitFirst } = pendingChange;

  const kernel = createActionKernel({
    store,
    /**
     * Everything that has to be brought back into line once the Document has
     * moved, and before anyone is told that it did.
     *
     * None of these depends on the others; all of them depend on the Document
     * having settled, which is the whole reason they sit here rather than in
     * the listeners. Each belongs to whoever owns it — this is only the order.
     */
    settle: (ops) => {
      if (selection !== undefined && !store.block(selection)) {
        selection = undefined;
      }
      // A Block that has left the Document takes the caret with it, whether
      // it was deleted or an undo took back the insertion that brought it.
      if (editing !== undefined && !store.block(editing)) {
        editing = undefined;
      }
      if (hovered !== undefined && !store.block(hovered)) {
        hovered = undefined;
        kernel.tellHover();
      }
      pendingChange.reconcile();
      diagnostics = undefined;
      // An image on its way to a Block an Author has just deleted, or to a
      // container an undo has just taken back, has nowhere to land. Dropping
      // it here is what aborts the signal a Consumer is watching.
      imageRequests?.prune((blockId) => store.block(blockId) !== undefined);
      // Whoever changed it, a Suggestion they overlap can no longer be
      // accepted without clobbering them.
      suggestions.settle(ops);
    },
    // Diagnostics answer to the Document alone, which is why `settle` drops
    // those and this does not.
    forget: () => {
      controls = undefined;
      addableChildren = undefined;
      editableChildren = undefined;
      division = undefined;
      divisionKnown = false;
    },
  });
  const { announce, asOneAction } = kernel;

  /**
   * Apply Ops as one undoable local action.
   *
   * The history is recorded before anything runs, so a listener woken by the
   * change reads a `canUndo` that already accounts for it.
   */
  const commit = (ops: readonly Op[], grouping?: Grouping): void => {
    history.record(ops, grouping);
    kernel.run(ops);
  };

  /** The Block and where it sits, when its parent would take one more. */
  const duplicable = (blockId: string) => {
    const block = store.block(blockId);
    const location = findLocation(store.get().root, blockId);
    if (!block || !location) return undefined;
    if (!canInsertInto(registry, location.parent, block.type)) return undefined;
    return { block, location };
  };

  /**
   * The nearest Block at or above this one that an Author may reach.
   *
   * A structural Block belongs to its parent rather than to the Author, and
   * that has to hold for every route to one or it holds for none. Two routes
   * are closed where the affordance is built: it is not offered in the palette,
   * and it is not registered as draggable. Selection is the third, and it is
   * the one route every surface has — so it is closed here rather than in the
   * Canvas, where only presses on the Canvas would have obeyed it.
   *
   * An unregistered Block stops the walk instead of handing on to its parent.
   * Selecting unknown data is refused, and quietly selecting something else
   * would be a stranger answer than refusing.
   *
   * The walk always terminates: a root Block is never structural, so the worst
   * case is the root.
   */
  const selectableId = (blockId: string): string | undefined => {
    const reachable = (block: Block): boolean =>
      registry.get(block.type)?.structural !== true;

    const block = store.block(blockId);
    if (!block || !registry.has(block.type)) return undefined;
    if (reachable(block)) return blockId;

    for (const ancestor of ancestorsOf(store.get().root, blockId)) {
      if (registry.has(ancestor.type) && reachable(ancestor))
        return ancestor.id;
    }
    return undefined;
  };

  /**
   * The Block the Inspector is currently describing.
   *
   * The selection, or the root when there is none — the fallback all three of
   * the Inspector-facing methods make, held in one place so they cannot come to
   * disagree about which Block the panel is about.
   */
  const describedBlock = (): Block =>
    (selection === undefined ? undefined : store.block(selection)) ??
    store.get().root;

  /**
   * The root props a described Block follows (ADR-0022). None for the root
   * itself, which is what everything else follows.
   */
  const describedRootProps = (
    block: Block,
  ): Readonly<Record<string, unknown>> => {
    const root = store.get().root;
    return block === root
      ? {}
      : rootPropsOf(root, (type) => registry.get(type));
  };

  /**
   * The Surface behind each of a described Block's colour props, read from
   * the stored Document. Walked only when a colour asks.
   */
  const describedAgainst = (
    block: Block,
  ): ((prop: string) => string | undefined) => {
    let trail: readonly Painted[] | undefined;
    return (prop) => {
      if (trail === undefined) {
        const root = store.get().root;
        const rootProps = rootPropsOf(root, (type) => registry.get(type));
        trail = [...ancestorsOf(root, block.id).toReversed(), block].map(
          (each) => {
            const definition = registry.get(each.type);
            return {
              definition,
              props: resolveProps(
                each,
                definition,
                each === root ? {} : { rootProps },
              ),
            };
          },
        );
      }
      return surfaceBehind(trail, prop)?.value;
    };
  };

  /**
   * A described Block as the front Suggestion would leave it: the first one
   * at the selected Block, when it is open (ADR-0042). None with nothing
   * selected, and none when it sets no prop on this Block.
   */
  const describedSuggestion = (block: Block): SuggestedBlock | undefined => {
    if (selection === undefined) return undefined;
    const front = suggestions.at(selection).at(0);
    if (front?.status !== "open") return undefined;
    const props = front.touches
      .filter((touch) => touch.blockId === block.id)
      .flatMap((touch) => touch.props);
    if (props.length === 0) return undefined;
    const after = suggestions.applied(front.id);
    const changed = after && findBlock(after.root, block.id);
    if (!after || !changed) return undefined;
    return {
      suggestionId: front.id,
      block: changed,
      rootProps:
        changed.id === after.root.id
          ? {}
          : rootPropsOf(after.root, (type) => registry.get(type)),
      props,
    };
  };

  /** Drop the descriptors when the open Suggestions have moved since. */
  const redescribeForSuggestions = (): void => {
    const list = suggestions.list();
    if (describedWith === list) return;
    describedWith = list;
    controls = undefined;
    editableChildren = undefined;
  };

  /**
   * The prop-write rule (`prop-write.ts`) against the stored Document: the
   * Ops a write becomes, or `undefined` when it is refused. Public methods say
   * only `false`; why, the rule's own tests say.
   *
   * On the editor's Stage unless told otherwise: clearing a Mobile Override
   * works from either Stage.
   */
  const writeOps = (
    blockId: string,
    values: Readonly<Record<string, unknown>>,
    fallback: Fallback,
    how: {
      readonly stage?: Stage;
      readonly resolvedAsset?: boolean;
      readonly document?: EmailDocument;
    } = {},
  ): readonly SetPropOp[] | undefined => {
    const write = propWrite({
      document: how.document ?? store.get(),
      registry,
      origin,
      blockId,
      values,
      stage: how.stage ?? stage,
      fallback,
      resolvedAsset: how.resolvedAsset === true,
    });
    return "refused" in write ? undefined : write.ops;
  };

  /**
   * The Ops a Pending Change on these props would commit, or `undefined` when
   * it may not open.
   *
   * Stricter than `setProp`, which writes an unknown prop and, on the mobile
   * Stage, writes a prop that is not Overridable to its desktop value. Both
   * are fine for a resolved image or a text edit. Neither is a drag an
   * Inspector can show: the mobile Inspector does not describe such a prop.
   */
  const pendingOps = (
    blockId: string,
    props: Readonly<Record<string, unknown>>,
  ): readonly SetPropOp[] | undefined => writeOps(blockId, props, "refuse");

  /** Store the Ops a write becomes. False when it is refused or changes nothing. */
  const commitWrite = (
    ops: readonly SetPropOp[] | undefined,
    grouping?: Grouping,
  ): boolean => {
    if (ops === undefined || ops.length === 0) return false;
    commit(ops, grouping);
    return true;
  };

  /**
   * Carry out one Edit against the Document as it reads now (ADR-0036).
   *
   * The one path an Edit takes, whoever holds it: `setProp`, a Repair and a
   * Suggestion. So an Edit writes the same Ops, and refuses the same things,
   * wherever it came from. Only a Suggestion is held to what an Agent may
   * write as well.
   */
  const applyEdit = (edit: Edit, grouping: Grouping): boolean =>
    commitFirst(() => {
      const carried = carryOut(planning, [edit], {
        document: store.get(),
        stage,
        createId,
        strict: false,
      });
      if ("refused" in carried || carried.ops.length === 0) return false;
      commit(carried.ops, grouping);
      return true;
    });

  const suggestions = createSuggestions({
    store,
    createId,
    stage: () => stage,
    carryOut: (edits, document, onStage, idsFor) =>
      carryOut(planning, edits, {
        document,
        stage: onStage,
        createId: idsFor,
        strict: true,
      }),
    diagnose: (document) =>
      collectDiagnostics(document, {
        registry,
        validators: options.validators,
        severities: options.severities,
      }),
    handOffText: (ops) =>
      ops.flatMap((op): readonly Op[] => {
        if (
          op.kind !== "set-prop" ||
          (op.stage ?? "desktop") !== "desktop" ||
          typeof op.value !== "string"
        ) {
          return [op];
        }
        const block = store.block(op.blockId);
        const definition = block && registry.get(block.type);
        if (richTextPropOf(definition) !== op.prop) return [op];
        // The set stays, so the Op stream carries the text, and undo still
        // brings it back if the engine has let go of its history by then.
        return textEngine?.replaceText(op.blockId, op.value) === true
          ? [op, { kind: "text-edit", origin, blockId: op.blockId }]
          : [op];
      }),
    // Its own step, never folded: the Author pressed accept.
    write: (ops) => {
      commit(ops, "alone");
    },
    act: (act) => asOneAction(() => commitFirst(act)),
    tell: kernel.tellSuggestions,
  });

  /**
   * A set from a control, which refuses what `setProp` would write to the
   * desktop value: a control held from the desktop Stage cannot reach a
   * desktop value from mobile.
   */
  const inspectorSet = (
    blockId: string,
    prop: string,
    value: unknown,
    grouping: Grouping,
  ): boolean =>
    commitFirst(() =>
      commitWrite(writeOps(blockId, { [prop]: value }, "refuse"), grouping),
    );

  /** Drop Mobile Overrides on one Block, from either Stage. */
  const clearOverride = (
    blockId: string,
    prop: string | readonly string[],
  ): boolean =>
    commitFirst(() =>
      commitWrite(
        writeOps(
          blockId,
          Object.fromEntries(
            (typeof prop === "string" ? [prop] : prop).map((name) => [
              name,
              undefined,
            ]),
          ),
          "refuse",
          { stage: "mobile" },
        ),
      ),
    );

  /**
   * How every Control Descriptor and every Share writes back, wherever it came
   * from.
   *
   * Shared so a control on a structural child behaves exactly as one on the
   * selected Block does, and a Share exactly as the width's own control does —
   * same Stage handling, same override rules. A second copy of this is a
   * second place for mobile behaviour to drift.
   */
  const controlActions: ControlActions = {
    setProp: (blockId, prop, value) => {
      inspectorSet(blockId, prop, value, "fold");
    },
    clearOverride: (blockId, prop) => {
      clearOverride(blockId, prop);
    },
    reset: (blockId, prop) => {
      inspectorSet(blockId, prop, undefined, "alone");
    },
    preview: (blockId, prop, value) => {
      const props = { [prop]: value };
      // One control drags one prop. A drag on the Block's other props is a
      // different change, kept as its own step before this one opens. Another
      // Block's drag `open` keeps by itself.
      if (
        pendingChange.get()?.blockId === blockId &&
        !pendingChange.isOwnDrag(blockId, prop) &&
        pendingOps(blockId, props) !== undefined
      ) {
        commitFirst(() => pendingChange.open(blockId, props));
        return;
      }
      pendingChange.open(blockId, props);
    },
    commit: (blockId, prop, value) => {
      // Ending this prop's own drag on a value: move it there, then store it.
      if (pendingChange.isOwnDrag(blockId, prop)) {
        pendingChange.open(blockId, { [prop]: value });
        pendingChange.commit();
        return;
      }
      // Any other drag is kept, as its own step, before this one is set.
      inspectorSet(blockId, prop, value, "fold");
    },
    commitPending: () => {
      pendingChange.commit();
    },
    cancel: () => {
      pendingChange.cancel();
    },
  };

  const replay = createReplay({ registry, divisions });

  const editor: Editor = {
    getDocument: () => store.get(),
    getBlock: (id) => store.block(id),
    getDefinition: (type) => registry.get(type),
    getDefinitions: () => registry.all,

    subscribe: kernel.subscribe,
    onOp: kernel.onOp,
    onReveal: kernel.onReveal,
    getLastAction: kernel.lastAction,

    // A lone set may be one move of a drag the Consumer wired straight to
    // `set` (ADR-0032). A width pair is never lone, so it never folds.
    setProp: (blockId, prop, value) =>
      applyEdit({ kind: "set-prop", blockId, prop, value }, "fold"),

    setPendingChange: (blockId, props) => pendingChange.open(blockId, props),
    commitPendingChange: () => pendingChange.commit(),
    cancelPendingChange: () => pendingChange.cancel(),
    getPendingChange: () => pendingChange.get(),
    subscribeToPendingChange: kernel.subscribeToPendingChange,
    getDocumentWithPendingChange: () => pendingChange.shown(),

    suggest: suggestions.suggest,
    getSuggestions: suggestions.list,
    getSuggestionsAt: suggestions.at,
    subscribeToSuggestions: kernel.subscribeToSuggestions,
    getDocumentWithSuggestions: (leaving) =>
      suggestions.shown(leaving?.without),

    clearMobileOverride: clearOverride,

    insertBlock(type, parentId, index, props) {
      return commitFirst(() => {
        const planned = planInsert(planning, store.get(), {
          type,
          parentId,
          index,
          props,
          createId,
        });
        if ("refused" in planned) return undefined;
        commit(planned.ops);
        return planned.block.id;
      });
    },

    moveBlock(blockId, toParentId, toIndex, moving = {}) {
      return kernel.actVia(moving.via ?? "api", () =>
        commitFirst(() => {
          const planned = planMove(
            planning,
            store.get(),
            blockId,
            toParentId,
            toIndex,
          );
          if ("refused" in planned || planned.ops.length === 0) return false;
          commit(planned.ops);
          return true;
        }),
      );
    },

    canMove(blockId, toParentId, toIndex) {
      const planned = planMove(
        planning,
        store.get(),
        blockId,
        toParentId,
        toIndex,
      );
      return !("refused" in planned) && planned.ops.length > 0;
    },

    duplicateBlock(blockId) {
      return commitFirst(() => {
        const original = duplicable(blockId);
        if (!original) return undefined;
        const { block, location } = original;

        const copy = cloneWithNewIds(block, createId);
        commit([
          {
            kind: "insert",
            origin,
            parentId: location.parent.id,
            index: location.index + 1,
            block: copy,
          },
          // A copy arrives like any other child, so its row pays for it.
          ...divisions.opsForInsert(location.parent, location.index + 1, copy),
        ]);
        return copy.id;
      });
    },

    canDuplicate: (blockId) => duplicable(blockId) !== undefined,

    removeBlock(blockId) {
      return commitFirst(() => {
        const planned = planRemove(planning, store.get(), blockId);
        if ("refused" in planned) return false;
        commit(planned.ops);
        return true;
      });
    },

    canRemove: (blockId) =>
      !("refused" in planRemove(planning, store.get(), blockId)),

    markTextEdit(blockId, edit = {}) {
      return commitFirst(() => {
        const block = store.block(blockId);
        if (!block || !registry.has(block.type)) return false;

        // A coalesced edit gets no new undo entry, but the Op still goes out —
        // a Consumer autosaving from the stream has to know the text moved.
        const op: Op = { kind: "text-edit", origin, blockId };
        commit([op], edit.coalesce === true ? "coalesce" : "alone");
        return true;
      });
    },

    canInsert(type, parentId) {
      // Only registered types can be inserted at all: the forgiving rule that
      // lets an unregistered Block move applies to Blocks that already exist.
      if (!registry.has(type)) return false;
      const parent = store.block(parentId);
      return parent ? canInsertInto(registry, parent, type) : false;
    },

    resolveDropTarget: (query) =>
      resolveDropTarget(store.get(), registry, query),

    getDropTargets: (query) => getDropTargets(store.get(), registry, query),

    explainDropRefusal: (parentId, type, movedBlockId) =>
      explainDropRefusal(store.get(), registry, parentId, type, movedBlockId),

    place: (intent) => asOneAction(() => placeNow(intent)),

    replaceImage(blockId, reason = "replace", prop) {
      if (!imageRequests) return false;
      const block = store.block(blockId);
      const definition = block && registry.get(block.type);
      const target = prop ?? assetPropOf(definition);
      if (
        target === undefined ||
        definition?.schema[target]?.kind !== SchemaKind.asset
      ) {
        return false;
      }

      // Whether a picture is there decides between the two, not the caller:
      // a `"replace"` with nothing to replace would not be true (#166).
      const empty = assetOf(block?.props[target]) === undefined;
      const why =
        reason === "add" || reason === "replace"
          ? empty
            ? "add"
            : "replace"
          : reason;

      // Never revealed: the Author is looking at the Block already — they just
      // pressed a button on it.
      imageRequests.start(
        {
          reason: why,
          files: NO_FILES,
          placement: {
            kind: "replace",
            blockId,
            prop: target,
            decorative: definition.schema[target]?.decorative === true,
          },
        },
        false,
      );
      return true;
    },

    getImageRequests: () => imageRequests?.list() ?? NO_IMAGE_REQUESTS,
    getImageBlockType: () =>
      imageRequests ? imageDefinition?.type : undefined,

    // Committed first, so undo takes back the drag the Author saw and redo
    // brings it back.
    // History whoever asked, a Command included: what an Author sees is the
    // change coming back, not the key that brought it.
    undo: () => travel("undo"),
    redo: () => travel("redo"),

    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),

    // One action, so a drag dropped by these Ops is announced after the
    // change listeners, as a commit is.
    applyExternalOps(ops) {
      kernel.actAlwaysVia("remote", () => {
        history.remoteOps(ops);
        kernel.run(ops);
      });
    },

    getSelection: () => selection,

    getSelectable: selectableId,

    select: (blockId, selecting = {}) =>
      kernel.actVia(selecting.via ?? "api", () => selectNow(blockId)),

    getEditing: () => editing,

    edit(blockId) {
      if (blockId === undefined) {
        if (editing === undefined) return true;
        return commitFirst(() => {
          editing = undefined;
          announce();
          return true;
        });
      }
      // Not `selectableId`: a Block whose text an Author may type into is one
      // they may select, so anything that resolves elsewhere is refused rather
      // than quietly redirected. Redirecting would put the caret in a Block
      // nobody double-clicked.
      if (selectableId(blockId) !== blockId) return false;
      const block = store.block(blockId);
      if (!block || richTextPropOf(registry.get(block.type)) === undefined) {
        return false;
      }

      if (selection === blockId && editing === blockId) return true;
      return commitFirst(() => {
        selection = blockId;
        editing = blockId;
        announce();
        return true;
      });
    },

    getHovered: () => hovered,

    hover(blockId) {
      const reached = blockId === undefined ? undefined : selectableId(blockId);
      if (blockId !== undefined && reached === undefined) return false;
      // The root is the whole email. Outlining it says nothing, and pointing at
      // its background on the Canvas is pointing at no Block.
      const target = reached === store.get().root.id ? undefined : reached;
      if (target !== hovered) {
        hovered = target;
        kernel.tellHover();
      }
      return true;
    },

    subscribeToHover: kernel.subscribeToHover,

    reveal: kernel.reveal,

    getStage: () => stage,

    setStage(next) {
      if (stage === next) return;
      // Stored on the Stage it was dragged on, before the Stage moves.
      commitFirst(() => {
        stage = next;
        announce();
      });
    },

    getControls() {
      redescribeForSuggestions();
      if (controls === undefined) {
        // With nothing selected the Inspector describes the root, so email-wide
        // settings need no separate surface.
        const target = describedBlock();
        // Constrained on this route too, though nothing can reach a width
        // through it today — a width sits on a structural child, and a
        // structural child cannot be selected. That is a fact about which
        // Definitions exist rather than a rule anything enforces, so the
        // ceiling is applied wherever a Descriptor is made rather than only
        // where one is currently expected.
        controls = divisions.constrain(
          describeControls(
            target,
            registry.get(target.type),
            stage,
            controlActions,
            describedRootProps(target),
            describedAgainst(target),
            describedSuggestion(target),
          ),
        );
      }
      return controls;
    },

    getEditableChildren() {
      redescribeForSuggestions();
      if (editableChildren === undefined) {
        const target = describedBlock();
        const children = childrenOf(target).filter(
          (child) => registry.get(child.type)?.structural === true,
        );

        editableChildren =
          children.length === 0
            ? NO_EDITABLE_CHILDREN
            : children.map((child) => {
                const definition = registry.get(child.type);
                return {
                  blockId: child.id,
                  label: definition?.label ?? child.type,
                  controls: divisions.constrain(
                    describeControls(
                      child,
                      definition,
                      stage,
                      controlActions,
                      describedRootProps(child),
                      describedAgainst(child),
                      describedSuggestion(child),
                    ),
                  ),
                  canRemove: editor.canRemove(child.id),
                  remove: () => {
                    editor.removeBlock(child.id);
                  },
                };
              });
      }
      return editableChildren;
    },

    getDivision() {
      if (!divisionKnown) {
        division = divisions.describe(describedBlock(), controlActions);
        divisionKnown = true;
      }
      return division;
    },

    getAddableChildren() {
      if (addableChildren === undefined) {
        // The same fallback `getControls` makes, for the same reason: with
        // nothing selected the Inspector is describing the root.
        const target = describedBlock();
        const definition = registry.get(target.type);

        // At the ceiling there is nothing to offer, whatever the types say.
        addableChildren = hasCapacity(target, definition)
          ? structuralChildrenOf(registry, definition).map((child) => ({
              type: child.type,
              label: child.label,
              add: () => {
                // Through `insertBlock` like anything else. `structural`
                // governs what an Author can reach, not what the editor
                // will do.
                editor.insertBlock(child.type, target.id);
              },
            }))
          : NO_ADDABLE_CHILDREN;
      }
      return addableChildren;
    },

    getRenderOptions: () => ({
      definitions: registry.all,
      validators: options.validators,
      severities: options.severities,
    }),

    getDiagnostics() {
      diagnostics ??= collectDiagnostics(store.get(), {
        registry,
        validators: options.validators,
        severities: options.severities,
      });
      return diagnostics;
    },

    applyRepair(repair) {
      const known = knownRepair(repair);
      if (!known) return false;

      // A Repair is a button the Author pressed, so it is its own step.
      return asOneAction(() =>
        known.kind === "restore-required-block"
          ? restore(known.type)
          : applyEdit(known, "alone"),
      );
    },
  };

  /**
   * Append a missing Required Block, then select it and ask for it to be
   * revealed — a compliance repair must never happen off-screen (ADR-0006).
   *
   * Three calls, one action: the caller holds the change channel, so a
   * subscriber is never woken with the Block in the Document and the old
   * selection still standing.
   *
   * Refused for a type that is not Required, and for one the Document already
   * has. A Repair is data and outlives the reading that produced it, so this
   * one has to mean what it said — "the email is missing this" — rather than
   * "append one of these", which would put a second unsubscribe link in front
   * of an Author who had already fixed it by hand.
   */
  function restore(type: string): boolean {
    if (!registry.required.some((definition) => definition.type === type)) {
      return false;
    }
    if (collectBlocks(store.get().root).some((block) => block.type === type)) {
      return false;
    }

    const id = editor.insertBlock(type, store.get().root.id);
    if (id === undefined) return false;
    editor.select(id);
    editor.reveal(id);
    return true;
  }

  /** Undo or redo, as History whoever asked. */
  function travel(direction: "undo" | "redo"): boolean {
    return commitFirst(() => {
      const ops = direction === "undo" ? history.undo() : history.redo();
      if (!ops) return false;
      kernel.actAlwaysVia("history", () => {
        kernel.run(ops, direction);
      });
      return true;
    });
  }

  /** The body of `select`, run inside one action. */
  function selectNow(blockId: string | undefined): boolean {
    // Each branch asks first whether anything would move. One that would
    // not is no action, and leaves a drag open.
    if (blockId === undefined) {
      if (selection === undefined && editing === undefined) return true;
      return commitFirst(() => {
        selection = undefined;
        editing = undefined;
        announce();
        return true;
      });
    }
    const target = selectableId(blockId);
    if (target === undefined) return false;
    // Pressing the Block being edited moves nothing, and leaves the caret
    // where the Author just put it.
    if (selection === target) return true;
    return commitFirst(() => {
      selection = target;
      // The selection moving is what ends an edit, so no surface has to
      // remember to: a press on another Block already comes through here.
      editing = undefined;
      announce();
      return true;
    });
  }

  /** The body of `place`, run inside one action. */
  function placeNow(intent: PlacementIntent): PlaceOutcome {
    const decision = decidePlacement(
      store.get(),
      registry,
      {
        selection,
        canRequest: imageRequests !== undefined,
        imageType: imageDefinition?.type,
      },
      intent,
    );

    switch (decision.kind) {
      case "refuse":
        return REFUSED;
      case "request":
        if (!imageRequests) return REFUSED;
        imageRequests.start(decision.facts, decision.reveal);
        return REQUESTED;
      case "insert": {
        const blockId = editor.insertBlock(
          decision.type,
          decision.parentId,
          decision.index,
        );
        if (blockId === undefined) return REFUSED;
        settleOn(blockId, decision.reveal);
        return { status: "inserted", blockId };
      }
      default:
        return unreachable(decision);
    }
  }

  /**
   * Hand the Author the Block that has just appeared.
   *
   * Always selected, so the Inspector is already describing it. Revealed only
   * when they did not choose the position themselves — a Block dropped where
   * they were looking needs no scrolling, and one arriving after an upload
   * they have stopped watching does.
   */
  function settleOn(blockId: string, reveal: boolean): void {
    editor.select(blockId);
    if (reveal) editor.reveal(blockId);
  }

  /** The single moment an image resolution touches the Document. */
  function landAsset(
    placement: ImagePlacement,
    asset: Asset,
    reveal: boolean,
  ): boolean {
    // Past the check on listed Assets: this is the request that check sends
    // every other picture to.
    return commitFirst(() => {
      if (placement.kind === "replace") {
        return commitWrite(
          writeOps(placement.blockId, { [placement.prop]: asset }, "desktop", {
            resolvedAsset: true,
          }),
        );
      }

      const prop = assetPropOf(registry.get(placement.type));
      if (prop === undefined) return false;
      const blockId = editor.insertBlock(
        placement.type,
        placement.target.parentId,
        reindex(store.get(), placement.target),
        { [prop]: asset },
      );
      if (blockId === undefined) return false;
      settleOn(blockId, reveal);
      return true;
    });
  }

  if (options.resolveImage) {
    imageRequests = createImageRequests({
      resolve: options.resolveImage,
      createId,
      place: landAsset,
      announce,
      asOneAction,
    });
  }

  actors.set(editor, (via, act) => kernel.actVia(via, act));
  return editor;
}
