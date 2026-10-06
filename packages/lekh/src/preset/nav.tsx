import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

import { isBlank, missingProp } from "../core/validate/blank";
import {
  defineBlock,
  SchemaKind,
  type Surface,
} from "../core/document/definition";
import { childrenOf } from "../core/document/tree";
import {
  alignment,
  alignSchema,
  directionOf,
  fontFamilyOf,
} from "../core/document/typography";
import { presetBlock } from "./block";
import { endSideOf, inlineRow, type EndSide, type Marks } from "./inline-row";
import { BLOCK_TYPE, PresetDiagnostic } from "./names";
import type { PresetDefaults } from "./options";
import {
  BACKGROUND_COLOR,
  clamped,
  leafSchema,
  weightAndSpacingSchema,
  weightAndSpacingStyles,
  type PaddingProps,
} from "./schema";

/** How many links a new nav starts with. */
const SEEDED_LINKS = 3;

/** The space a nav's links ask for, between them and round a separator. */
const NAV_GAP = { min: 0, max: 48, unit: "px" } as const;
const NAV_DEFAULT_GAP = 16;
const NAV_FONT_WEIGHT = 400;

/**
 * A stacked nav link's class, by the space under it. One per gap, because
 * the space is the nav's and a rule cannot read it.
 */
function navStackClass(below: number): string {
  return `lekh-nav-stack-${String(below)}`;
}

function navStackRule(below: number): string {
  return (
    `.${navStackClass(below)}{display:block!important;` +
    `padding-left:0!important;padding-right:0!important;` +
    `padding-bottom:${below === 0 ? "0" : `${String(below)}px`}!important}`
  );
}

/** A stacked nav's separators, which have nothing to sit between. */
const NAV_SEPARATOR_CLASS = "lekh-nav-sep";
const NAV_SEPARATOR_RULE = `.${NAV_SEPARATOR_CLASS}{display:none!important}`;

/**
 * What a link reads from the nav it is in (ADR-0031): its look, and the gap
 * after it, on the side its email runs towards. The last link that shows gets
 * none.
 */
interface NavSlotValue {
  readonly style: CSSProperties;
  readonly side: EndSide;
  readonly end: number;
  /**
   * The gap before a link with no label, on the Canvas only: one after the
   * last link that shows would otherwise touch it.
   */
  readonly start: number;
  /** The stacking class, or none when the nav does not stack. */
  readonly className: string | undefined;
}

const NavSlot = createContext<NavSlotValue>({
  style: {},
  side: "paddingRight",
  end: 0,
  start: 0,
  className: undefined,
});

/**
 * A row of text links, such as a header's menu (#79).
 *
 * The links are inline-block in one cell, so a phone wraps them like words.
 * The cell sets the font, its size and a px line height: classic Outlook
 * reads a bare multiplier as `100%`. A separator, when there is one, is a
 * span of the nav's own between two links, never after the last. Classic
 * Outlook ignores padding on inline elements, so it gets a table of its own
 * round them, a cell each for every link and separator, as the icon row does.
 *
 * Where lines break is the mail client's, so a wrapped line can end on a
 * separator. Stacking on a phone puts each link on a line of its own and
 * hides the separators, wherever the `<style>` survives.
 *
 * Unverified in classic Outlook: whether that table runs right to left with
 * `dir="rtl"`. If it does not, the cells go in reverse order.
 */
