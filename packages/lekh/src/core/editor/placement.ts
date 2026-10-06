import {
  NO_FILES,
  type ImageRequestFacts,
  type ImageRequestReason,
} from "../document/assets";
import { assetPropOf } from "../document/definition";
import type { EmailDocument } from "../document/document";
import type { DropTarget } from "./drop-target";
import { canInsertInto, type Registry } from "../document/registry";
import { childrenOf, findBlock, findLocation } from "../document/tree";

/**
 * What an Author did, as the caller understands it.
 *
 * Deliberately not coordinates plus a policy: a caller says a Block was
 * dropped here, or that files arrived, and the rules for what that means live
 * in one place rather than at each of the four gestures that can mean it.
 */
export interface PlacementIntent {
  readonly reason: ImageRequestReason;
  /** Files the Author supplied, for a drop or a paste. */
  readonly files?: readonly File[];
  /**
   * Where it lands. Left out when the Author pointed at nothing — a clicked
   * palette entry, a pasted screenshot — and the library decides.
   */
  readonly target?: DropTarget;
  /** The Block type to create. Defaults to the editor's image Block type. */
  readonly type?: string;
}

/** What the editor knows that the rules need. */
export interface PlacementContext {
  readonly selection: string | undefined;
  /** Whether a Consumer supplied a resolver, so an Asset can be asked for. */
  readonly canRequest: boolean;
  /** The Block type a file becomes: the first Definition with an Asset prop. */
  readonly imageType: string | undefined;
}

/**
 * What should happen, decided but not yet done.
 *
 * A value rather than an effect, so every branch below is answerable without
 * an editor, a resolver or a clock — the arbitration between "ask first" and
 * "insert now" is the part that used to be written at each call site and
 * tested at none of them.
 */
export type Placement =
  | {
      readonly kind: "insert";
      readonly type: string;
      readonly parentId: string;
      readonly index: number;
      readonly reveal: boolean;
    }
  | {
      readonly kind: "request";
      readonly facts: ImageRequestFacts;
      readonly reveal: boolean;
    }
  | { readonly kind: "refuse" };

const REFUSE: Placement = { kind: "refuse" };

/**
 * Decide where a Block goes and what it takes to put it there.
 *
 * Pure, in the same shape as `resolveDropTarget` and for the same reason: the
 * rules stay readable side by side and testable without a browser. Nothing
 * here touches the Document — the store applies what this returns (ADR-0004).
 */
export function decidePlacement(
  document: EmailDocument,
  registry: Registry,
  context: PlacementContext,
  intent: PlacementIntent,
): Placement {
  const type = intent.type ?? context.imageType;
  // Only a registered type can be inserted at all. The forgiving rule that
  // lets an unregistered Block move (ADR-0006) is about Blocks a Document
  // already holds, and would otherwise let this decide to create one.
  if (type === undefined || !registry.has(type)) return REFUSE;

  const target =
    intent.target ?? defaultTarget(document, registry, context, type);
  const parent = findBlock(document.root, target.parentId);
  if (!parent || !canInsertInto(registry, parent, type)) return REFUSE;

  // The Author pointed at a position, or they did not. Everything downstream
  // that cares about their attention — scrolling now, scrolling when an Asset
  // finally arrives — turns on this one fact.
  const reveal = intent.target === undefined;
  const files = intent.files ?? NO_FILES;

  if (context.canRequest && assetPropOf(registry.get(type)) !== undefined) {
    // Nothing enters the Document until an Asset resolves (ADR-0010). The
    // target is frozen here: the recorded index goes stale, but the Block it
    // was aimed at is an identity that does not.
    return {
      kind: "request",
      facts: {
        reason: intent.reason,
        files,
        placement: { kind: "insert", type, target },
      },
      reveal,
    };
  }

  // Files arrived and there is nobody to turn them into an Asset. Inserting an
  // empty Block and dropping the Author's JPEG on the floor is the swallowing
  // ADR-0010 refuses; declining lets the Canvas leave the event to the browser.
  if (files.length > 0) return REFUSE;

  return {
    kind: "insert",
    type,
    parentId: target.parentId,
    index: target.index,
    reveal,
  };
}

/**
 * Where a Drop Target's index points *now*.
 *
 * A resolution outlives the gesture that started it, and an Author is free to
 * keep editing while it runs, so the position is read off the Block it was
 * aimed at again at the last moment — otherwise an image dropped under a
 * paragraph lands somewhere else entirely because something above it was
 * deleted meanwhile. Where that Block has gone too, the recorded index stands.
 */
export function reindex(document: EmailDocument, target: DropTarget): number {
  if (target.referenceBlockId === undefined) return target.index;
  const location = findLocation(document.root, target.referenceBlockId);
  if (!location || location.parent.id !== target.parentId) return target.index;
  return target.position === "after" ? location.index + 1 : location.index;
}

/**
 * Where a Block goes when the Author pointed at nothing.
 *
 * After the selected Block, which is where someone looking at a Block expects
 * the next thing to appear, and at the end of the email when nothing is
 * selected or the selection's parent will not take it. One rule for a pasted
 * screenshot and a clicked palette entry alike: both are the same question
 * about where an Author's attention is.
 */
function defaultTarget(
  document: EmailDocument,
  registry: Registry,
  context: PlacementContext,
  type: string,
): DropTarget {
  const root = document.root;
  const location =
    context.selection === undefined
      ? undefined
      : findLocation(root, context.selection);

  if (location && canInsertInto(registry, location.parent, type)) {
    return {
      parentId: location.parent.id,
      index: location.index + 1,
      position: "after",
      referenceBlockId: context.selection,
    };
  }

  return {
    parentId: root.id,
    index: childrenOf(root).length,
    position: "inside",
  };
}
