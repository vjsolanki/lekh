"use client";

import { Draggable } from "@dnd-kit/dom";
import { getFrameTransform, isElement } from "@dnd-kit/dom/utilities";
import { useDragDropManager, useDragDropMonitor } from "@dnd-kit/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type {
  DropRefusal,
  DropTarget,
  Point,
} from "../core/editor/drop-target";
import type { RenderCache } from "../core/render/render-tree";
import { CarriedPreview, carriedBlockOf, renderChrome } from "./chrome";
import { createCommands, type CommandName } from "../core/editor/commands";
import { actVia } from "../core/editor/editor";
import { useEditor } from "./context";
import { blockDraggableId, readDragPayload, type DragPayload } from "./drag";
import {
  easeIn,
  edgeScrollSpeed,
  fromFrame,
  intoFrame,
  paddingBoxOf,
  rectOf,
  scrollerOf,
  toCanvasSpacePoint,
  towardEdge,
} from "./geometry";
import { useDragHandleRegistry } from "./handles";
import { useArrivingImages } from "./images";
import { CanvasFrame } from "./frame";
import {
  backsOut,
  defaultKeymap,
  firesWhileTyping,
  isApplePlatform,
  resolveCommand,
  type Keymap,
} from "./keymap";
import { useBoxEdges } from "./boxes";
import { useBlockMeasurements } from "./measure";
import {
  blockRectsOf,
  useCanvasDragSession,
  useDragSessionState,
} from "./session";
import type { CanvasSlots } from "./slots";
import { useEditorState, useShownDocument, useSuggestions } from "./state";
import { useEditableText, type TextSelection } from "./text";
import {
  blockElementsIn,
  blockIdAt,
  renderCanvasBlock,
  type CanvasText,
} from "./tree";

export interface CanvasProps {
  /**
   * How wide the email is rendered on the desktop Stage, in CSS pixels or any
   * CSS length. Offering an Author a choice of widths is a matter of changing
   * it. The mobile Stage is a separate concept and is not this prop.
   */
  readonly width?: number | string;
  /**
   * How wide the frame is on the mobile Stage. Defaults to 375 — a phone.
   *
   * The frame really is this wide, so the email's media queries fire against it
   * and the Author is looking at a rendering rather than a simulation of one
   * (ADR-0003).
   */
  readonly mobileWidth?: number | string;
  /** The Chrome drawn over the Canvas. The library draws none of it. */
  readonly slots?: CanvasSlots;
  /**
   * Keybindings, merged over the default keymap. Map a binding to `null` to
   * disable it. The key bound to `stepOut` or `stopEditing` first cancels an
   * open Pending Change, when it is pressed on the Canvas.
   */
  readonly keymap?: Keymap;
  /**
   * Called when a drop was refused and nothing happened.
   *
   * The moment after the mid-drag refusal, for a Consumer who wants a toast, a
   * shake, or a count of how often Authors try something the email will not
   * take. Nothing is drawn for it — releasing somewhere off the Canvas is how
   * a drag is abandoned, and that is deliberately silent, so the only thing
   * left to report is this.
   */
  readonly onDropRefused?: (refusal: DropRefusal) => void;
  /**
   * How tall the Canvas is on screen, in CSS pixels or any CSS length.
   *
   * Give it one and the Canvas scrolls: it wraps itself in a scroller of this
   * height and grows to the email inside it. Leave it out and the Canvas is
   * simply as tall as the email, for a Consumer whose own layout already has
   * the overflow — a pane sized to the viewport, a pre-existing well.
   *
   * Either way the email and the Chrome drawn over it are inside the same
   * scroller, which is what keeps a selection outline welded to its Block while
   * an Author scrolls.
   *
   * This rather than a height in `style`, which applies to the Canvas element
   * itself and would clip the Chrome at the fold: the Chrome is positioned
   * against that element, so it has to be the height of the whole email.
   */
  readonly height?: number | string;
  /**
   * How large the email is drawn: `0.8` draws it at 80%. Defaults to 1.
   *
   * The email is still laid out at the Stage's true width, so its media
   * queries fire as they will when it is sent. Only the drawing changes, and
   * every Slot gets its rectangle at the drawn size. lekh does not decide what
   * "fit" means: measure your own room and pass a number (ADR-0039).
   */
  readonly zoom?: number;
  /**
   * The id of an open Suggestion to draw the email without, as though it had
   * never come: for an Author holding a button to compare before and after.
   *
   * View only. Nothing is stored, nothing is announced, and the Suggestion
   * stays open; its `suggestion` Slot is not drawn while it is held back. The
   * other open Suggestions are drawn as ever. An id that is not open draws
   * everything.
   */
  readonly showOriginal?: string;
  /** Accessible name for the frame the email renders in. */
  readonly title?: string;
  readonly className?: string;
  /**
   * Applied to the Canvas element — the sheet the email is drawn on, which is
   * as wide as the Stage and as tall as the Document.
   *
   * Not the scroller. Pass {@link CanvasProps.height} for that; a `height` here
   * clips the Chrome rather than producing a scrolling Canvas.
   */
  readonly style?: CSSProperties;
}

