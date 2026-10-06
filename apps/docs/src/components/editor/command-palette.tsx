import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { CommandName } from "lekh-editor";
import { useCommands, useEditorState } from "lekh-editor/canvas";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { Icon } from "./icons";
import {
  COMMAND_LABELS,
  COMMAND_ORDER,
  isModKey,
  keysOf,
  useKeyAnywhere,
} from "./shortcuts";

/** Ask the agent about one Block, or the whole email with none. */
export type AskAgent = (text: string, blockId: string | undefined) => void;

/**
 * One palette on ⌘K, for every Command and, with an agent plugged in, an ask.
 *
 * Typing a Command's name runs it. One that can't run is greyed, by its `can`
 * check, and each shows its key, read back from the Keymap. Anything else
 * typed is an ask about the selected Block, or the whole email with nothing
 * selected. With no `onAsk` it is a Command palette only.
 */
export function CommandPalette({
  onAsk,
}: {
  readonly onAsk?: AskAgent;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const title = onAsk ? "Run a Command, or ask the agent" : "Run a Command";
  // What the palette chose, run once it has closed and given focus back.
  const chosen = useRef<(() => void) | undefined>(undefined);
  // Where focus was when it opened. Radix gives focus back to a trigger, and
  // this palette has none, so the caret in a Block's text would be lost.
  const back = useRef<HTMLElement | undefined>(undefined);

  const onKey = useCallback((event: KeyboardEvent) => {
    if (!isModKey(event, "k")) return;
    event.preventDefault();
    // Only ever opens: once open, the palette hears ⌘K first and closes.
    back.current = focusedElement();
    setOpen(true);
  }, []);
  useKeyAnywhere(onKey);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        onKeyDown={(event) => {
          // Every key stays in the palette, wherever focus is in it: the
          // Canvas listens on the page too, and would take Backspace, Enter
          // and the arrows as Commands on the Block behind.
          event.stopPropagation();
        }}
        onEscapeKeyDown={(event) => {
          // Radix hears Esc first, on the way down. Stopped here, it closes
          // the palette and nothing else: the Canvas would step out of the
          // selected Block on it.
          event.stopPropagation();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          back.current?.focus({ preventScroll: true });
          back.current = undefined;
          // After focus goes back, so a Command that starts typing keeps the
          // caret it puts in the text.
          chosen.current?.();
          chosen.current = undefined;
        }}
      >
        <DialogPrimitive.Title className="sr-only">
          {title}
        </DialogPrimitive.Title>
        <PaletteBody
          title={title}
          onAsk={onAsk}
          onChoose={(run) => {
            chosen.current = run;
            setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The element with focus, looking inside the email's frame when focus is in
 * there. The page alone would say only "the frame".
 */
function focusedElement(): HTMLElement | undefined {
  const active = document.activeElement;
  const inner =
    active instanceof HTMLIFrameElement
      ? active.contentDocument?.activeElement
      : active;
  return inner && isFocusable(inner) ? inner : undefined;
}

/** Checked by shape: an element in the frame fails `instanceof` here. */
function isFocusable(element: Element): element is HTMLElement {
  return "focus" in element && typeof element.focus === "function";
}

function PaletteBody({
  title,
  onAsk,
  onChoose,
  onClose,
}: {
  readonly title: string;
  readonly onAsk: AskAgent | undefined;
  readonly onChoose: (run: () => void) => void;
  readonly onClose: () => void;
}): ReactNode {
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [moved, setMoved] = useState<number | undefined>(undefined);

  // One string, so this holds still unless a `can` flips.
  const canRun = useEditorState(() =>
    COMMAND_ORDER.map((command) => (commands.can[command]() ? "1" : "0")).join(
      "",
    ),
  );
  const selected = useEditorState((editor) => editor.getSelection());
  const scope = useEditorState((editor) => {
    const block =
      selected === undefined ? undefined : editor.getBlock(selected);
    return block && (editor.getDefinition(block.type)?.label ?? block.type);
  });
  const about =
    scope === undefined ? "the email" : `this ${scope.toLowerCase()}`;

  const entries: Entry[] = COMMAND_ORDER.map((command, index) => {
    const keys = keysOf(command);
    return {
      command,
      does: COMMAND_LABELS[command],
      ...(keys === undefined ? {} : { keys }),
      can: canRun[index] === "1",
    };
  });
  const rows = rowsFor(query, entries, onAsk !== undefined);
  const active =
    moved !== undefined && rows[moved] !== undefined && runs(rows[moved])
      ? moved
      : activeRow(rows);

  const choose = (row: Row | undefined): void => {
    if (!row || !runs(row)) return;
    if (row.kind === "ask") {
      onChoose(() => onAsk?.(row.text, selected));
      return;
    }
    const { command } = row.entry;
    onChoose(() => {
      commands[command]();
    });
  };

  /** The next row along that can run, wrapping round. */
  const step = (by: 1 | -1): void => {
    for (let count = 1; count <= rows.length; count += 1) {
      const index = (active + by * count + rows.length) % rows.length;
      const row = rows[index];
      if (row !== undefined && runs(row)) {
        setMoved(index);
        return;
      }
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (isModKey(event.nativeEvent, "k")) {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[active]);
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the keys are the input's, heard on their way out
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b px-3">
        <Icon
          name={onAsk ? "agent" : "command"}
          className="text-muted-foreground"
        />
        <input
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-rows"
          aria-activedescendant={
            active === -1 ? undefined : `command-palette-row-${String(active)}`
          }
          aria-label={title}
          placeholder={
            onAsk ? `Run a Command, or ask about ${about}…` : "Run a Command…"
          }
          value={query}
          className="h-11 min-w-0 flex-1 bg-transparent text-[0.875rem] outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setQuery(event.target.value);
            setMoved(undefined);
          }}
        />
        <kbd className="keycap">Esc</kbd>
      </div>

      <ul
        id="command-palette-rows"
        role="listbox"
        aria-label="Commands"
        className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-1"
        // A click keeps the caret in the input, so the keys stay there too.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
      >
        {rows.length === 0 ? (
          <li className="px-2 py-3 text-center text-[0.8125rem] text-muted-foreground">
            No Command matches.
          </li>
        ) : null}
        {rows.map((row, index) => (
          <li
            key={row.kind === "ask" ? "ask" : row.entry.command}
            id={`command-palette-row-${String(index)}`}
            role="option"
            aria-selected={index === active}
            aria-disabled={!runs(row)}
            className={cn(
              "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem]",
              index === active && "bg-wash text-ink-mark",
              !runs(row) && "text-muted-foreground opacity-60",
            )}
            onPointerMove={() => {
              if (runs(row) && index !== active) setMoved(index);
            }}
            onClick={() => {
              choose(row);
            }}
          >
            {row.kind === "ask" ? (
              <>
                <Icon name="agent" />
                <span className="min-w-0 flex-1 truncate">
                  Ask about {about}:{" "}
                  <span className="text-foreground">{row.text}</span>
                </span>
                <kbd className="keycap">↵</kbd>
              </>
            ) : (
              <>
                <Icon name="command" />
                <span className="min-w-0 flex-1 truncate">
                  {row.entry.does}
                </span>
                {row.entry.keys === undefined ? null : (
                  <kbd className="keycap">{row.entry.keys}</kbd>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

/** One Command, as the palette lists it. */
interface Entry {
  readonly command: CommandName;
  readonly does: string;
  /** Its key, as printed. None when the Keymap binds none. */
  readonly keys?: string;
  /** Its `can` check. A Command that can't run is greyed. */
  readonly can: boolean;
}

type Row =
  | { readonly kind: "command"; readonly entry: Entry }
  | { readonly kind: "ask"; readonly text: string };

/**
 * The Commands whose name or label holds every word typed, then an ask with
 * the text when an agent can take one. Nothing typed lists every Command.
 */
function rowsFor(
  query: string,
  entries: readonly Entry[],
  canAsk: boolean,
): readonly Row[] {
  const text = query.trim();
  const words = text.toLowerCase().split(/\s+/u).filter(Boolean);
  const matched = entries
    .filter((entry) => {
      const name = `${entry.does} ${entry.command}`.toLowerCase();
      return words.every((word) => name.includes(word));
    })
    .map((entry): Row => ({ kind: "command", entry }));
  return canAsk && text !== "" ? [...matched, { kind: "ask", text }] : matched;
}

/** Whether Enter on a row does anything. */
function runs(row: Row): boolean {
  return row.kind === "ask" || row.entry.can;
}

/** The row Enter runs before the arrows move: the first that can. -1 if none. */
function activeRow(rows: readonly Row[]): number {
  return rows.findIndex((row) => runs(row));
}
