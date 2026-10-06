import { describe, expect, it } from "vitest";

import { createEditor, type EmailDocument } from "../index";
import { REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { parseMarkup, styleOf } from "../testing/markup";
import { definitions, markup, alone, setWidth } from "../testing/preset";

function editorWithARow(): {
  readonly editor: ReturnType<typeof createEditor>;
  readonly rowId: string;
} {
  const editor = createEditor({
    definitions,
    rootType: REACT_EMAIL_ROOT_TYPE,
  });
  const rowId =
    editor.insertBlock("columns", editor.getDocument().root.id) ?? "";
  return { editor, rowId };
}

describe("Columns", () => {
  it("arrives as a working two-column row", () => {
    // One palette entry and one gesture. It used to be an empty shell that did
    // nothing until a second Block was dragged into it.
    const { editor, rowId } = editorWithARow();

    expect(
      (editor.getBlock(rowId)?.children ?? []).map((child) => child.type),
    ).toEqual(["column", "column"]);
  });

  it("keeps its columns out of an Author's hands", () => {
    const column = definitions.find((one) => one.type === "column");

    expect(column?.structural).toBe(true);
    expect(definitions.find((one) => one.type === "columns")?.structural).toBe(
      undefined,
    );
  });

  it("offers another column through the row that owns it", () => {
    const { editor, rowId } = editorWithARow();
    editor.select(rowId);

    expect(editor.getAddableChildren()).toMatchObject([
      { type: "column", label: "Column" },
    ]);

    editor.getAddableChildren()[0]?.add();
    expect(editor.getBlock(rowId)?.children).toHaveLength(3);
  });

  it("stops offering one at six, which is 100px a column", () => {
    const { editor, rowId } = editorWithARow();
    editor.select(rowId);
    for (let index = 0; index < 4; index += 1) {
      editor.getAddableChildren()[0]?.add();
    }

    expect(editor.getBlock(rowId)?.children).toHaveLength(6);
    expect(editor.getAddableChildren()).toEqual([]);
  });

  it("will not be left holding one column", () => {
    const { editor, rowId } = editorWithARow();
    const [first] = editor.getBlock(rowId)?.children ?? [];

    expect(editor.canRemove(first?.id ?? "")).toBe(false);
    expect(editor.removeBlock(first?.id ?? "")).toBe(false);
    // The row itself is another matter — that is how an Author gets rid of it.
    expect(editor.canRemove(rowId)).toBe(true);
  });

  it("keeps every one of a column's own props, reached through the row", () => {
    // It left the palette and then the selection; it did not leave the
    // Document. The props are the reason it stays a Block at all, and the row
    // is now the only route to them.
    const { editor, rowId } = editorWithARow();
    editor.select(rowId);

    expect(
      editor.getEditableChildren()[0]?.controls.map((control) => control.name),
    ).toEqual([
      "width",
      "backgroundColor",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderWidth",
      "borderStyle",
      "borderColor",
      "borderRadius",
      "showOn",
    ]);
  });

  it("gives the row a surface of its own, behind its columns", () => {
    const { editor, rowId } = editorWithARow();
    editor.select(rowId);

    // Two surfaces, so two colours: the band reaches the edge of the window and
    // the content colour stops where the email's width does.
    expect(editor.getControls().map((control) => control.name)).toEqual([
      "backgroundColor",
      "contentBackgroundColor",
      "contentBackgroundImage",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderWidth",
      "borderStyle",
      "borderColor",
      "borderRadius",
      "verticalAlign",
      "gap",
      "stackOnMobile",
      "reverseOnMobile",
      "showOn",
    ]);
  });

  it("groups the two surfaces, so a color says which one it paints", () => {
    const { editor, rowId } = editorWithARow();
    editor.select(rowId);

    const groups = new Map(
      editor.getControls().map((control) => [control.name, control.group]),
    );
    // Named for the Block an Author selected, not for the shape it draws.
    expect(groups.get("backgroundColor")).toBe("Columns");
    expect(groups.get("contentBackgroundColor")).toBe("Content");
    expect(groups.get("paddingLeft")).toBe("Content");
    expect(groups.get("stackOnMobile")).toBe("Mobile");
  });

  it("draws an edge only once one is asked for", () => {
    const { editor, rowId } = editorWithARow();
    // Zero width is how a border is turned off, so there is no second switch
    // saying the same thing — and nothing is emitted until it is turned on.
    expect(markup(editor.getDocument())).not.toContain("border:");

    editor.select(rowId);
    editor
      .getControls()
      .find((c) => c.name === "borderWidth")
      ?.set(2);
    editor
      .getControls()
      .find((c) => c.name === "borderColor")
      ?.set("#334455");
    editor
      .getControls()
      .find((c) => c.name === "borderStyle")
      ?.set("dashed");

    expect(markup(editor.getDocument())).toContain("border:2px dashed #334455");
  });

  // The one thing about widths that is genuinely the Preset's: that a column
  // renders at the share the row gave it. The rules that produce the share are
  // the engine's, and `division.test.ts` pins them without react.email in
  // sight.
  it("renders each column at the width the row gave it", () => {
    const { editor, rowId } = editorWithARow();
    setWidth(editor, rowId, 0, 70);

    const html = markup(editor.getDocument());

    expect(html).toContain("width:70%");
    expect(html).toContain("width:30%");
  });
});

/** A row of `count` columns, each holding one word, under the root. */
function rowOf(
  count: number,
  props: Record<string, unknown> = {},
): EmailDocument {
  return alone({
    id: "row",
    type: "columns",
    props,
    children: Array.from({ length: count }, (_, index) => ({
      id: `column-${String(index)}`,
      type: "column",
      props: {},
      children: [
        {
          id: `word-${String(index)}`,
          type: "text",
          props: { content: `Word${String(index)}` },
        },
      ],
    })),
  });
}

/**
 * The row's own cells, in order.
 *
 * They are told apart by their style: a column says how it aligns, a spacer
 * zeroes its font. The text inside a column renders a cell too, which says
 * neither, and is skipped.
 */
function rowCells(html: string): readonly Element[] {
  return parseMarkup(html)
    .all("td")
    .filter((cell) => {
      const style = styleOf(cell);
      return "vertical-align" in style || style["font-size"] === "0";
    });
}

const isColumn = (cell: Element): boolean => "vertical-align" in styleOf(cell);

describe("the row's alignment and gap", () => {
  it("renders a row with neither prop exactly as it always has", () => {
    const html = markup(rowOf(2));
    const cells = rowCells(html);

    // Nothing between the columns, and both still sit at the top.
    expect(cells).toHaveLength(2);
    expect(cells.every((cell) => isColumn(cell))).toBe(true);
    for (const cell of cells) {
      expect(styleOf(cell)["vertical-align"]).toBe("top");
    }
    // The defaults say the same thing the missing props did.
    expect(markup(rowOf(2, { verticalAlign: "top", gap: 0 }))).toBe(html);
  });

  it("puts the row's alignment inline on every column", () => {
    const cells = rowCells(markup(rowOf(3, { verticalAlign: "middle" })));

    // Inline, so a client that strips the head still gets it.
    expect(cells.map((cell) => styleOf(cell)["vertical-align"])).toEqual([
      "middle",
      "middle",
      "middle",
    ]);
  });

  it("puts a spacer between each pair of columns, and nowhere else", () => {
    const cells = rowCells(markup(rowOf(3, { gap: 20 })));

    expect(cells.map((cell) => isColumn(cell))).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
    for (const spacer of cells.filter((cell) => !isColumn(cell))) {
      const style = styleOf(spacer);
      expect(style).toMatchObject({
        width: "20px",
        height: "20px",
        "font-size": "0",
        "line-height": "0",
      });
      // No colour of its own, so the row's content colour shows through.
      expect(
        Object.keys(style).filter((property) =>
          property.startsWith("background"),
        ),
      ).toEqual([]);
      // Something inside, so no client collapses it.
      expect(spacer.children).toHaveLength(0);
      expect(spacer.textContent).toBe("\u00A0");
    }
  });

  it("keeps column, spacer, column when the row stacks reversed", () => {
    // The stack rule makes every cell full width, spacers included, so a
    // spacer turns into the gap between stacked columns. Reversing the `<tr>`
    // reverses all of its cells, which leaves a spacer between every pair.
    const html = markup(
      rowOf(3, { gap: 16, stackOnMobile: true, reverseOnMobile: true }),
    );
    const cells = rowCells(html);

    expect(html).toContain('class="lekh-reverse lekh-stacked"');
    expect(cells.map((cell) => isColumn(cell))).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(cells.toReversed().map((cell) => isColumn(cell))).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  it("offers both as row controls a phone cannot override", () => {
    const editor = createEditor({
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const rowId =
      editor.insertBlock("columns", editor.getDocument().root.id) ?? "";
    editor.select(rowId);

    const controls = editor.getControls();
    expect(controls.find((c) => c.name === "verticalAlign")).toMatchObject({
      value: "top",
    });
    expect(controls.find((c) => c.name === "gap")).toMatchObject({ value: 0 });

    editor.setStage("mobile");
    const mobile = editor.getControls().map((control) => control.name);
    expect(mobile).not.toContain("verticalAlign");
    expect(mobile).not.toContain("gap");
  });
});
