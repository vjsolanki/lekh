import { agentSchemaOf, heldMarkup } from "../document/agent-schema";
import {
  isResolvedAsset,
  isSamePicture,
  listedAssetsOf,
} from "../document/assets";
import {
  SchemaKind,
  entryTextShape,
  type BlockDefinition,
  type SchemaEntry,
} from "../document/definition";
import type { Block, EmailDocument } from "../document/document";
import { knownEdit, type Edit, type InsertEdit } from "../document/edit";
import {
  canInsertInto,
  hasSpareChild,
  isDeletable,
  type Registry,
} from "../document/registry";
import {
  childrenOf,
  clamp,
  containsBlock,
  findBlock,
  findLocation,
} from "../document/tree";
import type { Divisions } from "../layout/division";
import type { Stage } from "../layout/responsive";
import {
  sanitiseInlineMarkup,
  unsupportedMarkup,
} from "../markup/inline-markup";
import { hasShape } from "../validate/validate";
import { explainDropRefusal, type DropTarget } from "./drop-target";
import { applyOp, type Op } from "./op";
import { reindex } from "./placement";
import { propWrite, type WriteRefusal } from "./prop-write";
import { newBlock } from "./seed";
import { unreachable } from "./unreachable";

/**
 * Why an Edit cannot be carried out.
 *
 * - `malformed`: it is not an Edit: an unknown `kind`, or a field missing or
 *   of the wrong type.
 * - `missing-block`: no Block has an id it names.
 * - `unregistered-block`: the Block's type has no Definition.
 * - `unknown-type`: an insert of a type no Definition has.
 * - `duplicate-id`: an insert's `id` is already a Block's.
 * - `no-place`: an insert or a move with no place, or one that contradicts
 *   itself: both `after` and `before`, a `parent` that does not hold the
 *   sibling, or a place beside the root.
 * - `is-root`: a remove or a move of the root.
 * - `not-accepted`, `at-capacity`, `own-subtree`: the parent won't take it,
 *   for the reasons a drop is refused.
 * - `at-minimum`: a remove or a move out of a container already at its
 *   `minChildren`.
 * - `not-deletable`: a remove of a Block whose Definition says
 *   `deletable: false`.
 * - `unknown-prop`: the Schema has no such prop.
 * - `closed-prop`: the prop is closed to Agents, with `agent: false` or as a
 *   Consumer's kind with no `agent` fragment to describe it.
 * - `wrong-shape`: the value is not the shape its kind says. An Asset prop
 *   takes a resolved Asset, never a URL.
 * - `unsupported-markup`: rich text with a tag its prop does not hold, or a
 *   link to nowhere safe. Paragraphs and lists only where the prop opts in
 *   (ADR-0023, ADR-0029).
 * - `unlisted-asset`, `not-a-width`: as `setProp` refuses them.
 */
export type EditRefusalCode =
  | "malformed"
  | "missing-block"
  | "unregistered-block"
  | "unknown-type"
  | "duplicate-id"
  | "no-place"
  | "is-root"
  | "not-accepted"
  | "at-capacity"
  | "own-subtree"
  | "at-minimum"
  | "not-deletable"
  | "unknown-prop"
  | "closed-prop"
  | "wrong-shape"
  | "unsupported-markup"
  | "unlisted-asset"
  | "not-a-width";

/** One Edit that cannot be carried out, and why, in words an Agent can act on. */
export interface EditRefusal {
  /** Where the Edit sits in the list it came in. */
  readonly index: number;
  readonly code: EditRefusalCode;
  readonly message: string;
}

/**
 * A Block some Edits touch, and how.
 *
 * `change` is what happens to the Block itself, the first of these that
 * applies: `insert`, `remove`, `move`, then `set`. `props` are the ones its
 * `set-prop` Edits set, in the order they come.
 */
export interface SuggestionTouch {
  readonly blockId: string;
  readonly change: "insert" | "remove" | "move" | "set";
  readonly props: readonly string[];
}

