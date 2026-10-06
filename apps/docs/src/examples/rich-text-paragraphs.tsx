import { defineBlock, RichText } from "lekh-editor";

/** Body copy that holds paragraphs, spaced by a prop of its own. */
export const bodyCopy = defineBlock<{ content: string; spacing: number }>({
  type: "body-copy",
  label: "Body copy",
  schema: {
    content: {
      kind: "rich-text",
      label: "Content",
      defaultValue: "",
      constraints: { paragraphs: true },
    },
    spacing: {
      kind: "number",
      label: "Paragraph spacing",
      defaultValue: 16,
      constraints: { min: 0, unit: "px" },
    },
  },
  // A cell, not a `<p>`: `RichText` writes one `<p>` per paragraph.
  render: ({ props }) => (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr>
          <td>
            <RichText
              value={props.content}
              paragraphStyle={{ marginTop: 0, marginBottom: props.spacing }}
            />
          </td>
        </tr>
      </tbody>
    </table>
  ),
});
