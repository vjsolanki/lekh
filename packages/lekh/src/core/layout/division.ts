import type { ControlActions, ControlDescriptor } from "../editor/controls";
import {
  widthFloorOf,
  widthPropOf,
  type BlockDefinition,
} from "../document/definition";
import type { Block } from "../document/document";
import { setPropOp, type Op, type SetPropOp } from "../editor/op";
import type { Registry } from "../document/registry";
import type { Stage } from "./responsive";
import type { Store } from "../editor/store";
import { childrenOf, findLocation } from "../document/tree";
import {
  areBalanced,
  usableWidths,
  widthCeiling,
  widthsAfterInsert,
  widthsAfterRemove,
  widthsAfterSet,
  widthsEvenly,
} from "./width";

/**
 * A container's children and how they divide it (ADR-0016).
 *
 * The concept has two callers who must agree to the number: the editor, which
 * writes a division back as Ops, and the Consumer, who draws it. This module is
 * where they meet, so neither ends up holding its own copy of the arithmetic —
 * a strip drawn from one rule and written by another is a strip that disagrees
 * with the email under the Author's pointer.
 *
 * `core/layout/width.ts` sits underneath as the rules over plain numbers. Nothing
 * above this file imports it: the numbers only mean anything once a parent, a
 * Registry and a prop have said which Blocks they belong to, and gathering
 * those four things in one place is the whole point.
 */

/**
 * How a container is divided between its children, described for a Consumer.
 *
 * The `prop` travels with it because a Definition names its own width prop
 * (ADR-0016) — a Consumer hiding the width row from a list of controls asks
 * this which one it is rather than guessing at a name or a kind.
 */
export interface Division {
  readonly parentId: string;
  /** The prop the children divide their parent by — the Definition's own name. */
  readonly prop: string;
  /** One per child, in the order the children sit in. */
  readonly shares: readonly Share[];
}

/**
 * One child's share of its parent, and what may be done to it.
 *
 * Everything needed to draw one segment and to move it, so a Consumer holds no
 * width arithmetic of its own. {@link Share.preview} and {@link Share.set} are
 * the same rule at two moments — what a gesture in flight would produce, and
 * what committing it does — so a strip cannot show a split the write would then
 * disagree with.
 *
 * A drag wires its live event to `preview` and its end to `commit`, as a
 * Control Descriptor's does (ADR-0032): the Canvas moves both columns while the
 * Author drags, and the pair is stored as one undo step on release.
 */
export interface Share {
  readonly blockId: string;
  readonly width: number;
  /** The narrowest this child may be, from its Schema's own constraints. */
  readonly floor: number;
  /**
   * The widest this child may be, given the siblings it currently has.
   *
   * Its own width plus everything its neighbour can spare, because the
   * neighbour absorbs the change alone — so this is tighter than the Schema's
   * `max`, which is a fact about the prop rather than about this row.
   */
  readonly ceiling: number;
  /**
   * What every share would read if this one were set to `value`, in child
   * order. Writes nothing and shows nothing.
   *
   * Already clamped between {@link Share.floor} and {@link Share.ceiling}: a
   * value the row cannot take is taken as far as it goes, so a strip dragged
   * past the end stops somewhere sensible rather than snapping back.
   */
  readonly widthsIf: (value: number) => readonly number[];
  /**
   * Show this share set to `value` on the Canvas, its neighbour moved with
   * it, as a Pending Change. Returns the widths, as {@link Share.widthsIf}
   * does, so a strip and the Canvas move together.
   *
   * Stores nothing until {@link Share.commit}.
   */
  readonly preview: (value: number) => readonly number[];
  /**
   * End the drag: store what was last previewed, both widths as one undo
   * step. A drag that ends where it began stores nothing.
   *
   * Ends whatever Pending Change is open, as a Control Descriptor's
   * `commit()` does. Only one is ever open, and it is this drag's.
   */
  readonly commit: () => void;
  /** Drop the open Pending Change, leaving the Document as it was. */
  readonly cancel: () => void;
  /**
   * Set it, moving the neighbour with it, as the one action that is.
   *
   * Clamped exactly as {@link Share.preview} is, and does nothing at all when
   * nothing would move — so a gesture that ends where it began leaves no Op and
   * no undo entry, and a caller needs no guard of its own.
   */
  readonly set: (value: number) => void;
}

