import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  assetOf,
  NONE,
  SchemaKind,
  type Asset,
  type Block,
  type BoxSide,
  type ControlDescriptor,
  type Editor,
  type Origin,
  type PendingChange,
  brandColorsOf,
} from "lekh";
import { useEditor, useEditorState } from "lekh/canvas";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import {
  backgroundOfColor,
  backgroundOfImage,
  renderingOf,
} from "./background";
import { contrastOf, READABLE } from "./contrast";
import { canonical, colorsInEmail } from "./swatches";
import { foldSummary } from "./fold-summary";
import { boxLabel, choicesOf, labelOf, optionsOf } from "./labels";
import { fitsButtonRow } from "./select-shape";
import { Icon } from "./icons";
import { originMarks, type OriginMark } from "./origin-marks";
import { dragFrom } from "./pointer-drag";
import { SuggestedValues, SuggestionCard } from "./suggestion-card";
import { Band, LABEL, Meta, PanelHint, PanelTitle, Row, Stack } from "./parts";
import {
  BlockDiagnostics,
  FieldDiagnostics,
  fieldKey,
  fieldOf,
} from "./field-diagnostics";

/**
 * The selected Block's editable props.
 *
 * The library describes them as data and renders none of it: `kind` is an open
 * string, and the `switch` below is this application's own (ADR-0002). A Block
 * declaring a kind nothing here handles falls through to the last case rather
 * than breaking the panel.
 *
 * Every control lands on the same right-hand edge, which is the one decision
 * that makes the panel readable. A stack of controls each sized to its own
 * content has to be read a row at a time; a stack that shares a column is a
 * table, and the eye can run down it. `Row` and `Stack` in `parts.tsx` are the
 * two arrangements, and the choice between them is only ever about whether the
 * control is worse for being narrow.
 */
export function Inspector({
  editor,
  onHold,
}: {
  readonly editor: Editor;
  /**
   * Hold a Suggestion back from the Canvas while an Author compares, or let
   * go: the Canvas's `showOriginal`.
   */
  readonly onHold: (suggestionId: string | undefined) => void;
}): ReactNode {
  // Five reads, five subscriptions. The three that describe the selection
  // hold their snapshot between changes, so an Author typing into a Block this
  // panel is not describing does not repaint it.
  const block = useEditorState((current) => {
    const id = current.getSelection();
    return id === undefined ? undefined : current.getBlock(id);
  });
  const controls = useEditorState((current) => current.getControls());
  const addable = useEditorState((current) => current.getAddableChildren());
  const owned = useEditorState((current) => current.getEditableChildren());
  const onMobile = useEditorState((current) => current.getStage() === "mobile");
  const rootId = useEditorState((current) => current.getDocument().root.id);

  // Definitions are composed once and never change, so this is a plain lookup
  // rather than something to be woken about.
  const definition = block ? editor.getDefinition(block.type) : undefined;

  // The filter belongs to the Block it was typed on: selecting another starts
  // it empty. Which folds are open is kept for the session, so an Author who
  // opened "More" once finds it open on the next Block too.
  const [filter, setFilter] = useState({ blockId: block?.id, query: "" });
  const query = filter.blockId === block?.id ? filter.query : "";
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const folds: Folds = {
    query,
    isOpen: (key) => opened.has(key),
    setOpen: (key, open) => {
      setOpened((current) => {
        if (current.has(key) === open) return current;
        const next = new Set(current);
        if (open) next.add(key);
        else next.delete(key);
        return next;
      });
    },
  };
  const shown = matching(controls, query);

  return (
    <ScrollArea className="min-h-0 flex-1">
      {/* Fades in once, when the panel opens. Clicking another Block swaps
          the values in place: a fade on every click read as flicker, and the
          rows that stay put are what tell an Author where they are. */}
      <div className="panel-in">
        <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-rule-soft bg-rail/95 px-3.5 py-2.5 backdrop-blur-sm">
          <span className="grid size-7 flex-none place-items-center rounded-md bg-wash text-primary">
            <Icon name={block?.type ?? "email"} className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">
              {definition?.label ?? (block ? block.type : "Email")}
            </span>
            {block ? <Ancestry editor={editor} blockId={block.id} /> : null}
          </div>
          {definition?.deletable === false ? (
            <Badge
              variant="tag"
              className="ml-auto"
              title="Required — cannot be deleted"
            >
              required
            </Badge>
          ) : null}
        </header>

        <SuggestionCard editor={editor} onHold={onHold} />

        {block ? null : (
          <PanelHint className="mb-0 px-3.5 pt-3">
            Email settings. Select a block to edit it instead.
          </PanelHint>
        )}

        {/* What is wrong with the Block as a whole. A Diagnostic about one prop
            sits under that prop's field instead. */}
        <BlockDiagnostics blockId={block?.id ?? rootId} editor={editor} />

        {onMobile ? (
          <p className="m-0 flex items-start gap-2 border-b border-rule-soft bg-wash px-3.5 py-2 text-[0.75rem]/[1.5] text-ink-mark">
            <Icon name="mobile" className="mt-px size-3.5 flex-none" />
            {controls.length === 0
              ? "This block looks the same on phones."
              : "Editing for phones. Other settings are the same on all screens."}
          </p>
        ) : null}

        {controls.length >= FILTER_FROM ? (
          <SettingsFilter
            query={query}
            onQuery={(next) => {
              setFilter({ blockId: block?.id, query: next });
            }}
          />
        ) : null}

        {query !== "" &&
        shown.length === 0 &&
        owned.every((child) => matching(child.controls, query).length === 0) ? (
          <PanelHint className="mb-0 px-3.5 pt-3">
            No setting matches “{query}”.
          </PanelHint>
        ) : null}

        {/* Grouped where the Schema said so, flat where it did not. The library
            names the groups; where they sit and what they look like is this
            panel's business. A group of only advanced settings is folded
            whole, under its own name. */}
        {groupsOf(shown).map(({ name, controls: rows }) => (
          <Band
            key={name ?? "ungrouped"}
            {...(name === undefined || rows.every((row) => isAdvanced(row))
              ? {}
              : { title: name })}
          >
            <FoldedControls
              controls={rows}
              title={name}
              editor={editor}
              onMobile={onMobile}
              folds={folds}
            />
          </Band>
        ))}

        {owned.length > 0 ? (
          <Division
            // Selecting the row again starts it over: the first column, its
            // fold closed.
            key={block?.id ?? rootId}
            owned={owned}
            addable={addable}
            editor={editor}
            onMobile={onMobile}
            folds={folds}
          />
        ) : addable.length > 0 ? (
          // Type-agnostic: the library names the child and this supplies the
          // verb. The list empties at the Block's ceiling, which is why the
          // button goes rather than sitting there refusing.
          <Band className="flex flex-col gap-1.5">
            {addable.map((child) => (
              <Button
                key={child.type}
                variant="outline"
                size="sm"
                className="w-full text-ink-2"
                onClick={child.add}
              >
                <Icon name={child.type} className="size-3.5" />
                Add {child.label.toLowerCase()}
              </Button>
            ))}
          </Band>
        ) : null}
      </div>
    </ScrollArea>
  );
}

/** A child a Block owns outright, and one it can be given. */
type EditableChild = ReturnType<Editor["getEditableChildren"]>[number];
type AddableChild = ReturnType<Editor["getAddableChildren"]>[number];

/**
 * The children a Block owns outright, drawn as the thing they add up to.
 *
 * They cannot be selected, so this panel is the only place they are edited.
 * Where they divide the parent between them the honest picture is the parent
 * itself: one strip, a segment per child, the boundaries between them
 * draggable. Clicking a segment opens that child's own props underneath, in
 * one fold that is closed when the row is selected and names what is set.
 *
 * The library says whether they divide anything and by how much —
 * `getDivision()` — so nothing here knows what a column is, what the prop is
 * called, or how far a boundary may travel. This file draws; the arithmetic is
 * the library's, and asking for it rather than repeating it is what stops the
 * strip from showing a split the write would refuse. Where the children divide
 * nothing the strip is still the picker; only the handles are missing.
 */
