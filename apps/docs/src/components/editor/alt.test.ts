import { describe, expect, it } from "vitest";

import { withAlt } from "./alt";

const picture = { src: "https://cdn.example/a.png", width: 600, height: 400 };

describe("withAlt", () => {
  it("adds the alt text the Author typed", () => {
    expect(withAlt(picture, { alt: "A red bike", decorative: false })).toEqual({
      ...picture,
      alt: "A red bike",
    });
  });

  it("leaves alt off when nothing was typed", () => {
    expect(withAlt(picture, { alt: "  ", decorative: false })).toEqual(picture);
  });

  it("leaves alt off when the Author says the picture is decorative", () => {
    expect(withAlt(picture, { alt: "A red bike", decorative: true })).toEqual(
      picture,
    );
  });

  it("keeps only the picture's own fields, not a library entry's label", () => {
    const entry = { ...picture, label: "Bike" };
    expect(withAlt(entry, { alt: "", decorative: false })).toEqual(picture);
  });
});
