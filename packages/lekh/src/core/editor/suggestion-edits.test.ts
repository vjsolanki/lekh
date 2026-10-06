import { beforeEach, describe, expect, it } from "vitest";

import {
  DiagnosticCode,
  type Edit,
  type Editor,
  type EmailDocument,
  type Op,
  type SuggestionEvent,
} from "../../index";
import {
  definitionsWithRequired,
  definitionsWithSeeded,
  image,
} from "../../testing/blocks";
import { editorFor, suggested } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/** The ids of a container's children, in order. */
const childIds = (
  document: EmailDocument,
  parentId: string,
): readonly string[] => {
  const find = (
    current: EmailDocument["root"],
  ): EmailDocument["root"] | undefined =>
    current.id === parentId
      ? current
      : current.children?.reduce<EmailDocument["root"] | undefined>(
          (found, child) => found ?? find(child),
          undefined,
        );
  return (find(document.root)?.children ?? []).map((child) => child.id);
};

const picture = { src: "https://cdn.example/a.png", width: 600, height: 300 };

// ADR-0035 and ADR-0036: a Suggestion adds, removes and moves Blocks, placed
// by identity, and refuses whole what cannot apply.
describe("a Suggestion's insert, remove and move Edits", () => {
  let editor: Editor;
  let ops: Op[];
  let events: SuggestionEvent[];

  const suggest = (...edits: Edit[]) => suggested(editor, edits);

  const shownIds = (parentId: string) =>
    childIds(editor.getDocumentWithSuggestions(), parentId);

  const storedIds = (parentId: string) =>
    childIds(editor.getDocument(), parentId);

  beforeEach(() => {
    editor = editorFor(
      documentOf(
        block("email", { id: "root" }, [
          block("text", { id: "a", fontSize: 14 }),
          block("section", { id: "s" }, [block("text", { id: "b" })]),
          block("grid", { id: "g" }, [
            block("cell", { id: "c1" }),
            block("cell", { id: "c2" }),
          ]),
        ]),
      ),
      { definitions: definitionsWithSeeded },
    );
    ops = [];
    editor.onOp((op) => {
      ops.push(op);
    });
    events = [];
    editor.subscribeToSuggestions((event) => {
      events.push(event);
    });
  });

  describe("insert", () => {
    it("places after a sibling, shown and not stored until accepted", () => {
      const suggestion = suggest({
        kind: "insert",
        type: "text",
        after: "a",
        id: "p",
      });

      expect(shownIds("root")).toEqual(["a", "p", "s", "g"]);
      expect(storedIds("root")).toEqual(["a", "s", "g"]);
      expect(ops).toEqual([]);

      expect(suggestion.accept()).toBe("accepted");
      expect(storedIds("root")).toEqual(["a", "p", "s", "g"]);
      expect(ops).toMatchObject([
        { kind: "insert", origin: "local", parentId: "root", index: 1 },
      ]);

      editor.undo();
      expect(storedIds("root")).toEqual(["a", "s", "g"]);
      expect(editor.canUndo()).toBe(false);
    });

    it("places before a sibling", () => {
      suggest({ kind: "insert", type: "text", before: "b", id: "p" });

      expect(shownIds("s")).toEqual(["p", "b"]);
    });

    it("places at the end of a parent", () => {
      suggest({ kind: "insert", type: "text", parent: "c1", id: "p" });

      expect(shownIds("c1")).toEqual(["p"]);
    });

    it("takes a parent beside a sibling, when the sibling is in it", () => {
      suggest({
        kind: "insert",
        type: "text",
        parent: "root",
        after: "a",
        id: "p",
      });

      expect(shownIds("root")).toEqual(["a", "p", "s", "g"]);
    });

    it("stores the props it was given", () => {
      suggest({
        kind: "insert",
        type: "text",
        after: "a",
        id: "p",
        props: { fontSize: 20 },
      }).accept();

      expect(editor.getBlock("p")?.props).toEqual({ fontSize: 20 });
    });

    it("lets later Edits name a Block an earlier one inserted", () => {
      suggest(
        { kind: "insert", type: "section", after: "a", id: "box" },
        { kind: "insert", type: "text", parent: "box", id: "inner" },
        { kind: "set-prop", blockId: "inner", prop: "fontSize", value: 30 },
        { kind: "move", blockId: "a", parent: "box" },
      ).accept();

      expect(storedIds("box")).toEqual(["inner", "a"]);
      expect(editor.getBlock("inner")?.props).toEqual({ fontSize: 30 });
    });

    it("picks an id when given none, the same one shown and accepted", () => {
      const suggestion = suggest({ kind: "insert", type: "text", after: "a" });
      const shownId = shownIds("root")[1];

      expect(suggestion.touches[0]?.blockId).toBe(shownId);
      expect(editor.getDocumentWithSuggestions()).toBe(
        editor.getDocumentWithSuggestions(),
      );
      // Moving the Document rebuilds what is shown, with the same id.
      editor.setProp("a", "fontSize", 18);
      expect(shownIds("root")[1]).toBe(shownId);

      suggestion.accept();
      expect(storedIds("root")[1]).toBe(shownId);
    });

    it("creates a container's Structural Blocks, as inserting one by hand does", () => {
      suggest({ kind: "insert", type: "grid", after: "a", id: "g2" }).accept();

      expect(
        editor.getBlock("g2")?.children?.map((child) => child.type),
      ).toEqual(["cell", "cell"]);
    });

    it("adds a Structural Block through the parent that owns it", () => {
      suggest({ kind: "insert", type: "cell", parent: "g", id: "c3" }).accept();

      expect(storedIds("g")).toEqual(["c1", "c2", "c3"]);
    });
  });

  describe("remove", () => {
    it("takes a Block out, and undo puts it back", () => {
      const suggestion = suggest({ kind: "remove", blockId: "s" });

      expect(shownIds("root")).toEqual(["a", "g"]);
      expect(storedIds("root")).toEqual(["a", "s", "g"]);

      suggestion.accept();
      expect(storedIds("root")).toEqual(["a", "g"]);
      editor.undo();
      expect(storedIds("root")).toEqual(["a", "s", "g"]);
      expect(storedIds("s")).toEqual(["b"]);
    });
  });

  describe("move", () => {
    it("places after a new sibling", () => {
      suggest({ kind: "move", blockId: "a", after: "s" }).accept();

      expect(storedIds("root")).toEqual(["s", "a", "g"]);
    });

    it("places before a sibling in another parent", () => {
      suggest({ kind: "move", blockId: "a", before: "b" }).accept();

      expect(storedIds("root")).toEqual(["s", "g"]);
      expect(storedIds("s")).toEqual(["a", "b"]);
    });

    it("places at the end of a parent", () => {
      suggest({ kind: "move", blockId: "a", parent: "c2" }).accept();

      expect(storedIds("c2")).toEqual(["a"]);
    });

    it("writes nothing when the Block is already there", () => {
      suggest({ kind: "move", blockId: "s", after: "a" }).accept();

      expect(ops).toEqual([]);
      expect(editor.canUndo()).toBe(false);
    });
  });

  it("accepts every kind of Edit together as one undo step", () => {
    const before = editor.getDocument();
    suggest(
      { kind: "set-prop", blockId: "a", prop: "fontSize", value: 20 },
      { kind: "insert", type: "text", after: "a", id: "p" },
      { kind: "remove", blockId: "b" },
      { kind: "move", blockId: "a", parent: "s" },
    ).accept();
    const after = editor.getDocument();

    expect(storedIds("root")).toEqual(["p", "s", "g"]);
    expect(storedIds("s")).toEqual(["a"]);

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toEqual(before);
    expect(editor.canUndo()).toBe(false);

    editor.redo();
    expect(editor.getDocument()).toEqual(after);
  });

  it("reports which Blocks and props it touches", () => {
    const suggestion = suggest(
      { kind: "set-prop", blockId: "a", prop: "fontSize", value: 20 },
      { kind: "insert", type: "text", after: "a", id: "p" },
      { kind: "set-prop", blockId: "p", prop: "fontSize", value: 9 },
      { kind: "remove", blockId: "b" },
      { kind: "move", blockId: "a", parent: "s" },
    );

    expect(suggestion.touches).toEqual([
      { blockId: "a", change: "move", props: ["fontSize"] },
      { blockId: "p", change: "insert", props: ["fontSize"] },
      { blockId: "b", change: "remove", props: [] },
    ]);
  });

  describe("refused", () => {
    /** Suggest Edits as an Agent sends them: JSON, unchecked. */
    const refusal = (...edits: unknown[]) => {
      // A method's parameters compare both ways, so this takes anything.
      const unchecked: {
        suggest(edits: readonly unknown[]): ReturnType<Editor["suggest"]>;
      } = editor;
      const result = unchecked.suggest(edits);
      if (result.status !== "refused") throw new Error("not refused");
      return result.reasons;
    };

    it("shows nothing, tells nobody, and says why for each Edit that cannot apply", () => {
      const reasons = refusal(
        { kind: "set-prop", blockId: "a", prop: "fontSize", value: 20 },
        { kind: "remove", blockId: "nope" },
        { kind: "set-prop", blockId: "a", prop: "colour", value: "red" },
      );

      expect(reasons).toMatchObject([
        { index: 1, code: "missing-block" },
        { index: 2, code: "unknown-prop" },
      ]);
      expect(reasons.map((reason) => reason.message)).toEqual([
        'No Block has the id "nope".',
        'This Block has no prop "colour".',
      ]);
      expect(editor.getSuggestions()).toEqual([]);
      expect(events).toEqual([]);
      expect(editor.getDocumentWithSuggestions()).toBe(editor.getDocument());
    });

    it.each<[string, readonly unknown[], string]>([
      [
        "a missing Block",
        [{ kind: "set-prop", blockId: "nope", prop: "fontSize", value: 1 }],
        "missing-block",
      ],
      [
        "a missing sibling",
        [{ kind: "insert", type: "text", after: "nope" }],
        "missing-block",
      ],
      [
        "a missing parent",
        [{ kind: "move", blockId: "a", parent: "nope" }],
        "missing-block",
      ],
      [
        "a type nobody registered",
        [{ kind: "insert", type: "carousel", after: "a" }],
        "unknown-type",
      ],
      [
        "a type its parent won't take",
        [{ kind: "insert", type: "section", parent: "s" }],
        "not-accepted",
      ],
      [
        "a parent that is full",
        [
          { kind: "insert", type: "text", parent: "s" },
          { kind: "insert", type: "text", parent: "s" },
        ],
        "at-capacity",
      ],
      [
        "a move into its own subtree",
        [{ kind: "move", blockId: "s", parent: "s" }],
        "own-subtree",
      ],
      [
        "an id already taken",
        [{ kind: "insert", type: "text", after: "a", id: "b" }],
        "duplicate-id",
      ],
      [
        "an insert with no place",
        [{ kind: "insert", type: "text" }],
        "no-place",
      ],
      [
        "a parent that does not hold the sibling",
        [{ kind: "insert", type: "text", parent: "s", after: "a" }],
        "no-place",
      ],
      [
        "a place beside the root",
        [{ kind: "insert", type: "text", after: "root" }],
        "no-place",
      ],
      [
        "an unknown prop",
        [{ kind: "set-prop", blockId: "a", prop: "colour", value: "red" }],
        "unknown-prop",
      ],
      [
        "an unknown prop on an insert",
        [{ kind: "insert", type: "text", after: "a", props: { colour: "x" } }],
        "unknown-prop",
      ],
      [
        "a value of the wrong shape",
        [{ kind: "set-prop", blockId: "a", prop: "fontSize", value: "big" }],
        "wrong-shape",
      ],
      [
        "a value of the wrong shape on an insert",
        [
          {
            kind: "insert",
            type: "text",
            after: "a",
            props: { fontSize: "big" },
          },
        ],
        "wrong-shape",
      ],
      [
        "a raw URL on an Asset prop",
        [
          {
            kind: "insert",
            type: "image",
            after: "a",
            props: { asset: "https://cdn.example/a.png" },
          },
        ],
        "wrong-shape",
      ],
      [
        "a remove out of a container at its minimum",
        [{ kind: "remove", blockId: "c1" }],
        "at-minimum",
      ],
      [
        "a move out of a container at its minimum",
        [
          { kind: "insert", type: "grid", after: "a", id: "g2" },
          { kind: "move", blockId: "c1", parent: "g2" },
        ],
        "at-minimum",
      ],
      ["removing the root", [{ kind: "remove", blockId: "root" }], "is-root"],
      ["an Edit that is not one", [{ kind: "explode" }], "malformed"],
      [
        "an Edit missing a field",
        [{ kind: "remove", blockId: 4 }],
        "malformed",
      ],
    ])("for %s", (_, edits, code) => {
      expect(refusal(...edits).map((reason) => reason.code)).toContain(code);
    });

    it("for removing a Block that may not be deleted", () => {
      editor = editorFor(
        documentOf(block("email", {}, [block("unsubscribe", { id: "u" })])),
        { definitions: definitionsWithRequired({ deletable: false }) },
      );

      expect(refusal({ kind: "remove", blockId: "u" })).toMatchObject([
        { index: 0, code: "not-deletable" },
      ]);
    });

    it("blames a later Edit's missing Block on the refused insert that would have made it", () => {
      const reasons = refusal(
        { kind: "insert", type: "text", after: "a", id: "n", props: { x: 1 } },
        { kind: "set-prop", blockId: "n", prop: "fontSize", value: 20 },
      );

      expect(reasons).toMatchObject([
        { index: 0, code: "unknown-prop" },
        { index: 1, code: "missing-block" },
      ]);
      expect(reasons[1]?.message).toBe(
        'Block "n" is not there: the Edit at 0 that inserts it was refused.',
      );
    });

    it("for an id another open Suggestion inserts", () => {
      suggest({ kind: "insert", type: "text", after: "a", id: "n" });

      expect(
        refusal(
          { kind: "set-prop", blockId: "a", prop: "fontSize", value: 20 },
          { kind: "insert", type: "text", after: "b", id: "n" },
        ),
      ).toMatchObject([{ index: 1, code: "duplicate-id" }]);
    });

    it("for an Asset its prop does not list, on an insert", () => {
      const logo = { src: "https://cdn.example/logo.png", width: 1, height: 1 };
      editor = editorFor(documentOf(block("email", {}, [block("text")])), {
        definitions: definitionsWithSeeded.map((definition) =>
          definition.type === "image"
            ? {
                ...definition,
                schema: {
                  asset: {
                    ...image.schema.asset,
                    constraints: { options: [{ label: "Logo", asset: logo }] },
                  },
                },
              }
            : definition,
        ),
      });
      const insert = (asset: unknown) =>
        editor.suggest([
          { kind: "insert", type: "image", after: "text-1", props: { asset } },
        ]);

      expect(insert(picture)).toMatchObject({
        status: "refused",
        reasons: [{ code: "unlisted-asset" }],
      });
      expect(insert(logo).status).toBe("open");
    });

    it("with no reasons when there are no Edits", () => {
      expect(refusal()).toEqual([]);
    });

    it("takes a resolved Asset", () => {
      suggest({
        kind: "insert",
        type: "image",
        after: "a",
        id: "i",
        props: { asset: { ...picture, alt: "A" } },
      }).accept();

      expect(editor.getBlock("i")?.props["asset"]).toEqual({
        ...picture,
        alt: "A",
      });
    });
  });

  describe("Diagnostics", () => {
    it("are those of the Document as it would read after accepting", () => {
      const before = editor.getDiagnostics();

      const suggestion = suggest({
        kind: "insert",
        type: "image",
        after: "a",
        id: "i",
        props: { asset: picture },
      });

      expect(suggestion.diagnostics).toMatchObject([
        { code: "image-alt-text-missing", blockId: "i" },
      ]);
      expect(editor.getDiagnostics()).toBe(before);
    });

    it("do not stop it being accepted", () => {
      editor = editorFor(
        documentOf(block("email", {}, [block("unsubscribe", { id: "u" })])),
        { definitions: definitionsWithRequired() },
      );

      const suggestion = suggest({ kind: "remove", blockId: "u" });

      expect(suggestion.diagnostics).toMatchObject([
        { code: DiagnosticCode.requiredBlockMissing },
      ]);
      expect(suggestion.accept()).toBe("accepted");
      expect(editor.getBlock("u")).toBeUndefined();
    });
  });
});
