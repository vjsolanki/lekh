/**
 * Which panels are open, and how big they are.
 *
 * Kept apart from the components so the rules can be read, and tested, as
 * rules: what a press opens, what floats over the email on a smaller screen,
 * and what ⇧\ puts back.
 */

/* ------------------------------------------------------------------ sizes */

/** How far a grip can go, where it starts, and how far a key moves it. */
export interface SizeBounds {
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
  readonly step: number;
}

/** Shift moves a grip this many steps at once. */
const SHIFT_STEPS = 4;

export function clampSize(value: number, bounds: SizeBounds): number {
  return Math.min(Math.max(value, bounds.min), bounds.max);
}

/**
 * Where a key moves a grip, or `undefined` for a key it ignores.
 *
 * Right and Down grow the size. `direction` is -1 for a grip on a panel's
 * leading edge, where moving left makes it wider.
 */
export function keyedSize(
  current: number,
  key: string,
  shift: boolean,
  bounds: SizeBounds,
  direction: 1 | -1 = 1,
): number | undefined {
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  const sign =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (sign === 0) return undefined;
  const step = bounds.step * (shift ? SHIFT_STEPS : 1);
  return clampSize(current + sign * direction * step, bounds);
}

/** A size read back from storage, or the fallback when there is none. */
export function readSize(stored: string | null, bounds: SizeBounds): number {
  const value = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(value) ? clampSize(value, bounds) : bounds.fallback;
}

/* ------------------------------------------------------------------- room */

/** Docked panels take room from the email. Floating ones sit over it. */
export type Dock = "docked" | "floating";

export interface Room {
  readonly left: Dock;
  readonly right: Dock;
}

/** Below this the left panel floats. */
export const DOCK_LEFT = 1280;
/** Below this the right column floats too. */
export const DOCK_RIGHT = 1024;

export function roomAt(width: number): Room {
  return {
    left: width >= DOCK_LEFT ? "docked" : "floating",
    right: width >= DOCK_RIGHT ? "docked" : "floating",
  };
}

/* ----------------------------------------------------------------- panels */

/** What the left panel shows: the building tools, or one source view. */
export type LeftView = "build" | "markup" | "document";

/** The right column's tabs. One column, so they share its width. */
export type RightTab = "inspector" | "agent";

export function isRightTab(value: string): value is RightTab {
  return value === "inspector" || value === "agent";
}

/** What a rail or top-bar button opens. */
export type PanelTarget = "add" | "layers" | "markup" | "document" | RightTab;

export interface Panels {
  readonly left: LeftView | undefined;
  /** Which halves of the building panel show. One alone takes the height. */
  readonly sections: { readonly add: boolean; readonly layers: boolean };
  /** The tab the right column shows, or none while it is closed. */
  readonly right: RightTab | undefined;
  /** What ⇧\ closed, to put back on the next press. */
  readonly stashed: Pick<Panels, "left" | "right"> | undefined;
}

/**
 * What opens first: everything that has room to sit beside the email. The
 * right column opens on the Inspector. The agent opens when asked, so the
 * email starts with the room.
 */
export function initialPanels(room: Room): Panels {
  return {
    left: room.left === "docked" ? "build" : undefined,
    sections: { add: true, layers: true },
    right: room.right === "docked" ? "inspector" : undefined,
    stashed: undefined,
  };
}

type Side = "left" | "right";

/** Which side a target lives on. */
function sideOf(target: PanelTarget): Side {
  return isRightTab(target) ? "right" : "left";
}

/** The sides open over the email right now. */
function floatingOpen(panels: Panels, room: Room): Side[] {
  return [
    ...(room.right === "floating" && panels.right !== undefined
      ? (["right"] as const)
      : []),
    ...(room.left === "floating" && panels.left !== undefined
      ? (["left"] as const)
      : []),
  ];
}

/** Close one side. */
function shut(panels: Panels, side: Side): Panels {
  return side === "right"
    ? { ...panels, right: undefined }
    : { ...panels, left: undefined };
}

/**
 * Only one panel ever floats over the email. `keep` is the one just opened,
 * and the other gives way to it. Without one, the first in `floatingOpen`'s
 * order stays.
 */
function oneOverlay(panels: Panels, room: Room, keep?: PanelTarget): Panels {
  const open = floatingOpen(panels, room);
  const kept = keep === undefined ? open[0] : sideOf(keep);
  return open
    .filter((side) => side !== kept)
    .reduce((settled, side) => shut(settled, side), panels);
}

/**
 * Press a rail or top-bar button. A right tab that is showing closes the
 * column. The other tab swaps in, in the same column.
 */
export function toggle(
  panels: Panels,
  target: PanelTarget,
  room: Room,
): Panels {
  const next = toggled(panels, target);
  return oneOverlay({ ...next, stashed: undefined }, room, target);
}

/** Open the right column on a tab. Leaves it be when that tab is showing. */
export function showTab(panels: Panels, tab: RightTab, room: Room): Panels {
  return panels.right === tab ? panels : toggle(panels, tab, room);
}

/**
 * The Inspector in place of the agent's tab, to review a Suggestion in the
 * fields it changes. A closed column stays closed.
 */
export function flipToInspector(panels: Panels): Panels {
  return panels.right === "agent" ? { ...panels, right: "inspector" } : panels;
}

function toggled(panels: Panels, target: PanelTarget): Panels {
  if (isRightTab(target)) {
    return { ...panels, right: panels.right === target ? undefined : target };
  }
  if (target === "markup" || target === "document") {
    return { ...panels, left: panels.left === target ? undefined : target };
  }
  if (panels.left !== "build") {
    return {
      ...panels,
      left: "build",
      sections: { ...panels.sections, [target]: true },
    };
  }
  const sections = { ...panels.sections, [target]: !panels.sections[target] };
  // Nothing left to show closes the panel, and the press that reopens it turns
  // its own half back on.
  return sections.add || sections.layers
    ? { ...panels, sections }
    : { ...panels, left: undefined, sections };
}

/** A click on the email puts the floating left panel away. */
export function dismissOnEmail(panels: Panels, room: Room): Panels {
  return room.left === "floating" && panels.left !== undefined
    ? { ...panels, left: undefined }
    : panels;
}

/** ⇧\: close both sides, or put back what the last press closed. */
export function collapseOrRestore(panels: Panels, room: Room): Panels {
  if (panels.left !== undefined || panels.right !== undefined) {
    return {
      ...panels,
      left: undefined,
      right: undefined,
      stashed: { left: panels.left, right: panels.right },
    };
  }
  const back = panels.stashed ?? initialPanels(roomAt(DOCK_LEFT));
  return oneOverlay(
    { ...panels, left: back.left, right: back.right, stashed: undefined },
    room,
  );
}

/** After the window changes size, at most one panel floats. */
export function settle(panels: Panels, room: Room): Panels {
  return oneOverlay(panels, room);
}
