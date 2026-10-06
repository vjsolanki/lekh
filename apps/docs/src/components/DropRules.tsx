import { useMemo, useState } from "react";
import { createEditor, defineBlock, type Editor } from "lekh";

import { refusalText } from "../examples/nesting-refusal";

/**
 * A React island: the real nesting rules, asked live.
 *
 * Every answer below comes from `editor.explainDropRefusal`, not from a table
 * written by hand. Change the Definitions and the grid changes with them.
 */

const leaf = (type: string, label: string) =>
  defineBlock<{ text: string }>({
    type,
    label,
    schema: { text: { kind: "text", label: "Text", defaultValue: label } },
    render: ({ props }) => <span>{props.text}</span>,
  });

const definitions = [
  defineBlock({
    type: "email",
    label: "Email",
    accepts: ["section", "row"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock({
    type: "section",
    label: "Section",
    // Two leaves at most, so "at-capacity" is reachable.
    accepts: ["heading", "image"],
    maxChildren: 2,
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock({
    type: "row",
    label: "Row",
    accepts: ["column"],
    minChildren: 2,
    maxChildren: 4,
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  defineBlock<{ width: number }>({
    type: "column",
    label: "Column",
    structural: true,
    accepts: ["heading", "image"],
    schema: {
      width: {
        kind: "width",
        label: "Width",
        defaultValue: 50,
        constraints: { min: 10, max: 100 },
      },
    },
    render: ({ children }) => <div>{children}</div>,
  }),
  leaf("heading", "Heading"),
  leaf("image", "Image"),
  leaf("callout", "Callout"),
];

const CONTAINERS = ["email", "section", "row", "column"] as const;
const DRAGGED = ["section", "row", "heading", "image", "callout"] as const;

interface Built {
  readonly editor: Editor;
  readonly ids: Readonly<Record<string, string>>;
}

/** One of each container, so every cell has a real Block to ask about. */
function build(fill: boolean): Built {
  const editor = createEditor({ definitions, rootType: "email" });
  const root = editor.getDocument().root;

  const section = editor.insertBlock("section", root.id, 0);
  const row = editor.insertBlock("row", root.id, 1);

  // A row seeds its own columns, because `minChildren` says a row of one
  // column is not a row.
  const column = editor.getBlock(row ?? "")?.children?.[0]?.id;

  if (fill && section) {
    editor.insertBlock("heading", section, 0);
    editor.insertBlock("image", section, 1);
  }

  return {
    editor,
    ids: {
      email: root.id,
      section: section ?? "",
      row: row ?? "",
      column: column ?? "",
    },
  };
}

export default function DropRules() {
  const [fill, setFill] = useState(false);
  const { editor, ids } = useMemo(() => build(fill), [fill]);

  return (
    <div>
      <label style={{ display: "block", marginBottom: "1rem" }}>
        <input
          type="checkbox"
          checked={fill}
          onChange={(event) => {
            setFill(event.target.checked);
          }}
        />{" "}
        Fill the Section to its <code>maxChildren</code> of 2
      </label>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Dragging</th>
              {CONTAINERS.map((type) => (
                <th key={type} scope="col">
                  into {editor.getDefinition(type)?.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DRAGGED.map((dragged) => (
              <tr key={dragged}>
                <th scope="row">{editor.getDefinition(dragged)?.label}</th>
                {CONTAINERS.map((container) => {
                  const refusal = editor.explainDropRefusal(
                    ids[container] ?? "",
                    dragged,
                  );

                  return (
                    <td key={container}>
                      {refusal ? (
                        <span>
                          <code>{refusal.code}</code>
                          <br />
                          {refusalText(refusal, editor)}
                        </span>
                      ) : (
                        <span>Lands here</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        <strong>Callout</strong> is registered and would appear in a palette,
        but no container names it. That is the one that catches people adding a
        Block to somebody else's Preset.
      </p>
    </div>
  );
}
