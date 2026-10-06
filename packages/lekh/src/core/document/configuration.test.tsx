import { describe, expect, it } from "vitest";

import {
  SchemaKind,
  createEditor,
  defineBlock,
  EditorConfigurationError,
  type BlockDefinition,
} from "../../index";
import {
  definitions,
  email,
  image,
  text,
  unsubscribe,
} from "../../testing/blocks";

/** A root that has not been told about the compliance Block. */
const narrowRoot: BlockDefinition = { ...email, accepts: ["section"] };

/** A root whose only child is the seeded container below. */
const gridRoot: BlockDefinition = { ...email, accepts: ["grid"] };

/** A Block the Author never places, of whatever type the caller needs. */
const structuralBlock = (type: string): BlockDefinition =>
  defineBlock<Record<string, never>>({
    type,
    label: type,
    structural: true,
    accepts: ["text"],
    schema: {},
    render: ({ children }) => <td>{children}</td>,
  });

/** A container claiming a minimum, over whichever types the caller names. */
const grid = (accepts: readonly string[]): BlockDefinition =>
  defineBlock<Record<string, never>>({
    type: "grid",
    label: "Grid",
    accepts,
    minChildren: 2,
    schema: {},
    render: ({ children }) => <tr>{children}</tr>,
  });

describe("constructing an editor", () => {
  it("composes the Block Definitions the Consumer passed in", () => {
    const editor = createEditor({
      definitions: [email, text],
      rootType: "email",
    });

    expect(editor.getDefinitions().map((one) => one.type)).toEqual([
      "email",
      "text",
    ]);
    expect(editor.canInsert("image", editor.getDocument().root.id)).toBe(false);
  });

  it("fails when a Required Block cannot be placed at the root", () => {
    // Restoring a Required Block appends it to the root, so a root that will
    // not accept it makes the repair impossible (ADR-0006). Surface it here,
    // not in front of an Author with an unsendable email.
    expect(() =>
      createEditor({
        definitions: [narrowRoot, text, unsubscribe()],
        rootType: "email",
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when the root cannot hold every Required Block", () => {
    const cappedRoot: BlockDefinition = {
      ...email,
      accepts: ["unsubscribe", "legal"],
      maxChildren: 1,
    };
    const legal = defineBlock<Record<string, never>>({
      type: "legal",
      label: "Legal footer",
      required: true,
      schema: {},
      render: () => <p>Legal</p>,
    });

    expect(() =>
      createEditor({
        definitions: [cappedRoot, unsubscribe(), legal],
        rootType: "email",
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when a prop the library writes is opted in to Mobile Overrides", () => {
    // A resolved Asset reaches the Document through `setProp` like any other
    // value, so an upload that finished while the Author was on the mobile
    // Stage would write an override instead — and an override on an `asset`
    // resolves to nothing, because `mobile` produces CSS and an Asset is not
    // CSS. The request would report success and no image would appear.
    const overridableImage: BlockDefinition = {
      ...image,
      schema: {
        ...image.schema,
        asset: { ...image.schema["asset"], mobile: () => ({}) },
      },
    };

    expect(() =>
      createEditor({
        definitions: [email, overridableImage],
        rootType: "email",
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when an optional Asset is opted in to Mobile Overrides", () => {
    // Optional or primary, the library still writes it (ADR-0026).
    const overridableBackdrop: BlockDefinition = {
      ...image,
      schema: {
        ...image.schema,
        backdrop: {
          kind: SchemaKind.asset,
          label: "Backdrop",
          defaultValue: undefined,
          mobile: () => ({}),
        },
      },
    };

    expect(() =>
      createEditor({
        definitions: [email, overridableBackdrop],
        rootType: "email",
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when a Definition declares two Primary Assets", () => {
    const twoPictures: BlockDefinition = {
      ...image,
      schema: { ...image.schema, second: image.schema["asset"] },
    };

    expect(() =>
      createEditor({ definitions: [email, twoPictures], rootType: "email" }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when a Primary Asset is decorative", () => {
    // The Block is the image, so its alt text is what a reader is told.
    const silentPicture: BlockDefinition = {
      ...image,
      schema: {
        ...image.schema,
        asset: { ...image.schema["asset"], decorative: true },
      },
    };

    expect(() =>
      createEditor({ definitions: [email, silentPicture], rootType: "email" }),
    ).toThrow(/decorative/u);
  });

  it.each([
    ["no src", { src: "", width: 64, height: 64 }],
    [
      "a zero width",
      { src: "https://cdn.example.com/a.png", width: 0, height: 64 },
    ],
    ["no size at all", { src: "https://cdn.example.com/a.png" }],
  ])("fails when an Asset prop lists one with %s (ADR-0030)", (_, asset) => {
    // A listed Asset enters the Document with no Image Request, so nothing
    // resolves it later: it has to be usable as it stands.
    const listing: BlockDefinition = {
      ...image,
      schema: {
        ...image.schema,
        badge: {
          kind: SchemaKind.asset,
          label: "Badge",
          defaultValue: undefined,
          constraints: { options: [{ label: "Broken", asset }] },
        },
      },
    };

    expect(() =>
      createEditor({ definitions: [email, listing], rootType: "email" }),
    ).toThrow(/"Broken"/u);
  });

  it("fails when two Block Definitions claim the same type", () => {
    expect(() =>
      createEditor({ definitions: [email, email], rootType: "email" }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when no Definition is registered for the root type", () => {
    expect(() =>
      createEditor({ definitions, rootType: "not-a-block" }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when given neither a root type nor a Document", () => {
    expect(() => createEditor({ definitions })).toThrow(TypeError);
  });
});

/** Defining a Block whose text has these constraints. */
const copy = (constraints: Record<string, unknown>) => () =>
  defineBlock<{ content: string }>({
    type: "copy",
    label: "Copy",
    schema: {
      content: {
        kind: "rich-text",
        label: "Content",
        defaultValue: "",
        constraints,
      },
    },
    render: () => null,
  });

// ADR-0029: a list needs the paragraphs under it.
describe("a rich-text prop that holds lists", () => {
  it("is defined alongside paragraphs", () => {
    expect(copy({ paragraphs: true, lists: true })).not.toThrow();
  });

  it("fails without paragraphs", () => {
    expect(copy({ lists: true })).toThrow(EditorConfigurationError);
    expect(copy({ paragraphs: false, lists: true })).toThrow(
      EditorConfigurationError,
    );
  });
});

describe("a container that seeds its own children", () => {
  it("constructs when exactly one accepted type is structural", () => {
    expect(() =>
      createEditor({
        definitions: [gridRoot, grid(["cell"]), structuralBlock("cell"), text],
        rootType: "email",
      }),
    ).not.toThrow();
  });

  it("fails when no accepted type is structural", () => {
    // `minChildren` says how many to create without saying what they are, so a
    // container with nothing structural among its accepted types would arrive
    // empty while claiming a minimum.
    expect(() =>
      createEditor({
        definitions: [gridRoot, grid(["text"]), text],
        rootType: "email",
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when two accepted types are structural", () => {
    // Seeding one of them would be a choice made by the order of `accepts`.
    expect(() =>
      createEditor({
        definitions: [
          gridRoot,
          grid(["cell", "gutter"]),
          structuralBlock("cell"),
          structuralBlock("gutter"),
          text,
        ],
        rootType: "email",
      }),
    ).toThrow(EditorConfigurationError);
  });

  it("fails when the seeded type declares a minimum of its own", () => {
    // Seeding is one level deep, so these cells would arrive already below the
    // minimum they declared, and no Author gesture could put it right.
    const seedingCell = defineBlock<Record<string, never>>({
      type: "cell",
      label: "Cell",
      structural: true,
      accepts: ["atom"],
      minChildren: 3,
      schema: {},
      render: ({ children }) => <td>{children}</td>,
    });

    expect(() =>
      createEditor({
        definitions: [
          gridRoot,
          grid(["cell"]),
          seedingCell,
          structuralBlock("atom"),
          text,
        ],
        rootType: "email",
      }),
    ).toThrow(EditorConfigurationError);
  });
});
