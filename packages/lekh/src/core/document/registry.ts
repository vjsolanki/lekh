import { isResolvedAsset } from "./assets";
import {
  SchemaKind,
  primaryAssetPropsOf,
  type BlockDefinition,
} from "./definition";
import type { Block } from "./document";
import { EditorConfigurationError } from "./errors";
import { isOverridable } from "../layout/responsive";
import { childrenOf } from "./tree";

/** Lookup over the Block Definitions a Consumer composed at construction. */
export interface Registry {
  get(type: string): BlockDefinition | undefined;
  has(type: string): boolean;
  readonly all: readonly BlockDefinition[];
  readonly required: readonly BlockDefinition[];
}

export function createRegistry(
  definitions: readonly BlockDefinition[],
): Registry {
  const byType = new Map<string, BlockDefinition>();
  for (const definition of definitions) {
    if (byType.has(definition.type)) {
      throw new EditorConfigurationError(
        `Two Block Definitions declare the type "${definition.type}".`,
      );
    }
    byType.set(definition.type, definition);
  }

  return {
    get: (type) => byType.get(type),
    has: (type) => byType.has(type),
    all: definitions,
    required: definitions.filter((definition) => definition.required === true),
  };
}

/**
 * Check the composed Definitions up front, so a wiring mistake surfaces in
 * development rather than in front of an Author with an unsendable email.
 *
 * Restoring a missing Required Block appends it to the root (ADR-0006), so
 * every Required Block Definition must be placeable there.
 */
export function assertUsableConfiguration(
  registry: Registry,
  rootType: string,
): void {
  const root = registry.get(rootType);
  if (!root) {
    throw new EditorConfigurationError(
      `No Block Definition is registered for the root type "${rootType}".`,
    );
  }

  for (const definition of registry.required) {
    if (!accepts(root, definition.type)) {
      throw new EditorConfigurationError(
        `Required Block "${definition.type}" cannot be placed at the root: ` +
          `the root Block Definition "${rootType}" does not accept it.`,
      );
    }
  }

  if (
    root.maxChildren !== undefined &&
    root.maxChildren < registry.required.length
  ) {
    throw new EditorConfigurationError(
      `The root Block Definition "${rootType}" accepts at most ` +
        `${String(root.maxChildren)} children, which cannot hold ` +
        `${String(registry.required.length)} Required Blocks.`,
    );
  }

  assertNoOverridableRecognisedKinds(registry);
  assertOnePrimaryAsset(registry);
  assertPrimaryAssetNotDecorative(registry);
  assertResolvedListedAssets(registry);
  assertSeedableMinimums(registry);
}

/**
 * Refuse an Asset listed in an Asset prop's `constraints.options` that is not
 * already resolved (ADR-0030).
 *
 * Setting the prop to a listed Asset needs no Image Request, so nothing would
 * ever resolve it later. Checked once here, so `setProp` can trust the list.
 */
function assertResolvedListedAssets(registry: Registry): void {
  for (const definition of registry.all) {
    for (const [name, entry] of Object.entries(definition.schema)) {
      const options = entry.constraints?.["options"];
      if (entry.kind !== SchemaKind.asset || !Array.isArray(options)) continue;
      for (const option of options as readonly unknown[]) {
        const listed =
          typeof option === "object" && option !== null ? option : {};
        if ("asset" in listed && isResolvedAsset(listed.asset)) continue;
        const label = "label" in listed ? String(listed.label) : "";
        throw new EditorConfigurationError(
          `Block Definition "${definition.type}" lists an Asset "${label}" ` +
            `on "${name}" without a src and a positive width and height. A ` +
            `listed Asset goes in with no Image Request, so it must already ` +
            `be resolved.`,
        );
      }
    }
  }
}