/** How close to an edge a drag has to come before the Canvas scrolls. */
const EDGE_SCROLL_ZONE = 48;
/** How far it scrolls per frame with the pointer pinned against the edge. */
const EDGE_SCROLL_SPEED = 12;
/** No drag, so nowhere to land: one empty list, so nothing re-renders. */
const NO_TARGETS: readonly DropTarget[] = [];

/**
 * The surface an Author edits their email on.
 *
 * The Document renders inside a same-origin iframe so that the Consumer's own
 * CSS cannot change what an Author sees and media queries resolve against the
 * email's width rather than the browser window (ADR-0003). Everything drawn
 * over it — selection outline, drop indicator, toolbars — comes from the
 * Consumer through a Slot, positioned by a rectangle this component has
 * already translated out of the frame's coordinate space.
 */
export function Canvas({
  width = 600,
  mobileWidth = 375,
  slots = {},
  keymap,
  onDropRefused,
  height,
  zoom: requestedZoom = 1,
  showOriginal,
  title = "Email canvas",
  className,
  style,
}: CanvasProps): ReactNode {
  const editor = useEditor();
  const manager = useDragDropManager();
  const session = useCanvasDragSession();
  const handles = useDragHandleRegistry();

  // What the Author is looking at, which during an Inspector drag or with a
  // Suggestion open is not yet what is stored.
  const emailDocument = useShownDocument(showOriginal);
  const suggestions = useSuggestions(showOriginal);
  const diagnostics = useEditorState((current) => current.getDiagnostics());
  const selection = useEditorState((current) => current.getSelection());
  const editing = useEditorState((current) => current.getEditing());
  const imageRequests = useEditorState((current) => current.getImageRequests());
  const stage = useEditorState((current) => current.getStage());

  // The Stage is a width and nothing else. The markup is identical on both, and
  // narrowing the frame is what makes the email's own mobile rules apply — so
  // what an Author sees on the mobile Stage is the rendering, not a preview of
  // one.
  const frameWidth = stage === "mobile" ? mobileWidth : width;
  // A zoom that could not draw anything is no zoom at all.
  const zoom =
    Number.isFinite(requestedZoom) && requestedZoom > 0 ? requestedZoom : 1;

  const canvasElement = useRef<HTMLDivElement | null>(null);
  const frameElement = useRef<HTMLIFrameElement | null>(null);
  const [frameDocument, setFrameDocument] = useState<Document | null>(null);

  const hovered = useEditorState((current) => current.getHovered());
  // Where the pointer last was, in the parent's viewport space, so that hover
  // can be re-resolved when the email moves and the pointer does not.
  const restingPointer = useRef<Point | undefined>(undefined);

  // The drag in flight, as the Chrome draws it. The pointer is left out: only
  // the refusal Slot follows it, and it reads the session itself.
  const carrying = useDragSessionState((current) => current?.getCarrying());
  const dropTarget = useDragSessionState((current) => current?.getDropTarget());
  const refusal = useDragSessionState((current) => current?.getRefusal());
  const isRefused = refusal !== undefined;
  // A file is only in the air while it is over somewhere: over a gap beside
  // the email it is still the Author's desktop drag, not one of ours, and the
  // Chrome has no reason to stand down for it.
  const fileOverNothing =
    carrying?.source === "file" && dropTarget === undefined && !isRefused;
  const carried = useMemo(
    () => (fileOverNothing ? undefined : carriedBlockOf(carrying)),
    [carrying, fileOverNothing],
  );

  // The Consumer's callback changes identity whenever they re-render, and the
  // handlers that reach it are registered against event streams — so the
  // latest one is held rather than threaded through every dependency array.
  const refusedCallback = useRef(onDropRefused);
  useEffect(() => {
    refusedCallback.current = onDropRefused;
  }, [onDropRefused]);

  const reportRefusal = useCallback((refused: DropRefusal) => {
    refusedCallback.current?.(refused);
  }, []);

  /**
   * The platform's own "not here", for as long as the drag is over somewhere
   * that will not take it.
   *
   * Set in both documents, because the pointer crosses between the Consumer's
   * page and the email and a cursor declared in one has no authority in the
   * other. Marked important: the drag backend runs a Cursor plugin of its own
   * (see `provider.tsx`), and this is the more specific claim about what the
   * pointer is currently doing.
   */
  useEffect(() => {
    if (!isRefused) return undefined;

    const elements = [
      globalThis.document.body,
      frameDocument?.documentElement,
    ].filter((element) => element !== undefined && element !== null);

    const restore = elements.map((element) => ({
      element,
      cursor: element.style.getPropertyValue("cursor"),
      priority: element.style.getPropertyPriority("cursor"),
    }));
    for (const { element } of restore) {
      element.style.setProperty("cursor", "not-allowed", "important");
    }

    return () => {
      for (const { element, cursor, priority } of restore) {
        if (cursor) element.style.setProperty("cursor", cursor, priority);
        else element.style.removeProperty("cursor");
      }
    };
  }, [isRefused, frameDocument]);
  // The Author's text selection, and where it is. Kept apart because the two
  // change for different reasons: the formatting on ⌘B, the rectangle on every
  // scroll of the email underneath it.
  const [textSelection, setTextSelection] = useState<TextSelection | undefined>(
    undefined,
  );
  const reportedSelection = useRef<TextSelection | undefined>(undefined);

  const reportTextSelection = useCallback(
    (reported: TextSelection | undefined) => {
      reportedSelection.current = reported;
      setTextSelection(reported);
    },
    [],
  );

  const { rects, standIns, textRect, measured, measure } = useBlockMeasurements(
    {
      canvasElement,
      frameElement,
      frameDocument,
      emailDocument,
      frameWidth,
      zoom,
      reportedSelection,
      textSelection,
    },
  );

  const boxEdges = useBoxEdges({
    editor,
    canvasElement,
    frameElement,
    frameDocument,
    emailDocument,
    selection,
    stage,
    zoom,
    rects,
  });

  // Selecting and hovering. The root is not selectable: with nothing selected
  // the Inspector already describes it, so clicking the email's background
  // clears the selection rather than picking the whole email.
  //
  // Everything else the press has to survive is `getSelectable`, which is why
  // this reads as one call. It is also the only thing that makes a row of
  // columns selectable at all: the Preset's row renders a table and each column
  // is a cell covering every pixel of it, so no press anywhere on a row lands
  // on the row. Drawing the selection Chrome wider would not have helped — the
  // press still meets a cell, and the Chrome layer does not take clicks.
  //
  // Hovering resolves through the same call, because the outline it draws is a
  // promise about what a press would do. An outline around a Block that cannot
  // be selected would be a lie the Author only finds out about by pressing it.
  useEffect(() => {
    if (!frameDocument) return undefined;
    const frameWindow = frameDocument.defaultView;

    const reach = (target: EventTarget | null): string | undefined => {
      const pressed = blockIdAt(target);
      const blockId =
        pressed === undefined ? undefined : editor.getSelectable(pressed);
      return blockId === emailDocument.root.id ? undefined : blockId;
    };

    const onPointerDown = (event: Event): void => {
      editor.select(reach(event.target), { via: "pointer" });
    };
    const onPointerMove = (event: Event): void => {
      // Kept in the parent's viewport space, which is the space that stays
      // still while the pointer does. The frame's own coordinates do not: the
      // frame slides under the cursor whenever the Consumer's scroller moves.
      const frame = frameElement.current;
      if (frame && frameWindow && event instanceof frameWindow.PointerEvent) {
        restingPointer.current = fromFrame(
          { x: event.clientX, y: event.clientY },
          rectOf(frame.getBoundingClientRect()),
          zoom,
        );
      }
      editor.hover(reach(event.target));
    };
    // Left the Canvas, not merely the email. Chrome drawn over the email,
    // like a grip in the hovered Block's corner, is outside the frame: leaving
    // the frame for it would drop the hover and take the grip away from under
    // the pointer reaching for it.
    const onPointerLeave = (): void => {
      restingPointer.current = undefined;
      editor.hover(undefined);
    };
    const canvas = canvasElement.current;

    /**
     * Re-resolve hover when the email moves under a stationary pointer.
     *
     * Without this, hover only ever changes on `pointermove`, so scrolling
     * without moving the mouse leaves the outline riding the Block it was on
     * while a different Block sits under the cursor — and the click that
     * follows selects the one the Author is looking at, not the one wearing
     * the outline.
     *
     * Not left to the browser to synthesise a boundary event for: browsers
     * disagree about whether one is dispatched when content moves beneath a
     * cursor that did not, and the outline pointing at the wrong Block is
     * exactly the bug.
     *
     * Capturing on the parent, so it hears whichever ancestor the Consumer
     * made their scroller. Cheap now — it hit-tests one point and measures
     * nothing.
     */
    const onScroll = (): void => {
      const pointer = restingPointer.current;
      const frame = frameElement.current;
      if (!pointer || !frame) return;
      const { x, y } = intoFrame(
        pointer,
        rectOf(frame.getBoundingClientRect()),
        zoom,
      );
      editor.hover(reach(frameDocument.elementFromPoint(x, y)));
    };

    frameDocument.addEventListener("pointerdown", onPointerDown);
    frameDocument.addEventListener("pointermove", onPointerMove);
    canvas?.addEventListener("pointerleave", onPointerLeave);
    globalThis.addEventListener("scroll", onScroll, true);
    return () => {
      frameDocument.removeEventListener("pointerdown", onPointerDown);
      frameDocument.removeEventListener("pointermove", onPointerMove);
      canvas?.removeEventListener("pointerleave", onPointerLeave);
      globalThis.removeEventListener("scroll", onScroll, true);
    };
  }, [frameDocument, editor, emailDocument, zoom]);

  // A Canvas that goes away takes its pointer with it, so a Layers row is not
  // left lit for a Block nobody is pointing at. Its own effect, because the one
  // above re-runs on every edit and hover has to survive those.
  useEffect(
    () => () => {
      editor.hover(undefined);
    },
    [editor],
  );

  // Typing into a Block is a thing an Author asks for, rather than the state
  // every text Block sits in. A single press selects, and a press that keeps
  // moving drags — so the caret has to be reached for, or the two gestures
  // would be the same gesture.
  //
  // The Block itself rather than `getSelectable`: `edit` refuses anything an
  // Author cannot select, and a double-click on a Block with no text at all is
  // refused there too. Nothing here needs to know which Blocks have words in
  // them.
  useEffect(() => {
    if (!frameDocument) return undefined;

    const onDoubleClick = (event: Event): void => {
      const blockId = blockIdAt(event.target);
      if (blockId !== undefined) {
        actVia(editor, "pointer", () => editor.edit(blockId));
      }
    };

    frameDocument.addEventListener("dblclick", onDoubleClick);
    return () => {
      frameDocument.removeEventListener("dblclick", onDoubleClick);
    };
  }, [frameDocument, editor]);

  // An email is mostly links, and an Author clicking one means "select this
  // Block" — never "take me there". Following it would replace the frame's
  // document, and the portal the Canvas renders through would go with it, so
  // one click on a Button would end the editing session (ADR-0003).
  useEffect(() => {
    if (!frameDocument) return undefined;

    const onClick = (event: Event): void => {
      const target = event.target;
      // A link the Text Engine drew may belong to the parent page's realm, so
      // `instanceof` against the frame's window would miss it.
      if (!isElement(target)) return;
      if (target.closest("a[href]")) event.preventDefault();
    };

    frameDocument.addEventListener("click", onClick, true);
    return () => {
      frameDocument.removeEventListener("click", onClick, true);
    };
  }, [frameDocument]);

  // Keybindings, in both documents: a keystroke inside an iframe never reaches
  // the parent, so binding only there would make undo stop working the moment
  // an Author clicked into the email (ADR-0003).
  const commands = useMemo(() => createCommands(editor), [editor]);
  const bindings = useMemo(() => ({ ...defaultKeymap, ...keymap }), [keymap]);

  useEffect(() => {
    const applePlatform = isApplePlatform(globalThis.navigator.platform);
    /** Whether a keystroke came from the email, or the Chrome drawn over it. */
    const isOnCanvas = (event: KeyboardEvent): boolean =>
      event.currentTarget === frameDocument ||
      (isElement(event.target) &&
        canvasElement.current?.contains(event.target) === true);
    const onKeyDown = (event: KeyboardEvent): void => {
      // A keystroke an input method is still composing belongs to the input
      // method: Escape abandons the composition and ⌘Z takes back a syllable,
      // and a command claiming either would leave the Author half a word.
      if (event.isComposing) return;
      const command = resolveCommand(bindings, event, applePlatform);
      if (command === undefined) return;
      if (isTextEntry(event.target) && !firesWhileTyping(command)) return;
      if (standsAside(event, command, event.currentTarget === frameDocument))
        return;
      // A drag the Author has not let go of is newer than the sentence they
      // were in, so the key that leaves the text backs out of it first. Only
      // on the Canvas: an Escape in the Consumer's own page belongs to them,
      // a modal or a menu, never to a drag (ADR-0032).
      if (
        backsOut(command) &&
        editor.getPendingChange() !== undefined &&
        isOnCanvas(event)
      ) {
        event.preventDefault();
        editor.cancelPendingChange();
        return;
      }
      // Enter and the arrows have jobs of their own in a page, like scrolling
      // it, so a step with nowhere to go leaves the key to the browser.
      if (movesSelection(command) && !commands.can[command]()) return;
      // Claimed whether or not it changed anything, so the browser's own undo
      // never fires behind a command that was merely refused.
      event.preventDefault();
      commands[command]();
    };

    const documents = [window.document, frameDocument].filter(
      (candidate) => candidate !== null,
    );
    for (const target of documents) {
      target.addEventListener("keydown", onKeyDown);
    }
    return () => {
      for (const target of documents) {
        target.removeEventListener("keydown", onKeyDown);
      }
    };
  }, [frameDocument, bindings, commands, editor]);

  // Every Block except the root and the structural ones is draggable, against
  // the elements the tree marked — so a Block Definition still needs to know
  // nothing about drag beyond whether it is a thing an Author handles at all.
  //
  // A structural Block belongs to its parent rather than to the Author. Keeping
  // it out of the palette says it cannot be carried in; this is the other half,
  // and says it cannot be carried out. Which is also why a container's
  // `minChildren` needs no counterpart in the drop machinery: the only children
  // a container with a minimum holds are structural, so no drag can take one
  // out and leave the container short.
  //
  // The Block being edited is the third exception, and the only temporary one.
  // A drag and a text selection are the same gesture — press, move, release —
  // so while an Author is in a Block's words, dragging one of them out of the
  // email cannot also be on offer. Registering nothing is what settles it: the
  // press reaches the caret because there is no draggable above it to claim it.
  //
  // A Block whose Consumer registered a grip for it gets that grip as its
  // draggable's handle, which is also what stops its body starting a drag.
  // Once any Block has a grip, every Block without one has its draggable
  // disabled, so a press on any body only selects (ADR-0043). The grip lives in Chrome that
  // comes and goes with the selection, and these are remade whenever the
  // Document changes, so each side picks the other up from the registry
  // whenever it arrives second.
  useEffect(() => {
    if (!frameDocument || !manager) return undefined;

    const draggables = new Map<string, Draggable>();
    for (const [blockId, element] of blockElementsIn(frameDocument)) {
      if (blockId === emailDocument.root.id) continue;
      if (blockId === editing) continue;
      const block = editor.getBlock(blockId);
      if (!block) continue;
      if (editor.getDefinition(block.type)?.structural === true) continue;

      const payload: DragPayload = {
        source: "canvas",
        blockId,
        blockType: block.type,
      };
      draggables.set(
        blockId,
        new Draggable(
          {
            id: blockDraggableId(blockId),
            element,
            data: payload,
          },
          manager,
        ),
      );
    }

    const applyHandles = (): void => {
      const gripOnly = handles?.hasAny() === true;
      for (const [blockId, draggable] of draggables) {
        const handle = handles?.handleOf(blockId);
        draggable.handle = handle;
        draggable.disabled = gripOnly && handle === undefined;
      }
    };
    applyHandles();
    const unsubscribe = handles?.subscribe(applyHandles);

    return () => {
      unsubscribe?.();
      for (const draggable of draggables.values()) draggable.destroy();
    };
  }, [frameDocument, manager, editor, emailDocument, editing, handles]);

  /**
   * Bring a revealed Block into view.
   *
   * The Canvas does this itself, whosever the scroller is. It has everything
   * the job needs and a Consumer does not: a measured rectangle for every
   * Block, and `scrollerOf` to find whatever holds the overflow — their element
   * when they laid one out, the Canvas's own wrapper when they asked for a
   * height instead. Left to the Consumer it is scroll arithmetic across a
   * document boundary, which is easy to get subtly wrong and wrong in a way
   * that looks like the editor ignoring them.
   *
   * `onReveal` stays public for a Consumer who wants to know a reveal
   * happened. It is no longer what makes one work.
   *
   * Measured rectangles rather than the DOM, because they are already in the
   * space this needs. Expressed as a distance to travel rather than a position
   * to travel to, so that the window and an element scroll the same way: only
   * one of them has a `scrollTop` that means anything here.
   *
   * A frame later, because a reveal follows an insertion React has not
   * committed yet — the measuring pass that knows where the new Block landed
   * has not run when the reveal arrives.
   */
  useEffect(() => {
    return editor.onReveal((blockId) => {
      const view = canvasElement.current?.ownerDocument.defaultView;
      view?.requestAnimationFrame(() => {
        const canvas = canvasElement.current;
        const rect = measured.current.get(blockId);
        if (!canvas || !rect) return;

        const scroller = scrollerOf(canvas);
        const blockTop = paddingBoxOf(canvas).top + rect.top;
        const centred = Math.max(
          0,
          (scroller.viewport.height - rect.height) / 2,
        );
        scroller.scrollBy(
          0,
          blockTop - scroller.viewport.top - centred,
          "smooth",
        );
      });
    });
  }, [editor, measured]);

  /**
   * A point in the frame's own viewport, in the Canvas's coordinate space.
   *
   * A native file drag reports its position there, so it is translated the
   * same way a measured rectangle is (ADR-0003), zoom and all (ADR-0039).
   */
  const framePointer = useCallback(
    (clientX: number, clientY: number): Point | undefined => {
      const canvas = canvasElement.current;
      const frame = frameElement.current;
      if (!canvas || !frame) return undefined;
      return toCanvasSpacePoint(
        fromFrame(
          { x: clientX, y: clientY },
          rectOf(frame.getBoundingClientRect()),
          zoom,
        ),
        paddingBoxOf(canvas),
      );
    },
    [zoom],
  );

  // An image file dragged in from the desktop, and a screenshot pasted from
  // the clipboard: native event streams with no Block behind them, so the drag
  // backend never sees either. A file drag feeds the same session.
  useArrivingImages({
    editor,
    frameDocument,
    session,
    pointerAt: framePointer,
  });

  /**
   * Keep scrolling the Canvas for as long as a drag lingers near its edge.
   *
   * Owned here rather than left to the drag backend, which picks a scrollable
   * ancestor of the dragged element: for a Block coming from the palette that
   * is somewhere in the Consumer's own page, never the email.
   */
  // `since` is when the scroll in its current direction began, on the frame
  // clock, so it can ease in. Unset until its first frame runs.
  const edgeScroll = useRef<{
    speed: number;
    frame: number;
    since: number | undefined;
  }>({ speed: 0, frame: 0, since: undefined });
  // The last position the drag reported, in the parent's viewport space. The
  // edge scroll re-resolves against it, because the pointer stays where it is
  // while the page moves and the backend has nothing new to report.
  const dragPointer = useRef<Point | undefined>(undefined);
  // Where the drag started, in the same space. An edge only scrolls once the
  // pointer has moved towards it from here.
  const dragStart = useRef<Point | undefined>(undefined);
  // Whether the drag in flight was started from a handle outside the frame,
  // which the backend reports one frame offset out (see `pointerOf`). Settled
  // when the drag starts, because the grip that started it is Chrome, and
  // Chrome stands down while a Block is in the air.
  const fromOutsideFrame = useRef(false);

  /**
   * Tell the session where the pointer is, given it in the parent's viewport.
   *
   * Shared by the backend's move events and the edge scroll's own loop, which
   * have to agree: they are the same question asked from two places. The
   * session works the Drop Target out, and wakes nobody unless it changed.
   *
   * Note what is *not* here. The Block rectangles are not re-measured, because
   * a scroll no longer moves them — the Canvas and the frame travel together.
   * The Canvas's own rectangle is re-read, because it does move, and the
   * pointer's position within it is what a scroll under a stationary cursor
   * actually changes.
   */
  const follow = useCallback(
    (viewportPointer: Point) => {
      const canvas = canvasElement.current;
      if (!canvas) return;

      session.move(toCanvasSpacePoint(viewportPointer, paddingBoxOf(canvas)));

      // Against the scroller's box, not the Canvas's. The Canvas is the height
      // of the email, so its bottom edge is the end of the Document rather than
      // the bottom of the screen — an edge zone measured there would fire on
      // almost every drag and scroll a page the Author had not reached the
      // bottom of.
      const scroller = scrollerOf(canvas);
      const speed = towardEdge(
        edgeScrollSpeed(
          toCanvasSpacePoint(viewportPointer, scroller.viewport),
          scroller.viewport,
          EDGE_SCROLL_ZONE,
          EDGE_SCROLL_SPEED,
        ),
        dragStart.current ?? viewportPointer,
        viewportPointer,
      );
      // A scroll that stops or turns round eases in again from nothing.
      if (Math.sign(speed) !== Math.sign(edgeScroll.current.speed)) {
        edgeScroll.current.since = undefined;
      }
      edgeScroll.current.speed = speed;
    },
    [session],
  );

  const keepScrolling = useCallback(() => {
    const canvas = canvasElement.current;
    const view = canvas?.ownerDocument.defaultView;
    if (!canvas || !view || edgeScroll.current.frame !== 0) return;

    // Resolved once per gesture rather than per frame: which ancestor scrolls
    // cannot change while a drag is in flight, and `getComputedStyle` up the
    // whole chain is not something to do sixty times a second.
    const scroller = scrollerOf(canvas);

    const step = (now: number): void => {
      const pointer = dragPointer.current;
      if (edgeScroll.current.speed === 0 || !pointer) {
        edgeScroll.current.frame = 0;
        edgeScroll.current.since = undefined;
        return;
      }
      edgeScroll.current.since ??= now;
      scroller.scrollBy(
        0,
        easeIn(edgeScroll.current.speed, now - edgeScroll.current.since),
      );
      // The page moved under a stationary pointer. The rectangles did not —
      // that is the point of the change — but the Canvas slid, so where the
      // pointer falls inside it did too, and the Drop Target has to be asked
      // again or a long drag lands where the short one would have.
      follow(pointer);
      edgeScroll.current.frame = view.requestAnimationFrame(step);
    };
    edgeScroll.current.frame = view.requestAnimationFrame(step);
  }, [follow]);

  // Where the pointer is now, for the preview to sit on. Read once when the
  // preview appears, before the first move may have reported.
  const pointerNow = useCallback(
    () => dragPointer.current ?? dragStart.current,
    [],
  );

  const stopScrolling = useCallback(() => {
    if (edgeScroll.current.frame !== 0) {
      canvasElement.current?.ownerDocument.defaultView?.cancelAnimationFrame(
        edgeScroll.current.frame,
      );
    }
    edgeScroll.current = { speed: 0, frame: 0, since: undefined };
    dragPointer.current = undefined;
    dragStart.current = undefined;
  }, []);

  /**
   * Change the Document once the drag backend has let go of the DOM.
   *
   * This was load-bearing when the backend lifted the Block's element out of
   * the flow and put it back at the end of the gesture: changing the Document
   * inside the drop handler let React reorder the email first and the backend
   * restore the Block afterwards, leaving a Document that said the Block had
   * moved and an email on screen that said it had not. Rendering the preview
   * outside the frame ended that — the Block never leaves the flow, so there
   * is nothing to restore (ADR-0008).
   *
   * Kept anyway. It costs one frame nobody can see, and it keeps the Canvas
   * out of the backend's way while a gesture unwinds. Removing it wants its
   * own evidence rather than an inference from the change that made the race
   * go away.
   */
  const settling = useRef(0);

  const afterDragSettles = useCallback((change: () => void) => {
    const view = canvasElement.current?.ownerDocument.defaultView;
    if (!view) {
      change();
      return;
    }
    settling.current = view.requestAnimationFrame(() => {
      settling.current = 0;
      change();
    });
  }, []);

  useEffect(
    () => () => {
      if (settling.current !== 0) cancelAnimationFrame(settling.current);
    },
    [],
  );

  // The session resolves against this Canvas's measurements, and reports and
  // lands through it.
  useEffect(
    () =>
      session.attach({
        editor,
        rects: () => measured.current,
        onRefused: reportRefusal,
        settle: afterDragSettles,
      }),
    [session, editor, measured, reportRefusal, afterDragSettles],
  );

  useDragDropMonitor({
    onDragStart({ operation }) {
      const payload = readDragPayload(operation.source?.data);
      const { handle, element } = operation.source ?? {};
      fromOutsideFrame.current =
        handle !== undefined &&
        element !== undefined &&
        handle.ownerDocument !== element.ownerDocument;
      dragStart.current = pointerOf(operation, fromOutsideFrame.current);
      measure();
      if (payload) session.start(payload);
    },
    onDragMove({ operation, to, by }) {
      const pointer = pointerOf(operation, fromOutsideFrame.current, {
        to,
        by,
      });
      dragPointer.current = pointer;
      follow(pointer);
      keepScrolling();
    },
    onDragEnd({ operation, canceled, nativeEvent }) {
      // Where the button came up. The backend holds each move back to the
      // next frame, so a button let go straight after a quick move comes up
      // before that move is told, and the last move heard is somewhere the
      // pointer has already left. Without a pointer to read, a key say, the
      // last move is all there is, read before the edge scroll lets go of it.
      const released =
        releasedAt(operation, nativeEvent, fromOutsideFrame.current) ??
        dragPointer.current ??
        pointerOf(operation, fromOutsideFrame.current);
      stopScrolling();
      const canvas = canvasElement.current;
      if (canceled || !canvas) {
        session.cancel();
        return;
      }
      session.drop(toCanvasSpacePoint(released, paddingBoxOf(canvas)));
    },
  });

  const editableText = useEditableText();
  const text: CanvasText | undefined = editableText
    ? { editableText, editing, report: reportTextSelection }
    : undefined;

  /**
   * What each Block last rendered to, so an edit redraws the Block it changed
   * and the path down to it rather than the whole email.
   *
   * Keyed on the Block, which the Document's structural sharing makes exact: a
   * Block that did not change is the same object. What that key cannot see is
   * everything *outside* a Block that still decides what it renders to, and
   * this is the list of it — so the cache is thrown away whole whenever one
   * moves, rather than left to answer for a render it never saw:
   *
   * - the editor, which is where the Definitions are;
   * - the Text Engine's surface, which every rich-text Block is wrapped in;
   * - which Block is being edited, because that is the one whose surface is
   *   editable and the one that has just stopped being;
   * - the root's own props, which every Block below may read as the email's
   *   (ADR-0017) or follow (ADR-0022) without any of them changing themselves.
   *
   * The Stage is deliberately absent. Mobile is a stylesheet over this same
   * markup, so switching Stage changes the frame's width and nothing a Block
   * rendered.
   */
  const renderCache: RenderCache = useMemo(
    () => new WeakMap(),
    // A key rather than an input: nothing here is read to build the cache, and
    // everything here invalidates it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [editor, editableText, editing, emailDocument.root.props],
  );

  // Every place the drag may land, worked out once when it starts and again
  // only if the email or its layout changes under it. Only asked for when a
  // Slot will draw them.
  const listsTargets = slots.dropTarget !== undefined;
  const dropTargets = useMemo(
    () =>
      listsTargets && carried
        ? editor.getDropTargets({
            draggedType: carried.type,
            ...(carried.blockId === undefined
              ? {}
              : { draggedBlockId: carried.blockId }),
            rects: blockRectsOf(rects),
          })
        : NO_TARGETS,
    // The Document is read through the editor; `emailDocument` says it moved.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [editor, listsTargets, carried, rects, emailDocument],
  );

  const chrome = renderChrome({
    editor,
    emailDocument,
    rects,
    standIns,
    selection,
    editing,
    hovered,
    boxEdges,
    carried,
    dropTarget,
    dropTargets,
    refusal,
    session,
    textSelection,
    textRect,
    imageRequests,
    suggestions,
    diagnostics,
    slots,
  });

  return (
    /*
      The scroller, when the Consumer has asked the Canvas to own one.

      Separate from the element below because that one cannot be both. The
      Chrome layer is positioned `inset: 0` against the Canvas element, so the
      Canvas element has to be the height of the whole email or the outline
      under the fold is clipped away — which leaves nowhere for a height the
      Consumer wants except an element outside it.

      Owning the scroller here changes nothing about the fix. The frame and the
      Chrome are both inside this element, so it moves them together and
      `toCanvasSpace` keeps subtracting two rectangles that shifted by the same
      amount. The scroller being the library's rather than the Consumer's is a
      matter of who wrote the `overflow`, not of how the geometry works.

      `display: contents` when no height was given, so a Consumer who scrolls
      the Canvas from their own layout gets the element tree they had before and
      no box of ours in the middle of their flex or grid.
    */
    <div
      style={
        height === undefined
          ? { display: "contents" }
          : { display: "block", height, overflowY: "auto" }
      }
    >
      <div
        ref={canvasElement}
        className={className}
        style={{
          position: "relative",
          // So the frame's bottom margin, which makes up its zoomed height,
          // stays inside rather than collapsing through.
          display: "flow-root",
          // The drawn width. The frame inside is laid out at the true one.
          width: scaledLength(frameWidth, zoom),
          // As tall as the email, never as tall as the window — see above.
          height: "auto",
          ...style,
        }}
      >
        <CanvasFrame
          title={title}
          frameRef={frameElement}
          layoutWidth={layoutWidthOf(frameWidth, zoom)}
          zoom={zoom}
          onDocumentChange={setFrameDocument}
        >
          {renderCanvasBlock(emailDocument.root, editor, text, renderCache)}
        </CanvasFrame>
        <div
          style={{
            position: "absolute",
            inset: 0,
            // The Chrome layer must not swallow clicks meant for the email. A
            // Slot that wants them asks for them.
            pointerEvents: "none",
          }}
        >
          {chrome}
        </div>
        <CarriedPreview editor={editor} slots={slots} pointer={pointerNow} />
      </div>
    </div>
  );
}

