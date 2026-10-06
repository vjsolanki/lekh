import { describe, expect, it } from "vitest";

import {
  SchemaKind,
  createEditor,
  type Asset,
  type BlockDefinition,
  type Editor,
  type ImageRequest,
  type Op,
} from "../../index";
import {
  definitions,
  email,
  image,
  section as plainSection,
  sequentialIds,
  text,
} from "../../testing/blocks";

/**
 * Assets, at the editor-instance seam.
 *
 * Almost all of this is a state machine, so it is exercised with a fake
 * resolver and no DOM. The assertions are on the Document and on the pending
 * state the library reports — never on how the resolver was called, because a
 * Consumer's gallery may be opened by any route and the library's promise is
 * about what ends up stored.
 */

const PHOTO: Asset = {
  src: "https://cdn.example.com/cat.jpg",
  width: 800,
  height: 600,
  alt: "A cat",
};

/** A resolver a test drives by hand, so a resolution can be held open. */
interface FakeResolver {
  resolve: (request: ImageRequest) => Promise<Asset | undefined>;
  /** The request currently outstanding. */
  readonly current: () => ImageRequest;
  /** Answer with an Asset, with `undefined` to cancel, or reject. */
  readonly settle: (asset?: Asset) => Promise<void>;
  readonly fail: (error: unknown) => Promise<void>;
}

function createFakeResolver(): FakeResolver {
  let outstanding: ImageRequest | undefined;
  let answer: ((asset: Asset | undefined) => void) | undefined;
  let refuse: ((error: unknown) => void) | undefined;

  return {
    resolve: (request) =>
      new Promise<Asset | undefined>((res, rej) => {
        outstanding = request;
        answer = res;
        refuse = rej;
      }),
    current: () => {
      if (!outstanding) throw new Error("No image was asked for.");
      return outstanding;
    },
    settle: async (asset) => {
      answer?.(asset);
      await flush();
    },
    fail: async (why) => {
      refuse?.(why);
      await flush();
    },
  };
}

/**
 * Let the store's continuations run: one turn for the resolver's own promise,
 * one for the handler attached to it.
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface Setup {
  readonly editor: Editor;
  readonly resolver: FakeResolver;
  readonly root: string;
  /** Every Op this editor produced, so a test can insist there were none. */
  readonly ops: Op[];
}

function setup(): Setup {
  const resolver = createFakeResolver();
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds(),
    resolveImage: resolver.resolve,
  });
  const ops: Op[] = [];
  editor.onOp((op) => ops.push(op));
  return { editor, resolver, root: editor.getDocument().root.id, ops };
}

const typesIn = (editor: Editor): readonly string[] =>
  (editor.getDocument().root.children ?? []).map((block) => block.type);

const assetIn = (editor: Editor, index: number): unknown =>
  editor.getDocument().root.children?.[index]?.props["asset"];

/** An editor a Consumer never gave a `resolveImage` to. */
function withoutResolver(): Editor {
  return createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds(),
  });
}

function file(name = "cat.png"): File {
  return new File(["binary"], name, { type: "image/png" });
}

