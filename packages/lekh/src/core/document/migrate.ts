import type { EmailDocument } from "./document";
import type { Block } from "./document";
import type { Registry } from "./registry";

/**
 * Bring every Block forward to its Definition's current version.
 *
 * Migrations run in ascending order from the version a Block was stored at to
 * the version its Definition writes today, so a Document that skipped several
 * releases still lands correctly.
 *
 * Blocks whose type is not registered are skipped rather than guessed at —
 * preservation and migration must not contradict each other. Blocks already at
 * the current version keep their object identity, which is what makes loading
 * and saving without edits non-destructive.
 */
export function migrateDocument(
  document: EmailDocument,
  registry: Registry,
): EmailDocument {
  const root = migrateBlock(document.root, registry);
  return root === document.root ? document : { root };
}

function migrateBlock(block: Block, registry: Registry): Block {
  const migratedChildren = migrateChildren(block, registry);
  const definition = registry.get(block.type);

  const target = definition?.version;
  if (definition === undefined || target === undefined) {
    return migratedChildren;
  }

  const stored = block.version ?? 0;
  if (stored >= target) return migratedChildren;

  let { props, mobile } = migratedChildren;
  for (let version = stored + 1; version <= target; version++) {
    const migration = definition.migrations?.[version];
    if (migration) ({ props, mobile } = migration({ props, mobile }));
  }

  // A migration that returns no `mobile` leaves no overrides (ADR-0024).
  const { mobile: _, ...rest } = migratedChildren;
  return { ...rest, props, ...(mobile && { mobile }), version: target };
}

function migrateChildren(block: Block, registry: Registry): Block {
  const children = block.children;
  if (!children) return block;

  let changed = false;
  const migrated = children.map((child) => {
    const next = migrateBlock(child, registry);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...block, children: migrated } : block;
}
