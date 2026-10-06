import { describe, expect, it } from "vitest";

import { defineBlock, SchemaKind, type Asset } from "../../index";
import { editorFor } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/**
 * What a colour is read against: the Surface its entry names with `on`, or
 * else the nearest one beneath it that is not None. A Block's Surfaces stack in
 * Schema order, the last on top, and an optional Asset declared after one lies
 * over it.
 */

const page = defineBlock<{ paper: string }>({
  type: "page",
  label: "Page",
  accepts: ["card", "badge"],
  schema: {
    paper: {
      kind: SchemaKind.surface,
      label: "Paper",
      defaultValue: "#ffffff",
    },
  },
  render: () => null,
});

const card = defineBlock<{
  band: string;
  column: string;
  wallpaper: Asset | undefined;
}>({
  type: "card",
  label: "Card",
  accepts: ["badge"],
  schema: {
    band: { kind: SchemaKind.surface, label: "Band", defaultValue: "none" },
    column: { kind: SchemaKind.surface, label: "Column", defaultValue: "none" },
    wallpaper: {
      kind: SchemaKind.asset,
      label: "Wallpaper",
      defaultValue: undefined,
    },
  },
  render: () => null,
});

const badge = defineBlock<{
  ring: string;
  fill: string;
  ink: string;
  rim: string;
  label: string;
}>({
  type: "badge",
  label: "Badge",
  schema: {
    ring: { kind: SchemaKind.surface, label: "Ring", defaultValue: "none" },
    fill: { kind: SchemaKind.surface, label: "Fill", defaultValue: "none" },
    ink: { kind: SchemaKind.color, label: "Ink", defaultValue: "#333333" },
    // Drawn on the ring, under the fill.
    rim: {
      kind: SchemaKind.color,
      label: "Rim",
      defaultValue: "#333333",
      on: "ring",
    },
    label: { kind: SchemaKind.text, label: "Label", defaultValue: "Hi" },
  },
  render: () => null,
});

const definitions = [page, card, badge];

const WALLPAPER: Asset = { src: "https://cdn.test/w.png", width: 8, height: 8 };

/** A badge inside a card on a page, selected. */
function editorWith(
  props: {
    readonly page?: Readonly<Record<string, unknown>>;
    readonly card?: Readonly<Record<string, unknown>>;
    readonly badge?: Readonly<Record<string, unknown>>;
  } = {},
) {
  const editor = editorFor(
    documentOf(
      block("page", props.page ?? {}, [
        block("card", props.card ?? {}, [
          block("badge", { id: "badge", ...props.badge }),
        ]),
      ]),
    ),
    { definitions },
  );
  editor.select("badge");
  return editor;
}

const againstOf = (editor: ReturnType<typeof editorWith>, name: string) =>
  editor.getControls().find((control) => control.name === name)?.against;

describe("a colour control's `against`", () => {
  it("is the Block's own Surface when it has one", () => {
    expect(againstOf(editorWith({ badge: { fill: "#123456" } }), "ink")).toBe(
      "#123456",
    );
  });

  it("is the top Surface of the Block when it has two", () => {
    const editor = editorWith({ badge: { ring: "#ff0000", fill: "#00ff00" } });

    expect(againstOf(editor, "ink")).toBe("#00ff00");
  });

  it("is the Surface the entry names with `on`, even under another", () => {
    const editor = editorWith({ badge: { ring: "#ff0000", fill: "#00ff00" } });

    expect(againstOf(editor, "rim")).toBe("#ff0000");
  });

  it("looks beneath a named Surface that is None", () => {
    const editor = editorWith({
      card: { column: "#0000ff" },
      badge: { fill: "#00ff00" },
    });

    // The ring is None, so the rim shows the card through it, never the fill
    // that sits above the ring.
    expect(againstOf(editor, "rim")).toBe("#0000ff");
  });

  it("is the nearest ancestor's top Surface when the Block's are None", () => {
    expect(
      againstOf(
        editorWith({ card: { band: "#111111", column: "#222222" } }),
        "ink",
      ),
    ).toBe("#222222");
    expect(againstOf(editorWith({ card: { band: "#111111" } }), "ink")).toBe(
      "#111111",
    );
    expect(againstOf(editorWith(), "ink")).toBe("#ffffff");
  });

  it("is nothing when a background image lies between", () => {
    const editor = editorWith({
      card: { column: "#222222", wallpaper: WALLPAPER },
    });

    expect(againstOf(editor, "ink")).toBeUndefined();
  });

  it("is a Surface above the image, when there is one", () => {
    const editor = editorWith({
      card: { wallpaper: WALLPAPER },
      badge: { fill: "#00ff00" },
    });

    expect(againstOf(editor, "ink")).toBe("#00ff00");
  });

  it("is nothing when what is beneath cannot be read", () => {
    const editor = editorWith({ card: { column: "var(--brand)" } });

    expect(againstOf(editor, "ink")).toBeUndefined();
  });

  it("is nothing when nothing beneath has a colour", () => {
    expect(againstOf(editorWith({ page: { paper: "none" } }), "ink")).toBe(
      undefined,
    );
  });

  it("is only on colour controls", () => {
    const editor = editorWith({ badge: { fill: "#00ff00" } });

    expect(againstOf(editor, "label")).toBeUndefined();
    expect(againstOf(editor, "fill")).toBeUndefined();
  });

  it("reads the stored Document, not a Pending Change", () => {
    const editor = editorWith({ badge: { fill: "#00ff00" } });

    editor
      .getControls()
      .find((control) => control.name === "fill")
      ?.preview("#000000");

    expect(againstOf(editor, "ink")).toBe("#00ff00");
  });
});

describe("a colour entry's `on`", () => {
  it("must name a Surface on the same Block", () => {
    expect(() =>
      defineBlock<{ ink: string; label: string }>({
        type: "bad",
        label: "Bad",
        schema: {
          ink: {
            kind: SchemaKind.color,
            label: "Ink",
            defaultValue: "#000000",
            on: "label",
          },
          label: { kind: SchemaKind.text, label: "Label", defaultValue: "" },
        },
        render: () => null,
      }),
    ).toThrow(/Surface/u);
  });
});