/**
 * Refuse a `minChildren` that has nothing it can create.
 *
 * `minChildren` says how many children a container is seeded with without
 * saying what they are: the type is the accepted one declared `structural`.
 * That indirection is what keeps the relationship written once — the Definition
 * that is structural is the only place it is said — and it is why it has to be
 * checked. A container accepting no structural type has nothing to seed and
 * would quietly arrive empty; one accepting two would seed whichever `accepts`
 * happens to list first, a choice made by array order and by nothing an author
 * of either Definition intended.
 *
 * Seeding is one level deep, so a seeded type carrying its own `minChildren`
 * would arrive already short of the minimum it declared, and nothing would ever
 * put it right — the Author cannot place one of its children either. Refused
 * rather than coped with.
 */
function assertSeedableMinimums(registry: Registry): void {
  for (const definition of registry.all) {
    if (definition.minChildren === undefined) continue;

    const structural = structuralChildrenOf(registry, definition);

    if (structural.length !== 1) {
      throw new EditorConfigurationError(
        `Block Definition "${definition.type}" declares "minChildren" but ` +
          `accepts ${String(structural.length)} structural types, not one. ` +
          `A seeded container has to know what to create, and the structural ` +
          `type among the ones it accepts is what says so.`,
      );
    }

    const seeded = structural[0];
    if (seeded?.minChildren !== undefined) {
      throw new EditorConfigurationError(
        `Block Definition "${definition.type}" seeds "${seeded.type}", which ` +
          `declares a "minChildren" of its own. Seeding is one level deep, so ` +
          `the seeded Blocks would arrive already below their own minimum.`,
      );
    }
  }
}

/**
 * Refuse a Mobile Override on a prop the library itself writes.
 *
 * `asset`, `rich-text` and `html` are kinds the library is not ignorant of
 * (ADR-0009, ADR-0010, ADR-0028) — it decides what goes in them or what comes
 * out. A `mobile` declaration says the value becomes CSS on a phone, and none
 * of these values is CSS: an Asset is a location and its dimensions, and rich
 * text and html are markup. Declaring one is always a mistake.
 *
 * It is a mistake worth catching here rather than coping with at the write
 * path, because it fails silently. A resolved Asset reaches the Document
 * through `setProp` like every other value, so an upload finished while the
 * Author was on the mobile Stage would write an override that resolves to
 * nothing — the request would report success and no image would appear.
 */
function assertNoOverridableRecognisedKinds(registry: Registry): void {
  for (const definition of registry.all) {
    for (const [name, entry] of Object.entries(definition.schema)) {
      if (
        entry.kind !== SchemaKind.asset &&
        entry.kind !== SchemaKind.richText &&
        entry.kind !== SchemaKind.html
      ) {
        continue;
      }
      if (!isOverridable(entry)) continue;

      throw new EditorConfigurationError(
        `Block Definition "${definition.type}" declares "mobile" on its ` +
          `"${name}" prop, which is of kind "${entry.kind}". The library ` +
          `writes that prop itself, and a Mobile Override on it would take ` +
          `the value instead and resolve to nothing.`,
      );
    }
  }
}

/**
 * Refuse a Definition that is two images at once (ADR-0026).
 *
 * The Primary Asset is where a dropped file lands and what placing the Block
 * asks for. With two, one of them would silently never be filled.
 */
function assertOnePrimaryAsset(registry: Registry): void {
  for (const definition of registry.all) {
    const primary = primaryAssetPropsOf(definition);
    if (primary.length < 2) continue;

    throw new EditorConfigurationError(
      `Block Definition "${definition.type}" declares ${String(primary.length)} ` +
        `Primary Assets (${primary.map((name) => `"${name}"`).join(", ")}). ` +
        `A Block has at most one: mark the others' entries without ` +
        `\`primary: true\`, which makes them optional.`,
    );
  }
}

/**
 * Refuse a Primary Asset marked `decorative`: the Block is the image, so its
 * alt text is what a reader with images off is told.
 */
