import { describe, expect, it } from "vitest";
import type { Edit } from "lekh";

import { workingLine, type Names } from "./working-line";

const LABELS: Readonly<Record<string, string>> = {
  heading: "Heading",
  button: "Button",
  image: "Image",
  section: "Section",
};
const PROPS: Readonly<Record<string, string>> = {
  text: "Text",
  backgroundColor: "Background color",
};
const STORED: Readonly<Record<string, string>> = {
  h1: "heading",
  b1: "button",
  i1: "image",
};

const names: Names = {
  typeOf: (blockId) => STORED[blockId],
  blockLabel: (type) => LABELS[type],
  propLabel: (_type, prop) => PROPS[prop],
};

const line = (...edits: Edit[]): string => workingLine(edits, names);

describe("workingLine", () => {
  it("reads the request before any Edit arrives", () => {
    expect(line()).toBe("Reading your request");
  });

  it("names the Block an insert adds", () => {
    expect(line({ kind: "insert", type: "button", parent: "root" })).toBe(
      "Adding a Button",
    );
  });

  it("says an before a vowel", () => {
    expect(line({ kind: "insert", type: "image", parent: "root" })).toBe(
      "Adding an Image",
    );
  });

  it("names the Block and the prop a set-prop changes", () => {
    expect(
      line({ kind: "set-prop", blockId: "h1", prop: "text", value: "Hi" }),
    ).toBe("Setting the Heading's text");
  });

  it("names the Block a remove takes out", () => {
    expect(line({ kind: "remove", blockId: "b1" })).toBe("Removing a Button");
  });

  it("names the Block a move puts somewhere else", () => {
    expect(line({ kind: "move", blockId: "h1", after: "b1" })).toBe(
      "Moving a Heading",
    );
  });

  it("names only the newest Edit", () => {
    expect(
      line(
        { kind: "insert", type: "section", parent: "root" },
        { kind: "remove", blockId: "i1" },
      ),
    ).toBe("Removing an Image");
  });

  it("knows a Block an earlier Edit in the Suggestion added", () => {
    expect(
      line(
        { kind: "insert", type: "section", id: "new", parent: "root" },
        {
          kind: "set-prop",
          blockId: "new",
          prop: "backgroundColor",
          value: "#fff",
        },
      ),
    ).toBe("Setting the Section's background color");
  });

  it("falls back to plain words for a Block or prop it can't name", () => {
    expect(
      line({ kind: "set-prop", blockId: "gone", prop: "odd", value: 1 }),
    ).toBe("Setting the block's odd");
  });
});