/** A Stage's width, drawn at a zoom. Exact for pixels, `calc` for the rest. */
function scaledLength(length: number | string, zoom: number): number | string {
  if (zoom === 1) return length;
  return typeof length === "number"
    ? length * zoom
    : `calc(${length} * ${String(zoom)})`;
}

/**
 * The width the frame is laid out at, inside a Canvas drawn at a zoom: the
 * Stage's own width, which for anything but pixels is the drawn width undone.
 */
function layoutWidthOf(length: number | string, zoom: number): string {
  if (typeof length === "number") return `${String(length)}px`;
  return zoom === 1 ? "100%" : `calc(100% / ${String(zoom)})`;
}

/**
 * Where the pointer of a drag is, in the parent's viewport space.
 *
 * What the backend reports, except for a drag started from a handle outside
 * the frame. The backend maps every pointer event into the top document by
 * the frame offset of the draggable's element, whichever document the event
 * came from. A press on the Block arrives in the frame's coordinates and is
 * shifted once, correctly. A press on a grip in the Consumer's document is
 * already in the parent's, and is shifted again — so that shift is taken back
 * out here, against the same transform.
 *
 * Only the absolute position is wrong. The preview follows the pointer by how
 * far it has moved, which both ends of the gesture were shifted alike for.
 */
