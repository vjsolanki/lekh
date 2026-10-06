import { describe, expect, it } from "vitest";
import { createEditor, NONE } from "lekh-editor";

import {
  backgroundOfColor,
  backgroundOfImage,
  fallbackColorOf,
  renderingOf,
  type Background,
} from "./background";
import { DEFINITIONS, REACT_EMAIL_ROOT_TYPE } from "./sample";

const SECTION: Background = {
  image: "contentBackgroundImage",
  color: "contentBackgroundColor",
  fit: "cover",
};
const PAGE: Background = {
  image: "backgroundImage",
  color: "backgroundColor",
  fit: "tile",
};

/** An email with one section, its colours as given. */
const editorWith = (
  rootProps: Record<string, unknown>,
  sectionProps: Record<string, unknown>,
) =>
  createEditor({
    definitions: DEFINITIONS,
    rootType: REACT_EMAIL_ROOT_TYPE,
    document: {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: rootProps,
        children: [
          { id: "band", type: "section", props: sectionProps, children: [] },
        ],
      },
    },
  });

describe("backgroundOfImage", () => {
  it("pairs a section's image with its content colour, filling the box", () => {
    expect(backgroundOfImage("contentBackgroundImage")).toEqual(SECTION);
  });

  it("pairs the page's image with the page colour, tiling", () => {
    expect(backgroundOfImage("backgroundImage")).toEqual(PAGE);
  });

  it("knows nothing of a picture that is the Block itself", () => {
    expect(backgroundOfImage("image")).toBeUndefined();
  });
});

describe("backgroundOfColor", () => {
  it("finds the image a colour stands in for", () => {
    expect(backgroundOfColor("contentBackgroundColor")?.image).toBe(
      "contentBackgroundImage",
    );
    expect(backgroundOfColor("backgroundColor")?.image).toBe("backgroundImage");
  });

  it("knows nothing of a text colour", () => {
    expect(backgroundOfColor("textColor")).toBeUndefined();
  });
});

describe("renderingOf", () => {
  it("says a section's image fills and centres", () => {
    expect(renderingOf("cover")).toMatch(/fills.*centred/iu);
  });

  it("says the page's image tiles", () => {
    expect(renderingOf("tile")).toMatch(/tiles/iu);
  });
});

describe("fallbackColorOf", () => {
  it("reads the section's own colour", () => {
    const editor = editorWith({}, { contentBackgroundColor: "#112233" });
    expect(fallbackColorOf(editor, "band", SECTION)).toBe("#112233");
  });

  it("follows the email's content colour when the section has none", () => {
    const editor = editorWith({ contentBackgroundColor: "#445566" }, {});
    expect(fallbackColorOf(editor, "band", SECTION)).toBe("#445566");
  });

  it("finds nothing when the section is cleared", () => {
    const editor = editorWith(
      { contentBackgroundColor: "#445566" },
      { contentBackgroundColor: NONE },
    );
    expect(fallbackColorOf(editor, "band", SECTION)).toBeUndefined();
  });

  it("reads the page colour for the page's image", () => {
    const editor = editorWith({ backgroundColor: "#eceef3" }, {});
    expect(fallbackColorOf(editor, "root", PAGE)).toBe("#eceef3");
  });
});
