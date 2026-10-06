import { SchemaKind, assetOf, defineBlock, isBlank, type Asset } from "lekh";

export const image = defineBlock<{ asset: Asset | undefined; width: number }>({
  type: "image",
  label: "Image",
  schema: {
    // The whole Asset, not just a URL. The location, the size and the
    // alt text arrive together and stay together. `primary` says this is
    // the picture the Block is, so a dropped file becomes this Block.
    asset: {
      kind: SchemaKind.asset,
      label: "Image",
      defaultValue: undefined,
      primary: true,
    },
    width: { kind: SchemaKind.number, label: "Width", defaultValue: 552 },
  },

  // Mail clients size an image from its markup, so always emit width and
  // height. Without them a blocked image collapses the layout.
  //
  // Then let it shrink. `max-width` gives the width way in a narrow column or
  // on a phone, and `height: auto` lets the height follow — without it the
  // width attribute gives and the height attribute does not, and the picture
  // comes out squashed.
  render: ({ props }) =>
    props.asset ? (
      <img
        src={props.asset.src}
        alt={props.asset.alt ?? ""}
        width={props.width}
        height={Math.round(
          (props.asset.height / props.asset.width) * props.width,
        )}
        style={{
          display: "block",
          border: 0,
          maxWidth: "100%",
          height: "auto",
        }}
      />
    ) : null,

  // Warn about a missing description rather than refusing to render. A
  // warning never blocks a send; only an error does.
  validate: (block) =>
    isBlank(assetOf(block.props["asset"])?.alt)
      ? [
          {
            code: "image-alt-text-missing",
            message: "This image has no description.",
            severity: "warning" as const,
            blockId: block.id,
          },
        ]
      : [],
});