/** What turning Edits into Ops needs from an editor. */
export interface CarryOutSetup {
  readonly registry: Registry;
  /** Stamped onto every Op. */
  readonly origin: string;
  readonly divisions: Pick<Divisions, "opsForInsert" | "opsForRemove">;
}

export interface CarryOutRequest {
  readonly document: EmailDocument;
  /** The Stage a `set-prop` Edit with none is written on. */
  readonly stage: Stage;
  /** Ids for new Blocks an insert does not name. */
  readonly createId: () => string;
  /**
   * Hold props to what an Agent may write: only props the Schema has, each
   * the shape its kind says. `setProp` and Repairs write any prop, as they
   * always have.
   */
  readonly strict: boolean;
}

/** The Ops some Edits become, the Document they leave, and what they touch. */
export interface CarriedOut {
  readonly ops: readonly Op[];
  readonly document: EmailDocument;
  readonly touches: readonly SuggestionTouch[];
}

/** Carried out, or refused with a reason for each Edit that cannot apply. */
export type CarryOutResult =
  CarriedOut | { readonly refused: readonly EditRefusal[] };

/** Why one Edit cannot apply, before it knows where in a list it sits. */
interface Refused {
  readonly refused: Omit<EditRefusal, "index">;
}

const refuse = (code: EditRefusalCode, message: string): Refused => ({
  refused: { code, message },
});

const isRefused = (value: object): value is Refused => "refused" in value;

/**
 * Carry Edits out on a copy of a Document, in order, each reading the
 * Document the ones before it left (ADR-0036).
 *
 * An Edit that cannot apply is skipped and the rest still read, so the answer
 * names every one that cannot, not only the first. Nothing is carried out
 * unless all of them can.
 */
export function carryOut(
  setup: CarryOutSetup,
  edits: readonly unknown[],
  request: CarryOutRequest,
): CarryOutResult {
  const ops: Op[] = [];
  const refused: EditRefusal[] = [];
  const touches = new Map<string, TouchEntry>();
  /** Ids a refused insert would have made, and which Edit that was. */
  const neverInserted = new Map<string, number>();
  let current = request.document;

  for (const [index, raw] of edits.entries()) {
    const edit = editOf(raw);
    // An Edit naming a Block a refused insert would have made says so,
    // rather than blaming a missing Block on the Agent twice.
    const after = edit && namedIds(edit).find((id) => neverInserted.has(id));
    const carried = edit
      ? after === undefined
        ? carryOne(setup, edit, { ...request, document: current })
        : refuse(
            "missing-block",
            `Block "${after}" is not there: the Edit at ${String(
              neverInserted.get(after),
            )} that inserts it was refused.`,
          )
      : refuse("malformed", "This is not an Edit.");
    if (isRefused(carried)) {
      refused.push({ index, ...carried.refused });
      if (edit?.kind === "insert" && edit.id !== undefined) {
        neverInserted.set(edit.id, index);
      }
      continue;
    }
    ops.push(...carried.ops);
    current = {
      ...current,
      root: carried.ops.reduce<Block>(
        (root, op) => applyOp(root, op),
        current.root,
      ),
    };
    touch(touches, carried.touch);
  }

  if (refused.length > 0) return { refused };
  return {
    ops,
    document: current,
    touches: [...touches].map(([blockId, { change, props }]) => ({
      blockId,
      change,
      props,
    })),
  };
}

/** Every Block id an Edit names, other than the one an insert makes. */
function namedIds(edit: Edit): readonly string[] {
  const place = (
    edit.kind === "insert" || edit.kind === "move"
      ? [edit.after, edit.before, edit.parent]
      : []
  ).filter((id): id is string => id !== undefined);
  return edit.kind === "insert" ? place : [edit.blockId, ...place];
}

/** What one Edit does to which Block. */
interface Touch {
  readonly blockId: string;
  readonly change: SuggestionTouch["change"];
  readonly prop?: string;
}

const PRECEDENCE: readonly SuggestionTouch["change"][] = [
  "insert",
  "remove",
  "move",
  "set",
];

