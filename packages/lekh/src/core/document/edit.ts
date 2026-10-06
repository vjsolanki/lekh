import type { Stage } from "../layout/responsive";

/**
 * One change to a Document, named by identity — which Block, which prop,
 * after which sibling — never by index (ADR-0036).
 *
 * It means the same thing later or is refused, so it can wait: a Repair
 * carries one, and a Suggestion is a list of them. Only an editor carries one
 * out, turning it into Ops against the Document as it reads then. The Op log
 * does not change.
 */
export type Edit = SetPropEdit | InsertEdit | RemoveEdit | MoveEdit;

/**
 * Set one prop. `undefined` unsets it, which resolves it to the Schema
 * default.
 *
 * No more general than `Editor.setProp`: the Stage rules, the Mobile Override
 * rules and the refusal on an unknown Block all stay where they were. Without
 * a `stage` it writes on the Stage the editor is showing.
 */
export type SetPropEdit = {
  readonly kind: "set-prop";
  readonly blockId: string;
  readonly prop: string;
  readonly value: unknown;
  readonly stage?: Stage;
};

/**
 * Add a new Block of `type`, placed by its siblings or its parent.
 *
 * `after` or `before` puts it beside a sibling. `parent` alone puts it at the
 * end of that Block's children. Given with a sibling, it must be the
 * sibling's parent.
 *
 * `id` names the new Block, so later Edits in the same Suggestion can name it
 * too. Refused when a Block already has it. Leave it out and the editor picks
 * one.
 */
export type InsertEdit = {
  readonly kind: "insert";
  readonly type: string;
  readonly id?: string;
  readonly after?: string;
  readonly before?: string;
  readonly parent?: string;
  readonly props?: Readonly<Record<string, unknown>>;
};

/** Take one Block, and everything inside it, out of the Document. */
export type RemoveEdit = {
  readonly kind: "remove";
  readonly blockId: string;
};

/** Put one Block somewhere else, placed as an insert is. */
export type MoveEdit = {
  readonly kind: "move";
  readonly blockId: string;
  readonly after?: string;
  readonly before?: string;
  readonly parent?: string;
};

/**
 * Narrow data to an Edit this library can carry out, checking its shape.
 *
 * At runtime because an Edit is data: it can come from untyped code, a stored
 * Diagnostic or a model. Matching the kind establishes nothing about the rest.
 */
export function knownEdit(edit: { readonly kind: string }): Edit | undefined {
  const fields: Readonly<Record<string, unknown>> = edit;

  switch (edit.kind) {
    case "set-prop": {
      const { blockId, prop, value, stage } = fields;
      if (typeof blockId !== "string" || typeof prop !== "string") {
        return undefined;
      }
      if (stage === undefined)
        return { kind: "set-prop", blockId, prop, value };
      return stage === "desktop" || stage === "mobile"
        ? { kind: "set-prop", blockId, prop, value, stage }
        : undefined;
    }
    case "insert": {
      const { type, id, props } = fields;
      const place = placeOf(fields);
      if (typeof type !== "string" || !place) return undefined;
      if (id !== undefined && typeof id !== "string") return undefined;
      if (props !== undefined && !isRecord(props)) return undefined;
      return {
        kind: "insert",
        type,
        ...(id === undefined ? {} : { id }),
        ...place,
        ...(props === undefined ? {} : { props }),
      };
    }
    case "remove": {
      const { blockId } = fields;
      return typeof blockId === "string"
        ? { kind: "remove", blockId }
        : undefined;
    }
    case "move": {
      const { blockId } = fields;
      const place = placeOf(fields);
      if (typeof blockId !== "string" || !place) return undefined;
      return { kind: "move", blockId, ...place };
    }
    default: {
      return undefined;
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The ids an insert or a move is placed by, each a string when given. */
function placeOf(
  fields: Readonly<Record<string, unknown>>,
): Pick<InsertEdit, "after" | "before" | "parent"> | undefined {
  const place: Record<string, string> = {};
  for (const key of ["after", "before", "parent"] as const) {
    const value = fields[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return undefined;
    place[key] = value;
  }
  return place;
}