function pointerOf(
  operation: {
    readonly position: { readonly current: Point };
    readonly source: { readonly element?: Element } | null;
  },
  fromOutsideFrame: boolean,
  move?: { readonly to?: Point; readonly by?: Point },
): Point {
  const reported = movedTo(operation.position.current, move);
  const element = operation.source?.element;
  if (!fromOutsideFrame || !element) return reported;
  const frame = getFrameTransform(element);
  return {
    x: (reported.x - frame.x) / frame.scaleX,
    y: (reported.y - frame.y) / frame.scaleY,
  };
}

/**
 * Where a pointer let go of a drag, in the parent's viewport, or nothing if a
 * pointer did not end it.
 *
 * Mapped the way the backend maps every move, then corrected as a move is, so
 * the drop lands by the same rules the drag was drawn by.
 */
function releasedAt(
  operation: {
    readonly position: { readonly current: Point };
    readonly source: { readonly element?: Element } | null;
  },
  nativeEvent: Event | undefined,
  fromOutsideFrame: boolean,
): Point | undefined {
  const element = operation.source?.element;
  if (!element || !isPointerLike(nativeEvent)) return undefined;
  const frame = getFrameTransform(element);
  const to = {
    x: nativeEvent.clientX * frame.scaleX + frame.x,
    y: nativeEvent.clientY * frame.scaleY + frame.y,
  };
  return pointerOf(operation, fromOutsideFrame, { to });
}

