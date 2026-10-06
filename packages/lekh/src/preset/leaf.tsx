/**
 * The shell the leaf Blocks render through: which screens they show on, the
 * cell their padding, background and Mobile Overrides sit on, and the table
 * round it. A fix here fixes every leaf.
 */

import { Column, Row } from "@react-email/components";
import type {
  ComponentProps,
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react";

import {
  classNames,
  type MobileRenderContext,
} from "../core/layout/responsive";
import { ALIGNMENT_BY_READING_ORDER } from "../core/document/typography";
import { paddingStyles, SHOW_ON_FROM_HIDE_ON_MOBILE } from "./schema";
import type { PaddingProps } from "./schema";

/**
 * The versions the text, image, button and divider share. Version 1 turns
 * `hideOnMobile` into `showOn` (ADR-0025). Version 2 stores alignment by
 * reading order (ADR-0027).
 */
export const LEAF_VERSIONS = {
  version: 2,
  migrations: {
    1: SHOW_ON_FROM_HIDE_ON_MOBILE,
    2: ALIGNMENT_BY_READING_ORDER,
  },
};

/**
 * Render a Block on the screens its `showOn` names.
 *
 * Handed the class that hides the outermost element on a phone, for
 * `"desktop"`. For `"mobile"` the whole output goes through `mobile.only`. One
 * helper so every Definition asks the same way, and only when it has to:
 * asking is what puts a rule in the stylesheet.
 */
export function shownOn(
  showOn: string,
  mobile: MobileRenderContext,
  render: (hideClass: string | undefined) => ReactElement,
): ReactElement {
  if (showOn === "mobile") return mobile.only(render(undefined));
  return render(desktopOnlyClass(showOn, mobile));
}

/** The class that hides a desktop-only Block on a phone, and only then. */
export function desktopOnlyClass(
  showOn: string,
  mobile: MobileRenderContext,
): string | undefined {
  return showOn === "desktop" ? mobile.use("hide") : undefined;
}

/**
 * The cell a leaf puts its padding on, inside a one-cell table.
 *
 * Padding has to sit on a `<td>`: a `<td>` is what every client pads. The
 * Mobile Override class goes on the same cell, so a padding override replaces
 * the inline value instead of adding to it. The hidden class goes on the
 * table, the outermost element, so hiding the Block takes the wrapper too.
 *
 * Anything else it is handed lands on the cell, so the Canvas's Block id does.
 */
function LeafCell({
  hideClass,
  ...cell
}: ComponentProps<typeof Column> & {
  readonly hideClass: string | undefined;
}): ReactNode {
  return (
    <Row className={hideClass}>
      <Column {...cell} />
    </Row>
  );
}

/** What a leaf puts on its cell, beyond what the shell does. */
interface LeafCellOptions {
  /** For Outlook, which honours `align` on a cell and little else. */
  readonly align?: "left" | "center" | "right";
  /** A class of the Block's own, after the Mobile Override class. */
  readonly className?: string | false;
  readonly height?: number;
  /** The cell's own styles. Its padding follows them. */
  readonly style?: CSSProperties;
  /** Markup that is the cell's whole content, already cleaned. */
  readonly html?: string;
  readonly children?: ReactNode;
}

/**
 * A leaf, in its shell: shown on the screens it names, in a one-cell table,
 * with the Mobile Override class and the padding on the cell.
 *
 * The background stays in the leaf's own `style`, because not every leaf
 * paints its cell: an image paints the picture and a button its fill.
 */
export function leafShell(
  props: Readonly<{ showOn: string } & Partial<PaddingProps>>,
  mobile: MobileRenderContext,
  { align, className, height, style, html, children }: LeafCellOptions,
): ReactElement {
  return shownOn(props.showOn, mobile, (hideClass) => (
    <LeafCell
      hideClass={hideClass}
      align={align}
      className={classNames(mobile.className, className)}
      height={height}
      style={{ ...style, ...paddingStyles(props) }}
      {...(html === undefined
        ? {}
        : { dangerouslySetInnerHTML: { __html: html } })}
    >
      {children}
    </LeafCell>
  ));
}

/** The auto margins that move a block-level element, which `text-align` cannot. */
export function autoMargins(align: "left" | "center" | "right"): {
  marginLeft?: string;
  marginRight?: string;
} {
  if (align === "center") return { marginLeft: "auto", marginRight: "auto" };
  return align === "right" ? { marginLeft: "auto" } : {};
}