/** A {@link SuggestionTouch} while the Edits are still being read. */
interface TouchEntry {
  change: SuggestionTouch["change"];
  props: string[];
}

function touch(
  touches: Map<string, TouchEntry>,
  { blockId, change, prop }: Touch,
): void {
  const known = touches.get(blockId);
  // A Block this list inserted and then removed was never there to touch.
  if (known?.change === "insert" && change === "remove") {
    touches.delete(blockId);
    return;
  }
  const entry = known ?? { change, props: [] };
  if (PRECEDENCE.indexOf(change) < PRECEDENCE.indexOf(entry.change)) {
    entry.change = change;
  }
  if (prop !== undefined && !entry.props.includes(prop)) entry.props.push(prop);
  touches.set(blockId, entry);
}

function editOf(raw: unknown): Edit | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!("kind" in raw) || typeof raw.kind !== "string") return undefined;
  return knownEdit({ ...raw, kind: raw.kind });
}

function carryOne(
  setup: CarryOutSetup,
  edit: Edit,
  request: CarryOutRequest,
): { readonly ops: readonly Op[]; readonly touch: Touch } | Refused {
  const { document } = request;
  switch (edit.kind) {
    case "set-prop": {
      const block = findBlock(document.root, edit.blockId);
      const definition = block && setup.registry.get(block.type);
      if (request.strict && block) {
        const wrong = propRefusal(definition, edit.prop, edit.value);
        if (wrong) return wrong;
      }
      const write = propWrite({
        document,
        registry: setup.registry,
        origin: setup.origin,
        blockId: edit.blockId,
        values: {
          [edit.prop]: request.strict
            ? asStored(definition, edit.prop, edit.value)
            : edit.value,
        },
        stage: edit.stage ?? request.stage,
        fallback: "desktop",
      });
      if ("refused" in write) {
        return writeRefusal(write.refused, edit.blockId, edit.prop);
      }
      return {
        ops: write.ops,
        touch: { blockId: edit.blockId, change: "set", prop: edit.prop },
      };
    }
    case "insert": {
      const definition = setup.registry.get(edit.type);
      if (!definition) {
        return refuse(
          "unknown-type",
          `No Block type is called "${edit.type}".`,
        );
      }
      const props = edit.props && { ...edit.props };
      if (request.strict && props) {
        for (const [prop, value] of Object.entries(props)) {
          const wrong =
            propRefusal(definition, prop, value) ??
            unlistedRefusal(definition.schema[prop], prop, value);
          if (wrong) return wrong;
          props[prop] = asStored(definition, prop, value);
        }
      }
      const target = targetOf(document, edit);
      if (isRefused(target)) return target;
      const planned = planInsert(setup, document, {
        type: edit.type,
        parentId: target.parentId,
        index: reindex(document, target),
        props,
        id: edit.id,
        createId: request.createId,
      });
      if (isRefused(planned)) return planned;
      return {
        ops: planned.ops,
        touch: { blockId: planned.block.id, change: "insert" },
      };
    }
    case "remove": {
      const planned = planRemove(setup, document, edit.blockId);
      if (isRefused(planned)) return planned;
      return {
        ops: planned.ops,
        touch: { blockId: edit.blockId, change: "remove" },
      };
    }
    case "move": {
      // The Block first: a missing one is the reason, not where it was going.
      if (!findBlock(document.root, edit.blockId)) {
        return missing(edit.blockId);
      }
      const target = targetOf(document, edit);
      if (isRefused(target)) return target;
      const planned = planMove(
        setup,
        document,
        edit.blockId,
        target.parentId,
        reindex(document, target),
      );
      if (isRefused(planned)) return planned;
      return {
        ops: planned.ops,
        touch: { blockId: edit.blockId, change: "move" },
      };
    }
    default: {
      return unreachable(edit);
    }
  }
}

/**
 * Where an insert or a move lands, as a Drop Target: beside a sibling or at
 * the end of a parent. Its index is read off the sibling by the same rule an
 * Image Request's target is re-read by when it lands.
 */
