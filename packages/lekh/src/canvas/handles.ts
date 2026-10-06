"use client";

import { createContext, useContext } from "react";

/**
 * The drag handles Consumers have registered, keyed by the Block each moves.
 *
 * The two sides meet here because they live on different clocks. A handle is
 * an element in the Consumer's Chrome, which mounts and unmounts as the
 * selection moves. A Block's draggable is made in one pass over the frame,
 * and made again whenever the Document changes. Neither can hold the other,
 * so both hold this.
 *
 * A Block has at most one handle in force: the last one registered. A Consumer
 * drawing two grips for one Block — a layers panel row and a grip in the
 * Chrome, say — gets the newer one, and the older one again once the newer
 * one goes.
 *
 * Whether any Block has a handle matters as much as which one does. Once one
 * does, every Block moves by its handle only (ADR-0043), so a handle arriving
 * or going can change every Block, not only its own.
 */
export interface DragHandleRegistry {
  /** The element in force as this Block's handle, if one is. */
  handleOf: (blockId: string) => Element | undefined;
  /** Whether any Block has a handle in force. */
  hasAny: () => boolean;
  /** Register a handle. The returned function withdraws that one only. */
  register: (blockId: string, element: Element) => () => void;
  /** Hear that a handle arrived or went. */
  subscribe: (listener: () => void) => () => void;
}

export function createDragHandleRegistry(): DragHandleRegistry {
  const handles = new Map<string, Element[]>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    handleOf: (blockId) => handles.get(blockId)?.at(-1),
    hasAny: () => handles.size > 0,
    register: (blockId, element) => {
      const stack = handles.get(blockId) ?? [];
      stack.push(element);
      handles.set(blockId, stack);
      notify();

      return () => {
        const current = handles.get(blockId);
        const index = current?.lastIndexOf(element) ?? -1;
        if (!current || index === -1) return;
        current.splice(index, 1);
        if (current.length === 0) handles.delete(blockId);
        notify();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const DragHandleContext = createContext<DragHandleRegistry | undefined>(
  undefined,
);

export const DragHandleContextProvider = DragHandleContext.Provider;

/** The registry the surrounding {@link EditorProvider} made. */
export function useDragHandleRegistry(): DragHandleRegistry | undefined {
  return useContext(DragHandleContext);
}
