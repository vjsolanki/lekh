/**
 * The row the icon row and the nav both are: inline-block items in one cell,
 * which a phone wraps like words, with a table of cells round them for classic
 * Outlook, which has no inline-block.
 */

import { Column, Row } from "@react-email/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import type { BlockRenderContext } from "../core/document/definition";
import type { Direction } from "../core/document/typography";
import { shownOn } from "./leaf";
import { paddingStyles, type PaddingProps } from "./schema";

/** The data attributes the Canvas marks a Block's element with. */
export type Marks = { readonly [attribute: `data-${string}`]: string };

/** The padding on the side an email runs towards, where a row's gaps go. */
export type EndSide = "paddingLeft" | "paddingRight";

export function endSideOf(direction: Direction): EndSide {
  return direction === "rtl" ? "paddingLeft" : "paddingRight";
}

/** The padding a gap of `end` writes, as Outlook's cell carries it too. */
function gapStyle(side: EndSide, end: number): string {
  const property = side === "paddingLeft" ? "padding-left" : "padding-right";
  return `${property}:${end === 0 ? "0" : `${String(end)}px`}`;
}

/** One thing in the row's cell: whether the email shows it, and the gap after it. */
export interface InlineItem {
  readonly shown: boolean;
  readonly end: number;
}

/**
 * The table classic Outlook reads round a row of inline-blocks, a cell each,
 * as the halves and the gaps `outlook()` takes.
 *
 * Handed what sits in the row's cell, in order. One the email leaves out gets
 * no cell. Before each shown one but the first, Outlook closes one cell and
 * opens the next.
 */
function outlookRow(
  items: readonly InlineItem[],
  side: EndSide,
  align: string,
  direction: Direction,
): { open: string; close: string; between: string[] } {
  const cell = (at: number): string =>
    `<td style="${gapStyle(side, items[at]?.end ?? 0)}">`;
  const first = items.findIndex((item) => item.shown);
  if (first === -1) {
    return { open: "", close: "", between: items.slice(1).map(() => "") };
  }
  return {
    open:
      `<table role="presentation" align="${align}" dir="${direction}" ` +
      `border="0" cellpadding="0" cellspacing="0"><tr>${cell(first)}`,
    close: "</td></tr></table>",
    // `between[i]` is the markup before item `i + 1`.
    between: items
      .slice(1)
      .map((item, at) =>
        item.shown && at + 1 !== first ? `</td>${cell(at + 1)}` : "",
      ),
  };
}

/**
 * An inline row, shown on the screens it names.
 *
 * The cell carries the alignment, the padding, the background and the Mobile
 * Override class. `style` is the row's own, written between the alignment and
 * the padding. `items` says what each of `children` is, in the same order.
 */
export function inlineRow(
  {
    props,
    mobile,
    outlook,
  }: Pick<
    BlockRenderContext<
      { showOn: string; backgroundColor: string | undefined } & PaddingProps
    >,
    "props" | "mobile" | "outlook"
  >,
  {
    align,
    direction,
    style,
    items,
    children,
  }: {
    readonly align: "left" | "center" | "right";
    readonly direction: Direction;
    readonly style: CSSProperties;
    readonly items: readonly InlineItem[];
    readonly children: ReactNode;
  },
): ReactElement {
  const { open, close, between } = outlookRow(
    items,
    endSideOf(direction),
    align,
    direction,
  );
  return shownOn(props.showOn, mobile, (hideClass) => (
    <Row className={hideClass}>
      {outlook(
        <Column
          align={align}
          dir={direction}
          className={mobile.className}
          style={{
            textAlign: align,
            ...style,
            ...paddingStyles(props),
            backgroundColor: props.backgroundColor,
          }}
        >
          {children}
        </Column>,
        open,
        close,
        between,
      )}
    </Row>
  ));
}
