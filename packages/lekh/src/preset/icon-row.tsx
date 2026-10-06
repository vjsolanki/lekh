import { createContext, useContext, type ReactNode } from "react";

import { assetOf, type Asset } from "../core/document/assets";
import { isBlank } from "../core/validate/blank";
import { validatedProps } from "../core/document/props";
import {
  SchemaKind,
  defineBlock,
  type Surface,
} from "../core/document/definition";
import { childrenOf } from "../core/document/tree";
import {
  alignment,
  alignSchema,
  directionOf,
} from "../core/document/typography";
import { presetBlock } from "./block";
import { endSideOf, inlineRow, type EndSide, type Marks } from "./inline-row";
import { BLOCK_TYPE, PresetDiagnostic } from "./names";
import type { PresetDefaults } from "./options";
import { BACKGROUND_COLOR, leafSchema, type PaddingProps } from "./schema";

/** How many icons a new row starts with. */
const SEEDED_ICONS = 3;

/**
 * What an icon reads from the row it is in (ADR-0031): its size, and the gap
 * after it, on the side its email runs towards.
 *
 * The gap is padding on the wrapper, never a margin or `hspace` on the image:
 * classic Outlook ignores both. The last icon gets none, so the row centres
 * on its icons. An empty icon's stand-in on the Canvas reads the same.
 */
interface IconSlotValue {
  readonly iconSize: number;
  readonly side: EndSide;
  readonly end: number;
}

const IconSlot = createContext<IconSlotValue>({
  iconSize: 32,
  side: "paddingRight",
  end: 0,
});

/**
 * Small linked images side by side, such as social links (#78).
 *
 * An inline row (see `inlineRow`). The cell zeroes its font size and line
 * height, which takes out the space between the icons and the gap under each.
 * The row owns the markup between its icons, as the columns own the gap cells
 * between theirs.
 *
 * Unverified in classic Outlook: whether that table runs right to left with
 * `dir="rtl"`, and whether the wrappers' padding adds to its cells'. If it
 * does not reverse, the cells go in reverse order.
 */
function iconRowDefinition(config: PresetDefaults) {
  return defineBlock<
    {
      iconSize: number;
      gap: number;
      align: string;
      backgroundColor: Surface;
      showOn: string;
    } & PaddingProps
  >({
    type: BLOCK_TYPE.iconRow,
    label: "Icon row",
    accepts: [BLOCK_TYPE.icon],
    // Never empty, and three to start with: a row of icons is a plural thing.
    // Twelve fits on one line at the email's width.
    minChildren: 1,
    maxChildren: 12,
    // The first three icons the Consumer listed, so a new row looks like a
    // row of icons rather than three empty squares (ADR-0030).
    seed: () =>
      Array.from({ length: SEEDED_ICONS }, (_, at) => {
        const icon = config.icons[at];
        if (!icon) return {};
        return {
          asset: icon.asset,
          ...(icon.href === undefined ? {} : { href: icon.href }),
        };
      }),
    schema: {
      // Every icon this wide. Its height comes from its own proportions.
      iconSize: {
        kind: SchemaKind.number,
        label: "Icon size",
        defaultValue: 32,
        constraints: { min: 16, max: 64, unit: "px" },
      },
      gap: {
        kind: SchemaKind.number,
        label: "Gap",
        defaultValue: 12,
        constraints: { min: 0, max: 32, unit: "px" },
      },
      // Centred, because a row of icons usually closes an email.
      align: alignSchema("center", true),
      backgroundColor: BACKGROUND_COLOR,
      ...leafSchema(),
    },
    render: (context) => {
      const { block, props, children, rootProps } = context;
      const direction = directionOf(rootProps);
      const align = alignment(props.align, direction, "center");
      const side = endSideOf(direction);

      // Which icons the email shows. One with no image renders nothing, and
      // takes no Outlook cell and no gap with it.
      const icons = childrenOf(block);
      // Every icon but the last has a gap after it. Measured against every
      // icon rather than the shown ones, so the Canvas, where an empty icon
      // shows as a square, spaces them the same as the email.
      const endOf = (at: number): number =>
        at < icons.length - 1 ? props.gap : 0;

      return inlineRow(context, {
        align,
        direction,
        style: { fontSize: 0, lineHeight: 0 },
        items: icons.map((icon, at) => ({
          shown: assetOf(icon.props["asset"]) !== undefined,
          end: endOf(at),
        })),
        children: children.map((child, at) => (
          <IconSlot.Provider
            key={icons[at]?.id ?? at}
            value={{ iconSize: props.iconSize, side, end: endOf(at) }}
          >
            {child}
          </IconSlot.Provider>
        )),
      });
    },
  });
}

