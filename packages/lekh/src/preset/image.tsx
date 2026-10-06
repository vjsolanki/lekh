import { Img, Link } from "@react-email/components";

import { assetOf, type Asset } from "../core/document/assets";
import { isBlank } from "../core/validate/blank";
import { validatedProps } from "../core/document/props";
import {
  SchemaKind,
  defineBlock,
  type Surface,
} from "../core/document/definition";
import {
  alignment,
  alignSchema,
  directionOf,
} from "../core/document/typography";
import { presetBlock } from "./block";
import { autoMargins, LEAF_VERSIONS, leafShell } from "./leaf";
import { BLOCK_TYPE, PresetDiagnostic } from "./names";
import type { PresetDefaults } from "./options";
import {
  BACKGROUND_COLOR,
  leafSchema,
  SQUARE_CORNERS,
  type PaddingProps,
} from "./schema";

/** A picture, which may link somewhere. */
function imageDefinition(config: PresetDefaults) {
  return defineBlock<
    {
      asset: Asset | undefined;
      width: number;
      align: string;
      href: string;
      backgroundColor: Surface;
      borderRadius: number;
      showOn: string;
    } & PaddingProps
  >({
    type: BLOCK_TYPE.image,
    label: "Image",
    ...LEAF_VERSIONS,
    schema: {
      // The whole Asset, not a URL: the location, the intrinsic dimensions and
      // the alternative text arrive together and stay together (ADR-0010).
      // The Asset this Block is: what a dropped file becomes, and what
      // placing one asks for first (ADR-0026).
      asset: {
        kind: SchemaKind.asset,
        label: "Image",
        defaultValue: undefined,
        primary: true,
      },
      // A ceiling rather than a size: the image is this wide where there is
      // room, and as wide as its column where there is not. So the default is
      // the email's own width — an image that fills whatever it lands in, a
      // section or a column, without the Author working out what that is.
      //
      // The ceiling of the constraint is a static number where the email's
      // width is an editable prop on the root, so it is left generous rather
      // than pinned to a configuration an Author can move away from; the
      // markup does the real clamping.
      width: {
        kind: SchemaKind.number,
        label: "Width",
        defaultValue: config.contentWidth,
        constraints: { min: 40, max: 800, unit: "px" },
      },
      align: alignSchema("start", false),
      href: { kind: SchemaKind.url, label: "Links to", defaultValue: "" },
      // On the image itself rather than a wrapper, so it sits behind the
      // transparency a logo is usually cut out with — which is the reason an
      // image wants a colour at all.
      backgroundColor: BACKGROUND_COLOR,
      // On the image, so it clips the picture. 400 is half the widest email,
      // so a square photo can become a round avatar. Classic Outlook ignores
      // it and shows square corners. No border and no mobile width: an image
      // edge is rare, and `max-width: 100%` already keeps it on a phone (#70).
      borderRadius: {
        kind: SchemaKind.number,
        label: "Corner radius",
        defaultValue: 0,
        constraints: { min: 0, max: 400, unit: "px" },
        clients: SQUARE_CORNERS,
      },
      ...leafSchema(),
    },
    validate: (block, context) =>
      isBlank(assetOf(validatedProps(block, context)["asset"])?.alt)
        ? [
            {
              code: PresetDiagnostic.imageAltTextMissing,
              message:
                "This image has no alt text, so it says nothing when images are blocked.",
              severity: "warning",
              blockId: block.id,
              prop: "asset",
            },
          ]
        : [],
    render: ({ props, mobile, rootProps }) => {
      const asset = props.asset;
      if (!asset) return null;
      const align = alignment(props.align, directionOf(rootProps));

      // Both dimensions as attributes, because several mail clients render an
      // image at its intrinsic size when the markup does not say otherwise.
      // The height follows the Author's width through the Asset's own
      // proportions, which is the only reason the Asset has to carry them.
      //
      // The attributes are the size where there is room. Where there is not —
      // a narrow column, a phone — `max-width` shrinks the width, and
      // `height: auto` lets the height follow it. Without the second, the
      // width attribute gives way and the height attribute does not, and a
      // photo in a column comes out squashed: 552 wide by 414 tall became 311
      // by 414 on a phone, which is the wrong picture.
      const width = props.width;
      const height = Math.round((width * asset.height) / asset.width);
      const img = (
        <Img
          src={asset.src}
          alt={asset.alt ?? ""}
          width={width}
          height={height}
          style={{
            backgroundColor: props.backgroundColor,
            display: "block",
            maxWidth: "100%",
            height: "auto",
            ...(props.borderRadius === 0
              ? {}
              : { borderRadius: props.borderRadius }),
            // A block is not moved by `text-align`, so the margins carry the
            // alignment in every client that reads CSS. Outlook reads neither
            // and takes the cell's `align` below instead.
            ...autoMargins(align),
          }}
        />
      );

      // In the leaf shell, as the button is: an image narrower than its
      // column leaves a gap beside it that belongs to no Block, and a drop
      // aimed at the gap needs a rectangle to land in. The cell is also where
      // the alignment lives for Outlook, which honours `align` on a cell and
      // nothing the image says for itself. Hidden on the outermost element,
      // so a hidden image takes its row and any anchor with it.
      return leafShell(props, mobile, {
        align,
        children:
          props.href === "" ? img : <Link href={props.href}>{img}</Link>,
      });
    },
  });
}

/** The image, for `pickReactEmailPreset`. */
export const imageBlock = presetBlock(BLOCK_TYPE.image, (config) => [
  imageDefinition(config),
]);
