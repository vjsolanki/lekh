import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Canvas,
  EditorProvider,
  useBlockDrag,
  usePalette,
  usePaletteDrag,
} from "../canvas";
import {
  createEditor,
  defineBlock,
  type BlockDefinition,
  type Editor,
} from "../index";
import { sequentialIds } from "../testing/blocks";
import {
  afterAFrame,
  centreOf,
  centreOfBlock,
  holdPointer,
  mount,
  movePointer,
  pathBetween,
  pointOnBlock,
  releasePointer,
  whenRendered,
  type MountedCanvas,
  type Point,
} from "../testing/browser";

/**
 * What an edit costs, counted in renders.
 *
 * ADR-0011 makes a Consumer's own components hold still through a change they
 * did not select. This is the other half: what the Canvas itself redraws when
 * one Block's prop moves. Nothing here is about appearance — the assertions are
 * counts, and they are the point.
 */

/** How many times each Block's Definition has rendered, by Block id. */
const renders = new Map<string, number>();

const countRender = (blockId: string): void => {
  renders.set(blockId, (renders.get(blockId) ?? 0) + 1);
};

const since = (mark: ReadonlyMap<string, number>, blockId: string): number =>
  (renders.get(blockId) ?? 0) - (mark.get(blockId) ?? 0);

const mark = (): ReadonlyMap<string, number> => new Map(renders);

const definitions: readonly BlockDefinition[] = [
  defineBlock({
    type: "email",
    label: "Email",
    accepts: ["stack"],
    schema: {},
    render: ({ block, children }) => {
      countRender(block.id);
      return <div>{children}</div>;
    },
  }),
  defineBlock({
    type: "stack",
    label: "Stack",
    accepts: ["text"],
    schema: {},
    render: ({ block, children }) => {
      countRender(block.id);
      return <div>{children}</div>;
    },
  }),
  defineBlock<{ fontSize: number }>({
    type: "text",
    label: "Text",
    schema: {
      fontSize: { kind: "number", label: "Font size", defaultValue: 14 },
    },
    render: ({ block, props }) => {
      countRender(block.id);
      return <p style={{ fontSize: props.fontSize }}>Text</p>;
    },
  }),
];

/**
 * A palette written the way a real one is: one component per entry, each
 * holding a drag handle of its own.
 *
 * The drag backend is the whole difference from a palette that only lists —
 * every entry is registered with it, and the Canvas re-registers every Block's
 * Draggable each time the Document changes.
 */
let entryRenders = 0;

function DraggableEntry({ type }: { readonly type: string }): ReactNode {
  entryRenders++;
  const { dragHandleProps } = usePaletteDrag(type);
  return (
    <button type="button" {...dragHandleProps}>
      {type}
    </button>
  );
}

function DraggablePalette(): ReactNode {
  const entries = usePalette();
  return (
    <div>
      {entries.map((entry) => (
        <DraggableEntry key={entry.type} type={entry.type} />
      ))}
    </div>
  );
}

/** An email with two stacks of three text Blocks each. */
function createExample(): {
  readonly editor: Editor;
  readonly blockIds: readonly string[];
} {
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds(),
  });
  const root = editor.getDocument().root.id;

  const blockIds: string[] = [];
  for (let stack = 0; stack < 2; stack++) {
    const stackId = editor.insertBlock("stack", root) ?? "";
    blockIds.push(stackId);
    for (let text = 0; text < 3; text++) {
      blockIds.push(editor.insertBlock("text", stackId) ?? "");
    }
  }
  return { editor, blockIds };
}

beforeEach(() => {
  renders.clear();
  entryRenders = 0;
});

/** Wait until a Block's rendered font size says the edit has landed. */
async function whenFontSize(
  frameDocument: Document,
  blockId: string,
  size: number,
): Promise<void> {
  await vi.waitFor(() => {
    // The attribute rather than `element.style`: this element belongs to the
    // frame's realm, so `instanceof HTMLElement` against ours is false however
    // ordinary the element is.
    const style = frameDocument
      .querySelector(`[data-block-id="${blockId}"]`)
      ?.getAttribute("style");
    if (style !== `font-size: ${String(size)}px;`) {
      throw new Error("The edit has not landed yet.");
    }
  });
}

