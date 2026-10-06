import { defineBlock, RichText } from "lekh";

/** Body copy that holds paragraphs and lists. */
export const bodyCopy = defineBlock<{ content: string; fontSize: number }>({
  type: "body-copy",
  label: "Body copy",
  schema: {
    content: {
      kind: "rich-text",
      label: "Content",
      defaultValue: "",
      constraints: { paragraphs: true, lists: true },
    },
    fontSize: {
      kind: "number",
      label: "Font size",
      defaultValue: 16,
      constraints: { min: 10, max: 48, unit: "px" },
    },
  },
  render: ({ props, rootProps }) => {
    // Some clients reset a list item's font, so every element writes it.
    const text = { fontFamily: "Arial, sans-serif", fontSize: "1em" };
    return (
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td style={{ fontSize: props.fontSize }}>
              <RichText
                value={props.content}
                paragraphStyle={{ ...text, marginTop: 0, marginBottom: 16 }}
                listStyle={{ ...text, marginTop: 0, marginBottom: 16 }}
                listItemStyle={{ ...text, marginTop: 0, marginBottom: 4 }}
                listIndent={Math.round(props.fontSize * 1.5)}
                direction={rootProps["direction"] === "rtl" ? "rtl" : "ltr"}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );
  },
});
