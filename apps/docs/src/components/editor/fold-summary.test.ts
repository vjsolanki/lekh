import { describe, expect, it } from "vitest";
import { SchemaKind } from "lekh";

import { foldSummary, type Summarised } from "./fold-summary";

const control = (
  label: string,
  overrides: Partial<Summarised> = {},
): Summarised => ({
  kind: SchemaKind.number,
  label,
  value: 0,
  origin: "default",
  ...overrides,
});

const borderWidth = (overrides: Partial<Summarised> = {}) =>
  control("Border width", {
    constraints: { min: 0, max: 12, unit: "px" },
    ...overrides,
  });

const borderStyle = (overrides: Partial<Summarised> = {}) =>
  control("Border style", {
    kind: SchemaKind.select,
    value: "solid",
    constraints: {
      options: [
        { label: "Solid", value: "solid" },
        { label: "Dashed", value: "dashed" },
      ],
    },
    ...overrides,
  });

const side = (value: number, origin: Summarised["origin"] = "block") =>
  control("Padding", {
    value,
    origin,
    box: "padding",
    constraints: { min: 0, max: 96, unit: "px" },
  });

describe("a fold's summary", () => {
  it("is just the fold's name when nothing inside is set", () => {
    expect(foldSummary("More", [borderWidth(), borderStyle()])).toBe("More");
  });

  it("names the one setting that is set, with its unit", () => {
    expect(
      foldSummary("More", [
        borderWidth({ value: 2, origin: "block" }),
        borderStyle(),
      ]),
    ).toBe("More · Border width 2px");
  });

  it("names every setting that is set, in order, and an option by its label", () => {
    expect(
      foldSummary("More", [
        borderWidth({ value: 2, origin: "block" }),
        borderStyle({ value: "dashed", origin: "block" }),
        control("Border color", {
          kind: SchemaKind.color,
          value: "#333333",
          origin: "email",
        }),
      ]),
    ).toBe(
      "More · Border width 2px, Border style Dashed, Border color #333333",
    );
  });

  it("names a numbered option by its label", () => {
    expect(
      foldSummary("Text", [
        control("Weight", {
          kind: SchemaKind.select,
          value: 700,
          origin: "block",
          constraints: {
            options: [
              { label: "Regular", value: 400 },
              { label: "Bold", value: 700 },
            ],
          },
        }),
      ]),
    ).toBe("Text · Weight Bold");
  });

  it("counts a Mobile Override as set", () => {
    expect(
      foldSummary("More", [borderWidth({ value: 4, origin: "override" })]),
    ).toBe("More · Border width 4px");
  });

  it("names a Box once, by one number when its sides agree", () => {
    expect(
      foldSummary("Column 1 of 2", [side(20), side(20), side(20), side(20)]),
    ).toBe("Column 1 of 2 · Padding 20px");
  });

  it("names a Box's four sides when they differ, and when only one is set", () => {
    expect(
      foldSummary("Column 1 of 2", [
        side(8),
        side(0, "default"),
        side(8),
        side(0, "default"),
      ]),
    ).toBe("Column 1 of 2 · Padding 8 0 8 0");
  });

  it("leaves a Box out when none of its sides is set", () => {
    expect(
      foldSummary("Column 1 of 2", [side(0, "default"), side(0, "default")]),
    ).toBe("Column 1 of 2");
  });

  it("names a value that does not read as a word by its label alone", () => {
    expect(
      foldSummary("Background", [
        control("Background image", {
          kind: SchemaKind.asset,
          value: { src: "https://example.com/a.png" },
          origin: "block",
        }),
        control("Stack on mobile", {
          kind: SchemaKind.boolean,
          value: false,
          origin: "block",
        }),
      ]),
    ).toBe("Background · Background image, Stack on mobile off");
  });
});