describe("what one edit costs", () => {
  it("redraws the edited Block and its ancestors, and nothing else", async () => {
    const { editor, blockIds } = createExample();
    const [firstStack, edited, sibling, , secondStack, cousin] = blockIds;
    const rootId = editor.getDocument().root.id;

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    const before = mark();
    editor.setProp(edited ?? "", "fontSize", 18);
    await whenFontSize(frameDocument, edited ?? "", 18);

    // The edited Block redraws, and so does the path down to it: those Blocks
    // are new objects, because the change had to be threaded through them.
    // Nothing to either side of that path has moved, so nothing else redraws.
    expect({
      edited: since(before, edited ?? ""),
      root: since(before, rootId),
      ancestorStack: since(before, firstStack ?? ""),
      sibling: since(before, sibling ?? ""),
      cousin: since(before, cousin ?? ""),
      untouchedStack: since(before, secondStack ?? ""),
    }).toEqual({
      edited: 1,
      root: 1,
      ancestorStack: 1,
      sibling: 0,
      cousin: 0,
      untouchedStack: 0,
    });
  });

  it("redraws nothing when the selection moves", async () => {
    const { editor, blockIds } = createExample();
    const [, first, second] = blockIds;

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas />
      </EditorProvider>,
    );
    await whenRendered(host);

    editor.select(first ?? "");
    const before = mark();
    editor.select(second ?? "");

    // Selection is Chrome, drawn over the frame rather than in it, and it
    // changes no Block. Waiting for a redraw that should not come is the whole
    // test, so this settles rather than polls.
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    expect(blockIds.map((blockId) => since(before, blockId))).toEqual(
      blockIds.map(() => 0),
    );
  });

  it("leaves a palette alone", async () => {
    const { editor, blockIds } = createExample();
    const edited = blockIds[1] ?? "";
    let paletteRenders = 0;

    function Palette(): ReactNode {
      paletteRenders++;
      const entries = usePalette();
      return <div>{entries.length}</div>;
    }

    const host = mount(
      <EditorProvider editor={editor}>
        <Palette />
        <Canvas />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    const before = paletteRenders;
    editor.setProp(edited, "fontSize", 18);
    await whenFontSize(frameDocument, edited, 18);

    // A palette lists Definitions. An edit does not change them, and it does
    // not select anything a palette reads.
    expect(paletteRenders).toBe(before);
  });

  it("leaves a palette whose entries are draggable alone", async () => {
    const { editor, blockIds } = createExample();
    const edited = blockIds[1] ?? "";

    const host = mount(
      <EditorProvider editor={editor}>
        <DraggablePalette />
        <Canvas />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    const before = entryRenders;
    editor.setProp(edited, "fontSize", 18);
    await whenFontSize(frameDocument, edited, 18);

    expect(entryRenders).toBe(before);
  });

  it("leaves a Consumer's own component alone", async () => {
    const { editor, blockIds } = createExample();
    const edited = blockIds[1] ?? "";
    let toolbarRenders = 0;

    function Toolbar(): ReactNode {
      toolbarRenders++;
      const [, setLocal] = useState(0);
      void setLocal;
      return <div>toolbar</div>;
    }

    const host = mount(
      <EditorProvider editor={editor}>
        <Toolbar />
        <Canvas />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    const before = toolbarRenders;
    editor.setProp(edited, "fontSize", 18);
    await whenFontSize(frameDocument, edited, 18);

    expect(toolbarRenders).toBe(before);
  });
});

/** A few moves that stay over the top of the same Block. */
function nudgesOver(mounted: MountedCanvas, blockId: string): Point[] {
  return [0.15, 0.2, 0.25, 0.2].map((fraction) =>
    pointOnBlock(mounted, blockId, fraction),
  );
}

/** The centre of the palette entry for a type. */
function entryFor(type: string) {
  return (host: HTMLElement): Point => {
    const entry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === type,
    );
    if (!entry) throw new Error(`No palette entry for ${type}.`);
    return centreOf(entry);
  };
}

/**
 * What a drag costs while it is in the air.
 *
 * A pointer moves sixty times a second, and most moves change nothing: the
 * pointer is still over the same gap, or still over a container that says no.
 * The drag hooks select what they show, so those moves must not reach them.
 */
describe("what a drag costs", () => {
  let gripRenders = 0;

  /** A grip's hook for one Block, without a grip: its renders are counted. */
  function WatchedBlock({ blockId }: { readonly blockId: string }): ReactNode {
    gripRenders++;
    const { isDragging, isRefused } = useBlockDrag(blockId);
    return (
      <span data-testid="watched">
        {String(isDragging)} {String(isRefused)}
      </span>
    );
  }

  beforeEach(() => {
    gripRenders = 0;
  });

  /**
   * Mount a palette, one watched grip and the Canvas, pick something up at
   * `pickUp`, and count the drag hooks' renders across a few more moves over
   * `heldOver`. `watched` is the state the grip shows once the drag is up.
   */
  async function rendersWhileHeld({
    watch,
    pickUp,
    heldOver,
    watched,
    refused = false,
  }: {
    readonly watch: (blockIds: readonly string[]) => string;
    readonly pickUp: (
      host: HTMLElement,
      mounted: MountedCanvas,
      blockIds: readonly string[],
    ) => Point;
    readonly heldOver: (blockIds: readonly string[]) => string;
    readonly watched: string;
    /** Whether the drag is held over somewhere that refuses it. */
    readonly refused?: boolean;
  }): Promise<{ entries: number; grips: number }> {
    const { editor, blockIds } = createExample();
    const host = mount(
      <EditorProvider editor={editor}>
        {/* A row of its own, so a press on an entry is not a press on the
            frame. */}
        <div style={{ display: "flex", gap: 8, height: 40 }}>
          <DraggablePalette />
          <WatchedBlock blockId={watch(blockIds)} />
        </div>
        <Canvas />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const over = heldOver(blockIds);

    await holdPointer(
      pathBetween(
        pickUp(host, mounted, blockIds),
        pointOnBlock(mounted, over, 0.2),
      ),
    );
    try {
      await afterAFrame();
      expect(host.querySelector("[data-testid='watched']")?.textContent).toBe(
        watched,
      );
      // The default refusal Slot, which is drawn only while refused.
      expect(host.querySelector("[role='status']") !== null).toBe(refused);
      const entriesBefore = entryRenders;
      const gripsBefore = gripRenders;

      await movePointer(nudgesOver(mounted, over));
      await afterAFrame();

      return {
        entries: entryRenders - entriesBefore,
        grips: gripRenders - gripsBefore,
      };
    } finally {
      await releasePointer();
    }
  }

  it("re-renders no drag hook for a palette drag that stays over one gap", async () => {
    const counts = await rendersWhileHeld({
      watch: ([, first]) => first ?? "",
      pickUp: entryFor("text"),
      // In the second stack, well clear of the palette's row.
      heldOver: (blockIds) => blockIds[5] ?? "",
      watched: "false false",
    });
    expect(counts).toEqual({ entries: 0, grips: 0 });
  });

  it("re-renders no drag hook for a palette drag that stays refused", async () => {
    const counts = await rendersWhileHeld({
      watch: ([, first]) => first ?? "",
      // Nothing in the email takes another email.
      pickUp: entryFor("email"),
      heldOver: (blockIds) => blockIds[5] ?? "",
      watched: "false false",
      refused: true,
    });
    expect(counts).toEqual({ entries: 0, grips: 0 });
  });

  it("re-renders no drag hook for a Block drag that stays over one gap", async () => {
    const counts = await rendersWhileHeld({
      watch: ([, , , third]) => third ?? "",
      pickUp: (_host, mounted, [, , , third]) =>
        centreOfBlock(mounted, third ?? ""),
      heldOver: ([, first]) => first ?? "",
      watched: "true false",
    });
    expect(counts).toEqual({ entries: 0, grips: 0 });
  });
});
