import { defineBlock } from "lekh-editor";

/**
 * A row and the columns it owns — the shape every nesting rule exists for.
 *
 * The row is placed by the person using your editor. The columns are not: the
 * row creates them, and they are reached only through it.
 */

export const row = defineBlock<{ gap: number }>({
  type: "row",
  label: "Row",

  // Only columns, and only ever between two and four of them.
  accepts: ["column"],
  maxChildren: 4,

  // Arrives holding two, and is never left holding one. A row of one column
  // renders as a single cell, which is what a plain container already is.
  minChildren: 2,

  schema: { gap: { kind: "number", label: "Gap", defaultValue: 16 } },
  render: ({ props, children }) => (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr style={{ verticalAlign: "top" }}>
          {children.map((child, at) => (
            <td key={at} style={{ paddingRight: props.gap }}>
              {child}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  ),
});

export const column = defineBlock<{ width: number }>({
  type: "column",
  label: "Column",

  // Never in the palette, never dragged. The row owns it.
  structural: true,

  accepts: ["heading", "paragraph", "image"],

  schema: {
    // `kind: "width"` is what opts a Block into the division of its parent.
    // The children of one container always come to 100, so moving one moves a
    // sibling, and `min` is the floor none of them goes below.
    width: {
      kind: "width",
      label: "Width",
      defaultValue: 50,
      constraints: { min: 10, max: 100, unit: "%" },
    },
  },

  render: ({ children }) => <>{children}</>,
});