describe("asking for an image", () => {
  it("puts the resolved Asset into a new Block", async () => {
    const { editor, resolver } = setup();

    expect(editor.place({ reason: "insert" }).status).toBe("requested");
    await resolver.settle(PHOTO);

    expect(typesIn(editor)).toEqual(["image"]);
    expect(assetIn(editor, 0)).toEqual(PHOTO);
  });

  it("lands it at the position the Author dropped it", async () => {
    const { editor, resolver, root } = setup();
    const first = editor.insertBlock("text", root) ?? "";
    editor.insertBlock("text", root);

    editor.place({
      reason: "drop",
      files: [file()],
      target: {
        parentId: root,
        index: 1,
        position: "after",
        referenceBlockId: first,
      },
    });
    await resolver.settle(PHOTO);

    expect(typesIn(editor)).toEqual(["text", "image", "text"]);
  });

  it("carries the reason and the files to the Consumer", () => {
    const { editor } = setup();
    const dropped = file("screenshot.png");

    editor.place({ reason: "paste", files: [dropped] });

    expect(editor.getImageRequests()).toMatchObject([
      {
        reason: "paste",
        files: [dropped],
        placement: { kind: "insert", type: "image" },
      },
    ]);
  });

  it("changes the image on a Block that already has one", async () => {
    const { editor, resolver, root } = setup();
    editor.place({ reason: "insert" });
    await resolver.settle(PHOTO);
    const blockId = editor.getDocument().root.children?.[0]?.id ?? "";

    const replacement: Asset = {
      src: "https://cdn.example.com/dog.jpg",
      width: 400,
      height: 400,
      alt: "A dog",
    };
    expect(editor.replaceImage(blockId)).toBe(true);
    expect(editor.getImageRequests()[0]?.placement).toEqual({
      kind: "replace",
      blockId,
      prop: "asset",
      decorative: false,
    });
    await resolver.settle(replacement);

    expect(editor.getBlock(root)?.children).toHaveLength(1);
    expect(assetIn(editor, 0)).toEqual(replacement);
  });

  it("selects the Block it just placed, so the Inspector describes it", async () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    await resolver.settle(PHOTO);

    expect(editor.getSelection()).toBe(
      editor.getDocument().root.children?.[0]?.id,
    );
  });

  it("is undoable as one action", async () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    await resolver.settle(PHOTO);

    expect(editor.undo()).toBe(true);
    expect(typesIn(editor)).toEqual([]);
  });

  it("lands where the Author aimed even after the email moved beneath it", async () => {
    const { editor, resolver, root } = setup();
    const first = editor.insertBlock("text", root) ?? "";
    const second = editor.insertBlock("text", root) ?? "";
    editor.insertBlock("text", root);

    // Aimed just below the second Block.
    editor.place({
      reason: "drop",
      files: [file()],
      target: {
        parentId: root,
        index: 2,
        position: "after",
        referenceBlockId: second,
      },
    });

    // An upload takes as long as it takes, and an Author keeps working. The
    // index the drop recorded now points below the *third* Block; the Block
    // they aimed under is the identity that survived.
    editor.removeBlock(first);
    await resolver.settle(PHOTO);

    expect(typesIn(editor)).toEqual(["text", "image", "text"]);
  });

  it("leaves alternative text editable afterwards, through the Asset itself", async () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    await resolver.settle({ ...PHOTO, alt: undefined });

    // One value, so a description can never outlive the image it describes:
    // the Consumer's `asset` control sets a changed Asset.
    const control = editor.getControls()[0];
    expect(control?.kind).toBe("asset");
    control?.set({ ...PHOTO, alt: "A cat on a windowsill" });

    expect(assetIn(editor, 0)).toMatchObject({ alt: "A cat on a windowsill" });
    // And that edit is an ordinary Op, so it undoes like any other.
    expect(editor.undo()).toBe(true);
    expect(assetIn(editor, 0)).toMatchObject({ alt: undefined });
  });
});

describe("an editor with no resolver", () => {
  it("inserts the image Block empty, for the Consumer's own control to fill", () => {
    const editor = withoutResolver();

    // The hook is how an editor becomes better, not how it becomes usable: a
    // Consumer with an `asset` control of their own needs no library
    // involvement at all.
    expect(editor.place({ reason: "insert" }).status).toBe("inserted");
    expect(typesIn(editor)).toEqual(["image"]);
    expect(editor.getImageRequests()).toEqual([]);
    // And the Canvas is told there is nowhere for a file to go, so it leaves a
    // native drop to the browser rather than claiming it.
    expect(editor.getImageBlockType()).toBeUndefined();
  });

  it("refuses files outright rather than dropping them on the floor", () => {
    const editor = withoutResolver();

    // Inserting an empty Block here would discard the Author's JPEG without a
    // word. Refusing an event is honest; swallowing it is not.
    expect(editor.place({ reason: "drop", files: [file()] }).status).toBe(
      "refused",
    );
    expect(typesIn(editor)).toEqual([]);
  });
});

