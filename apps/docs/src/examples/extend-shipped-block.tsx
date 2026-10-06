import {
  assetOf,
  classNames,
  type BlockDefinition,
  type SchemaEntry,
} from "lekh-editor";
import { createReactEmailPreset } from "lekh-editor/blocks";

const preset = createReactEmailPreset();

function shipped(type: string): BlockDefinition {
  const definition = preset.find((candidate) => candidate.type === type);
  if (!definition) throw new Error(`The Preset has no ${type} Block.`);
  return definition;
}

/** 1. A phone-only background for the text. The shipped `render` copes. */
const text = shipped("text");

export const textWithMobileBackground: BlockDefinition = {
  ...text,
  schema: {
    ...text.schema,
    backgroundColor: {
      ...text.schema["backgroundColor"],
      // A cleared background is stored as "none", which is not a CSS colour.
      mobile: (color) => ({
        "background-color": color === "none" ? "transparent" : String(color),
      }),
    },
  },
};

/** 2. A new prop on an element around the text: wrap `render`. */

const accentColor: SchemaEntry<string> = {
  kind: "color",
  label: "Accent color",
  defaultValue: "#6d28d9",
};

export const textWithAccent: BlockDefinition = {
  ...text,
  schema: { ...text.schema, accentColor },
  render(context) {
    const { props, mobile } = context;
    // The bar shows on the same screens as the text, so the shipped render is
    // told to show everywhere and the bar takes `showOn` instead.
    const inner = text.render({
      ...context,
      props: { ...props, showOn: "all" },
    });
    if (!inner) return null;
    const bar = (
      // A table cell, because Outlook ignores padding on a div. It takes the
      // hide class too, or a hidden paragraph leaves its bar behind.
      <table
        role="presentation"
        width="100%"
        className={
          props["showOn"] === "desktop" ? mobile.use("hide") : undefined
        }
      >
        <tbody>
          <tr>
            <td
              style={{
                borderLeft: `4px solid ${String(props["accentColor"])}`,
                paddingLeft: 12,
              }}
            >
              {inner}
            </td>
          </tr>
        </tbody>
      </table>
    );
    return props["showOn"] === "mobile" ? mobile.only(bar) : bar;
  },
};

/** 3. A new prop on the `<img>` itself: replace `render`. */
const image = shipped("image");

const borderRadius: SchemaEntry<number> = {
  kind: "number",
  label: "Corner radius",
  defaultValue: 0,
  constraints: { min: 0, max: 400, unit: "px" },
};

export const imageWithRadius: BlockDefinition = {
  ...image,
  schema: { ...image.schema, borderRadius },
  // This keeps the picture, its size and its phone-only values. It drops the
  // shipped alignment, link and background, so those controls stop working.
  // Add back the ones you use, or remove them from the Schema.
  render({ props, mobile }) {
    const asset = assetOf(props["asset"]);
    if (!asset) return null;
    const width = Number(props["width"]);
    const img = (
      <img
        className={classNames(
          props["showOn"] === "desktop" ? mobile.use("hide") : undefined,
          mobile.className,
        )}
        src={asset.src}
        alt={asset.alt ?? ""}
        width={width}
        height={Math.round((asset.height / asset.width) * width)}
        style={{
          display: "block",
          border: 0,
          maxWidth: "100%",
          height: "auto",
          borderRadius: Number(props["borderRadius"]),
        }}
      />
    );
    return props["showOn"] === "mobile" ? mobile.only(img) : img;
  },
};
