import type { CommandName } from "../core/editor/commands";

/**
 * Which command each keystroke runs.
 *
 * A key is a `+`-separated binding such as `"Mod+Shift+z"`, where `Mod` is
 * Command on Apple platforms and Control everywhere else. Mapping a binding to
 * `null` disables it, so a Consumer can free a keystroke their application
 * already owns without redeclaring the rest of the map.
 */
export type Keymap = Readonly<Record<string, CommandName | null>>;

/**
 * The parts of a keyboard event a binding is matched against.
 *
 * Declared structurally rather than as `KeyboardEvent` so that matching stays
 * a pure function, testable without a DOM.
 */
export interface KeyStroke {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The keymap an editor uses unless a Consumer overrides it.
 *
 * Covers undo, redo, delete, duplicate, Block movement, and moving the
 * selection in, out and along, which is the set an Author expects to work
 * without being taught. Escape steps out one level at a time, so it leaves a
 * Block's text first, as `stopEditing` does.
 */
export const defaultKeymap: Keymap = {
  "Mod+z": "undo",
  "Mod+Shift+z": "redo",
  "Mod+y": "redo",
  Backspace: "delete",
  Delete: "delete",
  "Mod+d": "duplicate",
  "Mod+Shift+ArrowUp": "moveUp",
  "Mod+Shift+ArrowDown": "moveDown",
  Escape: "stepOut",
  Enter: "selectFirstChild",
  ArrowUp: "selectPrevious",
  ArrowDown: "selectNext",
};

/** Which command a keystroke runs, if any. */
export function resolveCommand(
  keymap: Keymap,
  stroke: KeyStroke,
  applePlatform: boolean,
): CommandName | undefined {
  for (const [text, command] of Object.entries(keymap)) {
    if (command === null) continue;
    const binding = parseBinding(text);
    if (binding && matches(binding, stroke, applePlatform)) return command;
  }
  return undefined;
}

/**
 * Whether a command may still fire while an Author is typing.
 *
 * Undo and redo must: history is one timeline, so ⌘Z has to revert the last
 * thing that happened whether that was a drag or a sentence, and routing it by
 * focus is exactly the mistake ADR-0005 exists to avoid. So must leaving the
 * text, which is only ever run from inside it, and stepping out, whose first
 * rung is leaving the text. Everything else has to stand aside — Backspace
 * inside a paragraph deletes a character, not the Block, and Enter splits it.
 */
export function firesWhileTyping(command: CommandName): boolean {
  return (
    command === "undo" ||
    command === "redo" ||
    command === "stopEditing" ||
    command === "stepOut"
  );
}

/**
 * Whether a command is the one that backs out, so on the Canvas it cancels an
 * open Pending Change before anything else (ADR-0032).
 */
export function backsOut(command: CommandName): boolean {
  return command === "stopEditing" || command === "stepOut";
}

/** Whether `Mod` should mean Command rather than Control. */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/iu.test(platform);
}

interface Binding {
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
}

function parseBinding(text: string): Binding | undefined {
  let mod = false;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let key: string | undefined;

  for (const part of text.split("+")) {
    switch (part.trim().toLowerCase()) {
      case "mod":
        mod = true;
        break;
      case "ctrl":
      case "control":
        ctrl = true;
        break;
      case "meta":
      case "cmd":
        meta = true;
        break;
      case "alt":
      case "option":
        alt = true;
        break;
      case "shift":
        shift = true;
        break;
      default:
        key = part.trim().toLowerCase();
    }
  }

  return key === undefined || key === ""
    ? undefined
    : { mod, ctrl, meta, alt, shift, key };
}

/**
 * Modifiers are matched exactly, so `Backspace` does not fire for
 * `Command+Backspace` — a Consumer's own shortcut keeps working.
 */
function matches(
  binding: Binding,
  stroke: KeyStroke,
  applePlatform: boolean,
): boolean {
  return (
    // Shift reports `Z` rather than `z`, so the key is compared case-blind.
    stroke.key.toLowerCase() === binding.key &&
    stroke.ctrlKey === (binding.ctrl || (binding.mod && !applePlatform)) &&
    stroke.metaKey === (binding.meta || (binding.mod && applePlatform)) &&
    stroke.altKey === binding.alt &&
    stroke.shiftKey === binding.shift
  );
}
