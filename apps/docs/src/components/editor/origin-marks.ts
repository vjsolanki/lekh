import { type ControlDescriptor } from "lekh-editor";

/** What the marks read off a Control Descriptor. */
export type Marked = Pick<ControlDescriptor, "value" | "origin" | "otherStage">;

/**
 * One small mark beside a row's label: a dot for a value set on this Block, a
 * link for one that follows the email, and a phone with the value when phones
 * show something else.
 */
export type OriginMark =
  | { readonly kind: "block" }
  | { readonly kind: "email" }
  | { readonly kind: "phone"; readonly values: readonly unknown[] };

/**
 * The marks a row gets, in that order. A value at its default gets none.
 *
 * The phone shows for a Mobile Override, and on desktop whenever mobile holds
 * one, carrying the value a phone shows. A Box passes all its sides and gets
 * each mark once, its phone naming every side.
 */
export function originMarks(
  controls: readonly Marked[],
  onMobile: boolean,
): readonly OriginMark[] {
  const marks: OriginMark[] = [];
  if (controls.some((control) => control.origin === "block")) {
    marks.push({ kind: "block" });
  }
  if (controls.some((control) => control.origin === "email")) {
    marks.push({ kind: "email" });
  }
  const differs = controls.some(
    (control) =>
      control.origin === "override" ||
      control.otherStage?.origin === "override",
  );
  if (differs) {
    marks.push({
      kind: "phone",
      values: controls.map((control) =>
        onMobile ? control.value : (control.otherStage?.value ?? control.value),
      ),
    });
  }
  return marks;
}