function targetOf(
  document: EmailDocument,
  place: Pick<InsertEdit, "after" | "before" | "parent">,
): DropTarget | Refused {
  const { root } = document;
  if (place.after !== undefined && place.before !== undefined) {
    return refuse("no-place", "Give `after` or `before`, not both.");
  }
  if (place.parent !== undefined && !findBlock(root, place.parent)) {
    return missing(place.parent);
  }

  const sibling = place.after ?? place.before;
  if (sibling !== undefined) {
    if (!findBlock(root, sibling)) return missing(sibling);
    const location = findLocation(root, sibling);
    if (!location) {
      return refuse("no-place", "Nothing can go beside the root.");
    }
    if (place.parent !== undefined && place.parent !== location.parent.id) {
      return refuse(
        "no-place",
        `Block "${sibling}" is not inside Block "${place.parent}".`,
      );
    }
    return {
      parentId: location.parent.id,
      index: location.index,
      position: place.after === undefined ? "before" : "after",
      referenceBlockId: sibling,
    };
  }

  const parent =
    place.parent === undefined ? undefined : findBlock(root, place.parent);
  if (parent) {
    return {
      parentId: parent.id,
      index: childrenOf(parent).length,
      position: "inside",
    };
  }
  return refuse(
    "no-place",
    "Say where it goes: `after`, `before` or `parent`.",
  );
}

/** Whether an Agent may write this value to this prop. */
function propRefusal(
  definition: BlockDefinition | undefined,
  prop: string,
  value: unknown,
): Refused | undefined {
  const schema = definition?.schema;
  const entry = schema?.[prop];
  if (!entry) {
    // An unregistered Block has no Schema, and `propWrite` says so.
    if (!schema) return undefined;
    return refuse("unknown-prop", `This Block has no prop "${prop}".`);
  }
  // Closed to unsetting too: an Agent changes it in no way at all.
  if (!agentSchemaOf(entry)) {
    return refuse(
      "closed-prop",
      entry.agent === false
        ? `"${prop}" is closed to Agents. Only the Author changes it.`
        : `"${prop}" is not described to Agents, so it cannot be set.`,
    );
  }
  // Unset is never wrong: it resolves to the Schema default.
  if (value === undefined) return undefined;
  if (entry.kind === SchemaKind.asset) {
    return isResolvedAsset(value)
      ? undefined
      : refuse(
          "wrong-shape",
          `"${prop}" takes a resolved Asset ({ src, width, height }), ` +
            `never a URL on its own.`,
        );
  }
  if (hasShape(entry.kind, value) === false) {
    return refuse(
      "wrong-shape",
      `"${prop}" does not take a value of that shape.`,
    );
  }
  if (entry.kind === SchemaKind.richText && typeof value === "string") {
    const shape = entryTextShape(entry);
    const unsupported = unsupportedMarkup(value, shape);
    if (unsupported !== undefined) {
      return refuse(
        "unsupported-markup",
        `"${prop}" cannot hold ${unsupported}. It takes ${heldMarkup(shape)}.`,
      );
    }
  }
  return undefined;
}

/**
 * The value as it is stored: rich text as the subset writes it, so `<b>`
 * from an Agent is the `<strong>` an Author would have typed.
 */
function asStored(
  definition: BlockDefinition | undefined,
  prop: string,
  value: unknown,
): unknown {
  const entry = definition?.schema[prop];
  return entry?.kind === SchemaKind.richText && typeof value === "string"
    ? sanitiseInlineMarkup(value, entryTextShape(entry))
    : value;
}

/**
 * A new Block's Asset that its prop does not list, when it lists any
 * (ADR-0030). A set-prop Edit is checked by the prop-write rule instead.
 */
function unlistedRefusal(
  entry: SchemaEntry | undefined,
  prop: string,
  value: unknown,
): Refused | undefined {
  if (entry?.kind !== SchemaKind.asset || value === undefined) return undefined;
  const listed = listedAssetsOf(entry.constraints);
  if (!listed || listed.some((asset) => isSamePicture(value, asset))) {
    return undefined;
  }
  return refuse(
    "unlisted-asset",
    `"${prop}" takes only one of the Assets it lists.`,
  );
}

