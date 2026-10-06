import { describe, expect, it } from "vitest";

import type { ControlDescriptor, Editor } from "../../index";
import { editorFor, setProp, suggested } from "../../testing/editor";
import { block, documentOf } from "../../testing/tree";

/**
 * Each Control Descriptor carries what the front Suggestion would set it to,
 * on the Stage in view, so an Inspector draws the diff without matching Edits
 * to fields itself (ADR-0042).
 */

/** Two text Blocks, `a` and `b`, with `a` selected. */
function email(): Editor {
  const editor = editorFor(
    documentOf(
      block("email", {}, [
        block("text", { id: "a", props: { fontSize: 14 } }),
        block("text", { id: "b", props: { fontSize: 14 } }),
      ]),
    ),
  );
  editor.select("a");
  return editor;
}

const control = (editor: Editor, name: string): ControlDescriptor => {
  const found = editor.getControls().find((each) => each.name === name);
  if (!found) throw new Error(`No control for ${name}.`);
  return found;
};

describe("a descriptor's suggested value", () => {
  it("is absent when nothing is suggested", () => {
    expect(control(email(), "fontSize").suggested).toBeUndefined();
  });

  it("is what the front Suggestion would set, with its id", () => {
    const editor = email();
    const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);

    expect(control(editor, "fontSize").suggested).toEqual({
      value: 20,
      suggestionId: suggestion.id,
    });
    // The value stays the stored one, so the row can strike it through.
    expect(control(editor, "fontSize").value).toBe(14);
  });

  it("is on the props it sets and no others", () => {
    const editor = email();
    suggested(editor, [setProp("a", "fontSize", 20)]);

    expect(control(editor, "content").suggested).toBeUndefined();
  });

  it("is absent on another Block", () => {
    const editor = email();
    suggested(editor, [setProp("b", "fontSize", 20)]);

    expect(control(editor, "fontSize").suggested).toBeUndefined();
  });

  it("comes from the newest open one", () => {
    const editor = email();
    suggested(editor, [setProp("a", "fontSize", 20)]);
    const newest = suggested(editor, [setProp("a", "fontSize", 24)]);

    expect(control(editor, "fontSize").suggested).toEqual({
      value: 24,
      suggestionId: newest.id,
    });
  });

  it("is absent while the front one is still arriving", () => {
    const editor = email();
    suggested(editor, [setProp("a", "fontSize", 20)], { streaming: true });

    expect(control(editor, "fontSize").suggested).toBeUndefined();
  });

  it("is absent once the Suggestion goes stale", () => {
    const editor = email();
    suggested(editor, [setProp("a", "fontSize", 20)]);
    control(editor, "fontSize").set(16);

    expect(control(editor, "fontSize").suggested).toBeUndefined();
  });

  it("is absent once it is accepted or rejected", () => {
    const editor = email();
    suggested(editor, [setProp("a", "fontSize", 20)]).reject();

    expect(control(editor, "fontSize").suggested).toBeUndefined();
  });

  it("is absent when the Suggestion sets what is already there", () => {
    const editor = email();
    suggested(editor, [setProp("a", "fontSize", 14)]);

    expect(control(editor, "fontSize").suggested).toBeUndefined();
  });

  it("comes and goes with the Suggestion, without a change to the Document", () => {
    const editor = email();
    const before = editor.getControls();
    const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);
    const during = editor.getControls();

    expect(during).not.toBe(before);
    expect(editor.getControls()).toBe(during);

    suggestion.reject();
    expect(control(editor, "fontSize").suggested).toBeUndefined();
  });

  // ADR-0042: with nothing selected, nothing is in front, so the keys, the
  // card and the rows all show nothing.
  it("is absent on the root's rows when nothing is selected", () => {
    const editor = email();
    editor.select(undefined);
    suggested(editor, [
      setProp(editor.getDocument().root.id, "backgroundColor", "#000000"),
    ]);

    expect(control(editor, "backgroundColor").suggested).toBeUndefined();
  });

  describe("on each Stage", () => {
    it("shows a Mobile Override only on the mobile row", () => {
      const editor = email();
      const suggestion = suggested(
        editor,
        [{ kind: "set-prop", blockId: "a", prop: "fontSize", value: 12 }],
        { stage: "mobile" },
      );

      expect(control(editor, "fontSize").suggested).toBeUndefined();
      editor.setStage("mobile");
      expect(control(editor, "fontSize").suggested).toEqual({
        value: 12,
        suggestionId: suggestion.id,
      });
    });

    it("shows a desktop value on the mobile row it moves too", () => {
      const editor = email();
      const suggestion = suggested(editor, [setProp("a", "fontSize", 20)]);
      editor.setStage("mobile");

      expect(control(editor, "fontSize").suggested).toEqual({
        value: 20,
        suggestionId: suggestion.id,
      });
    });

    it("leaves the mobile row alone when its override holds", () => {
      const editor = email();
      editor.setStage("mobile");
      control(editor, "fontSize").set(12);
      editor.setStage("desktop");
      suggested(editor, [setProp("a", "fontSize", 20)]);
      editor.setStage("mobile");

      expect(control(editor, "fontSize").suggested).toBeUndefined();
    });
  });
});
