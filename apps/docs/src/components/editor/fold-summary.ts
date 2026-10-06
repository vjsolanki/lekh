import { SchemaKind, type ControlDescriptor } from "lekh-editor";

import { boxLabel, choicesOf } from "./labels";

/** What a summary reads off a Control Descriptor. */
export type Summarised = Pick<
  ControlDescriptor,
  "kind" | "label" | "value" | "origin" | "box" | "constraints"
>;

/**
 * A closed fold's title: its name, then what is set inside it — "More · Border
 * width 2px". Just the name when nothing is.
 *
 * A setting is set when its Origin is not `default`, so a value that follows
 * the email counts, and so does a Mobile Override. A Box is named once, by its
 * sides' values, when any side is set.
 */
export function foldSummary(
  name: string,
  controls: readonly Summarised[],
): string {
  const parts: string[] = [];
  const boxes = new Set<string>();
  for (const control of controls) {
    if (control.box === undefined) {
      if (control.origin !== "default") parts.push(describe(control));
      continue;
    }
    if (boxes.has(control.box)) continue;
    boxes.add(control.box);
    const sides = controls.filter((each) => each.box === control.box);
    if (sides.some((each) => each.origin !== "default")) {
      parts.push(`${boxLabel(control.box)} ${sidesText(sides)}`);
    }
  }
  return parts.length === 0 ? name : `${name} · ${parts.join(", ")}`;
}

/** One setting as a few words: its label, then its value where it reads. */
function describe(control: Summarised): string {
  const value = valueText(control);
  return value === "" ? control.label : `${control.label} ${value}`;
}

/** How long a typed value may run before it is cut short. */
const TEXT_MAX = 14;

/** A value as a word or a measure, or nothing for one that is not either. */
function valueText(control: Summarised): string {
  const { value } = control;
  const choice = choicesOf(control.constraints).find((option) =>
    Object.is(option.value, value),
  );
  if (choice) return choice.label;
  if (typeof value === "number") return `${String(value)}${unitOf(control)}`;
  if (typeof value === "boolean") return value ? "on" : "off";
  if (control.kind === SchemaKind.richText || typeof value !== "string") {
    return "";
  }
  return value.length > TEXT_MAX ? `${value.slice(0, TEXT_MAX - 1)}…` : value;
}

/**
 * A Box's sides: one value with its unit when they agree, the four bare
 * numbers when not — "20px", or "8 0 8 0", as CSS would write them.
 */
function sidesText(sides: readonly Summarised[]): string {
  const [first, ...rest] = sides;
  if (first === undefined) return "";
  return rest.every((side) => Object.is(side.value, first.value))
    ? valueText(first)
    : sides.map((side) => String(side.value)).join(" ");
}

/** The unit a number's Schema names, such as "px", or nothing. */
function unitOf(control: Summarised): string {
  const unit = control.constraints?.["unit"];
  return typeof unit === "string" ? unit : "";
}
