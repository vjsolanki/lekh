import type { Block, EmailDocument } from "../index";

/**
 * A Block as a test writes it, before it has an id.
 *
 * Built by `block` and turned into a Document by `documentOf`, which is where
 * the ids are handed out — so two Documents built from the same literal are
 * equal, whatever was built in between.
 */
export interface BlockSpec {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly mobile?: Readonly<Record<string, unknown>>;
  readonly children?: readonly BlockSpec[];
}

/**
 * One Block: a type, its props, and, for a container, its children.
 *
 * An `id` prop names the Block and is not kept as a prop. Without one the id
 * is the type and a counter, so the second text Block is `text-2`.
 *
 * Nothing is checked. A missing Required Block, an unknown type or Widths that
 * total 90 are built as written, because a Diagnostic or Repair test has to
 * start from exactly that.
 */
export function block(
  type: string,
  props: Readonly<Record<string, unknown>> = {},
  children?: readonly BlockSpec[],
): BlockSpec {
  return children === undefined ? { type, props } : { type, props, children };
}

/** The same Block with a Mobile Override stored against it. */
export function onMobile(
  spec: BlockSpec,
  mobile: Readonly<Record<string, unknown>>,
): BlockSpec {
  return { ...spec, mobile };
}

/** A Document whose root is the given Block. */
export function documentOf(root: BlockSpec): EmailDocument {
  const counters = new Map<string, number>();

  const idFor = (type: string): string => {
    const next = (counters.get(type) ?? 0) + 1;
    counters.set(type, next);
    return `${type}-${String(next)}`;
  };

  const build = (spec: BlockSpec): Block => {
    const { id, ...props } = spec.props;
    const built = {
      id: typeof id === "string" ? id : idFor(spec.type),
      type: spec.type,
      props,
      ...(spec.mobile === undefined ? {} : { mobile: spec.mobile }),
    };
    return spec.children === undefined
      ? built
      : { ...built, children: spec.children.map(build) };
  };

  return { root: build(root) };
}