describe("a placement the editor will not raise a request for", () => {
  it("names the Block a dropped file becomes when it can take one", () => {
    const { editor } = setup();
    expect(editor.getImageBlockType()).toBe("image");
  });

  it("inserts a Block that holds no Asset without asking for one", () => {
    const { editor, root } = setup();
    const blockId = editor.insertBlock("text", root) ?? "";

    expect(editor.replaceImage(blockId)).toBe(false);
    expect(editor.place({ reason: "insert", type: "text" }).status).toBe(
      "inserted",
    );
    expect(editor.getImageRequests()).toEqual([]);
  });

  it("is refused where the Block could not be placed anyway", () => {
    const { editor, root } = setup();
    // A section takes two children at most, and this fills it.
    const section = editor.insertBlock("section", root) ?? "";
    editor.insertBlock("text", section);
    editor.insertBlock("text", section);

    expect(
      editor.place({
        reason: "drop",
        files: [file()],
        target: { parentId: section, index: 2, position: "inside" },
      }).status,
    ).toBe("refused");
    expect(editor.getImageRequests()).toEqual([]);
  });
});

describe("while a resolution is outstanding", () => {
  it("reports it as Chrome, with where the image is going", () => {
    const { editor, root } = setup();
    editor.place({ reason: "insert" });

    expect(editor.getImageRequests()).toMatchObject([
      {
        status: "pending",
        reason: "insert",
        placement: {
          kind: "insert",
          type: "image",
          target: { parentId: root },
        },
      },
    ]);
  });

  it("leaves the Document exactly as it was, and persistable throughout", async () => {
    const { editor, resolver, root, ops } = setup();
    editor.insertBlock("text", root);
    const before = editor.getDocument();
    ops.length = 0;

    editor.place({ reason: "drop", files: [file()] });
    expect(editor.getDocument()).toBe(before);

    // The trap this design exists to close: an Author who saves mid-upload
    // must not write a local object URL into their database.
    resolver.current().onProgress(0.5);
    const saved = JSON.stringify(editor.getDocument());
    expect(saved).toBe(JSON.stringify(before));
    expect(saved).not.toContain("blob:");
    expect(ops).toEqual([]);

    await resolver.settle(PHOTO);
    expect(typesIn(editor)).toEqual(["text", "image"]);
  });

  it("reports the progress the Consumer chooses to report", () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    expect(editor.getImageRequests()[0]).not.toHaveProperty("progress");

    resolver.current().onProgress(0.42);
    expect(editor.getImageRequests()[0]).toMatchObject({ progress: 0.42 });
  });

  it("tells a subscriber every time that state changes", () => {
    const { editor, resolver } = setup();
    let changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });

    editor.place({ reason: "insert" });
    resolver.current().onProgress(0.5);

    expect(changes).toBe(2);
    // A list that has not changed is the same list, so a Consumer rendering
    // from it is not re-rendered by every unrelated edit.
    expect(editor.getImageRequests()).toBe(editor.getImageRequests());
  });

  it("announces an Asset landing once, however many pieces it takes", async () => {
    // The request leaves the list, a Block is inserted, and it becomes the
    // selected one. That is one thing the Author did.
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });

    let changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });
    await resolver.settle(PHOTO);

    expect(changes).toBe(1);
  });

  it("announces a replacement landing once", async () => {
    const { editor, resolver, root } = setup();
    const blockId = editor.insertBlock("image", root) ?? "";
    editor.replaceImage(blockId);

    let changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });
    await resolver.settle(PHOTO);

    expect(changes).toBe(1);
    expect(assetIn(editor, 0)).toEqual(PHOTO);
  });

  it("never shows a subscriber the Block before it is the selected one", async () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });

    const seen: (string | undefined)[] = [];
    editor.subscribe(() => seen.push(editor.getSelection()));
    await resolver.settle(PHOTO);

    const landed = editor.getDocument().root.children?.[0]?.id;
    expect(landed).toBeDefined();
    expect(seen).toEqual([landed]);
  });
});

