import type { Block } from "./document";

const NO_CHILDREN: readonly Block[] = [];

/** Children of a Block, or an empty list for a leaf. */
export function childrenOf(block: Block): readonly Block[] {
  return block.children ?? NO_CHILDREN;
}

/** Depth-first walk, root first. */
export function walk(root: Block, visit: (block: Block) => void): void {
  visit(root);
  for (const child of childrenOf(root)) walk(child, visit);
}

/** Every Block in the tree, root first. */
export function collectBlocks(root: Block): readonly Block[] {
  const blocks: Block[] = [];
  walk(root, (block) => {
    blocks.push(block);
  });
  return blocks;
}

export function findBlock(root: Block, id: string): Block | undefined {
  if (root.id === id) return root;
  for (const child of childrenOf(root)) {
    const found = findBlock(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Where a Block sits: its parent and its index within that parent. */
export interface BlockLocation {
  readonly parent: Block;
  readonly index: number;
}

export function findLocation(
  root: Block,
  id: string,
): BlockLocation | undefined {
  const children = childrenOf(root);
  for (const [index, child] of children.entries()) {
    if (child.id === id) return { parent: root, index };
    const found = findLocation(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Ancestors of a Block, nearest first. Empty for the root. */
export function ancestorsOf(root: Block, id: string): readonly Block[] {
  const trail: Block[] = [];
  const search = (block: Block): boolean => {
    if (block.id === id) return true;
    for (const child of childrenOf(block)) {
      if (search(child)) {
        trail.push(block);
        return true;
      }
    }
    return false;
  };
  search(root);
  return trail;
}

/** Whether `descendantId` sits at or below `ancestorId`. */
export function containsBlock(
  root: Block,
  ancestorId: string,
  descendantId: string,
): boolean {
  const ancestor = findBlock(root, ancestorId);
  return ancestor === undefined
    ? false
    : findBlock(ancestor, descendantId) !== undefined;
}

/**
 * Replace one Block in the tree.
 *
 * Untouched subtrees keep their object identity, which is what lets an
 * unregistered Block round-trip exactly as it was stored.
 */
export function replaceBlock(root: Block, next: Block): Block {
  if (root.id === next.id) return next;
  const children = root.children;
  if (!children) return root;

  let changed = false;
  const mapped = children.map((child) => {
    const replaced = replaceBlock(child, next);
    if (replaced !== child) changed = true;
    return replaced;
  });
  return changed ? { ...root, children: mapped } : root;
}

/** Replace a Block's children, preserving structural sharing elsewhere. */
function withChildren(block: Block, children: readonly Block[]): Block {
  return { ...block, children };
}

/** Insert a Block into a parent's children at `index`. */
export function insertChild(
  root: Block,
  parentId: string,
  index: number,
  block: Block,
): Block {
  const parent = findBlock(root, parentId);
  if (!parent) return root;

  const children = childrenOf(parent);
  const at = clamp(index, 0, children.length);
  const next = [...children.slice(0, at), block, ...children.slice(at)];
  return replaceBlock(root, withChildren(parent, next));
}

/** Remove the child at `index` from a parent. */
export function removeChildAt(
  root: Block,
  parentId: string,
  index: number,
): Block {
  const parent = findBlock(root, parentId);
  if (!parent) return root;

  const children = childrenOf(parent);
  if (index < 0 || index >= children.length) return root;
  const next = [...children.slice(0, index), ...children.slice(index + 1)];
  return replaceBlock(root, withChildren(parent, next));
}

/** Copy a subtree, giving every Block in it a fresh identity. */
export function cloneWithNewIds(block: Block, createId: () => string): Block {
  const copy: Block = { ...block, id: createId() };
  return block.children
    ? {
        ...copy,
        children: block.children.map((child) =>
          cloneWithNewIds(child, createId),
        ),
      }
    : copy;
}

/** Pin a value into a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
