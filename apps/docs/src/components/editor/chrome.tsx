import {
  createContext,
  use,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  SchemaKind,
  type Block,
  type BlockDefinition,
  type BoxSide,
  type DropTarget,
  type Editor,
  type ImagePlacement,
} from "lekh";
import {
  useBlockDrag,
  useCommands,
  useEditor,
  useEditorState,
  type BlockChromeProps,
  type BoxEdge,
  type BoxEdgesProps,
  type CanvasSlots,
  type DiagnosticChromeProps,
  type DragPreviewProps,
  type DropIndicatorProps,
  type DropTargetProps,
  type FailedImageProps,
  type PendingImageProps,
  type Rect,
  type TextToolbarProps,
} from "lekh/canvas";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { waitingOf } from "./gallery";
import { Icon } from "./icons";
import {
  containerName,
  containerPath,
  isWhereItIs,
  labelOf,
  parentOf as holderOf,
  placeName,
} from "./names";
import { clampTo, numberOf, valuesOf } from "./inspector";
import { dragFrom } from "./pointer-drag";
import { Quiet, Meta } from "./parts";
import { withKeys } from "./shortcuts";

/**
 * Every Slot this example fills.
 *
 * The Canvas renders no Chrome of its own: outlines, drop indicators,
 * toolbars and image placeholders are all ordinary components, positioned by
 * a rectangle the library has already translated out of the iframe into the
 * Canvas's own coordinate space. That translation is the only reason none of
 * these components does any arithmetic.
 */
export const SLOTS: CanvasSlots = {
  selection: Selection,
  boxEdges: BoxGrips,
  hover: HoverOutline,
  dropIndicator: DropIndicator,
  dropTarget: DropTargetMark,
  dragPreview: DragPreview,
  draggingBlock: DraggingBlock,
  textToolbar: TextToolbar,
  pendingImage: PendingImage,
  failedImage: FailedImage,
  unregisteredBlock: UnregisteredBlock,
  emptyBlock: EmptyBlock,
  diagnostic: DiagnosticBadge,
};