function writeRefusal(
  code: WriteRefusal,
  blockId: string,
  prop: string,
): Refused {
  switch (code) {
    case "missing-block": {
      return missing(blockId);
    }
    case "unregistered-block": {
      return refuse(
        "unregistered-block",
        `Block "${blockId}" has a type this editor does not know.`,
      );
    }
    case "unknown-prop":
    case "no-props": {
      return refuse("unknown-prop", `This Block has no prop "${prop}".`);
    }
    case "not-overridable": {
      // Only a Pending Change or a control refuses this. An Edit writes the
      // desktop value instead, as `setProp` does.
      return refuse("unknown-prop", `"${prop}" cannot be set here.`);
    }
    case "unlisted-asset": {
      return refuse(
        "unlisted-asset",
        `"${prop}" takes only one of the Assets it lists.`,
      );
    }
    case "not-a-width": {
      return refuse("not-a-width", `"${prop}" takes a number.`);
    }
    default: {
      return unreachable(code);
    }
  }
}

const missing = (blockId: string): Refused =>
  refuse("missing-block", `No Block has the id "${blockId}".`);

/** A parent's refusal of a type, in the words a drop would use. */
function placeRefusal(
  document: EmailDocument,
  setup: CarryOutSetup,
  parentId: string,
  type: string,
  movedBlockId?: string,
): Refused {
  const refusal = explainDropRefusal(
    document,
    setup.registry,
    parentId,
    type,
    movedBlockId,
  );
  return refusal
    ? refuse(refusal.code, refusal.message)
    : refuse("not-accepted", `Block "${parentId}" won't take "${type}".`);
}

/**
 * The Ops that put a new Block of `type` in a parent, and the Block, by the
 * nesting rules a drop is held to.
 *
 * The one place a new Block's Ops are built, for `insertBlock` and an insert
 * Edit alike. A container arrives holding its Structural Blocks, and a row
 * pays for a new child out of its widths, in the same undo step.
 */
export function planInsert(
  setup: CarryOutSetup,
  document: EmailDocument,
  request: {
    readonly type: string;
    readonly parentId: string;
    /** Counted as the Document reads now. The end when left out. */
    readonly index?: number;
    readonly props?: Readonly<Record<string, unknown>>;
    /** The new Block's id. Drawn from `createId` when left out. */
    readonly id?: string;
    readonly createId: () => string;
  },
): { readonly ops: readonly Op[]; readonly block: Block } | Refused {
  const { registry, origin } = setup;
  const definition = registry.get(request.type);
  if (!definition) {
    return refuse("unknown-type", `No Block type is called "${request.type}".`);
  }
  const parent = findBlock(document.root, request.parentId);
  if (!parent) return missing(request.parentId);
  if (!canInsertInto(registry, parent, request.type)) {
    return placeRefusal(document, setup, parent.id, request.type);
  }
  if (request.id !== undefined && findBlock(document.root, request.id)) {
    return refuse(
      "duplicate-id",
      `A Block already has the id "${request.id}".`,
    );
  }

  const fresh = newBlock(definition, registry, request.createId, request.props);
  const block = request.id === undefined ? fresh : { ...fresh, id: request.id };
  const children = childrenOf(parent);
  const at = clamp(request.index ?? children.length, 0, children.length);
  return {
    ops: [
      { kind: "insert", origin, parentId: parent.id, index: at, block },
      // The arrival is paid for out of the row it is arriving in, and both
      // Ops go in together — or ⌘Z takes back a column and leaves its width
      // behind.
      ...setup.divisions.opsForInsert(parent, at, block),
    ],
    block,
  };
}

/**
 * The Ops that move a Block, or none when it would not move.
 *
 * `toIndex` is counted as the Document reads now — the space
 * `resolveDropTarget` reports in.
 */
