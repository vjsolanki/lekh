import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

import {
  clampSize,
  DOCK_LEFT,
  DOCK_RIGHT,
  keyedSize,
  readSize,
  roomAt,
  type Room,
  type SizeBounds,
} from "./layout";

/**
 * How much room the window has, as the panels read it. Follows the window as
 * it is resized.
 */
export function useRoom(): Room {
  const [room, setRoom] = useState(() => roomAt(windowWidth()));

  useEffect(() => {
    // Absent outside a browser, where the room never changes.
    if (typeof globalThis.matchMedia !== "function") return undefined;
    const queries = [DOCK_LEFT, DOCK_RIGHT].map((width) =>
      globalThis.matchMedia(`(min-width: ${String(width)}px)`),
    );
    const onChange = (): void => {
      setRoom((current) => {
        const next = roomAt(windowWidth());
        // The same object when nothing moved, so nothing downstream re-runs.
        return next.left === current.left && next.right === current.right
          ? current
          : next;
      });
    };
    for (const query of queries) query.addEventListener("change", onChange);
    return () => {
      for (const query of queries) {
        query.removeEventListener("change", onChange);
      }
    };
  }, []);

  return room;
}

function windowWidth(): number {
  return globalThis.innerWidth ?? DOCK_LEFT;
}

/**
 * A size the Author set, kept in this browser for next time.
 *
 * Storage can be missing or full, and the editor works the same without it:
 * the size just isn't remembered.
 */
export function useRememberedSize(
  key: string,
  bounds: SizeBounds,
): readonly [number, (size: number) => void] {
  const [size, setSize] = useState(() => readSize(stored(key), bounds));

  const set = useCallback(
    (next: number) => {
      const clamped = clampSize(next, bounds);
      setSize(clamped);
      try {
        globalThis.localStorage.setItem(key, String(clamped));
      } catch {
        // Not remembered, and still resized.
      }
    },
    [key, bounds],
  );

  return [size, set] as const;
}

function stored(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The handle on a panel's edge, or between the two halves of one.
 *
 * Visible before it is found: a short bar sits on the edge, and the whole edge
 * lights up under the pointer. It takes focus, so the arrows move it, Shift
 * moves it further, and Home and End go to either end. A double-click puts it
 * back where it started.
 *
 * `edge` is where it sits on the panel it resizes. A grip on a panel's leading
 * edge grows it when dragged away from the email, so the arrows run the other
 * way there. `scale` turns pixels into the size's own unit, for a split kept
 * as a share of the panel's height.
 */
export function Grip({
  label,
  edge,
  size,
  bounds,
  onSize,
  scale,
}: {
  readonly label: string;
  readonly edge: "left" | "right" | "top" | "bottom";
  readonly size: number;
  readonly bounds: SizeBounds;
  readonly onSize: (size: number) => void;
  /** Units per pixel, read when a drag starts. One when left out. */
  readonly scale?: () => number;
}): ReactNode {
  const [dragging, setDragging] = useState(false);
  const across = edge === "top" || edge === "bottom";
  const direction = edge === "left" || edge === "top" ? -1 : 1;

  const begin = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = across ? event.clientY : event.clientX;
    const from = size;
    const perPixel = scale?.() ?? 1;
    setDragging(true);

    const onMove = (moved: PointerEvent): void => {
      const at = across ? moved.clientY : moved.clientX;
      onSize(clampSize(from + (at - start) * direction * perPixel, bounds));
    };
    const onUp = (): void => {
      setDragging(false);
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      globalThis.removeEventListener("pointercancel", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // A split moves on Up and Down, a column on Left and Right.
    const ours = across
      ? event.key !== "ArrowLeft" && event.key !== "ArrowRight"
      : event.key !== "ArrowUp" && event.key !== "ArrowDown";
    if (!ours) return;
    const next = keyedSize(size, event.key, event.shiftKey, bounds, direction);
    if (next === undefined) return;
    event.preventDefault();
    onSize(next);
  };

  return (
    // The WAI-ARIA window splitter: a focusable separator with a value.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={across ? "horizontal" : "vertical"}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(size * 100) / 100}
      title={`${label}. Double-click to reset.`}
      data-dragging={dragging}
      className={cn(
        "group/grip absolute z-30 touch-none focus-visible:outline-none",
        across
          ? "inset-x-0 h-3 cursor-ns-resize"
          : "inset-y-0 w-3 cursor-ew-resize",
        edge === "top" && "-top-1.5",
        edge === "bottom" && "-bottom-1.5",
        edge === "left" && "-left-1.5",
        edge === "right" && "-right-1.5",
      )}
      onPointerDown={begin}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onSize(bounds.fallback);
      }}
    >
      {/* The rule: the edge itself, lit while it is being used. */}
      <span
        className={cn(
          "absolute bg-transparent transition-colors duration-[var(--duration-quick)]",
          "group-hover/grip:bg-primary group-focus-visible/grip:bg-primary group-data-[dragging=true]/grip:bg-primary",
          across
            ? "inset-x-0 top-1/2 h-px -translate-y-1/2"
            : "inset-y-0 left-1/2 w-px -translate-x-1/2",
        )}
      />
      {/* The bar: there before the pointer is, so the edge can be found. */}
      <span
        className={cn(
          "absolute top-1/2 left-1/2 -translate-1/2 rounded-full bg-border transition-colors duration-[var(--duration-quick)]",
          "group-hover/grip:bg-primary group-focus-visible/grip:bg-primary group-focus-visible/grip:ring-2 group-focus-visible/grip:ring-ring/40 group-data-[dragging=true]/grip:bg-primary",
          across ? "h-1 w-8" : "h-8 w-1",
        )}
      />
    </div>
  );
}
