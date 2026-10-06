import { describe, expect, it } from "vitest";

import { createDocument, createEditor, type EmailDocument } from "../../index";
import {
  definitions,
  definitionsWithRequired,
  sequentialIds,
} from "../../testing/blocks";

const options = { definitions, rootType: "email", createId: sequentialIds() };

describe("the Document", () => {
  it("is plain serialisable data", () => {
    const editor = createEditor({ ...options, createId: sequentialIds() });
    editor.insertBlock("text", editor.getDocument().root.id);

    const document = editor.getDocument();
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it("has an ordinary Block at its root, carrying the email-wide settings", () => {
    const editor = createEditor({ ...options, createId: sequentialIds() });
    const root = editor.getDocument().root;

    expect(root.type).toBe("email");
    expect(root.id).toBe("id-1");
    expect(editor.getControls().map((control) => control.name)).toEqual([
      "backgroundColor",
      "contentWidth",
      "previewText",
    ]);
  });

  it("gives every Block a stable identity", () => {
    const editor = createEditor({ ...options, createId: sequentialIds() });
    const first = editor.insertBlock("text", editor.getDocument().root.id);
    const second = editor.insertBlock("text", editor.getDocument().root.id);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it("stores nothing an Author has not set", () => {
    const editor = createEditor({ ...options, createId: sequentialIds() });
    const id = editor.insertBlock("text", editor.getDocument().root.id);

    expect(editor.getBlock(id ?? "")?.props).toEqual({});
  });

  it("resolves an unset prop to its Schema default", () => {
    const editor = createEditor({ ...options, createId: sequentialIds() });
    const id = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.select(id);

    const fontSize = editor
      .getControls()
      .find((control) => control.name === "fontSize");
    expect(fontSize?.value).toBe(14);
  });

  it("prefers a stored value over the Schema default", () => {
    const editor = createEditor({ ...options, createId: sequentialIds() });
    const id = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.setProp(id, "fontSize", 22);
    editor.select(id);

    expect(
      editor.getControls().find((control) => control.name === "fontSize")
        ?.value,
    ).toBe(22);
  });

  it("round-trips unchanged when loaded and saved without edits", () => {
    const stored: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: { contentWidth: 640 },
        children: [
          { id: "a", type: "text", props: { content: "Hello" } },
          { id: "b", type: "section", props: {}, children: [] },
        ],
      },
    };

    const editor = createEditor({ definitions, document: stored });

    expect(editor.getDocument()).toEqual(stored);
    expect(editor.getDocument()).toBe(stored);
  });

  it("takes its root type from the Document it was given", () => {
    const stored: EmailDocument = {
      root: { id: "root", type: "email", props: {}, children: [] },
    };

    expect(createEditor({ definitions, document: stored }).getDocument()).toBe(
      stored,
    );
  });
});

describe("a new Document", () => {
  it("is seeded with the Required Blocks", () => {
    const editor = createEditor({
      definitions: definitionsWithRequired(),
      rootType: "email",
      createId: sequentialIds(),
    });

    expect(
      editor.getDocument().root.children?.map((child) => child.type),
    ).toEqual(["unsubscribe"]);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("can be built without standing up an editor", () => {
    const document = createDocument({
      definitions: definitionsWithRequired(),
      rootType: "email",
      createId: sequentialIds(),
    });

    expect(document.root.type).toBe("email");
    expect(document.root.children).toHaveLength(1);
  });
});