/**
 * The props each of `count` children is created holding, so a container arrives
 * divided evenly.
 *
 * Written out rather than left to the Schema's default, because the default is
 * one number and cannot know how many siblings it will have: three children
 * sharing it would all claim a half, and the Inspector would show a number the
 * email disagrees with — which is the whole reason widths are stored at all.
 *
 * Needs no Document, so it stands outside {@link createDivisions}: seeding
 * happens while a Block is being built, before there is a tree to find it in.
 * Empty objects where the children divide nothing, which is almost everything.
 */
export function evenShares(
  definition: BlockDefinition | undefined,
  count: number,
): readonly Readonly<Record<string, number>>[] {
  const prop = widthPropOf(definition);
  if (prop === undefined) return Array.from({ length: count }, () => ({}));

  const widths = widthsEvenly(count);
  return widths.map((width) => ({ [prop]: width }));
}

export interface DivisionsSetup {
  readonly store: Store;
  readonly registry: Registry;
  /** Stamped onto every Op this produces, as the editor's own are. */
  readonly origin: string;
  /** Read rather than captured: the editor's Stage moves under this. */
  readonly stage: () => Stage;
}

/** A write to a width that may not be made at all. */
export const WIDTH_REFUSED = Symbol("width refused");

/**
 * The Ops a desktop write to `prop` on `blockId` owes, or `undefined` when that
 * write is not part of a division at all.
 *
 * Four answers, and the caller needs all four: `undefined` means an ordinary
 * prop, which is the overwhelming majority of writes and must fall through to
 * an ordinary set; {@link WIDTH_REFUSED} means it *is* a width and the value is
 * not one, such as an unset; an empty array means nothing would move; anything
 * else is the rebalance.
 *
 * Knows nothing of Stages. Whether a write goes to the desktop value at all is
 * the prop-write rule's to decide, and it asks this only when it does.
 */
export function widthOpsForSet(
  root: Block,
  registry: Registry,
  origin: string,
  blockId: string,
  prop: string,
  value: unknown,
): readonly SetPropOp[] | typeof WIDTH_REFUSED | undefined {
  const location = findLocation(root, blockId);
  if (!location) return undefined;
  const shape = shapeOf(registry, location.parent);
  if (!shape || shape.prop !== prop) return undefined;
  // A width in a division is always written out (ADR-0016). Unset, it would
  // fall back to a default that knows nothing of its siblings.
  if (typeof value !== "number") return WIDTH_REFUSED;

  return opsFor(
    childrenOf(location.parent),
    shape.prop,
    widthsAfterSet(shape.widths, location.index, value, shape.floor),
    origin,
  );
}

/**
 * Whether a container's stored widths come to a hundred, none under the floor.
 * True for a container whose children divide nothing.
 *
 * Read from the Document as it stands, not through {@link usableWidths}: this
 * is the question of whether a set of writes left the row adding up, and
 * repairing the numbers first would answer yes every time.
 */
export function isDivided(registry: Registry, parent: Block): boolean {
  const children = childrenOf(parent);
  const first = children[0];
  if (!first) return true;
  const definition = registry.get(first.type);
  const prop = widthPropOf(definition);
  if (prop === undefined) return true;

  return areBalanced(
    children.map((child) => storedWidth(registry, child, prop)),
    widthFloorOf(definition, prop),
  );
}

/**
 * Everything the editor and the Consumer ask about a division.
 *
 * The Ops are handed back rather than applied, because History records one
 * entry per commit and a rebalance is half of the thing the Author did: the
 * insertion or removal that prompted one rides in the same array, ahead of it,
 * so undoing "add a column" takes the column and its widths at once.
 */
