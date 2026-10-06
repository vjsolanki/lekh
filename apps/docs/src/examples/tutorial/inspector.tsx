import { SchemaKind, NONE, assetOf, type ControlDescriptor } from "lekh";
import { useEditor, useEditorState } from "lekh/canvas";

/**
 * `control.value` is `unknown`, because your Blocks decide what a prop holds.
 * Narrow it. Casting compiles and then lies to you the first time a migration
 * changes a prop's type under an old saved email.
 */
const asText = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

/**
 * `select` and `align` both declare their choices the same way: a plain value,
 * or `{ label, value }` when the value needs a readable name, like a font
 * stack.
 */
const optionsOf = (
  control: ControlDescriptor,
): readonly { label: string; value: unknown }[] =>
  (Array.isArray(control.constraints?.["options"])
    ? control.constraints["options"]
    : []
  ).map((option: unknown) =>
    typeof option === "object" &&
    option !== null &&
    "label" in option &&
    "value" in option
      ? { label: String(option.label), value: option.value }
      : { label: String(option), value: option },
  );

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label style={{ display: "grid", gap: 4 }}>
    {label}
    {children}
  </label>
);

function Control({ control }: { control: ControlDescriptor }) {
  // The editor the provider is holding. Most controls never need it —
  // `control.set` is the whole write path — but swapping an image is a command
  // rather than a value, so it asks the editor directly.
  const editor = useEditor();

  switch (control.kind) {
    case SchemaKind.text:
    case SchemaKind.url: {
      return (
        <Field label={control.label}>
          <input
            type={control.kind === SchemaKind.url ? "url" : "text"}
            value={asText(control.value, "")}
            onChange={(event) => {
              control.set(event.target.value);
            }}
          />
        </Field>
      );
    }

    // A width is a number whose ceiling the editor works out from the row, so
    // it needs no control of its own — only this one, reading the constraints
    // the library moves as the neighbours move.
    case SchemaKind.number:
    case SchemaKind.width: {
      return (
        <Field label={control.label}>
          <input
            type="number"
            value={asNumber(control.value, 0)}
            min={asNumber(control.constraints?.["min"], 0)}
            max={asNumber(control.constraints?.["max"], 100)}
            onChange={(event) => {
              control.set(event.target.valueAsNumber);
            }}
          />
        </Field>
      );
    }

    // Ink. There is no way back to nothing, because there is no such thing:
    // text with no colour is not text an Author can read.
    case SchemaKind.color: {
      return (
        <Field label={control.label}>
          <input
            type="color"
            value={asText(control.value, "#000000")}
            onChange={(event) => {
              control.set(event.target.value);
            }}
          />
        </Field>
      );
    }

    // A surface, which may have no colour at all. `NONE` is what the Document
    // stores for that, and writing it is the whole of the clear affordance —
    // the library takes it out of the markup on the way to CSS.
    case SchemaKind.surface: {
      const color = asText(control.value, NONE);

      return (
        <Field label={control.label}>
          <span style={{ display: "flex", gap: 8 }}>
            <input
              type="color"
              value={color === NONE ? "#ffffff" : color}
              onChange={(event) => {
                control.set(event.target.value);
              }}
            />
            <button
              type="button"
              onClick={() => {
                control.set(NONE);
              }}
            >
              None
            </button>
          </span>
        </Field>
      );
    }

    case SchemaKind.boolean: {
      return (
        <Field label={control.label}>
          <input
            type="checkbox"
            checked={control.value === true}
            onChange={(event) => {
              control.set(event.target.checked);
            }}
          />
        </Field>
      );
    }

    case SchemaKind.select:
    case SchemaKind.align: {
      const options = optionsOf(control);
      const chosen = options.findIndex(
        (option) => option.value === control.value,
      );
      return (
        <Field label={control.label}>
          <select
            value={String(chosen)}
            onChange={(event) => {
              // Round-trip through the original option so a numeric choice
              // stays a number in the Document.
              const option = options[Number(event.target.value)];
              if (option !== undefined) control.set(option.value);
            }}
          >
            {/* A stored value your list does not have, such as a font from
                an older list. Shown, so it is not mistaken for nothing, but
                not offered. */}
            {chosen < 0 ? (
              <option value="-1" disabled>
                Custom ({String(control.value)})
              </option>
            ) : null}
            {options.map((option, index) => (
              <option key={String(index)} value={String(index)}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      );
    }

    // An image. The one an image Block *is* (`primary`) never arrives empty —
    // the editor asked `resolveImage` before it let the Block in. So that
    // control swaps the picture and insists on alt text. An optional one, like
    // a section's background, can be chosen and removed, and needs no alt.
    case SchemaKind.asset: {
      const asset = assetOf(control.value);
      // Goes back through the same resolver, into this prop, and leaves the
      // Document untouched if someone changes their mind.
      const choose = () => {
        editor.replaceImage(control.blockId, "replace", control.name);
      };

      if (!control.primary) {
        return (
          <Field label={control.label}>
            {asset ? <img src={asset.src} alt="" width={120} /> : null}
            <button type="button" onClick={choose}>
              Choose image
            </button>
            {asset ? (
              <button type="button" onClick={control.reset}>
                Remove
              </button>
            ) : null}
          </Field>
        );
      }
      if (!asset) return null;

      return (
        <Field label={control.label}>
          <img src={asset.src} alt={asset.alt ?? ""} width={120} />
          <button type="button" onClick={choose}>
            Replace
          </button>
          <input
            value={asset.alt ?? ""}
            placeholder="What this picture says when images are blocked"
            onChange={(event) => {
              control.set({ ...asset, alt: event.target.value });
            }}
          />
        </Field>
      );
    }

    case SchemaKind.richText: {
      // Owned by the Text Engine, and typed into on the email itself. A second
      // way to edit it here would be two sources of truth for one prop.
      return (
        <p style={{ margin: 0, opacity: 0.7 }}>
          {control.label} is edited on the email. Double-click into it.
        </p>
      );
    }

    // A kind you have not handled yet. Returning null is what lets you add a
    // new kind of prop later without coming back to this switch first.
    default: {
      return null;
    }
  }
}

export function Inspector() {
  // The controls describe the selected Block, and answer with the same array
  // until that description changes — so this panel holds still while somebody
  // types into a Block it is not describing.
  const controls = useEditorState((editor) => editor.getControls());

  return (
    <div style={{ display: "grid", gap: 12, padding: 16 }}>
      {controls.map((control) => (
        <Control key={control.name} control={control} />
      ))}
    </div>
  );
}
