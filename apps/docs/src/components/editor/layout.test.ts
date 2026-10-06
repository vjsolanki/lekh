import { describe, expect, it } from "vitest";

import {
  collapseOrRestore,
  dismissOnEmail,
  flipToInspector,
  initialPanels,
  keyedSize,
  readSize,
  roomAt,
  showTab,
  toggle,
  type Panels,
} from "./layout";

const WIDTH = { min: 260, max: 440, fallback: 320, step: 8 };

describe("keyedSize", () => {
  it("steps by the step, and by four steps with Shift", () => {
    expect(keyedSize(320, "ArrowRight", false, WIDTH)).toBe(328);
    expect(keyedSize(320, "ArrowLeft", true, WIDTH)).toBe(288);
  });

  it("stays between the bounds", () => {
    expect(keyedSize(436, "ArrowRight", true, WIDTH)).toBe(440);
    expect(keyedSize(262, "ArrowLeft", false, WIDTH)).toBe(260);
  });

  it("goes to either end on Home and End", () => {
    expect(keyedSize(320, "Home", false, WIDTH)).toBe(260);
    expect(keyedSize(320, "End", false, WIDTH)).toBe(440);
  });

  it("leaves every other key alone", () => {
    expect(keyedSize(320, "a", false, WIDTH)).toBeUndefined();
  });

  it("can run the other way, for a grip on a leading edge", () => {
    expect(keyedSize(320, "ArrowLeft", false, WIDTH, -1)).toBe(328);
  });

  it("reads Up and Down on a split", () => {
    expect(keyedSize(320, "ArrowDown", false, WIDTH)).toBe(328);
    expect(keyedSize(320, "ArrowUp", false, WIDTH)).toBe(312);
  });
});

describe("readSize", () => {
  it("reads a stored number back, kept between the bounds", () => {
    expect(readSize("400", WIDTH)).toBe(400);
    expect(readSize("900", WIDTH)).toBe(440);
  });

  it("falls back when nothing usable is stored", () => {
    expect(readSize(null, WIDTH)).toBe(320);
    expect(readSize("wide", WIDTH)).toBe(320);
  });
});

describe("roomAt", () => {
  it("docks both sides from 1280px", () => {
    expect(roomAt(1280)).toEqual({ left: "docked", right: "docked" });
  });

  it("floats the left panel below 1280px", () => {
    expect(roomAt(1279)).toEqual({ left: "floating", right: "docked" });
  });

  it("floats both below 1024px", () => {
    expect(roomAt(1023)).toEqual({ left: "floating", right: "floating" });
  });
});

const wide = roomAt(1440);
const laptop = roomAt(1100);
const narrow = roomAt(800);

const closed: Panels = {
  left: undefined,
  sections: { add: true, layers: true },
  right: undefined,
  stashed: undefined,
};

describe("initialPanels", () => {
  it("opens Add, Layers and the Inspector on a wide screen", () => {
    const panels = initialPanels(wide);
    expect(panels.left).toBe("build");
    expect(panels.sections).toEqual({ add: true, layers: true });
    // The Inspector's tab, not the agent's: the agent opens when asked.
    expect(panels.right).toBe("inspector");
  });

  it("keeps the floating left panel shut on a laptop", () => {
    const panels = initialPanels(laptop);
    expect(panels.left).toBeUndefined();
    expect(panels.right).toBe("inspector");
  });

  it("opens nothing over the email on a small screen", () => {
    const panels = initialPanels(narrow);
    expect(panels.left).toBeUndefined();
    expect(panels.right).toBeUndefined();
  });
});