/** Whether an event says where a pointer was. Across frames, so no instanceof. */
function isPointerLike(
  event: Event | undefined,
): event is Event & { readonly clientX: number; readonly clientY: number } {
  return (
    event !== undefined &&
    "clientX" in event &&
    "clientY" in event &&
    typeof event.clientX === "number" &&
    typeof event.clientY === "number"
  );
}

/**
 * Where a move takes the pointer.
 *
 * The backend tells its move listeners before it moves the operation, so the
 * operation still says where the pointer was. Read from it alone, every move
 * resolves one event late, and a drag let go straight after a long last move
 * lands where the pointer had been.
 */
function movedTo(
  current: Point,
  move: { readonly to?: Point; readonly by?: Point } | undefined,
): Point {
  if (move?.to) return move.to;
  if (move?.by) return { x: current.x + move.by.x, y: current.y + move.by.y };
  return current;
}

/**
 * Whether a key is someone else's to use, so the command that moves the
 * selection stands aside.
 *
 * Enter presses a focused button and the arrows move through a menu, so the
 * commands that step in and along leave those alone, as the rest do in text.
 * Escape closes a dialog or a menu, so stepping out stays out of one. Only in
 * the Consumer's page: inside the frame every Block is marked as a button for
 * the drag, and a key pressed there is meant for the editor.
 *
 * Enter and the arrows stand aside once something has claimed them, too. A
 * Block lifted with Space moves on the arrows, and the drag claims them before
 * they get here. Not Escape: inside the words it can arrive already claimed,
 * and leaving the words is stepping out's first rung.
 */
