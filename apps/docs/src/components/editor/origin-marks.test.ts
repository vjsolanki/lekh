import { describe, expect, it } from "vitest";

import { originMarks, type Marked } from "./origin-marks";

const control = (overrides: Partial<Marked> = {}): Marked => ({
  value: 16,
  origin: "default",
  ...overrides,
});

describe("a row's Origin marks", () => {
  it("are none for a value at its default", () => {
    expect(originMarks([control()], false)).toEqual([]);
  });

  it("are a dot for a value set on this Block", () => {
    expect(originMarks([control({ origin: "block" })], false)).toEqual([
      { kind: "block" },
    ]);
  });

  it("are a link for a value that follows the email", () => {
    expect(originMarks([control({ origin: "email" })], false)).toEqual([
      { kind: "email" },
    ]);
  });

  it("are a phone with the value for a Mobile Override", () => {
    expect(
      originMarks(
        [
          control({
            value: 12,
            origin: "override",
            otherStage: { value: 16, origin: "block" },
          }),
        ],
        true,
      ),
    ).toEqual([{ kind: "phone", values: [12] }]);
  });

  it("add a phone with the mobile value on desktop when mobile differs", () => {
    expect(
      originMarks(
        [
          control({
            value: 16,
            origin: "block",
            otherStage: { value: 12, origin: "override" },
          }),
        ],
        false,
      ),
    ).toEqual([{ kind: "block" }, { kind: "phone", values: [12] }]);
  });

  it("show a default value that differs on mobile by its phone alone", () => {
    expect(
      originMarks(
        [control({ otherStage: { value: 12, origin: "override" } })],
        false,
      ),
    ).toEqual([{ kind: "phone", values: [12] }]);
  });

  it("show no phone on mobile when the value follows desktop", () => {
    expect(
      originMarks(
        [
          control({
            origin: "block",
            otherStage: { value: 16, origin: "block" },
          }),
        ],
        true,
      ),
    ).toEqual([{ kind: "block" }]);
  });

  it("are one set for a Box, each mark once, the phone naming every side", () => {
    expect(
      originMarks(
        [
          control({
            origin: "block",
            otherStage: { value: 8, origin: "override" },
          }),
          control({ origin: "block" }),
          control({
            origin: "email",
            otherStage: { value: 8, origin: "override" },
          }),
          control(),
        ],
        false,
      ),
    ).toEqual([
      { kind: "block" },
      { kind: "email" },
      { kind: "phone", values: [8, 16, 8, 16] },
    ]);
  });
});
