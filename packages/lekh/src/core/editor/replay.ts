import { widthPropOf } from "../document/definition";
import { isDivided, type Divisions } from "../layout/division";
import type { Block } from "../document/document";
import { applyOp, type Op } from "./op";
import {
  hasCapacity,
  hasSpareChild,
  type Registry,
} from "../document/registry";
import {
  childrenOf,
  clamp,
  containsBlock,
  findBlock,
  findLocation,
  walk,
} from "../document/tree";
import { unreachable } from "./unreachable";

export interface ReplaySetup {
  readonly registry: Registry;
  /** Only the two rebalances, which read the parent they are handed. */
  readonly divisions: Pick<Divisions, "opsForInsert" | "opsForRemove">;
}

/**
 * The Ops of one undo or redo step that are still ours to carry out, against
 * the Document as it stands (#121).
 *
 * A peer's Ops never enter our History (ADR-0004), but they do change the
 * Blocks our entries name. Replayed blind, an entry would write back over a
 * peer's newer value, or bring back a Block the peer removed. So each Op is
 * checked first, and one a peer has since changed is left out:
 *
 * - a set, unless the prop still holds the value this step expects to find;
 * - a removal, unless the Block is still there;
 * - an insertion, if the Block is already there or its parent has gone;
 * - a move, unless the Block is still where this step expects to find it.
 *
 * What is kept is rewritten to say where things actually are, so the step
 * inverts cleanly: undo then redo, with nothing between, comes back to the
 * same Document.
 *
 * Widths travel together (ADR-0016). The recorded ones are kept when nothing in
 * the step was left out and every row it touches still comes to a hundred.
 * Otherwise all of them are dropped and the rebalance is worked out again,
 * against the rows as they are, for each insertion, removal and move that is
 * kept. Not always, because the rules do not quite invert: a column added at
 * the front and removed again hands its share to a different neighbour than it
 * took it from.
 *
 * An empty answer means nothing is left, and the History drops the entry.
 */
export function createReplay(
  setup: ReplaySetup,
): (root: Block, ops: readonly Op[]) => readonly Op[] {
  const { registry, divisions } = setup;

  /**
   * Whether a set writes the width a division is made of. Desktop only: a
   * width on the mobile Stage is an override, which divides nothing.
   */
  const isWidth = (op: Op, types: ReadonlyMap<string, string>): boolean => {
    if (op.kind !== "set-prop" || op.stage === "mobile") return false;
    const type = types.get(op.blockId);
    return type !== undefined && widthPropOf(registry.get(type)) === op.prop;
  };

  return (root, ops) => {
    const recorded = carryOut(root, ops);
    if (recorded.whole) return recorded.ops;

    // Something was left out, or a row no longer adds up. The recorded widths
    // were worked out for the whole step, so none of them can stand.
    const types = typesIn(root, ops);
    return carryOut(
      root,
      ops.filter((op) => !isWidth(op, types)),
      divisions,
    ).ops;
  };

  /**
   * Walk the Ops in order against a working tree, keeping what still applies.
   * With `rebalance`, each structural Op that is kept brings its rebalance with
   * it, worked out against the tree as it reads just then.
   *
   * `whole` is whether every Op was kept and every row any of them touched
   * still comes to a hundred.
   */
  function carryOut(
    root: Block,
    ops: readonly Op[],
    rebalance?: ReplaySetup["divisions"],
  ): { readonly ops: readonly Op[]; readonly whole: boolean } {
    let working = root;
    const kept: Op[] = [];
    const rows = new Set<string>();
    let whole = true;

    const keep = (op: Op): void => {
      kept.push(op);
      working = applyOp(working, op);
    };

    for (const op of ops) {
      const now = stillOurs(registry, working, op);
      if (now === undefined) {
        whole = false;
        continue;
      }
      for (const id of rowsOf(working, now)) rows.add(id);
      const owed = rebalance ? rebalanceFor(working, now, rebalance) : [];
      keep(now);
      for (const each of owed) keep(each);
    }

    for (const id of rows) {
      const row = findBlock(working, id);
      if (row && !isDivided(registry, row)) whole = false;
    }
    return { ops: kept, whole };
  }
}