function navDefinition(config: PresetDefaults) {
  return defineBlock<
    {
      gap: number;
      separator: string;
      color: string;
      fontSize: number;
      fontWeight: number;
      letterSpacing: number;
      underline: boolean;
      align: string;
      stackOnMobile: boolean;
      backgroundColor: Surface;
      showOn: string;
    } & PaddingProps
  >({
    type: BLOCK_TYPE.nav,
    label: "Navigation",
    accepts: [BLOCK_TYPE.navLink],
    // Never empty, and three to start with. Eight fit on one line at the
    // email's width, short labels and all.
    minChildren: 1,
    maxChildren: 8,
    seed: () =>
      Array.from({ length: SEEDED_LINKS }, (_, at) => ({
        label: `Link ${String(at + 1)}`,
      })),
    schema: {
      gap: {
        kind: SchemaKind.number,
        label: "Gap",
        defaultValue: NAV_DEFAULT_GAP,
        constraints: NAV_GAP,
      },
      separator: {
        kind: SchemaKind.text,
        label: "Separator",
        defaultValue: "",
        constraints: { maxLength: 3 },
      },
      // The email's link colour until the Author sets one, which they will
      // when the nav sits on a band of its own (ADR-0022).
      color: {
        kind: SchemaKind.color,
        label: "Color",
        follows: "linkColor",
        defaultValue: config.linkColor,
      },
      // The links' type. No line height: one line of links is one line. The
      // family follows the email's.
      fontSize: {
        kind: SchemaKind.number,
        label: "Font size",
        defaultValue: 14,
        constraints: { min: 10, max: 32, unit: "px" },
      },
      ...weightAndSpacingSchema(NAV_FONT_WEIGHT),
      underline: {
        kind: SchemaKind.boolean,
        label: "Underline",
        defaultValue: false,
      },
      align: alignSchema("center", true),
      // Structural, like the button's full width on mobile, so a fixed rule
      // rather than a Mobile Override.
      stackOnMobile: {
        kind: SchemaKind.boolean,
        label: "Stack on mobile",
        defaultValue: false,
      },
      backgroundColor: BACKGROUND_COLOR,
      ...leafSchema(),
    },
    render: (context) => {
      const { block, props, children, mobile, rootProps } = context;
      const direction = directionOf(rootProps);
      const align = alignment(props.align, direction, "center");
      const side = endSideOf(direction);
      // Whole pixels, since the stacking class is named by it.
      const gap = Math.round(clamped(props.gap, NAV_GAP, NAV_DEFAULT_GAP));
      const separator = isBlank(props.separator) ? "" : props.separator;
      const style: CSSProperties = {
        color: props.color,
        ...weightAndSpacingStyles(props, NAV_FONT_WEIGHT),
        textDecoration: props.underline ? "underline" : "none",
      };

      // Which links the email shows. One with no label renders nothing, and
      // takes its separator and its Outlook cell with it.
      const links = childrenOf(block);
      const shown = links.flatMap((link, at) =>
        isBlank(link.props["label"]) ? [] : [at],
      );
      const lastShown = shown.at(-1) ?? -1;
      // Every link before the last that shows has a gap after it, so a
      // centred nav centres on what the email shows. A blank link after that
      // one shows on the Canvas only, so it takes its gap before it instead.
      const endOf = (at: number): number => (at < lastShown ? gap : 0);
      const startOf = (at: number): number =>
        at > lastShown && at > 0 ? gap : 0;

      const stack = props.stackOnMobile;
      if (stack) {
        mobile.add(NAV_SEPARATOR_RULE);
        for (const at of links.keys()) mobile.add(navStackRule(endOf(at)));
      }

      // The cell's contents in order, links and separators, each with the
      // gap after it and whether the email shows it.
      const items: { node: ReactNode; shown: boolean; end: number }[] = [];
      for (const [at, child] of children.entries()) {
        items.push({
          node: (
            <NavSlot.Provider
              key={links[at]?.id ?? at}
              value={{
                style,
                side,
                end: endOf(at),
                start: startOf(at),
                className: stack ? navStackClass(endOf(at)) : undefined,
              }}
            >
              {child}
            </NavSlot.Provider>
          ),
          shown: shown.includes(at),
          end: endOf(at),
        });
        if (separator === "" || !shown.includes(at) || at === lastShown) {
          continue;
        }
        items.push({
          node: (
            <span
              key={`separator-${String(at)}`}
              className={stack ? NAV_SEPARATOR_CLASS : undefined}
              style={{
                display: "inline-block",
                color: props.color,
                [side]: gap,
              }}
            >
              {separator}
            </span>
          ),
          shown: true,
          end: gap,
        });
      }

      return inlineRow(context, {
        align,
        direction,
        style: {
          fontFamily: fontFamilyOf(rootProps, config),
          fontSize: props.fontSize,
          lineHeight: `${String(Math.round(props.fontSize * 1.4))}px`,
        },
        items,
        children: items.map((item) => item.node),
      });
    },
  });
}

/**
 * One link of a nav, which the nav creates rather than the Author. Its look
 * and spacing are the nav's.
 */
function navLinkDefinition() {
  return defineBlock<{ label: string; href: string }>({
    type: BLOCK_TYPE.navLink,
    label: "Link",
    structural: true,
    schema: {
      // A new nav seeds "Link 1" to "Link 3". One added later starts here.
      label: { kind: SchemaKind.text, label: "Label", defaultValue: "Link" },
      href: { kind: SchemaKind.url, label: "Links to", defaultValue: "" },
    },
    validate: (block, context) => {
      const label = missingProp(block, context, "label", {
        code: PresetDiagnostic.navLinkLabelMissing,
        message: "This link has no label, so the email leaves it out.",
        severity: "error",
      });
      if (label.length > 0) return label;
      return missingProp(block, context, "href", {
        code: PresetDiagnostic.navLinkHrefMissing,
        message: "This link does not go anywhere.",
        severity: "warning",
      });
    },
    render: ({ props }) =>
      isBlank(props.label) ? null : (
        <NavLink label={props.label} href={props.href} />
      ),
    // A faint "Link" in the nav's line, so the Author can see and pick a link
    // with no label yet.
    standIn: () => <NavLinkStandIn />,
  });
}

/**
 * A nav link as the nav styles it. With no address it is a span, never an
 * anchor with an empty `href`, which some clients turn into a link to the
 * email itself.
 */
function NavLink({
  label,
  href,
  ...marks
}: { readonly label: string; readonly href: string } & Marks): ReactNode {
  const { style, side, end, className } = useContext(NavSlot);
  const own = { display: "inline-block", ...style, [side]: end };
  return isBlank(href) ? (
    <span {...marks} className={className} style={own}>
      {label}
    </span>
  ) : (
    <a {...marks} href={href} className={className} style={own}>
      {label}
    </a>
  );
}

/** A nav link with no label on the Canvas: a faint placeholder. */
function NavLinkStandIn(marks: Marks): ReactNode {
  const { style, side, end, start } = useContext(NavSlot);
  const startSide = side === "paddingLeft" ? "paddingRight" : "paddingLeft";
  return (
    <span
      {...marks}
      style={{
        display: "inline-block",
        ...style,
        opacity: 0.4,
        [startSide]: start,
        [side]: end,
      }}
    >
      Link
    </span>
  );
}

/** The nav, with its links, for `pickReactEmailPreset`. */
export const navBlock = presetBlock(BLOCK_TYPE.nav, (config) => [
  navDefinition(config),
  navLinkDefinition(),
]);
