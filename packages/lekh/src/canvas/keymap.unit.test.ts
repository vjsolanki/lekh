import { describe, expect, it } from "vitest";

import {
  defaultKeymap,
  firesWhileTyping,
  resolveCommand,
  type KeyStroke,
} from "./keymap";

/** One keystroke, with every modifier released unless it says otherwise. */
function key(partial: Partial<KeyStroke>): KeyStroke {
  return {
    key: "z",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...partial,
  };
}

/**
 * A keybinding resolves to a command name, so remapping is data rather than
 * code, and any binding can be disabled by mapping it to nothing.
 */
describe("the keymap", () => {
  it("resolves the default undo binding on each platform", () => {
    expect(
      resolveCommand(defaultKeymap, key({ key: "z", metaKey: true }), true),
    ).toBe("undo");
    expect(
      resolveCommand(defaultKeymap, key({ key: "z", ctrlKey: true }), false),
    ).toBe("undo");
  });

  it("treats Mod as Command on Apple platforms and Control elsewhere", () => {
    expect(
      resolveCommand(defaultKeymap, key({ key: "z", ctrlKey: true }), true),
    ).toBeUndefined();
    expect(
      resolveCommand(defaultKeymap, key({ key: "z", metaKey: true }), false),
    ).toBeUndefined();
  });

  it("distinguishes redo from undo by the Shift modifier", () => {
    expect(
      resolveCommand(
        defaultKeymap,
        key({ key: "Z", metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe("redo");
  });

  it("steps out on Escape, in on Enter, and along on the arrows", () => {
    expect(resolveCommand(defaultKeymap, key({ key: "Escape" }), true)).toBe(
      "stepOut",
    );
    expect(resolveCommand(defaultKeymap, key({ key: "Enter" }), true)).toBe(
      "selectFirstChild",
    );
    expect(resolveCommand(defaultKeymap, key({ key: "ArrowUp" }), true)).toBe(
      "selectPrevious",
    );
    expect(resolveCommand(defaultKeymap, key({ key: "ArrowDown" }), true)).toBe(
      "selectNext",
    );
  });

  it("leaves Shift+Enter and Shift+ArrowDown alone", () => {
    expect(
      resolveCommand(
        defaultKeymap,
        key({ key: "Enter", shiftKey: true }),
        true,
      ),
    ).toBeUndefined();
    expect(
      resolveCommand(
        defaultKeymap,
        key({ key: "ArrowDown", shiftKey: true }),
        true,
      ),
    ).toBeUndefined();
  });

  it("covers delete, duplicate and Block movement out of the box", () => {
    expect(resolveCommand(defaultKeymap, key({ key: "Backspace" }), true)).toBe(
      "delete",
    );
    expect(resolveCommand(defaultKeymap, key({ key: "Delete" }), true)).toBe(
      "delete",
    );
    expect(
      resolveCommand(defaultKeymap, key({ key: "d", metaKey: true }), true),
    ).toBe("duplicate");
    expect(
      resolveCommand(
        defaultKeymap,
        key({ key: "ArrowUp", metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe("moveUp");
    expect(
      resolveCommand(
        defaultKeymap,
        key({ key: "ArrowDown", metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe("moveDown");
  });

  it("lets a Consumer remap one binding without redeclaring the rest", () => {
    const keymap = { ...defaultKeymap, "Alt+u": "undo" as const };

    expect(resolveCommand(keymap, key({ key: "u", altKey: true }), true)).toBe(
      "undo",
    );
    expect(resolveCommand(keymap, key({ key: "z", metaKey: true }), true)).toBe(
      "undo",
    );
  });

  it("lets a Consumer disable a single binding", () => {
    const keymap = { ...defaultKeymap, "Mod+z": null };

    expect(
      resolveCommand(keymap, key({ key: "z", metaKey: true }), true),
    ).toBeUndefined();
    expect(resolveCommand(keymap, key({ key: "Backspace" }), true)).toBe(
      "delete",
    );
  });

  it("ignores a keystroke carrying a modifier the binding does not declare", () => {
    expect(
      resolveCommand(
        defaultKeymap,
        key({ key: "Backspace", metaKey: true }),
        true,
      ),
    ).toBeUndefined();
  });
});

/**
 * A keystroke inside a Block being typed into is mostly the Author writing,
 * not driving the editor — but undo is the exception the whole Text Engine
 * design turns on (ADR-0005).
 */
describe("keystrokes while an Author is typing", () => {
  it("lets undo and redo through", () => {
    expect(firesWhileTyping("undo")).toBe(true);
    expect(firesWhileTyping("redo")).toBe(true);
  });

  it("lets the Author out of the text they are in", () => {
    // Stepping out leaves the words first, so it has to reach them.
    expect(firesWhileTyping("stopEditing")).toBe(true);
    expect(firesWhileTyping("stepOut")).toBe(true);
  });

  it("holds everything that would act on the Block instead of the words", () => {
    for (const command of [
      "delete",
      "duplicate",
      "moveUp",
      "moveDown",
      "selectFirstChild",
      "selectPrevious",
      "selectNext",
    ] as const) {
      expect(firesWhileTyping(command)).toBe(false);
    }
  });
});
