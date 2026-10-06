import { defineBlock } from "lekh-editor";

/** One `padding` number as `paddingX` and `paddingY`, if there is one. */
function splitPadding(values: Readonly<Record<string, unknown>>) {
  const padding = values["padding"];
  if (typeof padding !== "number") return { ...values };
  return {
    ...values,
    paddingX: padding * 2,
    paddingY: padding,
    padding: undefined,
  };
}

/**
 * A Block on its third version.
 *
 * Version 1 renamed `text` to `label`. Version 2 split one `padding` number
 * into two. Emails saved before either change still open, because the
 * migrations bring them forward as they load.
 */
export const button = defineBlock<{
  label: string;
  paddingX: number;
  paddingY: number;
}>({
  type: "button",
  label: "Button",
  version: 2,

  migrations: {
    // Runs on the Block stored at version 0, and returns version 1. It never
    // touches phone-only values, so it passes `mobile` through.
    1: ({ props, mobile }) => ({
      props: { ...props, label: props["text"] ?? "Read more", text: undefined },
      mobile,
    }),

    // Runs on version 1, returns version 2. `padding` had a phone-only value,
    // so that is split too, or it would be left under a name nothing reads.
    2: ({ props, mobile }) => ({
      props: splitPadding(props),
      ...(mobile ? { mobile: splitPadding(mobile) } : {}),
    }),
  },

  schema: {
    label: { kind: "text", label: "Label", defaultValue: "Read more" },
    paddingX: {
      kind: "number",
      label: "Side padding",
      defaultValue: 24,
      mobile: (value) => ({
        "padding-left": `${String(value)}px`,
        "padding-right": `${String(value)}px`,
      }),
    },
    paddingY: {
      kind: "number",
      label: "Top padding",
      defaultValue: 12,
      mobile: (value) => ({
        "padding-top": `${String(value)}px`,
        "padding-bottom": `${String(value)}px`,
      }),
    },
  },

  render: ({ props, mobile }) => (
    <a
      href="#"
      className={mobile.className}
      style={{
        display: "inline-block",
        padding: `${props.paddingY}px ${props.paddingX}px`,
      }}
    >
      {props.label}
    </a>
  ),
});