function assertPrimaryAssetNotDecorative(registry: Registry): void {
  for (const definition of registry.all) {
    for (const name of primaryAssetPropsOf(definition)) {
      if (definition.schema[name]?.decorative !== true) continue;

      throw new EditorConfigurationError(
        `Block Definition "${definition.type}" marks its Primary Asset ` +
          `"${name}" \`decorative\`. The Block is the image, so its alt ` +
          `text is what a reader with images off is told. Drop ` +
          `\`decorative: true\`, or \`primary: true\` if the image is only ` +
          `decoration.`,
      );
    }
  }
}

/**
 * The structural types a parent accepts — the children only it can create.
 *
 * The one place the parent-to-structural-child relationship is read, because
 * it is nowhere declared: the parent says which types it accepts and the child
 * says it is structural, and this is where those two facts meet. Seeding, the
 * Add affordance and the construction check all ask the same question, so they
 * all ask it here.
 *
 * In Definition order, which is the order the parent listed them in `accepts`.
 */
export function structuralChildrenOf(
  registry: Registry,
  definition: BlockDefinition | undefined,
): readonly BlockDefinition[] {
  return (definition?.accepts ?? [])
    .map((type) => registry.get(type))
    .filter((child): child is BlockDefinition => child?.structural === true);
}

/** Whether a parent Definition declares `type` among the children it accepts. */
export function accepts(
  parent: BlockDefinition | undefined,
  type: string,
): boolean {
  return parent?.accepts?.includes(type) ?? false;
}

/**
 * Whether a Block of `type` may be placed inside a parent.
 *
 * An unregistered Block was legal wherever it was stored and must stay
 * movable, so no accepts rule can be applied to it — any container will take
 * it. Registered types are held to the parent's declared rule.
 */
export function canPlace(
  registry: Registry,
  parent: BlockDefinition | undefined,
  type: string,
): boolean {
  return registry.has(type)
    ? accepts(parent, type)
    : parent?.accepts !== undefined;
}

/**
 * Whether a parent has room for one more child.
 *
 * A Block already inside the parent does not consume a slot, so reordering
 * within a full container stays possible.
 */
export function hasCapacity(
  parent: Block,
  definition: BlockDefinition | undefined,
  movedBlockId?: string,
): boolean {
  const max = definition?.maxChildren;
  if (max === undefined) return true;

  const children = childrenOf(parent);
  const alreadyInside =
    movedBlockId !== undefined &&
    children.some((child) => child.id === movedBlockId);
  return alreadyInside || children.length < max;
}

/**
 * Whether a parent can spare a child — the counterpart to {@link hasCapacity}.
 *
 * A container declaring `minChildren` is not usable below it, so the last ones
 * are held in place. Unlike capacity this is asked of a removal rather than an
 * insertion, and no Block is exempt: the floor is about how many are left, not
 * about which one is going.
 *
 * Asked of a delete, and of a move out to another parent, which takes the
 * child away just the same. The Canvas never drags into it: a structural type
 * is the only thing a container with a minimum holds, and those are not
 * draggable. But `moveBlock` can be called directly.
 */
export function hasSpareChild(
  parent: Block,
  definition: BlockDefinition | undefined,
): boolean {
  const minimum = definition?.minChildren;
  if (minimum === undefined) return true;
  return childrenOf(parent).length > minimum;
}

/**
 * Whether a parent will take a Block of this type: the accepts rule and the
 * capacity rule, which are always asked together.
 */
export function canInsertInto(
  registry: Registry,
  parent: Block,
  type: string,
  movedBlockId?: string,
): boolean {
  const definition = registry.get(parent.type);
  return (
    canPlace(registry, definition, type) &&
    hasCapacity(parent, definition, movedBlockId)
  );
}

/** Whether a Block may be removed directly. Unregistered Blocks always may. */
export function isDeletable(definition: BlockDefinition | undefined): boolean {
  return definition?.deletable !== false;
}
