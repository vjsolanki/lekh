import { describe, expect, it } from "vitest";

import {
  createEditor,
  defineBlock,
  type BlockDefinition,
  type EmailDocument,
} from "../../index";
import { definitions, email } from "../../testing/blocks";

/** The fixture root, widened to accept the Block this suite versions. */
const emailRoot: BlockDefinition = {
  ...email,
  accepts: [...(email.accepts ?? []), "banner"],
};

/** A Block Definition that has been through two rounds of renaming. */
const banner: BlockDefinition = defineBlock<{ heading: string; tone: string }>({
  type: "banner",
  label: "Banner",
  version: 3,
  migrations: {
    2: ({ props, mobile }) => ({
      props: { heading: props["title"], tone: props["tone"] },
      mobile,
    }),
    3: ({ props, mobile }) => ({
      props: {
        ...props,
        tone: props["tone"] === "loud" ? "primary" : props["tone"],
      },
      mobile,
    }),
  },
  schema: {
    heading: { kind: "text", label: "Heading", defaultValue: "" },
    tone: { kind: "select", label: "Tone", defaultValue: "default" },
  },
  render: ({ props }) => <h1>{props.heading}</h1>,
});

const withBanner = [emailRoot, banner];

function load(document: EmailDocument, set = withBanner) {
  return createEditor({ definitions: set, document });
}

describe("migrations", () => {
  it("run automatically on load, so old Documents keep working", () => {
    const editor = load({
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          { id: "a", type: "banner", props: { title: "Sale" }, version: 1 },
        ],
      },
    });

    expect(editor.getBlock("a")?.props).toEqual({
      heading: "Sale",
      tone: undefined,
    });
    expect(editor.getBlock("a")?.version).toBe(3);
  });

  it("run in order from the stored version to the current one", () => {
    const editor = load({
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          {
            id: "a",
            type: "banner",
            props: { title: "Sale", tone: "loud" },
            version: 1,
          },
        ],
      },
    });

    // v1 -> v2 renames title, v2 -> v3 rewrites the tone. Skipping either
    // would leave a different result.
    expect(editor.getBlock("a")?.props).toEqual({
      heading: "Sale",
      tone: "primary",
    });
  });

  it("treat a missing version as version 0", () => {
    const editor = load({
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "a", type: "banner", props: { title: "Sale" } }],
      },
    });

    expect(editor.getBlock("a")?.version).toBe(3);
  });

  it("leave a Block already at the current version untouched", () => {
    const stored: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          { id: "a", type: "banner", props: { heading: "Hi" }, version: 3 },
        ],
      },
    };

    expect(load(stored).getDocument()).toBe(stored);
  });

  it("stamp the current version onto Blocks the editor creates", () => {
    const editor = load({
      root: { id: "root", type: "email", props: {}, children: [] },
    });
    const id = editor.insertBlock("banner", "root") ?? "";

    expect(editor.getBlock(id)?.version).toBe(3);
  });

  it("keep the overrides of a migration that passes mobile through", () => {
    const editor = load({
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          {
            id: "a",
            type: "banner",
            props: { title: "Sale" },
            mobile: { tone: "quiet" },
            version: 1,
          },
        ],
      },
    });

    expect(editor.getBlock("a")?.mobile).toEqual({ tone: "quiet" });
  });

  it("let a migration rename an overridden prop in mobile too", () => {
    const renamer = defineBlock<{ size: number }>({
      type: "banner",
      label: "Banner",
      version: 1,
      migrations: {
        1: ({ props, mobile }) => ({
          props: { size: props["scale"] },
          mobile: mobile && { size: mobile["scale"] },
        }),
      },
      schema: { size: { kind: "number", label: "Size", defaultValue: 1 } },
      render: () => <h1 />,
    });
    const editor = load(
      {
        root: {
          id: "root",
          type: "email",
          props: {},
          children: [
            {
              id: "a",
              type: "banner",
              props: { scale: 3 },
              mobile: { scale: 2 },
            },
          ],
        },
      },
      [emailRoot, renamer],
    );

    expect(editor.getBlock("a")?.props).toEqual({ size: 3 });
    expect(editor.getBlock("a")?.mobile).toEqual({ size: 2 });
  });

  it("drop the overrides when a migration returns no mobile", () => {
    const forgetful = defineBlock<{ heading: string }>({
      type: "banner",
      label: "Banner",
      version: 1,
      migrations: { 1: ({ props }) => ({ props: { ...props } }) },
      schema: { heading: { kind: "text", label: "Heading", defaultValue: "" } },
      render: () => <h1 />,
    });
    const editor = load(
      {
        root: {
          id: "root",
          type: "email",
          props: {},
          children: [
            {
              id: "a",
              type: "banner",
              props: { heading: "Hi" },
              mobile: { heading: "Yo" },
            },
          ],
        },
      },
      [emailRoot, forgetful],
    );

    expect(editor.getBlock("a")).not.toHaveProperty("mobile");
  });

  it("skip Blocks whose type is not registered", () => {
    const editor = load(
      {
        root: {
          id: "root",
          type: "email",
          props: {},
          children: [
            { id: "a", type: "banner", props: { title: "Sale" }, version: 1 },
          ],
        },
      },
      [email],
    );

    // Preservation and migration must not contradict each other.
    expect(editor.getBlock("a")?.props).toEqual({ title: "Sale" });
    expect(editor.getBlock("a")?.version).toBe(1);
  });
});

describe("a Block whose type is not registered", () => {
  const stored: EmailDocument = {
    root: {
      id: "root",
      type: "email",
      props: {},
      children: [
        { id: "known", type: "text", props: {} },
        {
          id: "alien",
          type: "product-grid",
          props: { skus: ["a", "b"], layout: { columns: 3 } },
          children: [{ id: "alien-child", type: "product", props: {} }],
        },
      ],
    },
  };

  it("is preserved exactly as stored", () => {
    const editor = createEditor({ definitions, document: stored });

    expect(editor.getDocument()).toBe(stored);
    expect(editor.getBlock("alien")).toEqual(stored.root.children?.[1]);
  });

  it("survives edits elsewhere in the Document", () => {
    const editor = createEditor({ definitions, document: stored });
    editor.setProp("known", "fontSize", 20);

    expect(editor.getBlock("alien")).toBe(stored.root.children?.[1]);
  });

  it("is movable", () => {
    const editor = createEditor({ definitions, document: stored });

    expect(editor.moveBlock("alien", "root", 0)).toBe(true);
    expect(
      editor.getDocument().root.children?.map((child) => child.id),
    ).toEqual(["alien", "known"]);
  });

  it("is deletable", () => {
    const editor = createEditor({ definitions, document: stored });

    expect(editor.removeBlock("alien")).toBe(true);
    expect(editor.getBlock("alien")).toBeUndefined();
  });

  it("is unselectable", () => {
    const editor = createEditor({ definitions, document: stored });

    expect(editor.select("alien")).toBe(false);
    expect(editor.getSelection()).toBeUndefined();
  });

  it("is uneditable", () => {
    const editor = createEditor({ definitions, document: stored });

    expect(editor.setProp("alien", "layout", null)).toBe(false);
    expect(editor.getBlock("alien")).toBe(stored.root.children?.[1]);
  });

  it("round-trips through a save with no edits at all", () => {
    const editor = createEditor({ definitions, document: stored });

    expect(JSON.stringify(editor.getDocument())).toBe(JSON.stringify(stored));
  });
});
