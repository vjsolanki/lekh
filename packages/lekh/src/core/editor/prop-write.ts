import { isSamePicture, listedAssetsOf } from "../document/assets";
import { SchemaKind, type SchemaEntry } from "../document/definition";
import { WIDTH_REFUSED, widthOpsForSet } from "../layout/division";
import type { Block, EmailDocument } from "../document/document";
import { setPropOp, type SetPropOp } from "./op";
import type { Registry } from "../document/registry";
import { isOverridable, type Stage } from "../layout/responsive";
import { findBlock } from "../document/tree";

/**
 * What a write on the mobile Stage does with a prop that is not Overridable.
 *
 * - `desktop`: write its desktop value. What `setProp` does, so a resolved
 *   image, a text edit or a toolbar's "set link" still lands while the Author
 *   looks at mobile.
 * - `refuse`: write nothing. What the Pending Change and the Inspector do, so
 *   a mobile control never shows a value it cannot store.
 */
export type Fallback = "desktop" | "refuse";

/**
 * Why a write was refused. Internal: public methods say only `false`.
 *
 * - `missing-block`: no Block has that id.
 * - `unregistered-block`: the Block's type has no Definition, and nothing may
 *   half-edit data the editor does not understand.
 * - `no-props`: nothing was asked for.
 * - `unknown-prop`: the Schema has no such prop. Only in `refuse` mode;
 *   `setProp` writes an unknown prop as it is.
 * - `not-overridable`: on the mobile Stage, in `refuse` mode, a prop that
 *   cannot carry a Mobile Override.
 * - `unlisted-asset`: a new picture in an Asset prop that lists Assets. It
 *   comes through an Image Request instead (ADR-0030).
 * - `not-a-width`: a width in a division, written as anything but a number,
 *   an unset included (ADR-0016).
 */
export type WriteRefusal =
  | "missing-block"
  | "unregistered-block"
  | "no-props"
  | "unknown-prop"
  | "not-overridable"
  | "unlisted-asset"
  | "not-a-width";

/** The Ops a write becomes, empty when it changes nothing, or a refusal. */
export type PropWrite =
  { readonly ops: readonly SetPropOp[] } | { readonly refused: WriteRefusal };

export interface PropWriteRequest {
  readonly document: EmailDocument;
  readonly registry: Registry;
  /** Stamped onto every Op. */
  readonly origin: string;
  readonly blockId: string;
  /** All or nothing: one refused prop refuses the lot. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly stage: Stage;
  readonly fallback: Fallback;
  /**
   * The value is an Asset an Image Request just resolved. ADR-0030's list
   * does not gate it: that list is what sends every other picture there.
   */
  readonly resolvedAsset?: boolean;
}

/**
 * Which Ops a prop write becomes.
 *
 * The one rule every write of a prop goes through: `setProp`, the Pending
 * Change, clearing a Mobile Override, a Share and a Repair. It owns the Stage
 * and Overridable rule, Listed Assets, the Division rebalance for Widths, and
 * the no-op check, so none of those can be skipped by a route that forgot it.
 *
 * On the mobile Stage an Overridable prop is written as a Mobile Override,
 * and clearing one is writing `undefined` there. Anything else follows
 * `fallback`.
 */
export function propWrite(request: PropWriteRequest): PropWrite {
  const { document, registry, blockId, values } = request;
  const block = findBlock(document.root, blockId);
  if (!block) return { refused: "missing-block" };
  const definition = registry.get(block.type);
  if (!definition) return { refused: "unregistered-block" };

  const entries = Object.entries(values);
  if (entries.length === 0) return { refused: "no-props" };

  const ops: SetPropOp[] = [];
  for (const [prop, value] of entries) {
    const write = writeOne(
      request,
      block,
      definition.schema[prop],
      prop,
      value,
    );
    if ("refused" in write) return write;
    ops.push(...write.ops);
  }
  return { ops };
}

function writeOne(
  request: PropWriteRequest,
  block: Block,
  entry: SchemaEntry | undefined,
  prop: string,
  value: unknown,
): PropWrite {
  const { document, registry, origin, stage, fallback } = request;
  const refusing = fallback === "refuse";

  if (refusing && entry === undefined) return { refused: "unknown-prop" };
  if (
    request.resolvedAsset !== true &&
    !isAllowedAsset(block, entry, prop, value)
  ) {
    return { refused: "unlisted-asset" };
  }

  if (stage === "mobile") {
    if (entry !== undefined && isOverridable(entry)) {
      return opsOf(setPropOp(block, prop, value, origin, stage));
    }
    if (refusing) return { refused: "not-overridable" };
  }

  // A width is not one Block's business: the children divide their parent, so
  // widening one narrows its neighbour, and the two writes are one thing an
  // Author did.
  const widths = widthOpsForSet(
    document.root,
    registry,
    origin,
    block.id,
    prop,
    value,
  );
  if (widths === WIDTH_REFUSED) return { refused: "not-a-width" };
  if (widths !== undefined) return { ops: widths };
  return opsOf(setPropOp(block, prop, value, origin));
}

function opsOf(op: SetPropOp | undefined): PropWrite {
  return { ops: op === undefined ? [] : [op] };
}

/**
 * Whether a value may go into an Asset prop that lists Assets the Consumer
 * already resolved (ADR-0030).
 *
 * A listed one may, and so may the picture already there with its alt text
 * changed, and clearing. Any other picture comes through an Image Request. A
 * prop that lists nothing is left alone.
 */
function isAllowedAsset(
  block: Block,
  entry: SchemaEntry | undefined,
  prop: string,
  value: unknown,
): boolean {
  if (entry?.kind !== SchemaKind.asset || value === undefined) return true;
  const listed = listedAssetsOf(entry.constraints);
  if (listed === undefined) return true;
  return (
    isSamePicture(value, block.props[prop]) ||
    listed.some((asset) => isSamePicture(value, asset))
  );
}