/**
 * One icon of an icon row, which the row creates rather than the Author.
 *
 * Its Asset is optional, not primary: an icon is not what a dropped file
 * becomes, and placing a row asks for no image (ADR-0026). The Author picks
 * one the Consumer listed, with no request, or uploads one through a
 * `"replace"` request naming `asset` (ADR-0030). Size, gap and padding are the
 * row's.
 */
function iconDefinition(config: PresetDefaults) {
  return defineBlock<{ asset: Asset | undefined; href: string }>({
    type: BLOCK_TYPE.icon,
    label: "Icon",
    structural: true,
    schema: {
      asset: {
        kind: SchemaKind.asset,
        label: "Icon",
        defaultValue: undefined,
        constraints: {
          options: config.icons.map(({ label, asset }) => ({ label, asset })),
        },
      },
      href: { kind: SchemaKind.url, label: "Links to", defaultValue: "" },
    },
    validate: (block, context) => {
      const asset = assetOf(validatedProps(block, context)["asset"]);
      if (!asset) {
        return [
          {
            code: PresetDiagnostic.iconImageMissing,
            message: "This icon has no image, so the email leaves it out.",
            severity: "error",
            blockId: block.id,
            prop: "asset",
          },
        ];
      }
      return isBlank(asset.alt)
        ? [
            {
              code: PresetDiagnostic.iconAltTextMissing,
              message:
                "This icon has no alt text, so it says nothing when images are blocked.",
              severity: "warning",
              blockId: block.id,
              prop: "asset",
            },
          ]
        : [];
    },
    render: ({ props }) => {
      const asset = assetOf(props.asset);
      return asset ? <IconLink asset={asset} href={props.href} /> : null;
    },
    // A square at the icon size, in the row's line, so the Author can see and
    // pick an icon that has no image yet.
    standIn: () => <IconStandIn />,
  });
}

/**
 * An icon's wrapper and image, sized and spaced by its row.
 *
 * The image is a block with both sizes written twice, as attributes and as
 * CSS, and no border, which some clients draw round a linked image.
 */
function IconLink({
  asset,
  href,
  ...marks
}: { readonly asset: Asset; readonly href: string } & Marks): ReactNode {
  const { iconSize, side, end } = useContext(IconSlot);
  const height =
    asset.width > 0
      ? Math.round((iconSize * asset.height) / asset.width)
      : iconSize;
  const style = { display: "inline-block", [side]: end };
  const image = (
    <img
      src={asset.src}
      width={iconSize}
      height={height}
      alt={asset.alt ?? ""}
      style={{ display: "block", width: iconSize, height, border: 0 }}
    />
  );
  return href === "" ? (
    <span {...marks} style={style}>
      {image}
    </span>
  ) : (
    <a {...marks} href={href} style={style}>
      {image}
    </a>
  );
}

/** An empty icon on the Canvas: a faint square where its image will go. */
function IconStandIn(marks: Marks): ReactNode {
  const { iconSize, side, end } = useContext(IconSlot);
  return (
    <span {...marks} style={{ display: "inline-block", [side]: end }}>
      <span
        style={{
          display: "block",
          width: iconSize,
          height: iconSize,
          backgroundColor: "rgba(128, 128, 128, 0.25)",
        }}
      />
    </span>
  );
}

/** The icon row, with its icons, for `pickReactEmailPreset`. */
export const iconRowBlock = presetBlock(BLOCK_TYPE.iconRow, (config) => [
  iconRowDefinition(config),
  iconDefinition(config),
]);
