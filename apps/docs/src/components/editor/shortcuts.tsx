import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CommandName } from "lekh-editor";
import { defaultKeymap } from "lekh-editor/canvas";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { Icon } from "./icons";
import { PanelTitle } from "./parts";

export const APPLE = /mac|iphone|ipad|ipod/iu.test(
  globalThis.navigator.platform,
);

/**
 * Every Command, as an Author reads it, in the order they meet them. A
 * `Record`, so a Command lekh adds fails the typecheck until it is named.
 */
export const COMMAND_LABELS: Readonly<Record<CommandName, string>> = {
  undo: "Undo",
  redo: "Redo",
  selectFirstChild: "Go into a block, or start typing",
  stepOut: "Leave the text, then up to the parent",
  stopEditing: "Stop editing the text",
  selectPrevious: "Select the block above",
  selectNext: "Select the block below",
  moveUp: "Move the selection up",
  moveDown: "Move the selection down",
  duplicate: "Duplicate the selection",
  delete: "Delete the selection",
};

/** Every Command, in the order above. */
export const COMMAND_ORDER: readonly CommandName[] = Object.keys(
  COMMAND_LABELS,
).filter((key): key is CommandName => key in COMMAND_LABELS);

/** One part of a binding as it is printed on a keycap. */
const GLYPHS: Readonly<Record<string, string>> = {
  mod: APPLE ? "⌘" : "Ctrl+",
  shift: APPLE ? "⇧" : "Shift+",
  alt: APPLE ? "⌥" : "Alt+",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
  enter: "↵",
  backspace: "⌫",
  delete: "Del",
};

/** `"Mod+Shift+z"` as an Author reads it: `⌘⇧Z`. */
export function display(binding: string): string {
  return binding
    .split("+")
    .map((part) => GLYPHS[part.toLowerCase()] ?? part.toUpperCase())
    .join("");
}

/**
 * The first key bound to a Command, as it is printed, if it has one. Read back
 * from the keymap the Canvas uses, so a label never advertises a key that does
 * something else.
 */
export function keysOf(command: CommandName): string | undefined {
  const binding = Object.entries(defaultKeymap).find(
    ([, bound]) => bound === command,
  )?.[0];
  return binding === undefined ? undefined : display(binding);
}

/** A tooltip that ends with the Command's key: `Move up (⌘⇧↑)`. */
export function withKeys(label: string, command: CommandName): string {
  const keys = keysOf(command);
  return keys === undefined ? label : `${label} (${keys})`;
}

/** Keys outside the keymap: the Text Engine's, and this example's own. */
const TEXT_KEYS: readonly { keys: string; does: string }[] = [
  { keys: display("Mod+b"), does: "Bold, while editing text" },
  { keys: display("Mod+i"), does: "Italic, while editing text" },
  { keys: display("Mod+u"), does: "Underline, while editing text" },
  { keys: display("Mod+k"), does: "Run a Command, or ask the agent" },
  { keys: display("Mod+0"), does: "Show the email at 100%" },
  { keys: display("Shift+\\"), does: "Hide or bring back both panels" },
  { keys: "?", does: "Show this list" },
];

const SHORTCUTS: readonly { keys: string; does: string }[] = [
  ...COMMAND_ORDER.flatMap((command) => {
    const keys = keysOf(command);
    return keys === undefined ? [] : [{ keys, does: COMMAND_LABELS[command] }];
  }),
  ...TEXT_KEYS,
];

/**
 * Every shortcut, behind a button in the status bar and on `?`.
 *
 * `?` is listened for in the email's frame as well as the page: a keystroke
 * inside an iframe never reaches the page around it.
 */
export function Shortcuts({
  className,
}: {
  readonly className?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);

  const onKey = useCallback((event: KeyboardEvent) => {
    if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (isTyping(event.target)) return;
    event.preventDefault();
    setOpen((current) => !current);
  }, []);
  useKeyAnywhere(onKey);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(className, "gap-1.5")}
          title="Keyboard shortcuts (?)"
        >
          <Icon name="command" className="size-3.5" />
          <span className="max-sm:hidden">Shortcuts</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 p-2">
        <PanelTitle>Keyboard</PanelTitle>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.does}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-ink-2">{shortcut.does}</span>
              <kbd className="keycap">{shortcut.keys}</kbd>
            </li>
          ))}
        </ul>
        <p className="mt-2 mb-0 border-t border-rule-soft pt-2 text-[0.75rem]/[1.5] text-muted-foreground">
          These work with the caret inside the email too. While you type, Enter
          and the arrows stay with the text.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Whether a keystroke is ⌘ and one key, or Ctrl and the key off Apple. Read
 * the same way the Keymap reads `Mod`.
 */
export function isModKey(event: KeyboardEvent, key: string): boolean {
  // A keystroke an input method is composing belongs to the input method.
  if (event.isComposing) return false;
  return (
    (APPLE ? event.metaKey : event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === key
  );
}

/**
 * Hear a keystroke wherever focus is: the page, or any same-origin frame in
 * it, like the Canvas's. Key presses unless told `"keyup"`.
 *
 * Focus moving into a frame blurs the page's window and leaves the frame as
 * the active element, which is when its document is picked up.
 */
export function useKeyAnywhere(
  onKey: (event: KeyboardEvent) => void,
  type: "keydown" | "keyup" = "keydown",
): void {
  useEffect(() => {
    const heard = new Set<Document>();
    const listen = (target: Document): void => {
      if (heard.has(target)) return;
      heard.add(target);
      target.addEventListener(type, onKey);
    };
    const onBlur = (): void => {
      const active = document.activeElement;
      if (!(active instanceof HTMLIFrameElement)) return;
      // A cross-origin frame has no document to reach, and is not the email.
      if (active.contentDocument) listen(active.contentDocument);
    };

    listen(document);
    globalThis.addEventListener("blur", onBlur);
    return () => {
      globalThis.removeEventListener("blur", onBlur);
      for (const target of heard) target.removeEventListener(type, onKey);
    };
  }, [onKey, type]);
}

/** Whether a key is going into a field or the words of a Block. */
export function isTyping(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  // Checked by shape: an element in the frame fails `instanceof` here.
  const element = target as Partial<HTMLElement>;
  if (element.isContentEditable === true) return true;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
