import { describe, expect, it } from "vitest";

import { fitsButtonRow } from "./select-shape";

const choices = (...labels: string[]) =>
  labels.map((label) => ({ label, value: label }));

describe("whether a select is drawn as buttons", () => {
  it("is buttons for heading level", () => {
    expect(fitsButtonRow(choices("H1", "H2", "H3"))).toBe(true);
  });

  it("is buttons for two to four short options", () => {
    expect(fitsButtonRow(choices("Yes", "No"))).toBe(true);
    expect(fitsButtonRow(choices("XS", "S", "M", "L"))).toBe(true);
  });

  it("is a dropdown for five options or more", () => {
    expect(fitsButtonRow(choices("A", "B", "C", "D", "E"))).toBe(false);
  });

  it("is a dropdown for one option or none", () => {
    expect(fitsButtonRow(choices("Only"))).toBe(false);
    expect(fitsButtonRow([])).toBe(false);
  });

  it("is a dropdown when any label is long", () => {
    expect(fitsButtonRow(choices("Left to right", "Right to left"))).toBe(
      false,
    );
    expect(fitsButtonRow(choices("H1", "Subheading"))).toBe(false);
  });

  it("is a dropdown when the labels together overflow the row", () => {
    expect(fitsButtonRow(choices("solid", "dashed", "dotted"))).toBe(false);
  });
});
