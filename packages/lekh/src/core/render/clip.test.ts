import { describe, expect, it } from "vitest";

import { clipCheck, GMAIL_CLIP_BYTES } from "../../index";

describe("clipCheck", () => {
  it("defaults to Gmail's clip", () => {
    expect(clipCheck("<p>Hi</p>")).toEqual({
      bytes: 9,
      limit: GMAIL_CLIP_BYTES,
      risk: "ok",
    });
  });

  it("counts ASCII as a byte a character", () => {
    expect(clipCheck("a".repeat(100), { limit: 1000 }).bytes).toBe(100);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // é is two bytes, € three, and 🙂 four.
    expect(clipCheck("é€🙂").bytes).toBe(9);
  });

  it("says clipped once the bytes pass the limit", () => {
    expect(clipCheck("a".repeat(101), { limit: 100 }).risk).toBe("clipped");
    expect(clipCheck("a".repeat(100), { limit: 100 }).risk).toBe("near");
  });

  it("says clipped when multi-byte text passes the limit in bytes", () => {
    // 60 characters, 120 bytes.
    expect(clipCheck("é".repeat(60), { limit: 100 }).risk).toBe("clipped");
  });

  describe("headroom", () => {
    // A fifth of 100 bytes: near from 81 bytes up.
    const options = { limit: 100, headroom: 0.2 };

    it("is ok right at the edge of the headroom", () => {
      expect(clipCheck("a".repeat(80), options).risk).toBe("ok");
    });

    it("is near one byte into it", () => {
      expect(clipCheck("a".repeat(81), options).risk).toBe("near");
    });

    it("defaults to a tenth of the limit", () => {
      expect(clipCheck("a".repeat(90), { limit: 100 }).risk).toBe("ok");
      expect(clipCheck("a".repeat(91), { limit: 100 }).risk).toBe("near");
    });

    it("is a share of the limit, so one outside 0 to 1 throws", () => {
      expect(() => clipCheck("", { headroom: 2 })).toThrow(RangeError);
      expect(() => clipCheck("", { headroom: -0.1 })).toThrow(RangeError);
      expect(() => clipCheck("", { headroom: Number.NaN })).toThrow(RangeError);
    });

    it("keeps its edge on a whole byte", () => {
      // 1000 × (1 − 0.07) is 929.9999999999999, which would put byte 930 in
      // the headroom.
      const awkward = { limit: 1000, headroom: 0.07 };
      expect(clipCheck("a".repeat(930), awkward).risk).toBe("ok");
      expect(clipCheck("a".repeat(931), awkward).risk).toBe("near");
    });

    it("of none is never near", () => {
      const none = { limit: 100, headroom: 0 };
      expect(clipCheck("a".repeat(100), none).risk).toBe("ok");
      expect(clipCheck("a".repeat(101), none).risk).toBe("clipped");
    });
  });
});
