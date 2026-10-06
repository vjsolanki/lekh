/**
 * The words an Author reads for a Schema's options and Boxes.
 */

/** What an Author is told each of the Preset's Boxes is. */
const BOX_LABEL: Readonly<Record<string, string>> = {
  padding: "Padding",
  inner: "Inner padding",
};

/** What an Author reads for a Box, or its name where this example has none. */
export function boxLabel(box: string): string {
  return BOX_LABEL[box] ?? box;
}

/** An option or its label as text, or nothing for anything else. */
export function labelOf(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/**
 * A `select` Schema's options, each with a label. An option is a plain value,
 * or `{ label, value }` when the value is not something to show an Author.
 */
export function choicesOf(
  constraints: Readonly<Record<string, unknown>> | undefined,
): readonly { readonly label: string; readonly value: unknown }[] {
  return optionsOf(constraints).map((option) =>
    typeof option === "object" &&
    option !== null &&
    "label" in option &&
    "value" in option
      ? { label: labelOf(option.label), value: option.value }
      : { label: labelOf(option), value: option },
  );
}

/** A `select` or `align` Schema's options, narrowed out of open constraints. */
export function optionsOf(
  constraints: Readonly<Record<string, unknown>> | undefined,
): readonly unknown[] {
  const options = constraints?.["options"];
  return Array.isArray(options) ? options : [];
}
