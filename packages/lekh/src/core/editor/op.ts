import type { Block } from "../document/document";
import type { Stage } from "../layout/responsive";
import { unreachable } from "./unreachable";
import {
  findBlock,
  findLocation,
  insertChild,
  removeChildAt,
  replaceBlock,
} from "../document/tree";

/**
 * Who produced an Op, so a Consumer can tell their own edits apart from ones
 * they applied from elsewhere. Defaults to `"local"`.
 */
export const LOCAL_ORIGIN = "local";

interface OpBase {
  readonly origin: string;
}

/**
 * Set one prop on one Block.
 *
 * `undefined` means the prop is unset and resolves to its Schema default, so
 * Documents stay small and defaults stay changeable.
 */
export interface SetPropOp extends OpBase {
  readonly kind: "set-prop";
  readonly blockId: string;
  readonly prop: string;
  readonly value: unknown;
  readonly previousValue: unknown;
  /**
   * Which Stage the value belongs to. Absent means desktop.
   *
   * A mobile set writes a Mobile Override and leaves the desktop value alone;
   * clearing one is the same Op with an `undefined` value. Both are ordinary
   * Ops, so both invert and both are undoable — there is no second write path.
   */
  readonly stage?: Stage;
}

export interface InsertOp extends OpBase {
  readonly kind: "insert";
  readonly parentId: string;
  readonly index: number;
  /** The whole subtree, so the Op can be inverted and replayed. */
  readonly block: Block;
}

export interface RemoveOp extends OpBase {
  readonly kind: "remove";
  readonly parentId: string;
  readonly index: number;
  readonly block: Block;
}

/**
 * Move a Block to a different parent or position.
 *
 * Both indices are positions in that parent's children with the moved Block
 * absent, which is what makes the Op its own inverse under a swap.
 */
export interface MoveOp extends OpBase {
  readonly kind: "move";
  readonly blockId: string;
  readonly fromParentId: string;
  readonly fromIndex: number;
  readonly toParentId: string;
  readonly toIndex: number;
}

/**
 * A marker that a Block's text changed.
 *
 * The Document holds no text content — that lives in the Text Engine
 * (ADR-0005) — so this Op carries none. It exists to keep one chronological
 * timeline: undoing it delegates back to the engine for that Block.
 */
export interface TextEditOp extends OpBase {
  readonly kind: "text-edit";
  readonly blockId: string;
}

/** A single serialisable change to a Document. The only write path there is. */
export type Op = SetPropOp | InsertOp | RemoveOp | MoveOp | TextEditOp;

/**
 * The Op that sets `prop` on `block` to `value`, or `undefined` when it would
 * change nothing.
 *
 * The one place a set-prop Op is built. Which value a write should go to is
 * not decided here: that is the prop-write rule in `prop-write.ts`.
 */
export function setPropOp(
  block: Block,
  prop: string,
  value: unknown,
  origin: string,
  stage: Stage = "desktop",
): SetPropOp | undefined {
  const mobile = stage === "mobile";
  const previousValue = mobile ? block.mobile?.[prop] : block.props[prop];
  if (Object.is(previousValue, value)) return undefined;
  return {
    kind: "set-prop",
    origin,
    blockId: block.id,
    prop,
    value,
    previousValue,
    ...(mobile ? { stage } : {}),
  };
}

/** Apply an Op to a tree. Pure; unknown targets leave the tree untouched. */
export function applyOp(root: Block, op: Op): Block {
  switch (op.kind) {
    case "set-prop": {
      const block = findBlock(root, op.blockId);
      if (!block) return root;
      return replaceBlock(
        root,
        op.stage === "mobile"
          ? withOverride(block, op.prop, op.value)
          : { ...block, props: withProp(block.props, op.prop, op.value) },
      );
    }
    case "insert":
      return insertChild(root, op.parentId, op.index, op.block);
    case "remove": {
      // Located by identity rather than by the recorded index, so a removal
      // still hits the right Block after an interleaved external Op.
      const location = findLocation(root, op.block.id);
      if (!location) return root;
      return removeChildAt(root, location.parent.id, location.index);
    }
    case "move": {
      const block = findBlock(root, op.blockId);
      if (!block) return root;
      const location = findLocation(root, op.blockId);
      if (!location) return root;
      const detached = removeChildAt(root, location.parent.id, location.index);
      return insertChild(detached, op.toParentId, op.toIndex, block);
    }
    case "text-edit":
      // Text content is not in the Document; the marker changes nothing here.
      return root;
    default:
      return unreachable(op);
  }
}

/** The Op that undoes `op`. */
export function invertOp(op: Op, origin: string): Op {
  switch (op.kind) {
    case "set-prop":
      return {
        ...op,
        origin,
        value: op.previousValue,
        previousValue: op.value,
      };
    case "insert":
      return { ...op, origin, kind: "remove" };
    case "remove":
      return { ...op, origin, kind: "insert" };
    case "move":
      return {
        ...op,
        origin,
        fromParentId: op.toParentId,
        fromIndex: op.toIndex,
        toParentId: op.fromParentId,
        toIndex: op.fromIndex,
      };
    case "text-edit":
      return { ...op, origin };
    default:
      return unreachable(op);
  }
}

/**
 * Write, or clear, one Mobile Override.
 *
 * The `mobile` object goes entirely once its last override does, so a Block an
 * Author experimented on and then reverted is stored exactly as it was before —
 * the same round-trip guarantee an unset prop already has.
 */
function withOverride(block: Block, prop: string, value: unknown): Block {
  const overrides = withProp(block.mobile ?? {}, prop, value);
  if (Object.keys(overrides).length > 0) return { ...block, mobile: overrides };

  if (block.mobile === undefined) return block;
  const next = { ...block };
  delete next.mobile;
  return next;
}

function withProp(
  props: Readonly<Record<string, unknown>>,
  prop: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value === undefined) {
    if (!Object.hasOwn(props, prop)) return props;
    const next = { ...props };
    delete next[prop];
    return next;
  }
  return { ...props, [prop]: value };
}