function standsAside(
  event: KeyboardEvent,
  command: CommandName,
  inFrame: boolean,
): boolean {
  const target = event.target;
  const inside = (selector: string): boolean =>
    !inFrame && isElement(target) && target.closest(selector) !== null;
  if (command === "stepOut") return inside(LAYERS);
  return (
    movesSelection(command) && (event.defaultPrevented || inside(CONTROLS))
  );
}

/** The commands Enter and the arrows run: in and along the tree. */
function movesSelection(command: CommandName): boolean {
  return (
    command === "selectFirstChild" ||
    command === "selectPrevious" ||
    command === "selectNext"
  );
}

/** Elements that answer Enter or the arrows themselves. */
const CONTROLS =
  'button, a[href], summary, [role="button"], [role="link"], [role="menu"], [role="menubar"], [role="listbox"], [role="tablist"], [role="tree"], [role="grid"], [role="radiogroup"], [role="slider"], [role="combobox"]';

/** Elements that Escape closes. */
const LAYERS =
  'dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Whether a keystroke belongs to something being typed into.
 *
 * Checked by shape rather than with `instanceof`, because an element inside
 * the iframe belongs to a different realm and would fail the check.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as Partial<HTMLElement> & { tagName?: string };
  if (element.isContentEditable === true) return true;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
