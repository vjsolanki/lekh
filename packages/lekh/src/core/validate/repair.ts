import { knownEdit, type Edit, type SetPropEdit } from "../document/edit";

/**
 * What would put a Diagnostic right — described, not performed.
 *
 * A Diagnostic is produced on both sides of the editor/send line, and the
 * render path has no editor. That asymmetry is why this is data where a
 * Control Descriptor's setter is a closure (ADR-0002): a Control Descriptor
 * only ever exists inside an editor, so it can hold one. A Repair is
 * described wherever validation runs and carried out only by
 * `Editor.applyRepair` (ADR-0015).
 *
 * A Repair names identities and never indices, so one held across a change
 * either still means what it said or refuses — the rule ADR-0013 already
 * needed for a placement that outlives its gesture.
 */
export type Repair = KnownRepair | ConsumerRepair;

/**
 * The Repairs this library describes and knows how to carry out: an Edit, or
 * one of its own intent kinds, named for what they mean because carrying them
 * out carries policy too (ADR-0036).
 */
export type KnownRepair = Edit | RestoreRequiredBlockRepair;

/**
 * Put back a Required Block the Document is missing.
 *
 * Named for the intent rather than spelled out as steps, because the steps
 * carry policy: it appends to the root, then selects and reveals, since a
 * compliance repair must never happen off-screen (ADR-0006). A step list would
 * make that something the author of a Repair could forget.
 */
export type RestoreRequiredBlockRepair = {
  readonly kind: "restore-required-block";
  /** The Block Definition's type. */
  readonly type: string;
};

/**
 * Set one prop back to something that says what it should. It is the
 * `set-prop` Edit, and is carried out the same way.
 */
export type SetPropRepair = SetPropEdit;

/**
 * A Repair this library did not describe — one a Consumer's own Validator
 * attached, for their own Diagnostics panel to interpret.
 *
 * An open `kind`, for the reason ADR-0002 gives a Control Descriptor one: a
 * bespoke repair should not need an escape hatch. The Consumer's switch runs
 * first and `applyRepair` is its default branch, so a kind the library adds
 * later can never quietly take over one of theirs.
 *
 * Openness costs {@link Repair} its construction-time checking — anything
 * carrying a `kind` satisfies it, including a malformed one wearing a known
 * kind. Hence {@link knownRepair}, and hence the library annotating its own
 * literals with the member they are rather than with `Repair`.
 */
export type ConsumerRepair = {
  readonly kind: string;
  readonly [key: string]: unknown;
};

/**
 * Narrow a Repair to one this library can carry out, checking its shape.
 *
 * The check is at runtime because a Repair is data: it can arrive from
 * untyped code, from a Diagnostic that was stored, or from a Consumer who
 * reused one of these kinds and filled it in wrongly. Nothing here trusts the
 * type it was handed — which is the price of the Repair being serialisable,
 * not of the kind being open.
 */
export function knownRepair(repair: Repair): KnownRepair | undefined {
  if (repair.kind !== "restore-required-block") return knownEdit(repair);

  // Read through an untyped view rather than the narrowed member: matching the
  // kind is exactly what does not establish that the rest of it is there.
  const fields: Readonly<Record<string, unknown>> = repair;
  return isString(fields["type"])
    ? { kind: "restore-required-block", type: fields["type"] }
    : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