export interface Divisions {
  /**
   * The Ops a child arriving at `index` owes, to be committed after the
   * insertion itself.
   *
   * Takes the Block that is arriving, so the read and the write are one call:
   * the widths are computed against the parent as it reads now and applied to
   * the children as they will read after, and nothing in between can re-read
   * one and not the other.
   */
  readonly opsForInsert: (
    parent: Block,
    index: number,
    block: Block,
  ) => readonly Op[];
  /** The Ops a child leaving `index` owes, on the same terms. */
  readonly opsForRemove: (parent: Block, index: number) => readonly Op[];
  /**
   * The same Control Descriptors, with any width among them told how far its
   * own row will actually let it go.
   *
   * Applied to every route that produces a Descriptor, not only the one that
   * can reach a width today. The Schema's `max` is a fact about the prop — a
   * hundred per cent — while the ceiling is a fact about one child among the
   * siblings it currently has, and only this can see those. Without it a slider
   * would run to a hundred and stop moving the email two thirds of the way
   * along, which reads as a broken control rather than as a full row.
   *
   * Expects the Descriptors of one Block, which is what `describeControls`
   * hands back. Hand it a mixed list and only the first Block's row is
   * consulted.
   */
  readonly constrain: (
    controls: readonly ControlDescriptor[],
  ) => readonly ControlDescriptor[];
  /**
   * How this Block is divided between its children, or `undefined` when its
   * children divide nothing — which is almost everything.
   *
   * Also `undefined` on the mobile Stage. A width there would be a Mobile
   * Override, and a column stacks to the full width of the phone anyway: the
   * number means nothing, and offering a Consumer a strip to drag would be
   * offering to move desktop widths from a Stage that cannot see them.
   *
   * A Share writes through `actions`, the ones a Control Descriptor is given,
   * so a Share and a Descriptor for the same width take the same route into
   * the Document.
   */
  readonly describe: (
    block: Block | undefined,
    actions: ControlActions,
  ) => Division | undefined;
}

/**
 * A container's children, the prop they divide it by, and how they divide it.
 *
 * Gathered once and passed around, because every rule needs all four and
 * re-reading them between the read and the write is how a rebalance ends up
 * computed against one shape and applied to another.
 *
 * Private: a Consumer is handed {@link Division}, which says the same thing in
 * terms of the Blocks it is about rather than in terms of the arithmetic.
 */
interface Shape {
  readonly parentId: string;
  readonly prop: string;
  /** The narrowest any one child may be, from the Schema's own constraints. */
  readonly floor: number;
  readonly widths: readonly number[];
}

/**
 * How a container divides itself between its children, if it does.
 *
 * Undefined for everything whose children declare no width: the division
 * exists only where a Definition asked for one, and a container that never
 * asked is left entirely alone.
 *
 * The widths come back already run through {@link usableWidths}, so every
 * caller is working from numbers that add up whatever the Document said.
 *
 * `arriving` answers for a container with no children yet, so the first child
 * into an empty row is given the whole of it.
 */
function shapeOf(
  registry: Registry,
  parent: Block | undefined,
  arriving?: Block,
): Shape | undefined {
  if (!parent) return undefined;
  const children = childrenOf(parent);
  const first = children[0] ?? arriving;
  if (!first) return undefined;

  const definition = registry.get(first.type);
  const prop = widthPropOf(definition);
  if (prop === undefined) return undefined;

  const floor = widthFloorOf(definition, prop);
  return {
    parentId: parent.id,
    prop,
    floor,
    widths: usableWidths(
      children.map((child) => storedWidth(registry, child, prop)),
      floor,
    ),
  };
}

/**
 * A child's width: the stored value or the Schema's default, because an unset
 * prop is not an empty one — it is whatever the Definition said it was, and
 * that is the number the email is actually drawn from.
 */