/** A rectangle, as the four numbers an absolutely positioned box needs. */
function box(rect: Rect): CSSProperties {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/** Every mark in this file is absolute, and none of them takes the pointer. */
const MARK = "pointer-events-none absolute";

/**
 * A tag's look: accent-on-white, in both themes. It sits over the email, which
 * is on paper, and the paper does not change when the editor does. It carries
 * its own shadow because the paper is often a photograph.
 */
const TAG_LOOK =
  "absolute flex items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 text-[0.75rem] leading-[1.4] font-medium whitespace-nowrap text-primary-foreground shadow-[0_1px_3px_rgb(0_0_0/25%)]";

/** The tag that names a Block, hung above whatever it labels. */
const TAG = cn(TAG_LOOK, "top-0 left-0 -translate-y-6");

/** How much room a tag needs above its Block before it goes underneath. */
const TAG_ROOM = 26;

/**
 * The tag naming a Block, above it, or below it when the Block starts too
 * near the top of the Canvas for the tag to be seen.
 */
function BlockTag({
  block,
  rect,
  className,
  ...rest
}: {
  readonly block: Block;
  readonly rect: Rect;
} & ComponentProps<"span">): ReactNode {
  const editor = useEditor();
  const below = rect.top < TAG_ROOM;
  return (
    <span
      {...rest}
      className={cn(
        TAG_LOOK,
        "left-0",
        below ? "top-full" : "top-0 -translate-y-full",
        className,
      )}
    >
      <Icon name={block.type} className="size-3" />
      {editor.getDefinition(block.type)?.label ?? block.type}
    </span>
  );
}

/** How long a mark takes to walk from one Block to the next. As in `travels`. */
const TRAVEL_MS = 120;

/**
 * Whether this mark is on its way from one Block to another.
 *
 * The library renders the selection and the hover outline in place rather than
 * keyed by Block, so the same element survives a change of selection and its
 * rectangle can be animated from the old Block to the new one. That is the
 * whole trick — but it has to be armed for exactly that move and disarmed
 * immediately afterwards.
 *
 * A rectangle changes for three reasons: the Block being marked changed, the
 * email was scrolled, or its content reflowed. Only the first should be
 * animated, and only when a pointer moved it: the glide shows a click where it
 * landed. A key, a Layers row or an undo jumps, so keyboard work never waits
 * on the mark. `getLastAction()` says which it was. An outline that eased its way after a scroll would swim around the
 * page a moment behind the thing it is marking, which is worse than
 * never having moved at all. So the transition is switched on for the Block
 * change alone, and switched off again once the walk is over.
 *
 * The state is set during render rather than in an effect on purpose: the class
 * and the new rectangle have to reach the DOM in the same commit. An effect
 * runs after the browser has already been told the new position, and there is
 * nothing left to animate by then.
 */
function useTravel(blockId: string): boolean {
  const editor = useEditor();
  const [marked, setMarked] = useState(blockId);
  const [travelling, setTravelling] = useState(false);

  if (marked !== blockId) {
    setMarked(blockId);
    setTravelling(editor.getLastAction()?.via === "pointer");
  }

  useEffect(() => {
    if (!travelling) return undefined;
    const timer = setTimeout(() => {
      setTravelling(false);
    }, TRAVEL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [travelling, blockId]);

  return travelling;
}

/**
 * What is selected — one mark that walks the page, and that Block's actions.
 *
 * Clicking down a column of Blocks moves this outline from each to the next
 * instead of drawing a new box at every stop, which is the difference between
 * reading the page as a list of separate things and reading it as one document
 * being examined. The toolbar above it travels on the same curve, so the two
 * arrive together.
 *
 * Both come from this one component, so they share one idea of where the
 * Block is and when it moved. The label hangs off the outline's leading corner
 * and the toolbar off its trailing one. On a Block too narrow for both, the
 * toolbar wins: it comes later in the markup, so it paints on top.
 */
function Selection({ block, rect }: BlockChromeProps): ReactNode {
  const travelling = useTravel(block.id);
  return (
    <>
      <div
        className={cn(
          MARK,
          "travels rounded-[3px] outline-2 -outline-offset-1 outline-primary",
          "shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_14%,transparent)]",
        )}
        data-travelling={travelling}
        style={box(rect)}
      >
        <BlockTag block={block} rect={rect} />
      </div>
      <BlockToolbar block={block} rect={rect} travelling={travelling} />
    </>
  );
}

/**
 * The zoom the Canvas is drawn at, for a grip to turn pointer travel into
 * pixels of padding. Every rectangle the Canvas hands over is already zoomed;
 * a value written back is not.
 */
export const CanvasZoom = createContext(1);

/**
 * What a plugged-in agent adds to the Block toolbar, ahead of the editor's own
 * buttons. Nothing without one.
 */
export const BlockAction = createContext<
  ComponentType<{ readonly block: Block }> | undefined
>(undefined);

/**
 * Which way a grip's side grows, as a sign on the pointer's travel: the way
 * the edge it moves goes. More top or left padding pushes the content down or
 * right. More bottom padding pushes the Block's own edge down. More right
 * padding pulls the content in from the right.
 */
const GROWS: Readonly<Record<BoxSide, { axis: "x" | "y"; sign: 1 | -1 }>> = {
  top: { axis: "y", sign: 1 },
  bottom: { axis: "y", sign: 1 },
  left: { axis: "x", sign: 1 },
  right: { axis: "x", sign: -1 },
};

/**
 * Grips on the selected Block's Boxes (ADR-0040): one in the middle of each
 * side's padding band.
 *
 * The Canvas hands every side's band, naming the prop it writes, so a grip on
 * a button's outer edge moves its outer padding and one beside its label the
 * room around it. A drag previews through a Pending Change and commits on
 * release, so it is one undo step. Escape puts it back.
 *
 * A locked Box, every side the same on this Stage, moves all its sides
 * together, as the Inspector's Box control does. ⌥ moves one side alone.
 * Hidden while the Block is being typed into.
 */
function BoxGrips({ block, edges }: BoxEdgesProps): ReactNode {
  const editor = useEditor();
  const editing = useEditorState((current) => current.getEditing());
  const controls = useEditorState((current) => current.getControls());
  const zoom = use(CanvasZoom);
  // The sides lit while a drag is on: its own, or the whole Box when locked.
  const [lit, setLit] = useState<{ box: string; props: readonly string[] }>();
  if (editing === block.id) return null;

  const start = (
    edge: BoxEdge,
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    const sides = controls.filter(
      (control) => control.blockId === block.id && control.box === edge.box,
    );
    const holder = sides.find((control) => control.name === edge.prop);
    if (!holder) return;
    event.preventDefault();
    const locked = sides.every((control) =>
      Object.is(numberOf(control.value), numberOf(holder.value)),
    );
    const moved = locked && !event.altKey ? sides : [holder];
    const from = numberOf(holder.value);
    const clamp = clampTo(holder.constraints);
    const grows = GROWS[edge.side];
    setLit({ box: edge.box, props: moved.map((control) => control.name) });
    // Focused, so Escape reaches this page rather than the email's frame,
    // where it would step out of the Block.
    event.currentTarget.focus({ preventScroll: true });

    dragFrom(event, {
      move: (dx, dy) => {
        const travel = (grows.axis === "x" ? dx : dy) * grows.sign;
        const value = clamp(Math.round(from + travel / zoom));
        editor.setPendingChange(block.id, valuesOf(moved, value));
      },
      commit: () => {
        setLit(undefined);
        editor.commitPendingChange();
      },
      cancel: () => {
        setLit(undefined);
        editor.cancelPendingChange();
      },
    });
  };

  return edges.map((edge) => (
    <BoxGrip
      key={`${edge.box}:${edge.side}`}
      edge={edge}
      lit={lit?.box === edge.box && lit.props.includes(edge.prop)}
      label={
        controls.find(
          (control) =>
            control.blockId === block.id && control.name === edge.prop,
        )?.label
      }
      onPointerDown={(event) => {
        start(edge, event);
      }}
    />
  ));
}

/**
 * One side's band, shaded while it is dragged, and the grip in its middle.
 *
 * The hit area is wider than the pill so it is easy to catch on a thin band.
 */
function BoxGrip({
  edge,
  lit,
  label,
  onPointerDown,
}: {
  readonly edge: BoxEdge;
  readonly lit: boolean;
  readonly label: string | undefined;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactNode {
  const across = edge.side === "top" || edge.side === "bottom";
  const { rect } = edge;
  return (
    <>
      {lit ? (
        <div
          className={cn(MARK, "bg-primary/15")}
          style={box(rect)}
          aria-hidden="true"
        />
      ) : null}
      <div
        role="slider"
        aria-label={label ?? `${edge.box} ${edge.side}`}
        aria-orientation={across ? "vertical" : "horizontal"}
        tabIndex={-1}
        title={`Drag to change ${label ?? edge.side}. ⌥ for this side alone`}
        className={cn(
          "group pointer-events-auto absolute flex -translate-1/2 items-center justify-center outline-none",
          across ? "h-3 w-8 cursor-ns-resize" : "h-8 w-3 cursor-ew-resize",
        )}
        style={{
          top: rect.top + rect.height / 2,
          left: rect.left + rect.width / 2,
        }}
        onPointerDown={onPointerDown}
      >
        <span
          className={cn(
            "rounded-full bg-primary shadow-[0_0_0_1.5px_white] transition-transform duration-[var(--duration-quick)] ease-[var(--ease)] group-hover:scale-125",
            across ? "h-1 w-5" : "h-5 w-1",
            lit && "scale-125",
          )}
        />
      </div>
    </>
  );
}

/**
 * The Block a press would select. It jumps with the pointer rather than
 * gliding: a mark easing after the cursor is a mark behind it.
 */
function HoverOutline({ block, rect }: BlockChromeProps): ReactNode {
  return (
    <div
      className={cn(
        MARK,
        "rounded-[3px] outline -outline-offset-1 outline-primary/50",
      )}
      style={box(rect)}
    >
      <HoverTag block={block} rect={rect} />
    </div>
  );
}

/**
 * The hovered Block's tag, which is also its handle: one press and a drag
 * moves it, with no click to select it first.
 *
 * The tag rather than a grip of its own. It is already there on every hover,
 * it names what will move, and it is far easier to hit than a glyph tucked
 * into a corner of the Block.
 *
 * It sits flush against the Block, with no gap. The pointer goes from the
 * Block straight onto it, so it never crosses the parent on the way up, and
 * the Canvas holds the hover while the pointer is on its Chrome.
 *
 * It is also what registers a handle before the first selection. A pointer is
 * over a Block before it presses one, so a handle is in force by then and
 * every body only selects (ADR-0043).
 */
function HoverTag({
  block,
  rect,
}: {
  readonly block: Block;
  readonly rect: Rect;
}): ReactNode {
  const { dragHandleProps } = useBlockDrag(block.id);
  return (
    <BlockTag
      block={block}
      rect={rect}
      title="Drag to move"
      className="pointer-events-auto cursor-grab active:cursor-grabbing"
      {...dragHandleProps}
    />
  );
}

/**
 * What an Author is carrying: a small chip just off the pointer.
 *
 * Small and to one side on purpose. The pointer is aiming at the drop
 * indicator, and a preview the size of the Block would sit on top of it for
 * most of the drag (ADR-0044). The Block's real size still shows where it sits,
 * under {@link DraggingBlock}.
 */
function DragPreview({ block }: DragPreviewProps): ReactNode {
  const editor = useEditor();
  return (
    <span className="absolute top-2 left-4 flex items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 text-[0.75rem] font-medium whitespace-nowrap text-primary-foreground shadow-md">
      <Icon name={block.type} className="size-3" />
      {editor.getDefinition(block.type)?.label ?? block.type}
    </span>
  );
}

/**
 * The Block being carried, where it still sits.
 *
 * A drag no longer takes the Block out of the email — it stays exactly where it
 * was until the drop lands. Without something drawn over it an Author cannot
 * tell a move from a copy, so this is the hole the Block is about to leave.
 *
 * It covers rather than fades: the Block is inside the frame and this is
 * outside it, so a translucent scrim in the page's own ground colour is what
 * stands in for dimming.
 */
function DraggingBlock({ rect }: BlockChromeProps): ReactNode {
  return (
    <div
      className={cn(
        MARK,
        "rounded-[2px] bg-card/70 outline outline-dashed -outline-offset-1 outline-border",
      )}
      style={box(rect)}
    />
  );
}

/**
 * Where the Block will land, and which Block that is.
 *
 * The rectangle alone answers "where"; an Author halfway through a drag is
 * also asking "what", and by then the thing they picked up is under their
 * cursor and out of the palette. So the mark carries a label: what is landing,
 * and whether it is arriving or merely moving.
 *
 * Inside a container the label also says which one, and a faint dashed
 * outline marks it: two columns side by side have lines of the same length,
 * and only the name and the box tell them apart. At the email's own level
 * there is only one place it can mean, so neither is drawn.
 */
function DropIndicator({
  target,
  dragged,
  rect,
  parentRect,
}: DropIndicatorProps): ReactNode {
  const editor = useEditor();
  const nested = target.parentId !== editor.getDocument().root.id;
  const where = nested ? containerName(editor, target.parentId) : undefined;

  // A drop into a container with nothing in it yet is the container itself, so
  // it is drawn as a region rather than as a line with ends.
  if (target.position === "inside") {
    return (
      <div
        className={cn(
          MARK,
          "rounded-md border-2 border-dashed border-primary bg-primary/10",
        )}
        style={box(rect)}
      >
        <DropLabel
          dragged={dragged}
          where={where}
          className="left-3 -translate-y-6"
        />
      </div>
    );
  }

  // Otherwise the rectangle is flat along the parent's layout axis — a
  // zero-height line between stacked Blocks, a zero-width one between Blocks
  // sharing a row — so the thickness and the end caps go on the other axis.
  //
  // It glides, because the same element is re-positioned as the pointer moves
  // from one seam to the next: a jump between two distant positions reads as a
  // new mark appearing, and a short slide reads as the same mark moving. And it
  // carries a hairline of the paper colour, so it stays legible over a
  // photograph and over a dark Section, where accent-on-accent would vanish.
  const across = target.axis === "horizontal";
  return (
    <>
      {nested ? <LevelOutline rect={parentRect} /> : null}
      <DropLine rect={rect} across={across}>
        <DropLabel
          dragged={dragged}
          where={where}
          className={
            across
              ? "top-0 left-1/2 -translate-x-1/2 -translate-y-7"
              : "left-3 -translate-y-7"
          }
        />
      </DropLine>
    </>
  );
}

/**
 * The container a drop lands in, outlined faintly. It jumps rather than glides:
 * it changes only when the line crosses into another container, and a box
 * easing between two columns would cross the gap between them.
 */
function LevelOutline({ rect }: { readonly rect: Rect }): ReactNode {
  return (
    <div
      className={cn(
        MARK,
        "rounded-[3px] outline-1 -outline-offset-1 outline-primary/60 outline-dashed",
      )}
      style={box(rect)}
    />
  );
}

/** The rule between two Blocks, with its caps and whatever it is labelled. */
function DropLine({
  rect,
  across,
  children,
}: {
  readonly rect: Rect;
  readonly across: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className={cn(
        MARK,
        "rounded-full bg-primary shadow-[0_0_0_1px_rgb(255_255_255/75%),0_0_0_5px_color-mix(in_srgb,var(--primary)_16%,transparent)]",
        "transition-[top,left,width,height] duration-[var(--duration-quick)]",
        across ? "-ml-[1.5px] min-w-[3px]" : "-mt-[1.5px] min-h-[3px]",
      )}
      style={box(rect)}
    >
      <Cap across={across} />
      <Cap across={across} end />
      {children}
    </div>
  );
}

/**
 * One place the drag may land, drawn faintly from the moment it starts.
 *
 * An Author sees every place before aiming, and the pointer only picks one.
 * The one it picks is left to {@link DropIndicator}, which draws it solid and
 * names it, so this draws nothing there.
 */
function DropTargetMark({ target, rect, current }: DropTargetProps): ReactNode {
  if (current) return null;

  // An empty container is a region to drop into, not a line between Blocks.
  if (target.position === "inside") {
    return (
      <div
        className={cn(
          MARK,
          "rounded-md border border-dashed border-primary/50 bg-primary/5",
        )}
        style={box(rect)}
      />
    );
  }

  const across = target.axis === "horizontal";
  return (
    <div
      className={cn(
        MARK,
        "rounded-full bg-primary/30",
        across ? "-ml-px min-w-[2px]" : "-mt-px min-h-[2px]",
      )}
      style={box(rect)}
    />
  );
}

/**
 * What is landing here, whether it is arriving or merely moving, and, inside
 * a container, which one: "Move Text · into Column 2".
 *
 * It sits above the rule on a stacked seam and beside it on a row, which is the
 * side that has room in each case.
 */
function DropLabel({
  dragged,
  where,
  className,
}: {
  readonly dragged: DropIndicatorProps["dragged"];
  readonly where: string | undefined;
  readonly className?: string;
}): ReactNode {
  const editor = useEditor();
  return (
    <span className={cn(TAG, "shadow-xs", className)}>
      <Icon name={dragged.type} className="size-3" />
      {dragged.blockId === undefined ? "Add" : "Move"}{" "}
      {editor.getDefinition(dragged.type)?.label ?? dragged.type}
      {where === undefined ? null : (
        <span className="opacity-75">· into {where}</span>
      )}
    </span>
  );
}

/** One end of the drop rule, so an Author can see which container it belongs to. */
function Cap({
  across,
  end = false,
}: {
  readonly across: boolean;
  readonly end?: boolean;
}): ReactNode {
  return (
    <span
      className={cn(
        "absolute size-[7px] rounded-full bg-primary shadow-[0_0_0_1.5px_rgb(255_255_255/75%)]",
        across
          ? cn("left-1/2 -translate-x-1/2", end ? "-bottom-px" : "-top-px")
          : cn("top-1/2 -translate-y-1/2", end ? "-right-px" : "-left-px"),
      )}
    />
  );
}

/** How far in from a Block's corner its Diagnostic badge sits. */
const BADGE_INSET = 4;

/**
 * A small badge in a Block's top corner when something is wrong with it, red
 * for an error and amber for a warning, with a count when there is more than
 * one. It says only that something is wrong. The Inspector says what.
 *
 * It takes no pointer, so a click on it is a click on the Block, which
 * selects it and shows the Diagnostic under its field. Fixed colours, like the
 * tags: it sits on the email's paper, which does not change with the theme.
 */
function DiagnosticBadge({
  rect,
  diagnostics,
}: DiagnosticChromeProps): ReactNode {
  const error = diagnostics.some((finding) => finding.severity === "error");
  return (
    <span
      className={cn(
        MARK,
        "flex h-5 min-w-5 -translate-x-full items-center justify-center gap-0.5 rounded-full px-1 text-[0.6875rem] font-semibold text-white shadow-[0_0_0_1.5px_white,0_1px_3px_rgb(0_0_0/25%)]",
        error ? "bg-[#b42318]" : "bg-[#b45309]",
      )}
      style={{
        top: rect.top + BADGE_INSET,
        left: rect.left + rect.width - BADGE_INSET,
      }}
      aria-hidden="true"
    >
      <Icon name={error ? "error" : "warning"} className="size-3" />
      {diagnostics.length > 1 ? String(diagnostics.length) : null}
    </span>
  );
}

/**
 * A Block with nothing to show, which the Canvas has given a box.
 *
 * Two states arrive here wearing one face — a container with no children, and a
 * Block whose Definition rendered nothing at all — and this example draws them
 * the same way, because from an Author's side they are the same fact: there is
 * room here and nothing in it.
 *
 * Quieter than every other outline here on purpose: it is drawn on every empty
 * container at once, including while a drag is in flight, so anything with more
 * weight would read as a page full of warnings rather than a page full of
 * places. Named rather than left blank, because the Blocks that reach this are
 * mostly columns, and a column is the one thing on the Canvas whose own outline
 * says nothing about what it is.
 *
 * A Block whose Definition draws its own stand-in, such as an empty icon, gets
 * nothing here. It already shows where it is, and its box can be too small for
 * a name, or wider than its face where it carries a gap.
 */
function EmptyBlock({ block, rect }: BlockChromeProps): ReactNode {
  const editor = useEditor();
  const definition = editor.getDefinition(block.type);
  if (definition?.standIn) return null;
  return (
    <div
      className={cn(
        MARK,
        "grid place-items-center rounded-[3px] bg-black/[3%] outline outline-dashed -outline-offset-1 outline-black/20",
      )}
      style={box(rect)}
    >
      <Quiet>{definition?.label ?? block.type}</Quiet>
    </div>
  );
}

function UnregisteredBlock({ block, rect }: BlockChromeProps): ReactNode {
  return (
    <div
      className={cn(
        MARK,
        "bg-destructive/10 outline outline-dashed outline-destructive",
      )}
      style={box(rect)}
    >
      <span className={cn(TAG, "bg-destructive text-white")}>
        No Definition for “{block.type}”
      </span>
    </div>
  );
}

/**
 * What the delete button says, in the three states it has.
 *
 * The third is deliberately vague about why: the library reports that the
 * removal would be refused without a reason, and this application would have to
 * know what a column is to say more. It knows nothing about columns, and is
 * better off saying less than guessing.
 */
function deleteTitle(removable: boolean, required: boolean): string {
  if (removable) return withKeys("Delete", "delete");
  if (required) return "Required — this block cannot be deleted";
  return "This block cannot be removed right now";
}

/**
 * The floating toolbars' shell and their buttons.
 *
 * Dark in both themes, and deliberately so: these sit over the email, which is
 * on white paper whichever theme the editor is wearing. A toolbar that went
 * light with the rest of the editor would disappear into the page it is
 * annotating.
 */
const TOOLBAR = [
  "pointer-events-auto absolute flex items-center gap-0.5 rounded-lg bg-toolbar p-[3px] text-toolbar-foreground",
  // Three shadows doing three jobs: a rim so it holds an edge against a dark
  // photograph, an inner highlight along the top so it reads as a solid object
  // lit from above, and the cast shadow that lifts it off the page.
  "shadow-toolbar",
  "toolbar-in",
].join(" ");

const TOOLBAR_BUTTON =
  "size-8 rounded-[6px] text-toolbar-ink transition-colors hover:bg-white/12 hover:text-white aria-pressed:bg-primary aria-pressed:text-white disabled:opacity-35";

/**
 * The handle an Author moves the selected Block by.
 *
 * Registering it is what makes every Block grip-only (ADR-0043): while it is
 * drawn, a press on any Block's body selects it and leaves it where it is. So a
 * click on another Block never reorders the email, and a press on this one is
 * free to be the start of a double-click into its text. The hover tag is the
 * other handle, for when nothing is selected.
 *
 * Not drawn for a Block the Author cannot carry — a column belongs to its row —
 * or for the Block being typed into, which has no drag to start.
 */
function Grip({ block }: { readonly block: Block }): ReactNode {
  const editor = useEditor();
  const editing = useEditorState((current) => current.getEditing());
  const { dragHandleProps } = useBlockDrag(block.id);
  if (editor.getDefinition(block.type)?.structural === true) return null;
  if (editing === block.id) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(TOOLBAR_BUTTON, "cursor-grab active:cursor-grabbing")}
      title="Drag to move"
      aria-label="Move"
      {...dragHandleProps}
    >
      <Icon name="grip" />
    </Button>
  );
}

/**
 * The selected Block's own actions.
 *
 * Every button here runs the same command the matching keystroke does, so the
 * two can never drift apart. Each is greyed out by that command's `can` check
 * rather than hidden when it would do nothing: an Author is better told that
 * the unsubscribe link cannot go than left hunting for the button.
 *
 * Delete asks `can.delete` rather than reading `deletable` off the Definition.
 * The two answer different questions — `deletable` is permanent and about the
 * type, which is what the padlocks elsewhere in this application report, while
 * `can.delete` is about this Block where it currently sits. A column that is
 * merely the last one its row can spare is not required and not locked, so the
 * title says what is true without claiming either.
 */
function BlockToolbar({
  block,
  rect,
  travelling,
}: BlockChromeProps & { readonly travelling: boolean }): ReactNode {
  const editor = useEditor();
  const commands = useCommands();
  const definition = editor.getDefinition(block.type);
  const holdsImage = assetPropOf(definition) !== undefined;
  // Subscribed, so a change elsewhere, like a sibling filling the parent,
  // greys a button out without waiting for the toolbar to move.
  const removable = useEditorState(() => commands.can.delete());
  const canMoveUp = useEditorState(() => commands.can.moveUp());
  const canMoveDown = useEditorState(() => commands.can.moveDown());
  const canDuplicate = useEditorState(() => commands.can.duplicate());
  const parent = useEditorState((current) => parentOf(current, block.id));
  const required = definition?.deletable === false;
  const AgentAction = use(BlockAction);

  return (
    // Hung above the Block and pulled back from its trailing edge, rather than
    // starting at its leading one. The strip has to sit over something, and in
    // an email that something is almost always the previous Block — whose text
    // starts on the left and runs out well before the right. `translate` does
    // the aligning so nothing here has to measure the toolbar first.
    <div
      className={cn(TOOLBAR, "travels -translate-x-full")}
      data-travelling={travelling}
      style={{ top: Math.max(rect.top - 42, 2), left: rect.left + rect.width }}
    >
      {AgentAction === undefined ? null : <AgentAction block={block} />}
      <Grip block={block} />
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title={withKeys("Select parent", "stepOut")}
        aria-label="Select parent"
        disabled={parent === undefined}
        onClick={() => {
          editor.select(parent);
        }}
      >
        <Icon name="parent" />
      </Button>
      {holdsImage ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className={TOOLBAR_BUTTON}
          title="Replace image"
          aria-label="Replace image"
          onClick={() => {
            editor.replaceImage(block.id);
          }}
        >
          <Icon name="swap" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title={withKeys("Move up", "moveUp")}
        aria-label="Move up"
        disabled={!canMoveUp}
        onClick={commands.moveUp}
      >
        <Icon name="up" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title={withKeys("Move down", "moveDown")}
        aria-label="Move down"
        disabled={!canMoveDown}
        onClick={commands.moveDown}
      >
        <Icon name="down" />
      </Button>
      <MoveTo block={block} />
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title={withKeys("Duplicate", "duplicate")}
        aria-label="Duplicate"
        disabled={!canDuplicate}
        onClick={commands.duplicate}
      >
        <Icon name="duplicate" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title={deleteTitle(removable, required)}
        aria-label="Delete"
        disabled={!removable}
        onClick={commands.delete}
      >
        {/* The padlock means Required, so a floored column keeps the bin. */}
        <Icon name={required ? "lock" : "trash"} />
      </Button>
    </div>
  );
}

/**
 * Every place the selected Block could go, in words, grouped by container.
 *
 * Move up and Move down swap with a sibling and stop at the edge of the
 * container. This reaches the rest: out of a column, into another Section,
 * into an empty column. It is the way to move a Block anywhere without a
 * drag (WCAG 2.5.7).
 *
 * The places are `getDropTargets`, on the rules a drag lands by, so nothing
 * listed is refused. The move says it came from a Command, so it washes and
 * slides like Move up does. A screen reader hears where the Block went, and
 * focus comes back to this button.
 */
function MoveTo({ block }: { readonly block: Block }): ReactNode {
  const editor = useEditor();
  const [heard, setHeard] = useState("");
  const [groups, setGroups] = useState<readonly PlaceGroup[]>([]);
  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          // Read when it opens rather than on every render: the list walks
          // the whole email, and it only has to be right while it is shown.
          if (open) setGroups(placesFor(editor, block));
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={TOOLBAR_BUTTON}
            title="Move to…"
            aria-label="Move to…"
          >
            <Icon name="move-to" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-80 min-w-60 overflow-y-auto"
        >
          {groups.map((group, index) => (
            <DropdownMenuGroup key={group.parentId}>
              {index === 0 ? null : <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {group.name}
              </DropdownMenuLabel>
              {group.places.map((place) => (
                <DropdownMenuItem
                  key={String(place.target.index)}
                  disabled={place.here}
                  onSelect={() => {
                    const { target } = place;
                    const moved = editor.moveBlock(
                      block.id,
                      target.parentId,
                      target.index,
                      { via: "command" },
                    );
                    if (moved) setHeard(movedTo(editor, block.id));
                  }}
                >
                  <span className="truncate">{place.name}</span>
                  {place.here ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      here
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {heard}
      </span>
    </>
  );
}

/** The places in one container, under its name. */
interface PlaceGroup {
  readonly parentId: string;
  readonly name: string;
  readonly places: readonly {
    readonly target: DropTarget;
    readonly name: string;
    readonly here: boolean;
  }[];
}

/** Every place a Block could go, grouped by container, in email order. */
function placesFor(editor: Editor, block: Block): readonly PlaceGroup[] {
  const targets = editor.getDropTargets({
    draggedType: block.type,
    draggedBlockId: block.id,
  });
  const groups = new Map<string, PlaceGroup["places"][number][]>();
  for (const target of targets) {
    const places = groups.get(target.parentId) ?? [];
    places.push({
      target,
      name: placeName(editor, target),
      here: isWhereItIs(editor, target, block.id),
    });
    groups.set(target.parentId, places);
  }
  return [...groups].map(([parentId, places]) => ({
    parentId,
    name: containerPath(editor, parentId),
    places,
  }));
}

/** Where a Block now is, the way a screen reader should say it. */
function movedTo(editor: Editor, blockId: string): string {
  const block = editor.getBlock(blockId);
  const parent = holderOf(editor.getDocument().root, blockId);
  if (!block || !parent) return "";
  const siblings = parent.children ?? [];
  const position = siblings.findIndex((child) => child.id === blockId) + 1;
  return `${labelOf(block, editor)} moved into ${containerName(editor, parent.id)}, position ${String(position)} of ${String(siblings.length)}`;
}

/**
 * The Block a step up from this one selects, the way Escape does: a column is
 * passed over for its row, through `getSelectable`. Nothing at the top, where
 * the next step up is the email itself.
 */
function parentOf(editor: Editor, blockId: string): string | undefined {
  const root = editor.getDocument().root;
  const find = (block: Block): Block | undefined => {
    for (const child of block.children ?? []) {
      if (child.id === blockId) return block;
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  const parent = find(root);
  const selectable = parent && editor.getSelectable(parent.id);
  return selectable === root.id ? undefined : selectable;
}

/**
 * Inline formatting for the Author's text selection.
 *
 * The rectangle arrives already translated, and the commands already act on
 * the range without taking focus off it — clicking Bold from a toolbar that
 * lives outside the iframe would otherwise end the selection it is formatting.
 */
function TextToolbar({
  rect,
  formatting,
  commands,
}: TextToolbarProps): ReactNode {
  const [href, setHref] = useState<string | undefined>(undefined);

  return (
    <div
      className={TOOLBAR}
      style={{ top: Math.max(rect.top - 44, 2), left: rect.left }}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title="Bold (⌘B)"
        aria-label="Bold"
        aria-pressed={formatting.bold}
        onClick={commands.toggleBold}
      >
        <strong>B</strong>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title="Italic (⌘I)"
        aria-label="Italic"
        aria-pressed={formatting.italic}
        onClick={commands.toggleItalic}
      >
        <em>I</em>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title="Underline (⌘U)"
        aria-label="Underline"
        aria-pressed={formatting.underline}
        onClick={commands.toggleUnderline}
      >
        <u>U</u>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={TOOLBAR_BUTTON}
        title="Strikethrough"
        aria-label="Strikethrough"
        aria-pressed={formatting.strike}
        onClick={commands.toggleStrike}
      >
        <s>S</s>
      </Button>
      <span className="mx-0.5 w-px self-stretch bg-white/15" />
      {href === undefined ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className={TOOLBAR_BUTTON}
          title="Link"
          aria-label="Link"
          aria-pressed={formatting.link !== undefined}
          onClick={() => {
            setHref(formatting.link ?? "https://");
          }}
        >
          <Icon name="link" />
        </Button>
      ) : (
        <>
          <Input
            value={href}
            placeholder="https://example.com"
            aria-label="Link address"
            className="h-8 w-48 border-0 bg-white/12 text-toolbar-foreground placeholder:text-toolbar-ink/60 hover:border-0 focus-visible:ring-0"
            onChange={(event) => {
              setHref(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              commands.setLink(href);
              setHref(undefined);
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className={TOOLBAR_BUTTON}
            title="Apply"
            aria-label="Apply link"
            onClick={() => {
              commands.setLink(href);
              setHref(undefined);
            }}
          >
            <Icon name="check" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={TOOLBAR_BUTTON}
            title="Remove link"
            aria-label="Remove link"
            onClick={() => {
              commands.setLink(undefined);
              setHref(undefined);
            }}
          >
            <Icon name="close" />
          </Button>
        </>
      )}
    </div>
  );
}

/** The placeholder's shell. Over paper, so it does not follow the theme. */
const PLACEHOLDER =
  "pointer-events-auto absolute flex min-h-16 flex-col justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs";

/**
 * Where an image is going to land, while it is still being resolved.
 *
 * None of this is in the Document — that is the whole point. An Author who
 * saves at this moment saves an email with no image in it rather than one
 * pointing at a local URL that means nothing tomorrow.
 */
function PendingImage({ pending, rect }: PendingImageProps): ReactNode {
  const editor = useEditor();
  const percent = Math.round((pending.progress ?? 0) * 100);

  // A background is not the Block, so a cover over it would hide the very
  // thing being changed — a section can be most of the email. It gets a pill
  // at its corner instead. A Block that is its image keeps the cover.
  if (isBeside(editor, pending.placement)) {
    return (
      <div
        role="status"
        className="pointer-events-auto absolute flex -translate-x-full items-center gap-1.5 rounded-full border border-primary bg-[color-mix(in_srgb,var(--primary)_10%,#ffffff)] py-0.5 pr-0.5 pl-2.5 text-primary shadow-sm"
        style={{ top: rect.top + 8, left: rect.left + rect.width - 8 }}
      >
        <span className="text-[0.75rem] whitespace-nowrap">
          {waitingOf(pending)}
        </span>
        <ProgressBar percent={percent} className="h-1 w-10" />
        <Meta className="text-current">{percent}%</Meta>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 rounded-full text-current hover:bg-black/8"
          title="Cancel"
          aria-label="Cancel"
          onClick={pending.cancel}
        >
          <Icon name="close" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        PLACEHOLDER,
        "border-2 border-dashed border-primary bg-[color-mix(in_srgb,var(--primary)_10%,#ffffff)] text-primary",
      )}
      style={anticipated(pending.placement, rect)}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[0.75rem]">
          {waitingOf(pending)}
        </span>
        <Meta className="text-current">{percent}%</Meta>
      </div>
      <div className="flex items-center gap-2">
        <ProgressBar percent={percent} className="h-[5px] flex-1" />
        <Button size="sm" onClick={pending.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** How far along an image is, as a bar in the placeholder's ink. */
function ProgressBar({
  percent,
  className,
}: {
  readonly percent: number;
  readonly className: string;
}): ReactNode {
  return (
    <span className={cn("overflow-hidden rounded-full bg-black/12", className)}>
      <span
        className="block h-full rounded-full bg-current transition-[width] duration-[var(--duration-quick)]"
        style={{ width: `${String(percent)}%` }}
      />
    </span>
  );
}

/** The same place, once the resolver rejected. The Document is untouched. */
function FailedImage({ failure, rect }: FailedImageProps): ReactNode {
  return (
    <div
      className={cn(
        PLACEHOLDER,
        "border-2 border-destructive bg-[color-mix(in_srgb,var(--destructive)_10%,#ffffff)] text-destructive",
      )}
      style={anticipated(failure.placement, rect)}
    >
      <div className="flex items-center gap-2">
        <Icon name="warning" />
        <span className="min-w-0 flex-1 text-[0.75rem]">
          {messageOf(failure.error)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={failure.retry}>
          Try again
        </Button>
        <Button size="sm" onClick={failure.cancel}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** How tall a placeholder is allowed to be before it stops being one. */
const PLACEHOLDER_HEIGHT = 76;

/**
 * Where a placeholder for an image that is not here yet belongs.
 *
 * A replacement takes the Block it is replacing, whatever size that is. An
 * insertion takes the rectangle of the anticipated position, which for a drop
 * at the end of a container is the whole container — so it is drawn as a band
 * along the bottom edge, where the Block will actually appear, rather than as
 * a box over everything already there.
 */
function anticipated(placement: ImagePlacement, rect: Rect): CSSProperties {
  if (placement.kind === "replace") return box(rect);

  const height = Math.min(rect.height, PLACEHOLDER_HEIGHT);
  return {
    top: rect.top + rect.height - height,
    left: rect.left,
    width: rect.width,
    height,
  };
}

/**
 * Whether an image is going into a prop other than its Block's Primary Asset —
 * a background — rather than being the Block.
 */
function isBeside(editor: Editor, placement: ImagePlacement): boolean {
  if (placement.kind !== "replace") return false;
  const type = editor.getBlock(placement.blockId)?.type;
  const definition =
    type === undefined ? undefined : editor.getDefinition(type);
  return assetPropOf(definition) !== placement.prop;
}

/**
 * The prop the Block's Primary Asset lives in, when it has one. An optional
 * Asset — a section's background — is changed from the Inspector instead.
 */
function assetPropOf(
  definition: BlockDefinition | undefined,
): string | undefined {
  if (!definition) return undefined;
  return Object.entries(definition.schema).find(
    ([, entry]) => entry.kind === SchemaKind.asset && entry.primary === true,
  )?.[0];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "That image did not arrive.";
}
