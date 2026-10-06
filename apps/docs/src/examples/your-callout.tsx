import { defineBlock } from "lekh";

/** A leaf of your own, standing in for whatever your product needs. */
export const callout = defineBlock<{ text: string; tone: string }>({
  type: "callout",
  label: "Callout",
  schema: {
    text: { kind: "text", label: "Text", defaultValue: "Worth knowing" },
    tone: {
      kind: "select",
      label: "Tone",
      defaultValue: "info",
      constraints: { options: ["info", "warning"] },
    },
  },
  render: ({ props }) => (
    <p
      style={{
        margin: 0,
        padding: 12,
        backgroundColor: props.tone === "warning" ? "#fff4e5" : "#eef4ff",
      }}
    >
      {props.text}
    </p>
  ),
});
