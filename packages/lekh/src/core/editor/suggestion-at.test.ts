import { describe, expect, it } from "vitest";

import type { Editor } from "../../index";
import { editorFor, setProp, suggested } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/** Two text Blocks, `a` and `b`. */
function email(): Editor {
  return editorFor(
    documentOf(
      block("email", {}, [
        block("text", { id: "a", props: { fontSize: 14 } }),
        block("text", { id: "b", props: { fontSize: 14 } }),
      ]),
    ),
  );
}

const idsAt = (editor: Editor, blockId: string): string[] =>
  editor.getSuggestionsAt(blockId).map((suggestion) => suggestion.id);

// ADR-0042: the Suggestion in front is read from the selection.
describe("the Suggestions at a Block", () => {
  it("are none when nothing is open", () => {
    expect(email().getSuggestionsAt("a")).toEqual([]);
  });

  it("are only the ones touching it", () => {
    const editor = email();
    const onA = suggested(editor, [setProp("a", "fontSize", 20)]);
    suggested(editor, [setProp("b", "fontSize", 20)]);

    expect(idsAt(editor, "a")).toEqual([onA.id]);
  });

  it("count one touching several Blocks at each of them", () => {
    const editor = email();
    const both = suggested(editor, [
      setProp("a", "fontSize", 20),
      setProp("b", "fontSize", 20),
    ]);

    expect(idsAt(editor, "a")).toEqual([both.id]);
    expect(idsAt(editor, "b")).toEqual([both.id]);
  });

  it("count a Block one inserts", () => {
    const editor = email();
    const insert = suggested(editor, [
      { kind: "insert", id: "new", type: "text", after: "b" },
    ]);

    expect(idsAt(editor, "new")).toEqual([insert.id]);
  });

  it("put the newest first when several are open", () => {
    const editor = email();
    const first = suggested(editor, [setProp("a", "fontSize", 20)]);
    const second = suggested(editor, [setProp("a", "content", "Hi")]);
    const third = suggested(editor, [setProp("a", "fontSize", 24)]);

    expect(idsAt(editor, "a")).toEqual([third.id, second.id, first.id]);
  });

  it("never put a stale one first", () => {
    const editor = email();
    const older = suggested(editor, [setProp("a", "content", "Hi")]);
    const newer = suggested(editor, [setProp("a", "fontSize", 20)]);

    editor.setProp("a", "fontSize", 16);

    expect(editor.getSuggestionsAt("a")).toMatchObject([
      { id: older.id, status: "open" },
      { id: newer.id, status: "stale" },
    ]);
  });

  it("put one still arriving after the finished ones", () => {
    const editor = email();
    const finished = suggested(editor, [setProp("a", "fontSize", 20)]);
    const arriving = suggested(editor, [setProp("a", "content", "Hi")], {
      streaming: true,
    });

    expect(idsAt(editor, "a")).toEqual([finished.id, arriving.id]);
  });

  it("put one still arriving before a stale one", () => {
    const editor = email();
    const arriving = suggested(editor, [setProp("a", "content", "Hi")], {
      streaming: true,
    });
    const stale = suggested(editor, [setProp("a", "fontSize", 20)]);
    editor.setProp("a", "fontSize", 16);

    expect(idsAt(editor, "a")).toEqual([arriving.id, stale.id]);
  });

  it("order one that finishes by when it was suggested", () => {
    const editor = email();
    const arriving = suggested(editor, [setProp("a", "content", "Hi")], {
      streaming: true,
    });
    const finished = suggested(editor, [setProp("a", "fontSize", 20)]);

    arriving.finish();

    expect(idsAt(editor, "a")).toEqual([finished.id, arriving.id]);
  });

  it("drop one once it is accepted or rejected", () => {
    const editor = email();
    const accepted = suggested(editor, [setProp("a", "fontSize", 20)]);
    const rejected = suggested(editor, [setProp("a", "content", "Hi")]);

    accepted.accept();
    rejected.reject();

    expect(editor.getSuggestionsAt("a")).toEqual([]);
  });

  it("are the same array until a Suggestion comes, goes or changes", () => {
    const editor = email();
    suggested(editor, [setProp("a", "fontSize", 20)]);

    expect(editor.getSuggestionsAt("a")).toBe(editor.getSuggestionsAt("a"));
  });
});
