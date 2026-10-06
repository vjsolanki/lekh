import { useMemo, useState } from "react";
import {
  type ControlDescriptor,
  createEditor,
  defineBlock,
  renderDocument,
  toHtml,
} from "lekh";

/**
 * A React island: what `getControls()` hands you, beside what you draw from it.
 *
 * The `tone` prop uses a `kind` the library has never heard of. Nothing had to
 * be registered for it to work — a `kind` is an open string, and the switch
 * below is the only thing that decides what it means.
 */

type NoticeProps = {
  message: string;
  tone: string;
  size: number;
  boxed: boolean;
};

const TONES: Readonly<Record<string, { bg: string; fg: string }>> = {
  info: { bg: "#eef4ff", fg: "#1e3a8a" },
  success: { bg: "#eefbf1", fg: "#14532d" },
  warning: { bg: "#fff4e5", fg: "#7c2d12" },
};

const notice = defineBlock<NoticeProps>({
  type: "notice",
  label: "Notice",
  schema: {
    message: {
      kind: "text",
      label: "Message",
      defaultValue: "Your invoice is ready.",
    },
    // A kind of your own. The library passes it through untouched.
    tone: {
      kind: "tone",
      label: "Tone",
      defaultValue: "info",
      constraints: { options: Object.keys(TONES) },
    },
    size: {
      kind: "number",
      label: "Font size",
      defaultValue: 16,
      constraints: { min: 12, max: 28, unit: "px" },
    },
    boxed: { kind: "boolean", label: "Boxed", defaultValue: true },
  },
  render: ({ props }) => {
    const tone = TONES[props.tone] ?? TONES["info"];
    return (
      <p
        style={{
          margin: 0,
          fontFamily: "Arial, sans-serif",
          fontSize: props.size,
          color: tone?.fg,
          backgroundColor: props.boxed ? tone?.bg : "transparent",
          padding: props.boxed ? 16 : 0,
        }}
      >
        {props.message}
      </p>
    );
  },
});

const definitions = [
  defineBlock({
    type: "email",
    label: "Email",
    accepts: ["notice"],
    schema: {},
    render: ({ children }) => (
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td>{children}</td>
          </tr>
        </tbody>
      </table>
    ),
  }),
  notice,
];

const asText = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

const optionsOf = (control: ControlDescriptor): readonly string[] =>
  Array.isArray(control.constraints?.["options"])
    ? control.constraints["options"].map(String)
    : [];

function Control({
  control,
  onChange,
}: {
  control: ControlDescriptor;
  onChange: () => void;
}) {
  const set = (value: unknown) => {
    control.set(value);
    onChange();
  };

  switch (control.kind) {
    case "text": {
      return (
        <label style={{ display: "block" }}>
          {control.label}{" "}
          <input
            value={asText(control.value, "")}
            onChange={(event) => {
              set(event.target.value);
            }}
          />
        </label>
      );
    }

    case "number": {
      return (
        <label style={{ display: "block" }}>
          {control.label}{" "}
          <input
            type="range"
            value={asNumber(control.value, 16)}
            min={asNumber(control.constraints?.["min"], 12)}
            max={asNumber(control.constraints?.["max"], 28)}
            onChange={(event) => {
              set(event.target.valueAsNumber);
            }}
          />{" "}
          {asNumber(control.value, 16)}px
        </label>
      );
    }

    case "boolean": {
      return (
        <label style={{ display: "block" }}>
          <input
            type="checkbox"
            checked={control.value === true}
            onChange={(event) => {
              set(event.target.checked);
            }}
          />{" "}
          {control.label}
        </label>
      );
    }

    // Your own kind. Drawn as swatches, because that is what suits it here.
    case "tone": {
      return (
        <div>
          {control.label}{" "}
          {optionsOf(control).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                set(option);
              }}
              style={{
                marginRight: 4,
                fontWeight: control.value === option ? 700 : 400,
              }}
            >
              {option}
            </button>
          ))}
        </div>
      );
    }

    default: {
      return null;
    }
  }
}

export default function ControlsIsland() {
  const [version, setVersion] = useState(0);

  const editor = useMemo(() => {
    const created = createEditor({ definitions, rootType: "email" });
    created.insertBlock("notice", created.getDocument().root.id, 0);
    const first = created.getDocument().root.children?.[0];
    if (first) created.select(first.id);
    return created;
  }, []);

  const controls = editor.getControls();

  const html = useMemo(
    () =>
      toHtml(renderDocument(editor.getDocument(), editor.getRenderOptions()), {
        doctype: false,
      }),
    // The editor is mutable, so the version counter is what marks it dirty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, version],
  );

  return (
    <div>
      <div style={{ display: "grid", gap: "1.5rem" }}>
        <div>
          <strong>What you draw</strong>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {controls.map((control) => (
              <Control
                key={control.name}
                control={control}
                onChange={() => {
                  setVersion((at) => at + 1);
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <strong>What the editor described</strong>
          <pre>
            <code>
              {JSON.stringify(
                controls.map(({ name, kind, label, value, constraints }) => ({
                  name,
                  kind,
                  label,
                  value,
                  ...(constraints ? { constraints } : {}),
                })),
                undefined,
                2,
              )}
            </code>
          </pre>
        </div>

        <div>
          <strong>What gets sent</strong>
          <div
            style={{ border: "1px solid currentColor", padding: 8 }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>

      <p>
        Every <code>control.set</code> above recorded an Op, so all of it is
        undoable. There is no ⌘Z here because that comes from the Canvas keymap,
        and this island mounts no Canvas.
      </p>
    </div>
  );
}
