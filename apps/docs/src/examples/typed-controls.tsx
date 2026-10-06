import type { ControlDescriptor } from "lekh";
import type { ReactElement } from "react";

/**
 * A control registry that narrows once, at the edge.
 *
 * `ControlDescriptor.value` is `unknown` because one panel receives
 * descriptors from every Block type at once. Rather than narrowing inside
 * every control, each kind declares how to read its own value and is then
 * written against a real type.
 */

interface ControlProps<TValue> {
  readonly label: string;
  readonly value: TValue;
  readonly set: (value: TValue) => void;
  readonly constraints: Readonly<Record<string, unknown>>;
}

/**
 * Pair a reader with a renderer. `TValue` is inferred from the reader, so the
 * renderer below it is written against a concrete type with no annotation.
 */
const control =
  <TValue,>(
    read: (value: unknown) => TValue,
    render: (props: ControlProps<TValue>) => ReactElement | null,
  ) =>
  (descriptor: ControlDescriptor): ReactElement | null =>
    render({
      label: descriptor.label,
      value: read(descriptor.value),
      // Safe in this direction: a function taking `unknown` accepts a TValue.
      set: descriptor.set,
      constraints: descriptor.constraints ?? {},
    });

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const asNumber = (value: unknown): number =>
  typeof value === "number" ? value : 0;

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

export const CONTROLS: Readonly<
  Record<string, (descriptor: ControlDescriptor) => ReactElement | null>
> = {
  // `value` is a string in here. No casts, no optional chaining.
  text: control(asString, ({ label, value, set }) => (
    <label>
      {label}
      <input
        value={value}
        onChange={(event) => {
          set(event.target.value);
        }}
      />
    </label>
  )),

  // And a number in here.
  number: control(asNumber, ({ label, value, set, constraints }) => (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={numberOr(constraints["min"], 0)}
        max={numberOr(constraints["max"], 100)}
        onChange={(event) => {
          set(event.target.valueAsNumber);
        }}
      />
    </label>
  )),
};

/** A kind nothing claims draws nothing, which is what keeps this open. */
export function Control({
  descriptor,
}: {
  descriptor: ControlDescriptor;
}): ReactElement | null {
  return CONTROLS[descriptor.kind]?.(descriptor) ?? null;
}