function Division({
  owned,
  addable,
  editor,
  onMobile,
  folds,
}: {
  readonly owned: readonly EditableChild[];
  readonly addable: readonly AddableChild[];
  readonly editor: Editor;
  readonly onMobile: boolean;
  readonly folds: Folds;
}): ReactNode {
  const track = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  // The child's fold, apart from the session's: closed each time the row is
  // selected, so the row's own settings come first.
  const [open, setOpen] = useState(false);
  // Held for the length of a drag, so the strip moves with the pointer while
  // the Document is written once — every `set` is an undo entry. Set on the
  // press rather than the first move, so the grip lights up when it is grabbed
  // and not a few pixels later.
  const [drag, setDrag] = useState<
    { readonly index: number; readonly shares: readonly number[] } | undefined
  >(undefined);

  // Subscribed like every other read, rather than taken off `editor` in
  // passing: it holds its snapshot between changes, so this panel repaints when
  // the split moves and not when something else does.
  const division = useEditorState((current) => current.getDivision());
  const divided = division !== undefined;
  const shares =
    drag?.shares ??
    division?.shares.map((share) => share.width) ??
    // Not divided: even segments, so the strip is still a picker.
    owned.map(() => 100 / owned.length);

  // The pick follows the children rather than an id: adding one or deleting one
  // leaves behind a selection that is no longer in the row.
  const at = Math.max(
    owned.findIndex((child) => child.blockId === picked),
    0,
  );
  const active = owned[at];
  if (!active) return null;
  // The strip is the width control where there is one, and two places to set
  // the same number is what made this panel confusing. The library names the
  // prop, so nothing here has to guess at it.
  const controls = matching(
    active.controls.filter((control) => control.name !== division?.prop),
    folds.query,
  );

  /** Move the boundary after child `index`, trading with the next one along. */
  const resize =
    (index: number) =>
    (event: ReactPointerEvent<HTMLElement>): void => {
      const span = track.current?.getBoundingClientRect().width ?? 0;
      const share = division?.shares[index];
      if (!share || span <= 0) return;

      const from = event.clientX;

      // Captured, or the drag dies the moment the pointer crosses the Canvas:
      // the email is an iframe, and pointer events over it belong to its own
      // document.
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      // The pointer spends the drag over the Canvas, whose own cursor rules
      // would otherwise take over the moment it left the strip.
      document.body.style.cursor = "col-resize";
      setDrag({ index, shares: division.shares.map((each) => each.width) });

      const onMove = (moved: PointerEvent): void => {
        const latest = share.width + ((moved.clientX - from) / span) * 100;
        // The library clamps and rebalances; this only says where the pointer
        // is. Previewing moves the real columns on the Canvas too, through
        // the same rule the release will store, so the strip and the email
        // never disagree.
        setDrag({ index, shares: share.preview(latest) });
      };
      const onEnd = (ended: PointerEvent): void => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        document.body.style.cursor = "";
        setDrag(undefined);
        // Unguarded: a drag ending where it began stores nothing, so it costs
        // no undo entry. A pointer the browser took away is not a release.
        if (ended.type === "pointercancel") share.cancel();
        else share.commit();
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    };

  const nudge =
    (index: number) =>
    (event: ReactKeyboardEvent<HTMLElement>): void => {
      const step =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const share = division?.shares[index];
      if (step === 0 || !share) return;
      event.preventDefault();

      share.set(share.width + step * (event.shiftKey ? 10 : 1));
    };

  return (
    <Band>
      <div className="mb-1.5 flex items-center gap-1">
        {/* The label alone. A count beside it reads as an index — "Column 2"
            is the one thing this heading must not say. */}
        <PanelTitle className="mb-0 flex-1 truncate">{active.label}</PanelTitle>
        {addable.map((child) => (
          <Button
            key={child.type}
            variant="ghost"
            size="xs"
            className="-my-1 text-ink-2"
            title={`Add ${child.label.toLowerCase()}`}
            onClick={child.add}
          >
            <Icon name="plus" className="size-3" />
            Add
          </Button>
        ))}
        {/* Disabled rather than absent: the library says whether the removal
            would do anything, and a button that vanishes at the floor is harder
            to understand than one that explains. */}
        <Button
          variant="ghost"
          size="xs"
          className="-my-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={!active.canRemove}
          title={
            active.canRemove
              ? `Delete ${active.label.toLowerCase()} ${String(at + 1)}`
              : `The row will not go below ${String(owned.length)}.`
          }
          onClick={active.remove}
        >
          <Icon name="trash" className="size-3" />
          Delete
        </Button>
      </div>

      {/* The row, at the size it is. A segment is the picker and the reading at
          once, which is the whole reason this replaced a stack of accordions:
          the split was previously a number you had to open a panel to find. */}
      <div
        ref={track}
        className="relative flex h-11 w-full overflow-hidden rounded-md border bg-card"
      >
        {owned.map((child, index) => (
          <button
            key={child.blockId}
            type="button"
            aria-pressed={index === at}
            title={`${child.label} ${String(index + 1)}${divided ? ` — ${String(shares[index])}%` : ""}`}
            className={cn(
              "flex min-w-0 flex-none items-center justify-center px-1",
              // Mono for a width, which is a value. A column's number is not.
              "text-[0.75rem] transition-colors duration-[var(--duration-quick)]",
              divided && "font-mono tabular-nums",
              "focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              // The seam draws the division where there is one to drag.
              divided ? "" : "border-r border-rule-soft last:border-r-0",
              index === at
                ? "bg-wash font-medium text-ink-mark"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
            style={{ width: `${String(shares[index])}%` }}
            onClick={() => {
              setPicked(child.blockId);
              setOpen(true);
            }}
          >
            <span className="truncate">
              {divided ? `${String(shares[index])}%` : index + 1}
            </span>
          </button>
        ))}

        {/* The boundary, drawn as something to take hold of. A hairline is an
            honest picture of a division and a poor one of a control: it says
            nothing about being draggable and is a hard thing to hit. So the
            seam is a raised bar with a grip on it, and the target around it is
            wider than the bar — 22px of pointer, 6px of paint. */}
        {divided
          ? owned.slice(0, -1).map((child, index) => (
              <div
                key={child.blockId}
                role="separator"
                aria-orientation="vertical"
                aria-label={`${child.label} ${String(index + 1)} width`}
                aria-valuenow={shares[index]}
                aria-valuemin={division?.shares[index]?.floor}
                aria-valuemax={division?.shares[index]?.ceiling}
                tabIndex={0}
                data-dragging={drag?.index === index}
                title="Drag to resize"
                className="group/handle absolute inset-y-0 z-10 flex w-[22px] -translate-x-1/2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
                style={{
                  left: `${String(shares.slice(0, index + 1).reduce((sum, share) => sum + share, 0))}%`,
                }}
                onPointerDown={resize(index)}
                onKeyDown={nudge(index)}
              >
                <span
                  className={cn(
                    "flex h-full w-2 flex-col items-center justify-center gap-[3px] border-x border-border bg-secondary",
                    "transition-colors duration-[var(--duration-quick)]",
                    "group-hover/handle:border-primary group-hover/handle:bg-primary",
                    "group-focus-visible/handle:border-primary group-focus-visible/handle:bg-primary",
                    "group-data-[dragging=true]/handle:border-primary group-data-[dragging=true]/handle:bg-primary",
                  )}
                >
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className={cn(
                        "size-[2px] rounded-full bg-muted-foreground/70 transition-colors duration-[var(--duration-quick)]",
                        "group-hover/handle:bg-primary-foreground",
                        "group-focus-visible/handle:bg-primary-foreground",
                        "group-data-[dragging=true]/handle:bg-primary-foreground",
                      )}
                    />
                  ))}
                </span>
              </div>
            ))
          : null}
      </div>

      {divided ? (
        <PanelHint className="mt-1.5 mb-0">
          Drag a divider to resize. Click a {active.label.toLowerCase()} to edit
          it.
        </PanelHint>
      ) : null}

      <div className="mt-3 border-t border-rule-soft pt-1.5">
        <Fold
          title={`${active.label} ${String(at + 1)} of ${String(owned.length)}`}
          controls={controls}
          filtering={folds.query !== ""}
          open={open}
          onOpenChange={setOpen}
        >
          <FoldedControls
            controls={controls}
            editor={editor}
            onMobile={onMobile}
            folds={folds}
          />
        </Fold>
      </div>
    </Band>
  );
}

/**
 * What this Block sits inside, as a trail back to the email.
 *
 * A container is mostly covered by its own children, so selecting one on the
 * Canvas means hitting the padding they left. This is the way up without aim.
 */
