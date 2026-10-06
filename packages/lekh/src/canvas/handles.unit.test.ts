import { describe, expect, it } from "vitest";

import { parseMarkup } from "../testing/markup";
import { createDragHandleRegistry } from "./handles";

const page = parseMarkup("").document;

const element = (name: string): Element => {
  const made = page.createElement("button");
  made.textContent = name;
  return made;
};

describe("the drag handle registry", () => {
  it("puts the newest handle in force, and the older one back when it goes", () => {
    const registry = createDragHandleRegistry();
    const row = element("row");
    const grip = element("grip");

    const withdrawRow = registry.register("a", row);
    const withdrawGrip = registry.register("a", grip);
    expect(registry.handleOf("a")).toBe(grip);

    withdrawGrip();
    expect(registry.handleOf("a")).toBe(row);
    withdrawRow();
    expect(registry.handleOf("a")).toBeUndefined();
  });

  it("withdraws only the handle it registered", () => {
    const registry = createDragHandleRegistry();
    const first = element("first");
    const withdraw = registry.register("a", first);
    withdraw();
    const second = element("second");
    registry.register("a", second);

    withdraw();
    expect(registry.handleOf("a")).toBe(second);
  });

  it("says whether any Block has a handle", () => {
    const registry = createDragHandleRegistry();
    expect(registry.hasAny()).toBe(false);

    const withdrawA = registry.register("a", element("grip"));
    const withdrawB = registry.register("b", element("grip"));
    expect(registry.hasAny()).toBe(true);
    withdrawA();
    expect(registry.hasAny()).toBe(true);
    withdrawB();
    expect(registry.hasAny()).toBe(false);
  });

  it("tells a listener each time a handle arrives or goes", () => {
    const registry = createDragHandleRegistry();
    let heard = 0;
    const unsubscribe = registry.subscribe(() => {
      heard += 1;
    });

    const withdraw = registry.register("a", element("grip"));
    registry.register("b", element("grip"));
    withdraw();
    unsubscribe();
    registry.register("c", element("grip"));

    expect(heard).toBe(3);
  });
});
