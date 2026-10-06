import { defineBlock, SchemaKind } from "lekh";

/**
 * A type alias, not an interface.
 *
 * `defineBlock<TProps>` constrains `TProps` to `Record<string, unknown>`. An
 * interface has no implicit index signature, so it does not satisfy that
 * constraint and the call will not compile. A type alias does.
 */
type ButtonProps = {
  label: string;
  href: string;
  radius: number;
};

export const button = defineBlock<ButtonProps>({
  type: "button",
  label: "Button",

  // Every key of ButtonProps must appear here, and each defaultValue is typed
  // by the prop it belongs to. Add a prop above without adding it here and
  // this object stops compiling — which is the point.
  schema: {
    label: { kind: SchemaKind.text, label: "Text", defaultValue: "Read more" },
    href: {
      kind: SchemaKind.url,
      label: "Link",
      defaultValue: "https://example.com",
    },
    radius: {
      kind: SchemaKind.number,
      label: "Corner radius",
      defaultValue: 4,
      constraints: { min: 0, max: 24, unit: "px" },
    },
  },

  // `props` is ButtonProps. No narrowing, no casts, nothing optional.
  render: ({ props }) => (
    <a
      href={props.href}
      style={{ borderRadius: props.radius, padding: "12px 20px" }}
    >
      {props.label}
    </a>
  ),
});