function Ancestry({
  editor,
  blockId,
}: {
  readonly editor: Editor;
  readonly blockId: string;
}): ReactNode {
  // The trail is a walk down the Document, so it answers to the Document —
  // a Block moved into another container sits somewhere else without the
  // selection having moved at all.
  const root = useEditorState((current) => current.getDocument().root);
  const trail = pathTo(root, blockId).filter(
    (step, index) => index === 0 || editor.getSelectable(step.id) === step.id,
  );

  return (
    <nav
      aria-label="Where this block sits"
      className="-ml-1 flex flex-wrap items-center gap-x-0.5"
    >
      {trail.map((step, index) => (
        <span key={step.id} className="flex items-center gap-x-0.5">
          {index === 0 ? null : (
            <Icon
              name="disclosure"
              className="size-3 flex-none text-muted-foreground/60"
            />
          )}
          <button
            type="button"
            className="min-h-6 rounded-sm px-1 text-[0.75rem] text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => {
              // The root is "nothing selected", which is how the rest of this
              // panel already describes the email itself.
              editor.select(index === 0 ? undefined : step.id);
              if (index > 0) editor.reveal(step.id);
            }}
          >
            {editor.getDefinition(step.type)?.label ?? step.type}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** The Blocks from the root down to this one, not including it. */
function pathTo(root: Block, blockId: string): readonly Block[] {
  const walk = (block: Block, trail: readonly Block[]): Block[] | undefined => {
    const here = [...trail, block];
    if (block.id === blockId) return here;
    for (const child of block.children ?? []) {
      const found = walk(child, here);
      if (found) return found;
    }
    return undefined;
  };

  return walk(root, [])?.slice(0, -1) ?? [];
}

/**
 * Control Descriptors in runs, split wherever the group changes.
 *
 * A walk rather than a bucketing, because descriptors arrive in Schema order
 * and that order is the Preset author's: re-sorting them by group would move
 * controls around behind the back of whoever wrote the Schema. A Block that
 * groups nothing comes back as a single run with no heading, which is what
 * every Block in this example did until containers grew a second surface.
 */
function groupsOf(controls: readonly ControlDescriptor[]): readonly {
  name: string | undefined;
  controls: ControlDescriptor[];
}[] {
  const runs: { name: string | undefined; controls: ControlDescriptor[] }[] =
    [];
  for (const control of controls) {
    const last = runs.at(-1);
    if (last && last.name === control.group) last.controls.push(control);
    else runs.push({ name: control.group, controls: [control] });
  }
  return runs;
}

/** Which folds are open, and the filter that opens every one it matches. */
type Folds = {
  readonly query: string;
  readonly isOpen: (key: string) => boolean;
  readonly setOpen: (key: string, open: boolean) => void;
};

/** A Block with this many settings or more gets a filter box. */
const FILTER_FROM = 8;

/** A setting an Author rarely needs, folded away until asked for. */
function isAdvanced(control: ControlDescriptor): boolean {
  return control.advanced === true;
}

/**
 * The controls whose label, group or Box names the query, folded ones too.
 *
 * A Box is one control, so a match on any side keeps all its sides.
 */
function matching(
  controls: readonly ControlDescriptor[],
  query: string,
): readonly ControlDescriptor[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return controls;
  const hit = (control: ControlDescriptor): boolean =>
    [
      control.label,
      control.group,
      control.box === undefined ? undefined : boxLabel(control.box),
    ].some((text) => text?.toLowerCase().includes(wanted) === true);
  const boxes = new Set(
    controls
      .filter((control) => hit(control))
      .flatMap((control) => control.box ?? []),
  );
  return controls.filter(
    (control) =>
      hit(control) || (control.box !== undefined && boxes.has(control.box)),
  );
}

/**
 * Type to find a setting. Escape empties it before it reaches the editor,
 * where Escape would move the selection.
 */
function SettingsFilter({
  query,
  onQuery,
}: {
  readonly query: string;
  readonly onQuery: (query: string) => void;
}): ReactNode {
  return (
    <div className="border-b border-rule-soft px-3.5 py-2">
      <Input
        type="search"
        aria-label="Find a setting"
        placeholder="Find a setting"
        className="h-7 bg-card text-[0.75rem]"
        value={query}
        onChange={(event) => {
          onQuery(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || query === "") return;
          event.preventDefault();
          event.stopPropagation();
          onQuery("");
        }}
      />
    </div>
  );
}

/**
 * A run of controls with its advanced ones folded away. A run of nothing
 * but advanced ones is one fold, named after its group. Otherwise they go
 * last, in a fold called "More".
 *
 * A filter opens every fold it reaches: it already says which settings to
 * show.
 */
function FoldedControls({
  controls,
  title,
  editor,
  onMobile,
  folds,
}: {
  readonly controls: readonly ControlDescriptor[];
  readonly title?: string | undefined;
  readonly editor: Editor;
  readonly onMobile: boolean;
  readonly folds: Folds;
}): ReactNode {
  const common = controls.filter((control) => !isAdvanced(control));
  const advanced = controls.filter((control) => isAdvanced(control));
  const name = common.length === 0 ? (title ?? "More") : "More";
  return (
    <>
      <Controls controls={common} editor={editor} onMobile={onMobile} />
      {advanced.length === 0 ? null : (
        <Fold
          title={name}
          controls={advanced}
          filtering={folds.query !== ""}
          open={folds.isOpen(`${title ?? ""}/${name}`)}
          onOpenChange={(open) => {
            folds.setOpen(`${title ?? ""}/${name}`, open);
          }}
        >
          <Controls controls={advanced} editor={editor} onMobile={onMobile} />
        </Fold>
      )}
    </>
  );
}

/**
 * One fold. A native `<details>`, so `focusField` can open it to reach a
 * Diagnostic's field, and the `toggle` that fires keeps the open set in step.
 *
 * A click on the summary sets the state rather than letting the browser
 * toggle it. Otherwise a close and a filter landing in one render leave React
 * believing the fold is still open, and the filter's matches stay hidden.
 * While filtering, every fold is open and the summary is only a heading.
 *
 * Closed, its title names what is set inside, so an Author sees a Block's
 * real state without opening it. Open, the rows say that themselves.
 */
function Fold({
  title,
  controls,
  filtering,
  open: chosen,
  onOpenChange,
  children,
}: {
  readonly title: string;
  readonly controls: readonly ControlDescriptor[];
  readonly filtering: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactNode {
  const open = filtering || chosen;
  return (
    <details
      className="group/fold not-first:mt-2.5"
      open={open}
      onToggle={(event) => {
        if (!filtering) onOpenChange(event.currentTarget.open);
      }}
    >
      <summary
        className={cn(
          "-mx-1 flex min-h-7 list-none items-center gap-1 rounded-sm px-1 text-[0.75rem] font-semibold text-muted-foreground select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden",
          filtering ? "cursor-default" : "cursor-pointer hover:text-foreground",
        )}
        onClick={(event) => {
          event.preventDefault();
          if (!filtering) onOpenChange(!open);
        }}
      >
        <Icon
          name="disclosure"
          className="size-3 flex-none group-open/fold:rotate-90"
        />
        <span className="min-w-0 truncate">
          {open ? title : foldSummary(title, controls)}
        </span>
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}

/**
 * A run of controls, with the sides of each Box drawn as one control where
 * its first side is.
 *
 * The Schema names the Boxes (ADR-0040), so nothing here guesses from a prop's
 * name. A button's outer padding and the room round its label are two.
 */
function Controls({
  controls,
  editor,
  onMobile,
}: {
  readonly controls: readonly ControlDescriptor[];
  readonly editor: Editor;
  readonly onMobile: boolean;
}): ReactNode {
  const items: (ControlDescriptor | readonly ControlDescriptor[])[] = [];
  const boxes = new Map<string, ControlDescriptor[]>();
  for (const control of controls) {
    if (control.box === undefined) {
      items.push(control);
      continue;
    }
    const sides = boxes.get(control.box);
    if (sides) {
      sides.push(control);
      continue;
    }
    const first = [control];
    boxes.set(control.box, first);
    items.push(first);
  }

  return items.map((item) =>
    "name" in item ? (
      <ControlRow
        key={`${item.blockId}:${item.name}`}
        control={item}
        editor={editor}
        onMobile={onMobile}
      />
    ) : (
      <BoxControl
        key={`${item[0]?.blockId ?? ""}:${item[0]?.box ?? ""}`}
        sides={item}
        editor={editor}
        onMobile={onMobile}
      />
    ),
  );
}

/**
 * One control, plus where its value comes from.
 *
 * Shared by the selected Block's own props and by those of the children it
 * owns, because a Control Descriptor is a Control Descriptor wherever it came
 * from — the library already resolved the Stage and the override before
 * handing it over.
 */
function ControlRow({
  control,
  editor,
  onMobile,
}: {
  readonly control: ControlDescriptor;
  readonly editor: Editor;
  readonly onMobile: boolean;
}): ReactNode {
  return (
    // The gap between controls lives here rather than on the row, because a
    // control is not always one row: an Asset is a picture and a field.
    <div className="not-first:mt-2.5" {...fieldOf([control])}>
      <Control
        control={control}
        editor={editor}
        mark={
          <OriginMarks control={control} editor={editor} onMobile={onMobile} />
        }
      />
      <SuggestedValues controls={[control]} />
      <MailClientNotes control={control} />
      <FieldDiagnostics
        controls={[control]}
        editor={editor}
        onMobile={onMobile}
      />
    </div>
  );
}

/** What an Author is told a value comes from, Origin by Origin. */
const ORIGIN_LABEL: Readonly<Record<Origin, string>> = {
  override: "Mobile only",
  block: "This block",
  email: "From the email",
  default: "Default",
};

/**
 * Where one control's value comes from, as marks beside its label and the
 * rest in a popover: what the other Stage holds, and the way back.
 *
 * Everything here is read off the descriptor's `origin` and `otherStage`. A
 * row with a mark names the other Stage on mobile always, so an Author never
 * breaks desktop by accident, and on desktop only when mobile differs. A row
 * at its default has no mark and so names nothing. Naming it is a button,
 * because the next thing an Author wants is to go and look.
 *
 * Each reset says where it leads. "Use desktop" drops the Mobile Override.
 * "Use email color" puts a Block back on the email's. "Reset to default" is
 * there whenever the value is not already the Schema's.
 */
function OriginMarks({
  control,
  editor,
  onMobile,
}: {
  readonly control: ControlDescriptor;
  readonly editor: Editor;
  readonly onMobile: boolean;
}): ReactNode {
  const block = editor.getBlock(control.blockId);
  const entry = block && editor.getDefinition(block.type)?.schema[control.name];
  const other = control.otherStage;
  const showOther =
    other !== undefined && (onMobile || other.origin === "override");

  const resets: { label: string; run: () => void }[] = [];
  if (control.origin === "override" && other !== undefined) {
    resets.push({
      label: `Use desktop${valueSuffix(other.value)}`,
      run: control.clearOverride,
    });
  }
  if (!onMobile && control.origin === "block" && entry?.follows !== undefined) {
    resets.push({ label: "Use email color", run: control.reset });
  }
  // The rich-text row is edited on the email, and a Primary Asset is never
  // removed, so neither is offered a way back from the Inspector.
  if (
    control.origin !== "default" &&
    entry !== undefined &&
    control.kind !== SchemaKind.richText &&
    control.primary !== true &&
    !Object.is(control.value, entry.defaultValue)
  ) {
    // On desktop a Block that follows nothing goes back to its default by
    // dropping its own value. Anywhere else that would land on the email or on
    // desktop, so the default is set outright.
    const unset =
      !onMobile && control.origin === "block" && entry.follows === undefined;
    const fallback: unknown = entry.defaultValue;
    resets.push({
      label: "Reset to default",
      run: unset
        ? control.reset
        : () => {
            control.set(fallback);
          },
    });
  }

  return (
    <OriginPopover
      label={control.label}
      marks={originMarks([control], onMobile)}
      origin={control.origin}
      {...(showOther ? { other: valueSuffix(other.value) } : {})}
      resets={resets}
      editor={editor}
      onMobile={onMobile}
    />
  );
}

/** What an Author is told each mail client is called. */
const CLIENT_LABEL: Readonly<Record<string, string>> = {
  "outlook-windows": "Classic Outlook for Windows",
  "gmail-app": "Gmail app",
  "gmail-mobile-webmail": "Gmail in a phone's browser",
  "samsung-email": "Samsung Email",
  sfr: "SFR Mail",
  laposte: "La Poste Mail",
};

/**
 * The Mail Client Notes that apply to the value, one grey line each: what a
 * mail client will do with it. Apart from the Diagnostics below, because
 * nothing is wrong. A client the example has no name for shows its id.
 */
function MailClientNotes({
  control,
}: {
  readonly control: ControlDescriptor;
}): ReactNode {
  if (control.clients === undefined) return null;
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      {control.clients.map(({ client, note }) => (
        <p
          key={`${client}:${note}`}
          className="flex items-start gap-1.5 pl-0.5 text-[0.75rem]/[1.45] text-muted-foreground"
        >
          <Icon name="info" className="mt-0.5 size-3 flex-none" />
          <span>
            {CLIENT_LABEL[client] ?? client}: {note}
          </span>
        </p>
      ))}
    </div>
  );
}

/** What a screen reader hears for each mark. */
const MARK_WORDS: Readonly<Record<OriginMark["kind"], string>> = {
  block: "set on this block",
  email: "follows the email",
  phone: "different on phones",
};

/**
 * The marks themselves, one button that opens the popover: a dot for this
 * Block, a link for the email, a phone chip with the value phones show. Each
 * is a shape as well as a colour. A value at its default gets nothing.
 *
 * The popover says where the value comes from, names the other Stage as a
 * button that switches to it, and offers the ways back. `origin` is absent for
 * a Box whose sides come from different places.
 */
function OriginPopover({
  label,
  marks,
  origin,
  other,
  resets,
  editor,
  onMobile,
}: {
  readonly label: string;
  readonly marks: readonly OriginMark[];
  readonly origin: Origin | undefined;
  /** The other Stage's value as a tail — ", 30" — when it is worth naming. */
  readonly other?: string;
  readonly resets: readonly {
    readonly label: string;
    readonly run: () => void;
  }[];
  readonly editor: Editor;
  readonly onMobile: boolean;
}): ReactNode {
  if (marks.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${marks.map((mark) => MARK_WORDS[mark.kind]).join(", ")}`}
          className="flex min-h-5 min-w-0 flex-none items-center gap-1 rounded-sm px-1 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-secondary"
        >
          {marks.map((mark) =>
            mark.kind === "block" ? (
              <span
                key="block"
                className="size-1.5 flex-none rounded-full bg-primary"
              />
            ) : mark.kind === "email" ? (
              <Icon
                key="email"
                name="link"
                className="size-3 flex-none text-ink-2"
              />
            ) : (
              <span
                key="phone"
                className="flex h-4 max-w-20 min-w-0 items-center gap-0.5 rounded-full border border-primary/50 px-1 font-mono text-[0.6875rem] tabular-nums text-ink-mark"
              >
                <Icon name="mobile" className="size-2.5 flex-none" />
                <span className="truncate">{sidesText(mark.values)}</span>
              </span>
            ),
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-60 flex-col items-start gap-2 p-3 text-[0.75rem]"
      >
        <p className="m-0 text-foreground">
          {origin === undefined ? "Mixed" : ORIGIN_LABEL[origin]}
        </p>
        {other === undefined ? null : (
          <button
            type="button"
            title={`Switch to ${onMobile ? "desktop" : "mobile"}`}
            className="-mx-1.5 flex min-h-6 items-center gap-1 rounded-sm px-1.5 text-ink-2 hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => {
              editor.setStage(onMobile ? "desktop" : "mobile");
            }}
          >
            <Icon
              name={onMobile ? "desktop" : "mobile"}
              className="size-3 flex-none"
            />
            {onMobile ? "Desktop" : "Mobile"}
            {other}
          </button>
        )}
        {resets.length === 0 ? null : (
          <div className="-mx-2 flex flex-wrap gap-1">
            {resets.map((reset) => (
              <Button
                key={reset.label}
                variant="ghost"
                size="xs"
                className="text-ink-mark hover:bg-primary/10 hover:text-ink-mark"
                onClick={reset.run}
              >
                {reset.label}
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The four sides, in the order CSS writes them. */
const BOX_SIDES = ["top", "right", "bottom", "left"] as const;

/** How far an arrow key moves a side, and how far with Shift. */
const BOX_STEP = 1;
const BOX_SHIFT_STEP = 8;

/** One value for each of these props, keyed by name. */
export function valuesOf(
  moved: readonly ControlDescriptor[],
  value: unknown,
): Record<string, unknown> {
  return Object.fromEntries(moved.map((control) => [control.name, value]));
}

/** The sides one descriptor is, as a list. */
function sidesOf(control: ControlDescriptor): readonly BoxSide[] {
  if (control.side === undefined) return [];
  return typeof control.side === "string" ? [control.side] : control.side;
}

/** Four numbers as a tail — ", 16" when they agree, ", 8 16 8 16" if not. */
function sidesSuffix(values: readonly unknown[]): string {
  const text = sidesText(values);
  return text === "" ? "" : `, ${text}`;
}

/** Four numbers as a word — "16" when they agree, "8 16 8 16" if not. */
function sidesText(values: readonly unknown[]): string {
  const [first] = values;
  return values.every((value) => Object.is(value, first))
    ? valueText(first)
    : values.map(String).join(" ");
}

/**
 * A Box: up to four sides of spacing, edited as one thing (ADR-0040).
 *
 * Locked exactly when every side reads the same on this Stage. Nothing stores
 * it, so an undo that makes the sides uneven unlocks it too. While it is
 * locked, a side moves every side. Locking an uneven Box writes the side the
 * Author touched last, or the top, to every side, as one Pending Change and so
 * one undo step. On mobile that is every side's Mobile Override at once.
 *
 * ⌥ changes one side alone, which is the way to break a locked Box.
 */
function BoxControl({
  sides,
  editor,
  onMobile,
}: {
  readonly sides: readonly ControlDescriptor[];
  readonly editor: Editor;
  readonly onMobile: boolean;
}): ReactNode {
  const subscribe = useCallback(
    (onChange: () => void) => editor.subscribeToPendingChange(onChange),
    [editor],
  );
  const read = (): PendingChange | undefined => editor.getPendingChange();
  const pending = useSyncExternalStore(subscribe, read, read);
  // Example UI state, never stored: which side a lock copies.
  const [touched, setTouched] = useState<BoxSide>();

  const [first] = sides;
  if (!first) return null;
  const { blockId } = first;
  const holderOf = (side: BoxSide): ControlDescriptor | undefined =>
    sides.find((control) => sidesOf(control).includes(side));
  const locked = sides.every((control) =>
    Object.is(numberOf(control.value), numberOf(first.value)),
  );
  const shown = (control: ControlDescriptor): number => {
    const dragged =
      pending?.blockId === blockId
        ? pending.ops.find((op) => op.prop === control.name)?.value
        : undefined;
    return numberOf(dragged ?? control.value);
  };

  const clamp = clampTo(first.constraints);
  const step = numberOf(first.constraints?.["step"], 1);

  /** The props a change to this side moves: all of them, while locked. */
  const movedBy = (
    side: BoxSide,
    alone: boolean,
  ): readonly ControlDescriptor[] => {
    const holder = holderOf(side);
    if (!holder) return [];
    return locked && !alone ? sides : [holder];
  };
  /** Every side at once, as one Pending Change: one Op per prop, one step. */
  const writeAll = (values: Readonly<Record<string, unknown>>): void => {
    if (editor.setPendingChange(blockId, values)) editor.commitPendingChange();
  };

  const write = (side: BoxSide, value: number, alone: boolean): void => {
    setTouched(side);
    const moved = movedBy(side, alone);
    const next = clamp(value);
    if (moved.length === 1) moved[0]?.set(next);
    else writeAll(valuesOf(moved, next));
  };

  const lock = (): void => {
    if (locked) return;
    const from = holderOf(touched ?? "top") ?? first;
    writeAll(valuesOf(sides, numberOf(from.value)));
  };

  const scrub =
    (side: BoxSide) =>
    (event: ReactPointerEvent<HTMLElement>): void => {
      const holder = holderOf(side);
      if (!holder) return;
      setTouched(side);
      const moved = movedBy(side, event.altKey);
      const start = numberOf(holder.value);
      scrubFrom(event, {
        move: (steps) => {
          editor.setPendingChange(
            blockId,
            valuesOf(moved, clamp(start + steps * step)),
          );
        },
        commit: () => {
          editor.commitPendingChange();
        },
        cancel: () => {
          editor.cancelPendingChange();
        },
      });
    };

  const label = boxLabel(first.box ?? "");
  const present = BOX_SIDES.filter((side) => holderOf(side) !== undefined);

  // One set of marks for the whole Box, read off its sides.
  const origins = new Set(sides.map((control) => control.origin));
  const [origin] = origins;
  const overridden = sides.filter((control) => control.origin === "override");
  const others = present.map((side) => holderOf(side)?.otherStage?.value);
  const showOther =
    sides.every((control) => control.otherStage !== undefined) &&
    (onMobile ||
      sides.some((control) => control.otherStage?.origin === "override"));
  const definition = editor.getDefinition(editor.getBlock(blockId)?.type ?? "");
  const defaults = sides.map(
    (control) => definition?.schema[control.name]?.defaultValue,
  );
  const resets: { label: string; run: () => void }[] = [];
  if (overridden.length > 0) {
    resets.push({
      label: `Use desktop${sidesSuffix(others)}`,
      run: () => {
        editor.clearMobileOverride(
          blockId,
          overridden.map((control) => control.name),
        );
      },
    });
  }
  if (
    sides.some((control, index) => !Object.is(control.value, defaults[index]))
  ) {
    resets.push({
      label: "Reset to default",
      // On desktop, dropping the Block's own values lands on the default. On
      // mobile that would land on desktop, so the default is set outright.
      run: () => {
        writeAll(
          Object.fromEntries(
            sides.map((control, index) => [
              control.name,
              onMobile ? defaults[index] : undefined,
            ]),
          ),
        );
      },
    });
  }

  return (
    <div className="not-first:mt-2.5" {...fieldOf(sides)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <span className={LABEL}>{label}</span>
          <OriginPopover
            label={label}
            marks={originMarks(
              present.flatMap((side) => holderOf(side) ?? []),
              onMobile,
            )}
            origin={origins.size === 1 ? origin : undefined}
            {...(showOther ? { other: sidesSuffix(others) } : {})}
            resets={resets}
            editor={editor}
            onMobile={onMobile}
          />
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(locked ? "text-primary" : "text-muted-foreground")}
          aria-pressed={locked}
          aria-label={`Lock ${label.toLowerCase()} sides`}
          title={
            locked
              ? "Locked: every side is the same. Hold ⌥ to change one side."
              : "Lock: give every side the one you changed last"
          }
          onClick={lock}
        >
          <Icon name={locked ? "link" : "unlink"} />
        </Button>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1.5">
        {present.map((side) => {
          const holder = holderOf(side);
          return holder ? (
            <BoxSideField
              key={side}
              side={side}
              field={fieldKey(holder.blockId, holder.name)}
              label={`${label}, ${side}`}
              value={shown(holder)}
              unit={textOf(holder.constraints?.["unit"])}
              write={(value, alone) => {
                write(side, value, alone);
              }}
              scrub={scrub(side)}
            />
          ) : null;
        })}
      </div>
      <SuggestedValues controls={sides} labelled />
      <FieldDiagnostics controls={sides} editor={editor} onMobile={onMobile} />
    </div>
  );
}

/**
 * One side of a Box: a short label that scrubs, over a box that takes typing
 * and the arrow keys. Arrows step by 1, and by 8 with Shift.
 */
function BoxSideField({
  side,
  field,
  label,
  value,
  unit,
  write,
  scrub,
}: {
  readonly side: BoxSide;
  /** The `blockId:prop` this side writes, so a Diagnostic can focus it. */
  readonly field: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  /** `alone` when ⌥ is held: this side only, even on a locked Box. */
  readonly write: (value: number, alone: boolean) => void;
  readonly scrub: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactNode {
  const id = useId();
  const [typed, setTyped] = useState<string>();

  const save = (alone: boolean): void => {
    if (typed === undefined) return;
    setTyped(undefined);
    const next = Number(typed);
    if (typed.trim() !== "" && Number.isFinite(next) && next !== value) {
      write(next, alone);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <label
        htmlFor={id}
        title="Drag to change"
        className="cursor-ew-resize touch-none text-center text-[0.6875rem] text-muted-foreground capitalize select-none hover:text-foreground"
        onPointerDown={scrub}
      >
        {side}
      </label>
      <Input
        id={id}
        data-field={field}
        aria-label={label}
        inputMode="numeric"
        className="h-7 w-full bg-card px-1 text-center font-mono tabular-nums"
        value={typed ?? String(value)}
        {...(unit === "" ? {} : { title: `${String(value)}${unit}` })}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
        onBlur={() => {
          save(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") save(event.altKey);
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const by = event.shiftKey ? BOX_SHIFT_STEP : BOX_STEP;
          setTyped(undefined);
          write(value + (event.key === "ArrowUp" ? by : -by), event.altKey);
        }}
      />
    </div>
  );
}

/**
 * A value as a short tail for a line of text — ", 30" — or nothing for one
 * that does not read as a word, like an Asset.
 */
function valueSuffix(value: unknown): string {
  const text = valueText(value);
  return text === "" ? "" : `, ${text}`;
}

/** A value as a short word — "30", "on", "#ffffff" — or nothing. */
function valueText(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value !== "string") return "";
  return value.length > 14 ? `${value.slice(0, 13)}…` : value;
}

/** Three or six digits, which is everything a native colour input will take. */
const HEX = /^#[\da-f]{3}([\da-f]{3})?$/iu;

function Control({
  control,
  editor,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly editor: Editor;
  /** Where the value comes from, drawn after the control's label. */
  readonly mark?: ReactNode;
}): ReactNode {
  switch (control.kind) {
    case SchemaKind.richText: {
      const type = editor.getBlock(control.blockId)?.type ?? "";
      const name = editor.getDefinition(type)?.label ?? control.label;
      return (
        <div className="mt-1.5 flex items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-2">
          <Icon
            name="text"
            className="mt-px size-3.5 flex-none text-muted-foreground"
          />
          <p className="m-0 text-[0.75rem]/[1.5] text-muted-foreground">
            Double-click the {name.toLowerCase()} on the email to change its
            words.
          </p>
          {mark}
        </div>
      );
    }

    case SchemaKind.asset: {
      return <AssetControl control={control} editor={editor} mark={mark} />;
    }

    // Two values in one control, because a surface with no colour is a state a
    // native colour input cannot hold: `<input type="color">` takes hex and
    // nothing else, so `transparent` reaches it as an invalid value and it
    // shows black — the one colour the Author definitely did not choose. So the
    // well is drawn here and the input sits invisibly on top of it, which also
    // gives "no colour" somewhere honest to be: a chequerboard.
    // Two kinds, one control, and one difference: only a surface can be
    // emptied. Ink cannot — `color: none` is not a colour, and a heading whose
    // text colour an Author cleared would emit exactly that.
    case SchemaKind.color: {
      return <ColorControl control={control} mark={mark} />;
    }

    case SchemaKind.surface: {
      return <ColorControl control={control} clearable mark={mark} />;
    }

    // A width is a number with a ceiling the library works out from the row —
    // so it needs no control of its own, only the same one pointed at
    // constraints that move. Dragging past the end stops where the neighbour
    // runs out rather than where the Schema said a hundred was.
    case SchemaKind.number:
    case SchemaKind.width: {
      return <NumberControl control={control} mark={mark} />;
    }

    case SchemaKind.select: {
      if (isVisibility(control)) {
        return (
          <ButtonsControl control={control} mark={mark} draw={drawVisibility} />
        );
      }
      return fitsButtonRow(choicesOf(control.constraints)) ? (
        <ButtonsControl control={control} mark={mark} />
      ) : (
        <SelectControl control={control} mark={mark} />
      );
    }

    case SchemaKind.boolean: {
      // Structural mobile behaviour — stacking, reversing, hiding — arrives as
      // an ordinary boolean prop and needs no special control (ADR-0007).
      return <BooleanControl control={control} mark={mark} />;
    }

    case SchemaKind.align: {
      return <AlignControl control={control} mark={mark} />;
    }

    default: {
      // `text`, `url`, and any kind this example has never met.
      return (
        <Field
          label={control.label}
          type={control.kind === SchemaKind.url ? "url" : "text"}
          multiline={control.constraints?.["multiline"] === true}
          value={textOf(control.value)}
          commit={control.set}
          mark={mark}
          {...placeholderOf(control)}
        />
      );
    }
  }
}

/** A hint for an empty text box, where its kind or name suggests one. */
function placeholderOf(control: ControlDescriptor): {
  readonly placeholder?: string;
} {
  if (control.kind === SchemaKind.url)
    return { placeholder: "https://example.com" };
  if (control.name === "language") return { placeholder: "e.g. en" };
  return {};
}

type Choice = ReturnType<typeof choicesOf>[number];

/**
 * A select's options and where its value sits among them, for the dropdown
 * and the buttons alike.
 */
function choiceOf(control: ControlDescriptor): {
  readonly options: readonly Choice[];
  readonly selected: number;
  readonly custom: string | undefined;
} {
  const options = choicesOf(control.constraints);
  // Indices rather than the values themselves: an option is whatever the
  // Schema put there, a native select carries strings, and two of a
  // Consumer's labels may match.
  const selected = options.findIndex(
    (option) => option.value === control.value,
  );
  // A stored value the Schema does not list, such as a font from another
  // list. Shown so it is not mistaken for nothing, but not offered: picking
  // anything else is the only way out of it.
  const custom =
    selected < 0 && control.value !== undefined
      ? `Custom (${labelOf(control.value)})`
      : undefined;
  return { options, selected, custom };
}

/** One of a fixed set, named by the Schema. */
function SelectControl({
  control,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly mark?: ReactNode;
}): ReactNode {
  const id = useId();
  const { options, selected, custom } = choiceOf(control);

  // A Schema's `help` is passed through untouched, like its options.
  const help = control.constraints?.["help"];

  return (
    <Row
      label={control.label}
      htmlFor={id}
      mark={mark}
      {...(typeof help === "string" ? { hint: help } : {})}
    >
      <Select
        value={
          selected >= 0
            ? String(selected)
            : custom === undefined
              ? undefined
              : "custom"
        }
        onValueChange={(next) => {
          const option = options[Number(next)];
          if (option !== undefined) control.set(option.value);
        }}
      >
        <SelectTrigger id={id} size="sm" className="w-full bg-card">
          <SelectValue placeholder="Choose one" />
        </SelectTrigger>
        <SelectContent>
          {custom === undefined ? null : (
            <SelectItem value="custom" disabled>
              {custom}
            </SelectItem>
          )}
          {options.map((option, index) => (
            // Keyed by position: two of a Consumer's labels may match.
            <SelectItem key={String(index)} value={String(index)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

/** The screens a Block shows on, drawn: which devices each choice keeps. */
const VISIBILITY_ICONS: Readonly<Record<string, readonly string[]>> = {
  all: ["desktop", "mobile"],
  desktop: ["desktop"],
  mobile: ["mobile"],
};

/** A Show on choice as the devices it keeps. */
function drawVisibility(option: Choice): ReactNode {
  return (VISIBILITY_ICONS[labelOf(option.value)] ?? []).map((icon) => (
    <Icon key={icon} name={icon} className="size-3.5" />
  ));
}

/**
 * Whether a select chooses screens: every option is one of `all`, `desktop`
 * or `mobile`. Read off the options, not the prop's name, so a column's,
 * which cannot be mobile only, is drawn the same with one fewer choice.
 */
function isVisibility(control: ControlDescriptor): boolean {
  const options = choicesOf(control.constraints);
  return (
    options.length > 1 &&
    options.every(
      (option) =>
        typeof option.value === "string" &&
        Object.hasOwn(VISIBILITY_ICONS, option.value),
    )
  );
}

/**
 * A short select as a row of buttons, so every choice is in view. Each button
 * shows its label, or what `draw` gives, such as Show on's device icons, with
 * the label then naming it for a tooltip and a screen reader.
 */
function ButtonsControl({
  control,
  mark,
  draw,
}: {
  readonly control: ControlDescriptor;
  readonly mark?: ReactNode;
  readonly draw?: (option: Choice) => ReactNode;
}): ReactNode {
  // A custom value presses no button, and is named under the row.
  const { options, selected, custom } = choiceOf(control);
  const help = control.constraints?.["help"];

  return (
    <Row
      label={control.label}
      mark={mark}
      {...(typeof help === "string" ? { hint: help } : {})}
    >
      <ToggleGroup
        type="single"
        spacing={0}
        variant="outline"
        size="sm"
        className="w-full"
        aria-label={control.label}
        value={selected < 0 ? "" : String(selected)}
        onValueChange={(next) => {
          // An empty string when the pressed one is pressed again. There is
          // no empty choice to clear to, so that changes nothing.
          const option = next === "" ? undefined : options[Number(next)];
          if (option !== undefined) control.set(option.value);
        }}
      >
        {options.map((option, index) => (
          <ToggleGroupItem
            key={String(index)}
            value={String(index)}
            {...(draw === undefined
              ? {}
              : { "aria-label": option.label, title: option.label })}
            className="flex-1 gap-0.5 data-[state=on]:bg-wash data-[state=on]:text-primary"
          >
            {draw === undefined ? option.label : draw(option)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {custom === undefined ? null : (
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">{custom}</p>
      )}
    </Row>
  );
}

/** On or off. A switch rather than a tick: these read as behaviour, not data. */
function BooleanControl({
  control,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly mark?: ReactNode;
}): ReactNode {
  const id = useId();

  return (
    <Row label={control.label} htmlFor={id} mark={mark}>
      <div className="flex justify-end">
        <Switch
          id={id}
          checked={control.value === true}
          onCheckedChange={(checked) => {
            control.set(checked);
          }}
        />
      </div>
    </Row>
  );
}

/** One of three, drawn rather than named — the options are all shapes. */
function AlignControl({
  control,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly mark?: ReactNode;
}): ReactNode {
  const options = optionsOf(control.constraints);

  return (
    <Row label={control.label} mark={mark}>
      <ToggleGroup
        type="single"
        spacing={0}
        variant="outline"
        size="sm"
        className="w-full"
        value={labelOf(control.value)}
        onValueChange={(next) => {
          // Radix hands back an empty string when the pressed item is pressed
          // again. An alignment always has a value, so that is a no-op rather
          // than a clear.
          const option = options.find((entry) => labelOf(entry) === next);
          if (option !== undefined) control.set(option);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={labelOf(option)}
            value={labelOf(option)}
            aria-label={ALIGN_LABELS[labelOf(option)] ?? labelOf(option)}
            title={ALIGN_LABELS[labelOf(option)] ?? labelOf(option)}
            className="flex-1 data-[state=on]:bg-wash data-[state=on]:text-primary"
          >
            <Icon
              name={sideOf(option, control.direction)}
              className="size-3.5"
            />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Row>
  );
}

/** What an Author reads for each stored alignment. */
const ALIGN_LABELS: Readonly<Record<string, string>> = {
  start: "Start",
  center: "Centre",
  end: "End",
};

/**
 * The side an alignment lands on, which is the icon to draw. `start` is the
 * right in a right-to-left email, so its icon is mirrored there (ADR-0027).
 */
function sideOf(
  value: unknown,
  direction: ControlDescriptor["direction"],
): string {
  const rtl = direction === "rtl";
  if (value === "start") return rtl ? "right" : "left";
  if (value === "end") return rtl ? "left" : "right";
  return labelOf(value);
}

/**
 * A colour, and the well that shows what it is.
 *
 * The well is this application's, not the browser's: a native colour input can
 * only hold a hex value, so "no colour" had nowhere to go and came out black.
 * The input is still there — it is what opens the picker — but it lies over the
 * well at zero opacity, so what an Author sees is drawn here.
 *
 * Dragging in the picker is a Pending Change: `input` previews, the native
 * `change` commits, Escape cancels. The Canvas follows the drag, and the whole
 * drag is one undo step. `control.value` stays the stored value until then, so
 * the well reads what is being dragged off the Pending Change. That way it
 * also lets go when something else ends the drag.
 */
function ColorControl({
  control,
  clearable = false,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly mark?: ReactNode;
  /**
   * Whether "no colour" is one of the answers — true for a surface, false for
   * ink. `NONE` is the value the Document stores for an emptied surface, and
   * writing it into a prop that becomes `color` or `border-color` would emit
   * the word rather than remove the declaration.
   */
  readonly clearable?: boolean;
}): ReactNode {
  const dragged = usePendingValue(control);
  const value = textOf(dragged ?? control.value, "#000000");
  const empty = clearable && value === NONE;
  // A colour with a background image over it is only seen when images are off.
  const background = backgroundOfColor(control.name);
  const behindImage = useEditorState(
    (current) =>
      background !== undefined &&
      assetOf(current.getBlock(control.blockId)?.props[background.image]) !==
        undefined,
  );

  // React's `onChange` is the native `input` event, which fires on every move.
  // The native `change` fires once, when the picker lets go, and React has no
  // prop for it.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = input.current;
    if (!element) return undefined;
    const end = (): void => {
      control.commit();
    };
    element.addEventListener("change", end);
    return () => {
      element.removeEventListener("change", end);
    };
  }, [control]);
  // What the picker opens on when there is no colour yet. White rather than
  // black: an Author reaching for a section's background wants paper more
  // often than ink.
  const picked = HEX.test(value) ? value : "#ffffff";

  return (
    <>
      <Row
        label={control.label}
        mark={mark}
        {...(behindImage ? { hint: "Shown when images are off" } : {})}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`relative size-7 shrink-0 overflow-hidden rounded-md border transition-transform hover:scale-105 ${
              empty ? "checkerboard" : ""
            }`}
            style={empty ? undefined : { background: value }}
          >
            <input
              ref={input}
              className="color-well-input"
              type="color"
              aria-label={control.label}
              value={picked}
              onChange={(event) => {
                control.preview(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || dragged === undefined) return;
                event.preventDefault();
                control.cancel();
              }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <Field
              label={control.label}
              bare
              type="text"
              className="font-mono tabular-nums lowercase"
              value={value}
              commit={(entered) => {
                // Cleared as well as read: without a way back a colour could be
                // set and never removed, and every surface in the Preset starts
                // with none. `transparent` is taken too, because an Author who
                // knows CSS will type it and meant the same thing. Ink refuses
                // all three and keeps the colour it had.
                const text = entered.trim().toLowerCase();
                if (text === NONE || text === "transparent" || text === "") {
                  if (clearable) control.set(NONE);
                } else if (HEX.test(text)) {
                  control.set(text);
                }
              }}
            />
          </div>
          {dragged !== undefined &&
          control.against !== undefined &&
          control.name === TEXT_COLOR ? (
            <ContrastMeter color={value} against={control.against} />
          ) : null}
        </div>
      </Row>
      <Swatches control={control} value={value} />
    </>
  );
}

/**
 * The colours an Author can pick in one click: the Consumer's Brand Colours,
 * then the ones already in this email. The hex field above still takes any
 * other. A swatch stores its colour, never its name, so a brand that changes
 * its list leaves this email as it is.
 */
function Swatches({
  control,
  value,
}: {
  readonly control: ControlDescriptor;
  readonly value: string;
}): ReactNode {
  const editor = useEditor();
  const { constraints } = control;
  const brand = useMemo(() => brandColorsOf(constraints), [constraints]);
  const root = useEditorState((current) => current.getDocument().root);
  const inEmail = useMemo(
    () =>
      colorsInEmail(
        root,
        editor.getDefinitions(),
        brand.map((color) => color.value),
      ),
    [root, editor, brand],
  );
  const current = canonical(value);
  if (brand.length === 0 && inEmail.length === 0) return null;
  const pick = (color: string) => () => {
    control.set(color);
  };
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {brand.length > 0 ? (
        <SwatchRow label="Brand">
          {brand.map((color) => (
            <Swatch
              key={color.value + color.label}
              color={color.value}
              name={`${color.label} ${color.value}`}
              picked={canonical(color.value) === current}
              onPick={pick(color.value)}
            />
          ))}
        </SwatchRow>
      ) : null}
      {inEmail.length > 0 ? (
        <SwatchRow label="In this email">
          {inEmail.map((color) => (
            <Swatch
              key={color}
              color={color}
              name={color}
              picked={color === current}
              onPick={pick(color)}
            />
          ))}
        </SwatchRow>
      ) : null}
    </div>
  );
}

/**
 * One labelled row of swatches, on the same grid as a {@link Row}. The chips
 * are pulled left by their inset, so the first lines up with the field above.
 */
function SwatchRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-[minmax(0,1fr)_8.75rem] items-start gap-x-2.5"
    >
      <span className={cn(LABEL, "pt-1.5")}>{label}</span>
      <div className="-ml-1 flex min-w-0 flex-wrap">{children}</div>
    </div>
  );
}

/** One colour to pick. A 28px target round a smaller chip. */
function Swatch({
  color,
  name,
  picked,
  onPick,
}: {
  readonly color: string;
  readonly name: string;
  readonly picked: boolean;
  readonly onPick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={picked}
      onClick={onPick}
      className="group/swatch flex size-7 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        className={cn(
          "size-5 rounded-sm border transition-transform duration-[var(--duration-quick)] group-hover/swatch:scale-110",
          picked && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        )}
        style={{ background: color }}
      />
    </button>
  );
}

/**
 * The prop the Preset's Blocks keep their text colour in, the one lekh's
 * contrast check reads. A border or a divider line is not text, and needs no
 * 4.5:1. The email's own text colour is left out too: most text sits in a
 * Section's column, not on the page behind the email.
 */
const TEXT_COLOR = "color";

/**
 * How readable a colour being dragged is against the Surface behind it.
 *
 * Only while dragging. The Diagnostic under the field reads the stored
 * Document, so it updates when the drag is let go (ADR-0032). This keeps the
 * Author from picking blind until then.
 */
function ContrastMeter({
  color,
  against,
}: {
  readonly color: string;
  readonly against: string;
}): ReactNode {
  const ratio = contrastOf(color, against);
  if (ratio === undefined) return null;
  const readable = ratio >= READABLE;
  return (
    <span
      role="status"
      title={
        readable
          ? "Readable against what is behind it"
          : `Hard to read: below ${String(READABLE)}:1`
      }
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-1.5 font-mono text-[0.75rem] tabular-nums",
        readable ? "text-muted-foreground" : "border-warn/40 text-warn",
      )}
    >
      <span
        aria-hidden
        className="flex size-5 items-center justify-center rounded-sm border text-[0.6875rem] font-semibold"
        style={{ background: against, color }}
      >
        Aa
      </span>
      {ratio.toFixed(1)}:1
      <Icon
        name={readable ? "check" : "warning"}
        className="size-3 flex-none"
      />
    </span>
  );
}

/**
 * The value a control is being dragged to, or `undefined` when no drag on it
 * is open.
 */
function usePendingValue(control: ControlDescriptor): unknown {
  const editor = useEditor();
  const subscribe = useCallback(
    (onChange: () => void) => editor.subscribeToPendingChange(onChange),
    [editor],
  );
  const read = (): unknown =>
    editor
      .getPendingChange()
      ?.ops.find(
        (op) => op.blockId === control.blockId && op.prop === control.name,
      )?.value;
  return useSyncExternalStore(subscribe, read, read);
}

/** How far the pointer travels for one step of a scrubbed number. */
const SCRUB_PX = 3;

/** A number held to a control's `min` and `max`, where it has them. */
export function clampTo(
  constraints: ControlDescriptor["constraints"],
): (next: number) => number {
  const min = numberOf(constraints?.["min"], Number.NaN);
  const max = numberOf(constraints?.["max"], Number.NaN);
  return (next) => {
    const floored = Number.isFinite(min) ? Math.max(next, min) : next;
    return Number.isFinite(max) ? Math.min(floored, max) : floored;
  };
}

/**
 * Drag a label to change a number: `move` hears how many steps the pointer
 * has travelled, the release commits, and Escape cancels.
 */
function scrubFrom(
  event: ReactPointerEvent<HTMLElement>,
  on: {
    readonly move: (steps: number) => void;
    readonly commit: () => void;
    readonly cancel: () => void;
  },
): void {
  dragFrom(event, {
    ...on,
    move: (dx) => {
      on.move(Math.round(dx / SCRUB_PX));
    },
  });
}

/**
 * A number, as a box on the row whose label is also the drag handle.
 *
 * Scrubbing the label is a Pending Change: each move previews, the release
 * commits, and Escape cancels. So the Canvas follows the drag and the whole
 * drag is one undo step. Typing writes once, on Return or when the box is
 * left: a number half typed is not one to show on the Canvas.
 */
function NumberControl({
  control,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly mark?: ReactNode;
}): ReactNode {
  const id = useId();
  const dragged = usePendingValue(control);
  const value = numberOf(dragged ?? control.value);
  const min = numberOf(control.constraints?.["min"], Number.NaN);
  const max = numberOf(control.constraints?.["max"], Number.NaN);
  const clamp = clampTo(control.constraints);
  const step = numberOf(control.constraints?.["step"], 1);
  const unit = textOf(control.constraints?.["unit"]);

  // Only the text in the box while the Author types into it.
  const [typed, setTyped] = useState<string>();

  const save = (): void => {
    if (typed === undefined) return;
    setTyped(undefined);
    const next = Number(typed);
    if (typed.trim() !== "" && Number.isFinite(next) && next !== value) {
      control.set(next);
    }
  };

  const scrub = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = value;
    scrubFrom(event, {
      move: (steps) => {
        control.preview(clamp(start + steps * step));
      },
      commit: () => {
        control.commit();
      },
      cancel: control.cancel,
    });
  };

  return (
    <div>
      <Row label={control.label} htmlFor={id} scrub={scrub} mark={mark}>
        {/* The unit rides inside the box rather than beside it. It is part of
            the reading — 36px, not 36 and separately px — and a column of its
            own would have taken width off every other control on the panel. */}
        <div className="relative">
          <Input
            id={id}
            type="number"
            className={cn(
              "h-7 w-full bg-card px-2 text-right font-mono tabular-nums",
              unit === "" ? "" : "pr-7",
            )}
            {...(Number.isFinite(min) ? { min } : {})}
            {...(Number.isFinite(max) ? { max } : {})}
            step={step}
            value={typed ?? value}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
          />
          {unit === "" ? null : (
            <Meta className="pointer-events-none absolute inset-y-0 right-2 grid place-items-center">
              {unit}
            </Meta>
          )}
        </div>
      </Row>
    </div>
  );
}

/**
 * A field that writes when the Author has finished with it, not per keystroke.
 *
 * Setting a prop is an Op, and an Op is an undo entry — a field that wrote on
 * every character would make ⌘Z take the word back one letter at a time, and
 * would re-render the whole email between letters. The entry is held here
 * until the field is left or Return is pressed.
 *
 * A multi-line field is a `Stack` and a single-line one is a `Row`, because a
 * four-row textarea in a 9rem column is not a control anybody can write in.
 * `bare` is for the one case that is neither — the hex box, which already has a
 * label on the row it shares with its colour well.
 */
function Field({
  label,
  bare = false,
  type,
  multiline = false,
  value,
  commit,
  placeholder,
  className,
  mark,
}: {
  readonly label: string;
  readonly bare?: boolean;
  readonly type: string;
  readonly multiline?: boolean;
  readonly value: string;
  readonly commit: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly mark?: ReactNode;
}): ReactNode {
  const id = useId();
  const [draft, setDraft] = useState(value);
  // When the stored value moves under us — an undo, a Diagnostic's repair —
  // the entry follows it rather than sitting on a stale draft.
  const [stored, setStored] = useState(value);
  if (stored !== value) {
    setStored(value);
    setDraft(value);
  }

  const shared = {
    id,
    value: draft,
    "aria-label": label,
    ...(placeholder === undefined ? {} : { placeholder }),
    onBlur: () => {
      commit(draft);
    },
  };

  if (multiline) {
    return (
      <Stack label={label} htmlFor={id} mark={mark}>
        <Textarea
          {...shared}
          rows={4}
          className={cn("bg-card text-sm/[1.6]", className)}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      </Stack>
    );
  }

  const input = (
    <Input
      {...shared}
      type={type}
      className={cn("h-7 w-full bg-card px-2", className)}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(draft);
      }}
    />
  );

  return bare ? (
    input
  ) : (
    <Row label={label} htmlFor={id} mark={mark}>
      {input}
    </Row>
  );
}

/**
 * An Asset, edited as the one value it is.
 *
 * The location, the intrinsic dimensions and the alternative text live in a
 * single prop, so changing the alt text afterwards is an ordinary `set` with a
 * changed Asset — no second hook, and no upload (ADR-0010). Choosing a
 * different image is the same hook every other route uses.
 */
function AssetControl({
  control,
  editor,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly editor: Editor;
  readonly mark?: ReactNode;
}): ReactNode {
  const asset = assetOf(control.value);
  // An optional Asset — a section's background — is chosen and removed. The
  // Primary Asset is the Block itself, so it is only ever replaced.
  if (control.primary !== true) {
    return (
      <OptionalAssetControl control={control} editor={editor} mark={mark} />
    );
  }

  return (
    <>
      <Stack label={control.label} mark={mark}>
        {asset ? (
          // A group, so the button that replaces it can lie over the image
          // rather than under it: the picture is the control here, and a row of
          // chrome beneath it would say otherwise.
          <figure className="group relative m-0 overflow-hidden rounded-md border bg-card">
            <img
              src={asset.src}
              alt=""
              className="block h-auto max-h-40 w-full object-cover"
            />
            {/* The intrinsic size, over the picture rather than under it. The
                gradient is what keeps it readable on a light photograph. */}
            <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pt-7 pb-1.5">
              <Meta className="text-white/90">
                {asset.width} × {asset.height}
              </Meta>
            </figcaption>
            <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-[var(--duration-land)] group-hover:opacity-100 group-focus-within:opacity-100">
              <Button
                size="sm"
                onClick={() => {
                  editor.replaceImage(control.blockId, "replace");
                }}
              >
                <Icon name="swap" className="size-3.5" />
                Replace
              </Button>
            </span>
          </figure>
        ) : (
          <button
            type="button"
            className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-border bg-card/50 px-3 py-5 text-muted-foreground transition-colors hover:border-primary hover:bg-wash hover:text-ink-mark focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => {
              editor.replaceImage(control.blockId, "add");
            }}
          >
            <Icon name="image" className="size-5" />
            <span className="text-[0.75rem]">Choose an image</span>
          </button>
        )}
      </Stack>
      {asset ? (
        <Field
          label="Alt text"
          type="text"
          value={asset.alt ?? ""}
          placeholder="Describe the image"
          commit={(alt) => {
            const next: Asset = {
              src: asset.src,
              width: asset.width,
              height: asset.height,
              ...(alt === "" ? {} : { alt }),
            };
            control.set(next);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * An Asset the Block may hold or not, such as a section's background image.
 *
 * "Choose image", or "Replace" once one is set, raises an `"add"` or
 * `"replace"` request for this prop, so the picture resolves before it lands
 * like any other (ADR-0026). "Remove" is a plain reset: clearing needs no
 * request. No alt text: a background is decoration.
 */
function OptionalAssetControl({
  control,
  editor,
  mark,
}: {
  readonly control: ControlDescriptor;
  readonly editor: Editor;
  readonly mark?: ReactNode;
}): ReactNode {
  const asset = assetOf(control.value);
  const choose = (): void => {
    editor.replaceImage(control.blockId, "replace", control.name);
  };
  const background = backgroundOfImage(control.name);

  return (
    <Stack
      label={control.label}
      mark={mark}
      {...(background ? { hint: renderingOf(background.fit) } : {})}
    >
      {asset ? (
        <div className="flex items-center gap-2">
          <img
            src={asset.src}
            alt=""
            className="size-10 shrink-0 rounded border object-cover"
          />
          <Button size="sm" variant="outline" onClick={choose}>
            <Icon name="swap" className="size-3.5" />
            Replace
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              control.reset();
            }}
          >
            Remove
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card/50 px-3 py-2.5 text-muted-foreground transition-colors hover:border-primary hover:bg-wash hover:text-ink-mark focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={choose}
        >
          <Icon name="image" className="size-4" />
          <span className="text-[0.75rem]">Choose image</span>
        </button>
      )}
    </Stack>
  );
}

function textOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function numberOf(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}