describe("cancelling", () => {
  it("changes nothing when the Consumer dismisses their dialog", async () => {
    const { editor, resolver, root, ops } = setup();
    editor.insertBlock("text", root);
    const before = editor.getDocument();
    ops.length = 0;

    editor.place({ reason: "insert" });
    await resolver.settle(undefined);

    expect(editor.getDocument()).toBe(before);
    expect(editor.getImageRequests()).toEqual([]);
    expect(ops).toEqual([]);

    // No Op means no undo entry: the one undo the Author has left is the text
    // Block they added before any of this, not a keystroke spent on nothing.
    editor.undo();
    expect(typesIn(editor)).toEqual([]);
    expect(editor.canUndo()).toBe(false);
  });

  it("aborts the resolution when the Author cancels it", () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    const { signal } = resolver.current();
    expect(signal.aborted).toBe(false);

    editor.getImageRequests()[0]?.cancel();

    expect(signal.aborted).toBe(true);
    expect(editor.getImageRequests()).toEqual([]);
  });

  it("ignores an Asset that arrives after the Author walked away", async () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    editor.getImageRequests()[0]?.cancel();

    await resolver.settle(PHOTO);

    expect(typesIn(editor)).toEqual([]);
  });

  it("abandons a resolution whose Block an undo took away", async () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    await resolver.settle(PHOTO);
    const blockId = editor.getDocument().root.children?.[0]?.id ?? "";

    editor.replaceImage(blockId);
    const { signal } = resolver.current();

    // Undoing the insertion takes the Block the image was going into with it.
    editor.undo();

    expect(signal.aborted).toBe(true);
    expect(editor.getImageRequests()).toEqual([]);
  });
});

describe("failing", () => {
  it("surfaces a retryable failure and leaves the Document untouched", async () => {
    const { editor, resolver, root, ops } = setup();
    editor.insertBlock("text", root);
    const before = editor.getDocument();
    ops.length = 0;

    editor.place({ reason: "drop", files: [file()] });
    await resolver.fail(new Error("The connection dropped."));

    expect(editor.getDocument()).toBe(before);
    expect(ops).toEqual([]);
    expect(editor.getImageRequests()).toMatchObject([
      {
        status: "failed",
        reason: "drop",
        error: { message: "The connection dropped." },
      },
    ]);
  });

  it("asks again, with the same request, when the Author retries", async () => {
    const { editor, resolver } = setup();
    const dropped = file();
    editor.place({ reason: "drop", files: [dropped] });
    await resolver.fail(new Error("nope"));

    const failure = editor.getImageRequests()[0];
    if (failure?.status !== "failed") throw new Error("Expected a failure.");
    failure.retry();

    expect(editor.getImageRequests()).toMatchObject([
      { status: "pending", reason: "drop", files: [dropped] },
    ]);

    await resolver.settle(PHOTO);
    expect(typesIn(editor)).toEqual(["image"]);
    expect(editor.getImageRequests()).toEqual([]);
  });

  it("can be dismissed, which is still no change to the Document", async () => {
    const { editor, resolver } = setup();
    editor.place({ reason: "insert" });
    await resolver.fail(new Error("nope"));

    editor.getImageRequests()[0]?.cancel();

    expect(editor.getImageRequests()).toEqual([]);
    expect(editor.canUndo()).toBe(false);
  });
});

