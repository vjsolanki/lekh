import { useMemo, useState } from "react";
import {
  defineBlock,
  type EmailDocument,
  renderDocument,
  toHtml,
} from "lekh-editor";

/**
 * A tiny set of Block Definitions, written the way a Consumer would write
 * them. No react.email here — the core imports nothing from it, so a Consumer
 * bringing their own components never pulls it in.
 */
const definitions = [
  defineBlock<{ backgroundColor: string; contentWidth: number }>({
    type: "email",
    label: "Email",
    accepts: ["greeting"],
    schema: {
      backgroundColor: {
        kind: "color",
        label: "Background color",
        defaultValue: "#f6f6f6",
      },
      contentWidth: {
        kind: "number",
        label: "Content width",
        defaultValue: 600,
      },
    },
    render: ({ props, children }) => (
      <table
        role="presentation"
        width={props.contentWidth}
        cellPadding={0}
        cellSpacing={0}
        style={{ backgroundColor: props.backgroundColor }}
      >
        <tbody>{children}</tbody>
      </table>
    ),
  }),
  defineBlock<{ name: string }>({
    type: "greeting",
    label: "Greeting",
    schema: {
      name: { kind: "text", label: "Recipient name", defaultValue: "there" },
    },
    render: ({ props }) => (
      <tr>
        <td style={{ fontFamily: "sans-serif", padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Hello {props.name}</h1>
          <p style={{ margin: "8px 0 0" }}>Thanks for signing up.</p>
        </td>
      </tr>
    ),
  }),
];

/**
 * A React island: a stored Document renders through the real library, in the
 * browser, proving the isomorphic build works outside Node.
 */
export default function LivePreview() {
  const [name, setName] = useState("Ada");

  const html = useMemo(() => {
    const document: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "greeting", type: "greeting", props: { name } }],
      },
    };
    return toHtml(renderDocument(document, { definitions }), {
      doctype: false,
    });
  }, [name]);

  return (
    <div>
      <label>
        Recipient name{" "}
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <p>Rendered output:</p>
      <pre>
        <code>{html}</code>
      </pre>
    </div>
  );
}
