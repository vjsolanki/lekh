import type { BlockDefinition } from "../document/definition";
import type { Block, EmailDocument } from "../document/document";
import { evenShares } from "../layout/division";
import { structuralChildrenOf, type Registry } from "../document/registry";

/** A fresh Block, storing nothing an Author has not set. */
export function newBlock(
  definition: BlockDefinition,
  registry: Registry,
  createId: () => string,
  props?: Readonly<Record<string, unknown>>,
): Block {
  return {
    id: createId(),
    type: definition.type,
    props: props ? { ...props } : {},
    ...(definition.accepts === undefined
      ? {}
      : { children: seedChildren(definition, registry, createId) }),
    ...(definition.version === undefined
      ? {}
      : { version: definition.version }),
  };
}

/**
 * The children a container is created holding.
 *
 * Empty for almost everything: a Block an Author drops is theirs to fill. A
 * container declaring `minChildren` is the exception, because it is not usable
 * empty — a row of columns with no columns is a shell that does nothing until
 * something is dragged into it, which was two gestures for one intention.
 *
 * They are built here rather than by whoever inserts the container, so the
 * whole shape travels in the one `insert` Op and comes back out on one undo.
 * A container's `seed` gives each child its starting props.
 *
 * One level deep. Recursion terminates on its own rather than by a depth
 * count: a seeded type may not declare `minChildren` of its own, checked when
 * the editor is constructed, so the call below always seeds nothing.
 */
function seedChildren(
  definition: BlockDefinition,
  registry: Registry,
  createId: () => string,
): Block[] {
  const minimum = definition.minChildren;
  if (minimum === undefined) return [];

  // Exactly one, by the same construction-time check.
  const seeded = structuralChildrenOf(registry, definition)[0];
  if (!seeded) return [];

  // The container's own starting props, if it gives any (ADR-0030). They may
  // ask for more children than the floor, never past the ceiling.
  const seeds = definition.seed?.() ?? [];
  const count = Math.min(
    Math.max(minimum, seeds.length),
    definition.maxChildren ?? Infinity,
  );

  // A container that divides itself arrives divided evenly. Empty for
  // everything else, which is almost everything.
  const shares = evenShares(seeded, count);

  return Array.from({ length: count }, (_, at) =>
    newBlock(seeded, registry, createId, { ...seeds[at], ...shares[at] }),
  );
}

/** An empty Document, holding one of each Required Block. */
export function seedDocument(
  registry: Registry,
  rootType: string,
  createId: () => string,
): EmailDocument {
  const rootDefinition = registry.get(rootType);
  const children = registry.required.map((definition) =>
    newBlock(definition, registry, createId),
  );

  return {
    root: {
      id: createId(),
      type: rootType,
      props: {},
      children,
      ...(rootDefinition?.version === undefined
        ? {}
        : { version: rootDefinition.version }),
    },
  };
}
