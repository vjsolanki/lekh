import {
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The marks the whole editor is built from.
 *
 * Two of them are typographic and three are structural. The typography keeps
 * the value forward: a row's label is small and grey, the value beside it is a
 * size up in full ink, so the eye lands on what is set. Mono, with tabular
 * figures, means one thing: a value you can type or measure — 24px, #1a1a1a,
 * 50%. Names are not values, so a Block's label, a count in a sentence and a
 * mail client's name are set in the body face. The structure is what stops a
 * panel of twelve controls reading as twelve unrelated questions.
 *
 * They live here rather than in `components/ui/` because they are this
 * example's voice, not shadcn's.
 */

/** A row's label: a size under its value, and grey, so the value leads. */
export const LABEL = "text-[0.75rem] font-normal text-ink-2";

/** A panel's heading: Layout, Document, Typography. */
export function PanelTitle({
  className,
  ...props
}: ComponentProps<"p">): ReactNode {
  return (
    <p
      className={cn(
        "mb-1.5 text-[0.75rem] font-semibold text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A sentence of explanation under a heading. */
export function PanelHint({
  className,
  ...props
}: ComponentProps<"p">): ReactNode {
  return (
    <p
      className={cn(
        "mb-2.5 text-pretty text-[0.75rem]/[1.5] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A value you can type or measure, set quietly: 600 × 400, 12 kB, px. */
export function Meta({
  className,
  ...props
}: ComponentProps<"span">): ReactNode {
  return (
    <span
      className={cn(
        "font-mono text-[0.75rem] tabular-nums text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A quiet word beside something: a name, a count in a sentence. */
export function Quiet({
  className,
  ...props
}: ComponentProps<"span">): ReactNode {
  return (
    <span
      className={cn("text-[0.75rem] text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * A band of a panel, with its heading pinned while the band is being read.
 *
 * The Inspector is a stack of these and so is the palette. Sticking the
 * heading costs nothing on a short band and is the whole difference on a long
 * one, where the controls being scrolled through would otherwise be unlabelled
 * by the time they reach the top of the pane.
 */
export function Band({
  title,
  hint,
  className,
  children,
}: {
  readonly title?: string;
  readonly hint?: string;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      className={cn(
        "px-3.5 pt-2.5 pb-3 not-first:border-t not-first:border-rule-soft",
        className,
      )}
    >
      {title === undefined ? null : (
        <PanelTitle className="sticky top-0 z-10 -mx-3.5 mb-1.5 bg-rail/95 px-3.5 py-1 backdrop-blur-sm">
          {title}
        </PanelTitle>
      )}
      {hint === undefined ? null : <PanelHint>{hint}</PanelHint>}
      {children}
    </section>
  );
}

/**
 * One control on one line: what it is on the left, what it is set to on the
 * right.
 *
 * The fixed right-hand column is the point. A panel where every control sizes
 * itself to its content is twelve ragged rows that have to be read one at a
 * time; a panel where they all land on the same edge is a table, and a table
 * can be scanned. The label column takes whatever is left, so a long name wraps
 * rather than pushing the control out of alignment.
 *
 * `scrub` turns the label into a drag handle. A label is dead space on every
 * row that has one, and a number is the one value worth dragging — so the word
 * does the job a slider used to need a row of its own for.
 */
export function Row({
  label,
  htmlFor,
  hint,
  scrub,
  mark,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly hint?: string;
  readonly scrub?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** What sits after the label, such as where the value comes from. */
  readonly mark?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="group/row grid min-h-7 grid-cols-[minmax(0,1fr)_8.75rem] items-center gap-x-2.5 gap-y-1 not-first:mt-2">
      <div className="flex min-w-0 items-center gap-1">
        <Label
          htmlFor={htmlFor}
          className={cn(
            LABEL,
            "min-w-0 items-center gap-1 text-pretty leading-[1.35]",
            scrub &&
              "cursor-ew-resize touch-none select-none decoration-dotted underline-offset-[3px] group-hover/row:underline",
          )}
          {...(scrub === undefined
            ? {}
            : { onPointerDown: scrub, title: "Drag to change" })}
        >
          {label}
        </Label>
        {mark}
      </div>
      <div className="min-w-0">{children}</div>
      {hint === undefined ? null : (
        <p className="col-span-2 -mt-0.5 text-[0.75rem] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A control too big for a line of its own: an image, a paragraph, a swatch of
 * something.
 *
 * Same voice as `Row`, opposite arrangement — the label sits above and the
 * control takes the full width. Used where squeezing into the right-hand column
 * would make the control worse rather than the panel better.
 */
export function Stack({
  label,
  htmlFor,
  hint,
  mark,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  /** A grey line under the control, as on a `Row`. */
  readonly hint?: string;
  /** What sits after the label, as on a `Row`. */
  readonly mark?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="not-first:mt-2.5">
      <div className="mb-1.5 flex items-center gap-1">
        <Label htmlFor={htmlFor} className={LABEL}>
          {label}
        </Label>
        {mark}
      </div>
      {children}
      {hint === undefined ? null : (
        <p className="mt-1 text-[0.75rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
