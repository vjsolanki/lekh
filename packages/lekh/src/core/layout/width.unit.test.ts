import { describe, expect, it } from "vitest";

import {
  usableWidths,
  widthCeiling,
  widthsAfterInsert,
  widthsAfterRemove,
  widthsAfterSet,
  widthsEvenly,
} from "./width";

/** The floor the built-in Preset declares, and the one every case below uses. */
const FLOOR = 10;

const total = (widths: readonly number[]): number =>
  widths.reduce((sum, width) => sum + width, 0);

describe("an even split", () => {
  it("divides a hundred, giving the odd point to the first", () => {
    expect(widthsEvenly(2)).toEqual([50, 50]);
    expect(widthsEvenly(3)).toEqual([34, 33, 33]);
    expect(widthsEvenly(6)).toEqual([20, 16, 16, 16, 16, 16]);
  });

  it("stays on whole numbers, which is what an Author types", () => {
    for (let count = 1; count <= 6; count += 1) {
      const widths = widthsEvenly(count);
      expect(widths.every((width) => Number.isInteger(width))).toBe(true);
      expect(total(widths)).toBe(100);
    }
  });
});

describe("widths a rule can be run on", () => {
  it("leaves a set that already adds up alone", () => {
    const widths = [60, 40];
    expect(usableWidths(widths, FLOOR)).toBe(widths);
  });

  it("evens out a set that does not add up", () => {
    // A Document written by hand, or one from a Consumer's own JSON. Evened
    // rather than refused: an Author did not do this and must not be left with
    // a row they cannot touch (ADR-0006).
    expect(usableWidths([50, 50, 50], FLOOR)).toEqual([34, 33, 33]);
    expect(usableWidths([90], FLOOR)).toEqual([100]);
  });

  it("evens out a set holding something under the floor", () => {
    // Adds to a hundred, but the rules cannot run on it: a child below the
    // floor has negative room, and every trade from here would be wrong.
    expect(usableWidths([95, 5], FLOOR)).toEqual([50, 50]);
  });
});

describe("setting one width", () => {
  it("takes what it gains from the next one along", () => {
    expect(widthsAfterSet([50, 50], 0, 60, FLOOR)).toEqual([60, 40]);
    expect(widthsAfterSet([50, 30, 20], 0, 60, FLOOR)).toEqual([60, 20, 20]);
  });

  it("gives what it loses back to the next one along", () => {
    expect(widthsAfterSet([60, 40], 0, 30, FLOOR)).toEqual([30, 70]);
  });

  it("trades backwards for the last one, its only neighbour", () => {
    expect(widthsAfterSet([50, 50], 1, 70, FLOOR)).toEqual([30, 70]);
    expect(widthsAfterSet([40, 40, 20], 2, 40, FLOOR)).toEqual([40, 20, 40]);
  });

  it("stops at what the neighbour can spare, rather than refusing", () => {
    // A slider dragged to the end should stop somewhere sensible. Three at 33
    // cannot take the first past 56 however much room the third is sitting on,
    // because the second absorbs the change alone.
    expect(widthsAfterSet([34, 33, 33], 0, 100, FLOOR)).toEqual([57, 10, 33]);
    expect(widthsAfterSet([50, 50], 0, 100, FLOOR)).toEqual([90, 10]);
  });

  it("stops at the floor going the other way", () => {
    expect(widthsAfterSet([50, 50], 0, 0, FLOOR)).toEqual([10, 90]);
  });

  it("hands back the same array when nothing would move", () => {
    // Identity, because the editor reads it to decide whether an Op — and an
    // undo entry — is owed at all.
    const widths = [50, 50];
    expect(widthsAfterSet(widths, 0, 50, FLOOR)).toBe(widths);

    // Already at its ceiling, so a larger value changes nothing either.
    const full = [90, 10];
    expect(widthsAfterSet(full, 0, 95, FLOOR)).toBe(full);
  });

  it("leaves a lone child alone, having nobody to trade with", () => {
    const widths = [100];
    expect(widthsAfterSet(widths, 0, 60, FLOOR)).toBe(widths);
  });

  it("keeps the total at a hundred whatever it is asked for", () => {
    for (const value of [-50, 0, 5, 33, 71, 100, 400]) {
      expect(
        total([...widthsAfterSet([40, 30, 20, 10], 1, value, FLOOR)]),
      ).toBe(100);
    }
  });
});

