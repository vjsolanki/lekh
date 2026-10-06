import { describe, expect, it } from "vitest";
import { createEditor } from "lekh-editor";

import { containerName, containerPath, isWhereItIs, placeName } from "./names";
import {
  DEFINITIONS,
  REACT_EMAIL_ROOT_TYPE,
  STARTING_DOCUMENT,
} from "./sample";

const editor = () =>
  createEditor({
    definitions: DEFINITIONS,
    rootType: REACT_EMAIL_ROOT_TYPE,
    document: STARTING_DOCUMENT,
  });

describe("containerName", () => {
  it("numbers a column among the columns beside it", () => {
    const sample = editor();
    expect(containerName(sample, "spotlight-copy")).toBe("Column 1");
    expect(containerName(sample, "spotlight-figure")).toBe("Column 2");
  });

  it("numbers a section among the email's sections", () => {
    const sample = editor();
    const first = sample.getDocument().root.children?.[0]?.id ?? "";
    expect(containerName(sample, first)).toBe("Section 1");
  });

  it("calls the root the email", () => {
    const sample = editor();
    expect(containerName(sample, sample.getDocument().root.id)).toBe("Email");
  });
});

describe("placeName", () => {
  it("names a place by what the Block beside it says", () => {
    expect(
      placeName(editor(), {
        parentId: "spotlight-copy",
        index: 0,
        position: "before",
        referenceBlockId: "spotlight-heading",
      }),
    ).toBe("Before One timeline");
  });

  it("clips a long sibling", () => {
    const name = placeName(editor(), {
      parentId: "spotlight-copy",
      index: 2,
      position: "after",
      referenceBlockId: "spotlight-text",
    });
    expect(name.startsWith("After Type a word")).toBe(true);
    expect(name.endsWith("…")).toBe(true);
  });

  it("names a sibling with no words of its own by its place among its kind", () => {
    const sample = editor();
    const sections = (sample.getDocument().root.children ?? []).filter(
      (child) => child.type === "section",
    );
    expect(
      placeName(sample, {
        parentId: sample.getDocument().root.id,
        index: 1,
        position: "before",
        referenceBlockId: sections[1]?.id ?? "",
      }),
    ).toBe("Before Section 2");
  });

  it("names an empty container by the container", () => {
    expect(
      placeName(editor(), {
        parentId: "spotlight-figure",
        index: 0,
        position: "inside",
      }),
    ).toBe("Into Column 2");
  });
});

/** A gap in the spotlight's copy column. */
const at = (index: number) => ({
  parentId: "spotlight-copy",
  index,
  position: "before" as const,
});

describe("isWhereItIs", () => {
  it("is the gap just before or after the Block", () => {
    expect(isWhereItIs(editor(), at(1), "spotlight-text")).toBe(true);
    expect(isWhereItIs(editor(), at(2), "spotlight-text")).toBe(true);
  });

  it("is not a gap further along, or in another container", () => {
    expect(isWhereItIs(editor(), at(0), "spotlight-text")).toBe(false);
    expect(
      isWhereItIs(
        editor(),
        { parentId: "spotlight-figure", index: 0, position: "before" },
        "spotlight-text",
      ),
    ).toBe(false);
  });
});

describe("containerPath", () => {
  it("names a column by the row it is in", () => {
    const sample = editor();
    // The spotlight is the only row at the email's own level. The others sit
    // inside Sections, and read "Section 4 › Columns › Column 1".
    expect(containerPath(sample, "spotlight-copy")).toBe("Columns › Column 1");
  });

  it("is the email for the root", () => {
    const sample = editor();
    expect(containerPath(sample, sample.getDocument().root.id)).toBe("Email");
  });
});
