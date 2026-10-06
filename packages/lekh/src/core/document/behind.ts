import { assetOf } from "./assets";
import { parseColor, type Color } from "./color";
import { SchemaKind, type BlockDefinition } from "./definition";

/** One Block on the way down to a colour: what it is and what it resolved to. */
export interface Painted {
  /** `undefined` for a Block nobody registered. */
  readonly definition: BlockDefinition | undefined;
  /** Its resolved desktop props. */
  readonly props: Readonly<Record<string, unknown>>;
}

/** The Surface colour a colour is read against: as stored, and as read. */
export interface Behind {
  readonly value: string;
  readonly color: Color;
}

/**
 * What is really behind a colour prop: the Surface its entry names with `on`,
 * or else the nearest one beneath it that is not None.
 *
 * `trail` runs from the root down to the Block that holds `prop`. A Block's
 * Surfaces stack in Schema order, the last on top, and above its parent's. An
 * optional Asset declared after a Surface is drawn over it.
 *
 * `undefined` whenever this cannot be sure: a background image lies between,
 * a Surface is a colour it cannot read, a Block on the way is unregistered, or
 * nothing beneath has a colour at all. Never a guess, since a contrast check a
 * Consumer escalates must never block a send on one.
 */
export function surfaceBehind(
  trail: readonly Painted[],
  prop: string,
): Behind | undefined {
  for (let index = trail.length - 1; index >= 0; index--) {
    const painted = trail[index];
    if (!painted?.definition) return undefined;

    let layers = layersOf(painted.definition);
    if (index === trail.length - 1) {
      const on = painted.definition.schema[prop]?.on;
      const named =
        on === undefined ? -1 : layers.findIndex((layer) => layer.name === on);
      if (named !== -1) layers = layers.slice(0, named + 1);
    }

    for (const layer of layers.toReversed()) {
      const value = painted.props[layer.name];
      if (layer.image) {
        if (assetOf(value)) return undefined;
        continue;
      }
      const parsed = parseColor(value);
      if (parsed.kind === "unreadable") return undefined;
      if (parsed.kind === "opaque" && typeof value === "string") {
        return { value, color: parsed.color };
      }
    }
  }
  return undefined;
}

interface Layer {
  readonly name: string;
  /** An optional Asset, drawn over the Surfaces declared before it. */
  readonly image: boolean;
}

/** A Block's Surfaces and the images over them, bottom first. */
function layersOf(definition: BlockDefinition): readonly Layer[] {
  const layers: Layer[] = [];
  for (const [name, entry] of Object.entries(definition.schema)) {
    if (entry.kind === SchemaKind.surface) layers.push({ name, image: false });
    // Only over a Surface: an Asset with nothing under it, like an icon, is
    // the Block's own picture rather than a background.
    else if (
      entry.kind === SchemaKind.asset &&
      entry.primary !== true &&
      layers.length > 0
    ) {
      layers.push({ name, image: true });
    }
  }
  return layers;
}
