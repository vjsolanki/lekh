import { defineBlock } from "lekh";

/**
 * A whole editor's worth of Blocks, owing nothing to any Preset.
 *
 * Three Definitions is the minimum that does something: a root to hold
 * everything, and two things to put in it. Nothing here imports react.email,
 * so none of it reaches your bundle.
 */

/** The root: every email is one of these, and it holds everything else. */
export const email = defineBlock<{ background: string }>({
  type: "email",
  label: "Email",
  accepts: ["heading", "paragraph"],
  schema: {
    background: {
      kind: "color",
      label: "Background",
      defaultValue: "#f4f4f5",
    },
  },
  render: ({ props, children }) => (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: props.background }}>
        <table width="100%" cellPadding={0} cellSpacing={0} role="presentation">
          <tbody>
            <tr>
              <td align="center" style={{ padding: 24 }}>
                <table
                  width={600}
                  cellPadding={0}
                  cellSpacing={0}
                  role="presentation"
                  style={{ backgroundColor: "#ffffff" }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: 24 }}>{children}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  ),
});

export const heading = defineBlock<{ text: string; size: number }>({
  type: "heading",
  label: "Heading",
  schema: {
    text: { kind: "text", label: "Text", defaultValue: "Your headline" },
    size: {
      kind: "number",
      label: "Size",
      defaultValue: 28,
      constraints: { min: 14, max: 48, unit: "px" },
    },
  },
  render: ({ props }) => (
    <h1
      style={{
        margin: "0 0 16px",
        fontFamily: "Arial, sans-serif",
        fontSize: props.size,
        lineHeight: 1.2,
      }}
    >
      {props.text}
    </h1>
  ),
});

export const paragraph = defineBlock<{ text: string }>({
  type: "paragraph",
  label: "Paragraph",
  schema: {
    text: {
      kind: "text",
      label: "Text",
      defaultValue: "Say something worth reading.",
    },
  },
  render: ({ props }) => (
    <p
      style={{
        margin: "0 0 16px",
        fontFamily: "Arial, sans-serif",
        fontSize: 16,
        lineHeight: 1.5,
      }}
    >
      {props.text}
    </p>
  ),
});

export const definitions = [email, heading, paragraph];