describe("an Asset a Block may hold without being an image", () => {
  /** A section with a picture behind it, registered ahead of the image. */
  const backdropSection: BlockDefinition = {
    ...plainSection,
    schema: {
      ...plainSection.schema,
      backdrop: {
        kind: SchemaKind.asset,
        label: "Backdrop",
        defaultValue: undefined,
      },
    },
  };

  function withBackdrop(): Setup {
    const resolver = createFakeResolver();
    const editor = createEditor({
      definitions: [email, backdropSection, text, image],
      rootType: "email",
      createId: sequentialIds(),
      resolveImage: resolver.resolve,
    });
    return { editor, resolver, root: editor.getDocument().root.id, ops: [] };
  }

  it("still turns a dropped file into the image Block", async () => {
    const { editor, resolver } = withBackdrop();
    expect(editor.getImageBlockType()).toBe("image");

    editor.place({ reason: "drop", files: [file()] });
    await resolver.settle(PHOTO);

    expect(typesIn(editor)).toEqual(["image"]);
  });

  it("places the section without asking for a picture", () => {
    const { editor } = withBackdrop();

    expect(editor.place({ reason: "insert", type: "section" }).status).toBe(
      "inserted",
    );
    expect(editor.getImageRequests()).toEqual([]);
  });

  it("lands a replacement in the prop it was asked for", async () => {
    const { editor, resolver, root } = withBackdrop();
    const blockId = editor.insertBlock("section", root) ?? "";

    expect(editor.replaceImage(blockId, "replace", "backdrop")).toBe(true);
    expect(editor.getImageRequests()[0]?.placement).toEqual({
      kind: "replace",
      blockId,
      prop: "backdrop",
      decorative: false,
    });
    await resolver.settle(PHOTO);

    const props = editor.getBlock(blockId)?.props;
    expect(props?.["backdrop"]).toEqual(PHOTO);
    expect(props?.["asset"]).toBeUndefined();
  });

  it("says in the placement that a decorative one shows no alt text", () => {
    const decorative: BlockDefinition = {
      ...backdropSection,
      schema: {
        ...backdropSection.schema,
        backdrop: {
          kind: SchemaKind.asset,
          label: "Backdrop",
          defaultValue: undefined,
          decorative: true,
        },
      },
    };
    const editor = createEditor({
      definitions: [email, decorative, text, image],
      rootType: "email",
      createId: sequentialIds(),
      resolveImage: () => new Promise(() => {}),
    });
    const root = editor.getDocument().root.id;
    const blockId = editor.insertBlock("section", root) ?? "";

    editor.replaceImage(blockId, "add", "backdrop");

    expect(editor.getImageRequests()).toMatchObject([
      {
        reason: "add",
        placement: {
          kind: "replace",
          blockId,
          prop: "backdrop",
          decorative: true,
        },
      },
    ]);
  });

  it("asks for nothing when the Block has no primary one to replace", () => {
    const { editor, root } = withBackdrop();
    const blockId = editor.insertBlock("section", root) ?? "";

    expect(editor.replaceImage(blockId)).toBe(false);
    expect(editor.replaceImage(blockId, "replace", "padding")).toBe(false);
    expect(editor.getImageRequests()).toEqual([]);
  });

  it("is cleared with a plain change, and no request", () => {
    const { editor, root } = withBackdrop();
    const blockId =
      editor.insertBlock("section", root, undefined, {
        backdrop: PHOTO,
      }) ?? "";

    expect(editor.setProp(blockId, "backdrop", undefined)).toBe(true);
    expect(editor.getBlock(blockId)?.props["backdrop"]).toBeUndefined();
    expect(editor.getImageRequests()).toEqual([]);
  });
});

const badgeOf = (editor: Editor, blockId: string): unknown =>
  editor.getBlock(blockId)?.props["badge"];

