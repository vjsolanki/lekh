import type { ReactNode } from "react";
import type { BlockDefinition, Editor } from "lekh";
import {
  useEditor,
  usePalette,
  usePaletteDrag,
  type PaletteEntry,
} from "lekh/canvas";

import { ScrollArea } from "@/components/ui/scroll-area";

import { Icon } from "./icons";
import { Band } from "./parts";

/**
 * The Blocks this editor offers.
 *
 * `usePalette` returns data only, and leaves out exactly one thing: a Block
 * whose Definition declares itself structural, which belongs to its parent
 * rather than to an Author. `column` is the one here, and it is reached through
 * the row that owns it — see the Inspector's Add buttons.
 *
 * Everything else arrives, root type included. Dropping the root and sorting
 * the rest into groups are this application's decisions rather than the
 * library's, and both are read off the Definitions rather than hand-maintained:
 * a Block that accepts children is a container, and one marked required is
 * compliance.
 */
export function Palette({
  rootType,
}: {
  readonly rootType: string;
}): ReactNode {
  const editor = useEditor();
  const entries = usePalette().filter((entry) => entry.type !== rootType);
  const groups = GROUPS.map((group) => ({
    ...group,
    entries: entries.filter(
      (entry) => groupOf(editor.getDefinition(entry.type)) === group.id,
    ),
  })).filter((group) => group.entries.length > 0);

  return (
    <ScrollArea className="min-h-0 flex-1">
      {groups.map((group) => (
        <Band key={group.id} title={group.label}>
          {/* Two to a row, so the whole rack is reachable without a scroll. */}
          <div className="grid grid-cols-2 gap-1.5">
            {group.entries.map((entry) => (
              <PaletteBlock
                key={entry.type}
                entry={entry}
                locked={editor.getDefinition(entry.type)?.deletable === false}
              />
            ))}
          </div>
        </Band>
      ))}
    </ScrollArea>
  );
}

type GroupId = "layout" | "content" | "compliance";

// Named only. The panel's own line says what dragging one does and the
// padlocks say which are required, so a hint per group buries the Blocks.
const GROUPS: readonly {
  readonly id: GroupId;
  readonly label: string;
}[] = [
  { id: "layout", label: "Layout" },
  { id: "content", label: "Content" },
  { id: "compliance", label: "Compliance" },
];

function groupOf(definition: BlockDefinition | undefined): GroupId {
  if (definition?.required === true) return "compliance";
  return definition?.accepts === undefined ? "content" : "layout";
}

/**
 * One draggable Block.
 *
 * Not a shadcn Button: this is a drag handle first and a button second, so it
 * carries `touch-action: none` and a grab cursor, and it has a fourth visual
 * state — being carried — that no button variant has a name for.
 */
function PaletteBlock({
  entry,
  locked,
}: {
  readonly entry: PaletteEntry;
  readonly locked: boolean;
}): ReactNode {
  const editor = useEditor();
  const { dragHandleProps, isDragging } = usePaletteDrag(entry.type);

  return (
    <button
      type="button"
      data-dragging={isDragging}
      title={`Drag onto the email, or click to add it after the selection — ${entry.type}`}
      className={[
        "group relative flex cursor-grab touch-none flex-col items-center gap-1.5 rounded-md border bg-card px-1.5 py-2.5 text-ink-2",
        // Colour only. A tile that lifted on hover made the panel restless.
        "transition-[color,border-color] duration-[var(--duration-quick)]",
        "hover:border-primary/40 hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "data-[dragging=true]:cursor-grabbing data-[dragging=true]:border-dashed data-[dragging=true]:border-primary data-[dragging=true]:bg-wash data-[dragging=true]:text-ink-mark data-[dragging=true]:shadow-none",
      ].join(" ")}
      {...dragHandleProps}
      onClick={() => {
        addBlock(editor, entry.type);
      }}
    >
      {locked ? (
        <span
          className="absolute top-1.5 right-1.5 grid place-items-center"
          title="Required — cannot be deleted"
        >
          <Icon name="lock" className="size-3 text-muted-foreground" />
        </span>
      ) : null}
      <Icon name={entry.type} className="size-[18px] flex-none" />
      <span className="w-full truncate text-center text-[0.75rem] leading-tight">
        {entry.label}
      </span>
    </button>
  );
}

/**
 * Add a Block without dragging one.
 *
 * Giving no position is the whole of the difference from a drop: the library
 * puts it after whatever is selected, or at the end, and scrolls to it. Asking
 * for an Asset first where the Block needs one is its business too, so this is
 * one call and not a branch a Consumer has to know to write.
 */
function addBlock(editor: Editor, type: string): void {
  editor.place({ reason: "insert", type });
}