describe("toggle", () => {
  it("opens the left panel on the section pressed", () => {
    const panels = toggle(closed, "layers", wide);
    expect(panels.left).toBe("build");
    expect(panels.sections.layers).toBe(true);
  });

  it("hides one section and keeps the other", () => {
    const open = { ...closed, left: "build" as const };
    const panels = toggle(open, "add", wide);
    expect(panels.left).toBe("build");
    expect(panels.sections).toEqual({ add: false, layers: true });
  });

  it("closes the panel when its last section goes", () => {
    const open = {
      ...closed,
      left: "build" as const,
      sections: { add: false, layers: true },
    };
    const panels = toggle(open, "layers", wide);
    expect(panels.left).toBeUndefined();
    // Pressing either again brings the panel back with something in it.
    expect(toggle(panels, "add", wide).sections.add).toBe(true);
  });

  it("swaps the left panel for a source view, and back", () => {
    const open = { ...closed, left: "build" as const };
    const markup = toggle(open, "markup", wide);
    expect(markup.left).toBe("markup");
    expect(toggle(markup, "markup", wide).left).toBeUndefined();
    expect(toggle(markup, "add", wide).left).toBe("build");
  });

  it("keeps docked panels open beside each other", () => {
    const panels = toggle({ ...closed, right: "agent" }, "add", wide);
    expect(panels).toMatchObject({ left: "build", right: "agent" });
  });

  it("keeps the docked Inspector when the left panel floats", () => {
    const panels = toggle({ ...closed, right: "inspector" }, "add", laptop);
    expect(panels).toMatchObject({ left: "build", right: "inspector" });
  });

  it("opens the right column on the tab pressed", () => {
    expect(toggle(closed, "agent", wide).right).toBe("agent");
    expect(toggle(closed, "inspector", wide).right).toBe("inspector");
  });

  it("swaps tabs in the one column, and closes it on the tab showing", () => {
    const inspector = { ...closed, right: "inspector" as const };
    const agent = toggle(inspector, "agent", wide);
    expect(agent.right).toBe("agent");
    expect(toggle(agent, "inspector", wide).right).toBe("inspector");
    expect(toggle(agent, "agent", wide).right).toBeUndefined();
  });

  it("opens one overlay at a time", () => {
    const left = toggle(closed, "add", narrow);
    const inspector = toggle(left, "inspector", narrow);
    expect(inspector).toMatchObject({ left: undefined, right: "inspector" });
    const agent = toggle(inspector, "agent", narrow);
    expect(agent).toMatchObject({ right: "agent" });
    expect(toggle(agent, "document", narrow)).toMatchObject({
      left: "document",
      right: undefined,
    });
  });
});

describe("showTab", () => {
  it("opens the column on a tab, or leaves it showing", () => {
    expect(showTab(closed, "agent", wide).right).toBe("agent");
    const open = { ...closed, right: "agent" as const };
    expect(showTab(open, "agent", wide)).toBe(open);
    expect(showTab(open, "inspector", wide).right).toBe("inspector");
  });

  it("puts a floating left panel away for it", () => {
    const left = toggle(closed, "add", narrow);
    expect(showTab(left, "agent", narrow)).toMatchObject({
      left: undefined,
      right: "agent",
    });
  });
});

describe("flipToInspector", () => {
  it("swaps the agent's tab for the Inspector", () => {
    expect(flipToInspector({ ...closed, right: "agent" }).right).toBe(
      "inspector",
    );
  });

  it("leaves a closed column closed", () => {
    expect(flipToInspector(closed)).toBe(closed);
  });
});

describe("dismissOnEmail", () => {
  it("closes the floating left panel", () => {
    const open = {
      ...closed,
      left: "build" as const,
      right: "inspector" as const,
    };
    expect(dismissOnEmail(open, laptop)).toMatchObject({
      left: undefined,
      right: "inspector",
    });
  });

  it("leaves a docked one where it is", () => {
    const open = { ...closed, left: "build" as const };
    expect(dismissOnEmail(open, wide)).toBe(open);
  });
});

describe("collapseOrRestore", () => {
  it("closes both sides, then puts them back", () => {
    const open: Panels = { ...closed, left: "markup", right: "agent" };
    const collapsed = collapseOrRestore(open, wide);
    expect(collapsed).toMatchObject({ left: undefined, right: undefined });
    expect(collapseOrRestore(collapsed, wide)).toMatchObject({
      left: "markup",
      right: "agent",
      stashed: undefined,
    });
  });

  it("opens the defaults when nothing was stashed", () => {
    expect(collapseOrRestore(closed, wide)).toMatchObject({
      left: "build",
      right: "inspector",
    });
  });

  it("restores one overlay at most on a small screen", () => {
    const open: Panels = { ...closed, left: "build", right: "inspector" };
    const restored = collapseOrRestore(collapseOrRestore(open, wide), narrow);
    expect(
      [restored.left !== undefined, restored.right !== undefined].filter(
        Boolean,
      ),
    ).toHaveLength(1);
  });
});