describe("an Asset the Consumer listed (ADR-0030)", () => {
  const BADGE: Asset = {
    src: "https://cdn.example.com/badge.png",
    width: 64,
    height: 64,
    alt: "Acme on Instagram",
  };

  /** A section whose optional `badge` lists one Asset already resolved. */
  const badgedSection: BlockDefinition = {
    ...plainSection,
    schema: {
      ...plainSection.schema,
      badge: {
        kind: SchemaKind.asset,
        label: "Badge",
        defaultValue: undefined,
        constraints: { options: [{ label: "Instagram", asset: BADGE }] },
      },
    },
  };

  function withBadge(resolveImage = true): Setup {
    const resolver = createFakeResolver();
    const editor = createEditor({
      definitions: [email, badgedSection, text, image],
      rootType: "email",
      createId: sequentialIds(),
      ...(resolveImage ? { resolveImage: resolver.resolve } : {}),
    });
    return { editor, resolver, root: editor.getDocument().root.id, ops: [] };
  }

  it("is set with a plain change, and no request", () => {
    const { editor, root } = withBadge();
    const blockId = editor.insertBlock("section", root) ?? "";

    expect(editor.setProp(blockId, "badge", { ...BADGE })).toBe(true);
    expect(badgeOf(editor, blockId)).toEqual(BADGE);
    expect(editor.getImageRequests()).toEqual([]);
  });

  it("is set the same way with no resolver at all", () => {
    const { editor, root } = withBadge(false);
    const blockId = editor.insertBlock("section", root) ?? "";

    expect(editor.setProp(blockId, "badge", BADGE)).toBe(true);
    expect(badgeOf(editor, blockId)).toEqual(BADGE);
  });

  it("refuses any other picture, which still needs a request", () => {
    const { editor, root } = withBadge();
    const blockId = editor.insertBlock("section", root) ?? "";

    expect(editor.setProp(blockId, "badge", PHOTO)).toBe(false);
    expect(
      editor.setProp(blockId, "badge", { ...BADGE, width: 32, height: 32 }),
    ).toBe(false);
    expect(badgeOf(editor, blockId)).toBeUndefined();
  });

  it("still takes an upload through a request", async () => {
    const { editor, resolver, root } = withBadge();
    const blockId = editor.insertBlock("section", root) ?? "";

    expect(editor.replaceImage(blockId, "replace", "badge")).toBe(true);
    await resolver.settle(PHOTO);

    expect(badgeOf(editor, blockId)).toEqual(PHOTO);
  });

  it("lets the alt text change on the picture already there", async () => {
    const { editor, resolver, root } = withBadge();
    const blockId = editor.insertBlock("section", root) ?? "";
    editor.replaceImage(blockId, "replace", "badge");
    await resolver.settle(PHOTO);

    expect(editor.setProp(blockId, "badge", { ...PHOTO, alt: "Ours" })).toBe(
      true,
    );
    expect(badgeOf(editor, blockId)).toMatchObject({ alt: "Ours" });
    expect(editor.setProp(blockId, "badge", { ...BADGE, alt: "Theirs" })).toBe(
      true,
    );
  });

  it("is cleared with a plain change", () => {
    const { editor, root } = withBadge();
    const blockId =
      editor.insertBlock("section", root, undefined, { badge: BADGE }) ?? "";

    expect(editor.setProp(blockId, "badge", undefined)).toBe(true);
    expect(badgeOf(editor, blockId)).toBeUndefined();
  });

  it("passes the list through to the Control Descriptor", () => {
    const { editor, root } = withBadge();
    const blockId = editor.insertBlock("section", root) ?? "";
    editor.select(blockId);

    const control = editor.getControls().find((c) => c.name === "badge");
    expect(control?.constraints).toEqual({
      options: [{ label: "Instagram", asset: BADGE }],
    });
  });

  it("leaves an Asset that lists nothing open to any change, as before", () => {
    const { editor, root } = withBadge();
    const blockId = editor.insertBlock("image", root) ?? "";

    expect(editor.setProp(blockId, "asset", PHOTO)).toBe(true);
  });
});
