import { describe, expect, it } from "vitest";
import type { Action } from "lekh";

import { canUndoAccept } from "./receipt";

const selected: Action = { via: "pointer", blocks: [], inserted: [] };
const edited: Action = { via: "command", blocks: ["h1"], inserted: [] };
const peer: Action = { via: "remote", blocks: ["b1"], inserted: [] };

describe("canUndoAccept", () => {
  it("offers Undo straight after the accept", () => {
    expect(canUndoAccept([])).toBe(true);
  });

  it("keeps Undo through Actions that only move the selection", () => {
    expect(canUndoAccept([selected, selected])).toBe(true);
  });

  it("hides Undo once an edit follows", () => {
    expect(canUndoAccept([selected, edited])).toBe(false);
  });

  it("hides Undo once a peer changes the email", () => {
    expect(canUndoAccept([peer])).toBe(false);
  });

  it("keeps it hidden after a later selection", () => {
    expect(canUndoAccept([edited, selected])).toBe(false);
  });
});