export function planMove(
  setup: CarryOutSetup,
  document: EmailDocument,
  blockId: string,
  toParentId: string,
  toIndex: number,
): { readonly ops: readonly Op[] } | Refused {
  const { root } = document;
  const { registry, origin, divisions } = setup;
  const block = findBlock(root, blockId);
  if (!block) return missing(blockId);
  const location = findLocation(root, blockId);
  if (!location) return refuse("is-root", "The root cannot be moved.");
  const parent = findBlock(root, toParentId);
  if (!parent) return missing(toParentId);
  // Nothing may be moved into itself or into its own subtree.
  if (
    containsBlock(root, blockId, toParentId) ||
    !canInsertInto(registry, parent, block.type, blockId)
  ) {
    return placeRefusal(document, setup, toParentId, block.type, blockId);
  }

  const sameParent = location.parent.id === toParentId;
  // Leaving a container at its minimum is a removal from it, and refused
  // the same way. Moving within it leaves the count where it was.
  if (
    !sameParent &&
    !hasSpareChild(location.parent, registry.get(location.parent.type))
  ) {
    return atMinimum(location.parent.id);
  }
  // `toIndex` is counted as the Document reads now, but the Op moves a
  // Block that is lifted out first — so a Block travelling further down its
  // own parent passes one position it no longer occupies. Done here rather
  // than by whoever resolved the position, so a Drop Target's index means
  // the same thing whether it is acted on at once or held while an upload
  // runs.
  const lifted = sameParent && toIndex > location.index ? toIndex - 1 : toIndex;
  const capacity = childrenOf(parent).length - (sameParent ? 1 : 0);
  const at = clamp(lifted, 0, capacity);
  if (sameParent && at === location.index) return { ops: [] };

  return {
    ops: [
      {
        kind: "move",
        origin,
        blockId,
        fromParentId: location.parent.id,
        fromIndex: location.index,
        toParentId,
        toIndex: at,
      },
      // Into another row, it is a removal from one and an arrival in the
      // other, and both rows still add up. Within its row it keeps its width
      // and the total is unchanged.
      ...(sameParent
        ? []
        : [
            ...divisions.opsForRemove(location.parent, location.index),
            ...divisions.opsForInsert(parent, at, block),
          ]),
    ],
  };
}

/**
 * The Ops that delete a Block, or why it may not go.
 *
 * The one place both refusals live, so `canRemove`, `removeBlock` and a
 * remove Edit cannot drift apart. A Consumer disables a button from the first
 * and the Author presses it against the second, and a button that is enabled
 * and does nothing is worse than no button at all.
 */
export function planRemove(
  setup: CarryOutSetup,
  document: EmailDocument,
  blockId: string,
): { readonly ops: readonly Op[] } | Refused {
  const { root } = document;
  const { registry } = setup;
  if (!findBlock(root, blockId)) return missing(blockId);
  const location = findLocation(root, blockId);
  const block = location && childrenOf(location.parent)[location.index];
  if (!location || !block) {
    return refuse("is-root", "The root cannot be removed.");
  }

  // Deleting a container that holds Required content is allowed; the Document
  // simply becomes invalid and says so (ADR-0006).
  if (!isDeletable(registry.get(block.type))) {
    return refuse("not-deletable", `Block "${blockId}" may not be deleted.`);
  }
  // A container declaring a minimum keeps it. Nothing is made impossible: an
  // Author who wants the whole row gone selects the row instead.
  if (!hasSpareChild(location.parent, registry.get(location.parent.type))) {
    return atMinimum(location.parent.id);
  }

  return {
    ops: [
      {
        kind: "remove",
        origin: setup.origin,
        parentId: location.parent.id,
        index: location.index,
        block,
      },
      // The width it was holding does not evaporate: its neighbour takes it,
      // so the row closes up rather than leaving a gap an Author has to
      // notice and fix.
      ...setup.divisions.opsForRemove(location.parent, location.index),
    ],
  };
}

const atMinimum = (parentId: string): Refused =>
  refuse(
    "at-minimum",
    `Block "${parentId}" is at the fewest children it may hold.`,
  );