/**
 * The Op as it would apply now, or `undefined` when a peer has changed what it
 * was going to change.
 *
 * Also `undefined` when it would take a container past its `minChildren` or
 * `maxChildren`. A peer's edit can leave a row with no child to spare, and
 * the step is then refused the way a delete would be (#120).
 */
function stillOurs(registry: Registry, root: Block, op: Op): Op | undefined {
  switch (op.kind) {
    case "set-prop": {
      const block = findBlock(root, op.blockId);
      if (!block) return undefined;
      const current =
        op.stage === "mobile" ? block.mobile?.[op.prop] : block.props[op.prop];
      return Object.is(current, op.previousValue) ? op : undefined;
    }
    case "insert": {
      const parent = findBlock(root, op.parentId);
      if (!parent || findBlock(root, op.block.id)) return undefined;
      if (!hasCapacity(parent, registry.get(parent.type))) return undefined;
      return {
        ...op,
        index: clamp(op.index, 0, childrenOf(parent).length),
      };
    }
    case "remove": {
      const location = findLocation(root, op.block.id);
      if (!location) return undefined;
      const { parent } = location;
      if (!hasSpareChild(parent, registry.get(parent.type))) return undefined;
      // Carries the Block as it is now, so undoing the removal puts back what
      // was there, a peer's edits inside it included.
      const block = childrenOf(parent)[location.index];
      if (!block) return undefined;
      return {
        ...op,
        parentId: parent.id,
        index: location.index,
        block,
      };
    }
    case "move": {
      const location = findLocation(root, op.blockId);
      if (!location || location.parent.id !== op.fromParentId) return undefined;
      const parent = findBlock(root, op.toParentId);
      if (!parent || containsBlock(root, op.blockId, op.toParentId)) {
        return undefined;
      }
      const same = op.fromParentId === op.toParentId;
      if (
        !same &&
        (!hasSpareChild(location.parent, registry.get(location.parent.type)) ||
          !hasCapacity(parent, registry.get(parent.type)))
      ) {
        return undefined;
      }
      const capacity = childrenOf(parent).length - (same ? 1 : 0);
      const toIndex = clamp(op.toIndex, 0, capacity);
      if (same && toIndex === location.index) return undefined;
      return { ...op, fromIndex: location.index, toIndex };
    }
    case "text-edit":
      // The History has already asked the Text Engine.
      return op;
    default:
      return unreachable(op);
  }
}

/** The containers an Op changes a child of, or the children of. */
function rowsOf(root: Block, op: Op): readonly string[] {
  switch (op.kind) {
    case "insert":
    case "remove":
      return [op.parentId];
    case "move":
      return [op.fromParentId, op.toParentId];
    case "set-prop": {
      const location = findLocation(root, op.blockId);
      return location ? [location.parent.id] : [];
    }
    case "text-edit":
      return [];
    default:
      return unreachable(op);
  }
}

/** The rebalance a structural Op owes, as the Command that made it worked it out. */
function rebalanceFor(
  root: Block,
  op: Op,
  divisions: ReplaySetup["divisions"],
): readonly Op[] {
  switch (op.kind) {
    case "insert": {
      const parent = findBlock(root, op.parentId);
      return parent ? divisions.opsForInsert(parent, op.index, op.block) : [];
    }
    case "remove": {
      const parent = findBlock(root, op.parentId);
      return parent ? divisions.opsForRemove(parent, op.index) : [];
    }
    case "move": {
      if (op.fromParentId === op.toParentId) return [];
      const from = findBlock(root, op.fromParentId);
      const to = findBlock(root, op.toParentId);
      const block = findBlock(root, op.blockId);
      if (!from || !to || !block) return [];
      return [
        ...divisions.opsForRemove(from, op.fromIndex),
        ...divisions.opsForInsert(to, op.toIndex, block),
      ];
    }
    case "set-prop":
    case "text-edit":
      return [];
    default:
      return unreachable(op);
  }
}

/** Every Block's type, in the tree and arriving in an insertion. */
function typesIn(root: Block, ops: readonly Op[]): ReadonlyMap<string, string> {
  const types = new Map<string, string>();
  const note = (block: Block): void => {
    types.set(block.id, block.type);
  };
  walk(root, note);
  for (const op of ops) {
    if (op.kind === "insert" || op.kind === "remove") walk(op.block, note);
  }
  return types;
}