function storedWidth(registry: Registry, child: Block, prop: string): number {
  const stored = child.props[prop];
  const fallback = registry.get(child.type)?.schema[prop]?.defaultValue;
  return typeof stored === "number"
    ? stored
    : typeof fallback === "number"
      ? fallback
      : 0;
}

/**
 * The Ops that write a set of widths back, skipping whatever did not move.
 *
 * Ordinary `set-prop` Ops rather than one bespoke write, because a width is an
 * ordinary prop and every other route to one is an Op — undo has to take a
 * division back the same way it takes anything else back.
 *
 * `children` is the list as it will read *after* those Ops, which is why each
 * caller builds it rather than this re-reading the store: the widths were
 * computed against that shape and have to be written against the same one.
 */
function opsFor(
  children: readonly Block[],
  prop: string,
  next: readonly number[],
  origin: string,
): readonly SetPropOp[] {
  return children.flatMap((child, at) => {
    const value = next[at];
    const op =
      value === undefined ? undefined : setPropOp(child, prop, value, origin);
    return op === undefined ? [] : [op];
  });
}

export function createDivisions(setup: DivisionsSetup): Divisions {
  const { store, registry, origin, stage } = setup;

  return {
    opsForInsert(parent, index, block) {
      // Read before the insertion, because the rule is about the widths the
      // arrival has to make room in.
      const shape = shapeOf(registry, parent, block);
      if (!shape) return [];
      return opsFor(
        childrenOf(parent).toSpliced(index, 0, block),
        shape.prop,
        widthsAfterInsert(shape.widths, index, shape.floor),
        origin,
      );
    },

    opsForRemove(parent, index) {
      const shape = shapeOf(registry, parent);
      if (!shape) return [];
      // The width it was holding does not evaporate: its neighbour takes it, so
      // the row closes up rather than leaving a gap an Author has to notice and
      // fix.
      return opsFor(
        childrenOf(parent).toSpliced(index, 1),
        shape.prop,
        widthsAfterRemove(shape.widths, index),
        origin,
      );
    },

    constrain(controls) {
      // They all describe one Block, which is what `describeControls` produces
      // — so one lookup answers for the whole list.
      const first = controls[0];
      if (!first) return controls;
      // On the mobile Stage a width that is Overridable at all is describing an
      // override, and an override is not part of the division: the Schema's own
      // `max` is the honest number there.
      if (stage() === "mobile") return controls;

      const location = findLocation(store.get().root, first.blockId);
      if (!location) return controls;
      const shape = shapeOf(registry, location.parent);
      if (!shape) return controls;

      return controls.map((control) =>
        control.name === shape.prop
          ? {
              ...control,
              constraints: {
                ...control.constraints,
                max: widthCeiling(shape.widths, location.index, shape.floor),
              },
            }
          : control,
      );
    },

    describe(block, actions) {
      if (!block || stage() === "mobile") return undefined;
      const shape = shapeOf(registry, block);
      if (!shape) return undefined;

      // Walked over the children rather than the widths, because the children
      // are what a share is *about* — the two are the same length by
      // construction, `usableWidths` having kept the count it was given.
      return {
        parentId: shape.parentId,
        prop: shape.prop,
        shares: childrenOf(block).map((child, index) => {
          const widthsIf = (value: number): readonly number[] =>
            widthsAfterSet(shape.widths, index, value, shape.floor);
          return {
            blockId: child.id,
            width: shape.widths[index] ?? 0,
            floor: shape.floor,
            ceiling: widthCeiling(shape.widths, index, shape.floor),
            widthsIf,
            preview: (value: number) => {
              actions.preview(child.id, shape.prop, value);
              return widthsIf(value);
            },
            commit: actions.commitPending,
            cancel: actions.cancel,
            set: (value: number) => {
              actions.setProp(child.id, shape.prop, value);
            },
          };
        }),
      };
    },
  };
}