describe("the ceiling a width is offered", () => {
  it("is its own plus everything its neighbour can spare", () => {
    expect(widthCeiling([50, 50], 0, FLOOR)).toBe(90);
    expect(widthCeiling([34, 33, 33], 0, FLOOR)).toBe(57);
  });

  it("is the current width when the neighbour is already on the floor", () => {
    expect(widthCeiling([50, 40, 10], 1, FLOOR)).toBe(40);
  });

  it("looks backwards for the last one", () => {
    expect(widthCeiling([50, 40, 10], 2, FLOOR)).toBe(40);
  });

  it("agrees with what setting actually does", () => {
    // The affordance and the rule are the same arithmetic, so a slider cannot
    // offer a value the row would then clamp.
    const widths = [40, 30, 20, 10];
    for (const [index] of widths.entries()) {
      const ceiling = widthCeiling(widths, index, FLOOR);
      const reached = widthsAfterSet(widths, index, 100, FLOOR)[index];
      expect(reached).toBe(ceiling);
    }
  });
});

describe("a child arriving", () => {
  it("takes the floor from the nearest one with room", () => {
    expect(widthsAfterInsert([50, 50], 2, FLOOR)).toEqual([50, 40, 10]);
  });

  it("passes over everything already on the floor", () => {
    expect(widthsAfterInsert([40, 30, 20, 10], 4, FLOOR)).toEqual([
      40, 30, 10, 10, 10,
    ]);
    expect(widthsAfterInsert([40, 30, 10, 10, 10], 5, FLOOR)).toEqual([
      40, 20, 10, 10, 10, 10,
    ]);
  });

  it("takes what it can and passes the rest further back", () => {
    // The last has 6 above the floor and pays all of it; the 4 still owed goes
    // to the one before. A child with partial room pays what it has rather
    // than being skipped for not covering the whole amount.
    expect(widthsAfterInsert([50, 34, 16], 3, FLOOR)).toEqual([50, 30, 10, 10]);
  });

  it("survives a row filling to six, which is as many as one holds", () => {
    let widths: readonly number[] = [50, 50];
    for (let count = 3; count <= 6; count += 1) {
      widths = widthsAfterInsert(widths, widths.length, FLOOR);
      expect(widths).toHaveLength(count);
      expect(total([...widths])).toBe(100);
      expect(widths.every((width) => width >= FLOOR)).toBe(true);
    }
  });

  it("lands where it was put, not only at the end", () => {
    expect(widthsAfterInsert([50, 50], 0, FLOOR)).toEqual([10, 50, 40]);
  });

  it("takes the whole row when it is the first child", () => {
    expect(widthsAfterInsert([], 0, FLOOR)).toEqual([100]);
  });
});

describe("a child going", () => {
  it("hands its width to the one that takes its place", () => {
    expect(widthsAfterRemove([50, 40, 10], 1)).toEqual([50, 50]);
    expect(widthsAfterRemove([60, 30, 10], 0)).toEqual([90, 10]);
  });

  it("hands it backwards when it was the last", () => {
    expect(widthsAfterRemove([50, 40, 10], 2)).toEqual([50, 50]);
  });

  it("undoes an arrival, so adding and deleting leaves the row as it was", () => {
    const before = [50, 50];
    const after = widthsAfterInsert(before, 2, FLOOR);
    expect(widthsAfterRemove(after, 2)).toEqual(before);
  });

  it("leaves widths it cannot find alone", () => {
    const widths = [50, 50];
    expect(widthsAfterRemove(widths, 7)).toBe(widths);
  });
});
