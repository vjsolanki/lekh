import { describe, expect, it } from "vitest";

import type { BlockDefinition } from "../../index";
import { dividingCell, email, grid, image, text } from "../../testing/blocks";
import { block, documentOf, onMobile } from "../../testing/tree";
import {
  propWrite,
  type Fallback,
  type PropWrite,
  type PropWriteRequest,
} from "./prop-write";

const LISTED = { src: "https://cdn.test/logo.png", width: 120, height: 40 };
const UPLOADED = {
  src: "https://cdn.test/upload.png",
  width: 300,
  height: 200,
};

/** The test image, with one Asset the Consumer already resolved. */
const listedImage: BlockDefinition = {
  ...image,
  schema: {
    asset: {
      ...image.schema["asset"],
      kind: "asset",
      label: "Image",
      constraints: { options: [{ label: "Logo", asset: LISTED }] },
    },
  },
};

const definitions: readonly BlockDefinition[] = [
  email,
  text,
  listedImage,
  grid,
  dividingCell,
];

const registry: PropWriteRequest["registry"] = {
  get: (type) => definitions.find((definition) => definition.type === type),
  has: (type) => definitions.some((definition) => definition.type === type),
  all: definitions,
  required: [],
};

const document = documentOf(
  block("email", {}, [
    // `fontSize` is Overridable; `content` is not. `content` also holds a
    // Mobile Override left from when it was.
    onMobile(block("text", { id: "copy", content: "Hello", fontSize: 14 }), {
      fontSize: 12,
      content: "stale",
    }),
    block("image", { id: "logo" }),
    block("grid", {}, [
      block("cell", { id: "left", share: 50 }),
      block("cell", { id: "right", share: 50 }),
    ]),
    block("marquee", { id: "unknown" }),
  ]),
);

const write = (
  blockId: string,
  values: Readonly<Record<string, unknown>>,
  stage: "desktop" | "mobile",
  fallback: Fallback,
  resolvedAsset = false,
): PropWrite =>
  propWrite({
    document,
    registry,
    origin: "local",
    blockId,
    values,
    stage,
    fallback,
    resolvedAsset,
  });

/** An Op as `block.prop = value @ stage`, or the refusal reason. */
const summary = (result: PropWrite): string | readonly string[] =>
  "refused" in result
    ? result.refused
    : result.ops.map(
        (op) =>
          `${op.blockId}.${op.prop} = ${JSON.stringify(op.value) ?? "unset"} @ ${op.stage ?? "desktop"}`,
      );

describe("the prop-write rule, by Stage, prop kind and fallback", () => {
  it.each([
    // An Overridable prop takes a Mobile Override on mobile, in either mode.
    [
      "desktop",
      "desktop",
      "copy",
      { fontSize: 20 },
      ["copy.fontSize = 20 @ desktop"],
    ],
    [
      "desktop",
      "refuse",
      "copy",
      { fontSize: 20 },
      ["copy.fontSize = 20 @ desktop"],
    ],
    [
      "mobile",
      "desktop",
      "copy",
      { fontSize: 20 },
      ["copy.fontSize = 20 @ mobile"],
    ],
    [
      "mobile",
      "refuse",
      "copy",
      { fontSize: 20 },
      ["copy.fontSize = 20 @ mobile"],
    ],
    // A prop that is not Overridable writes its desktop value, or is refused.
    [
      "desktop",
      "desktop",
      "copy",
      { content: "Hi" },
      ['copy.content = "Hi" @ desktop'],
    ],
    [
      "desktop",
      "refuse",
      "copy",
      { content: "Hi" },
      ['copy.content = "Hi" @ desktop'],
    ],
    [
      "mobile",
      "desktop",
      "copy",
      { content: "Hi" },
      ['copy.content = "Hi" @ desktop'],
    ],
    ["mobile", "refuse", "copy", { content: "Hi" }, "not-overridable"],
    // A prop the Schema does not have is written as it is, or refused.
    ["desktop", "desktop", "copy", { extra: 1 }, ["copy.extra = 1 @ desktop"]],
    ["desktop", "refuse", "copy", { extra: 1 }, "unknown-prop"],
    ["mobile", "desktop", "copy", { extra: 1 }, ["copy.extra = 1 @ desktop"]],
    ["mobile", "refuse", "copy", { extra: 1 }, "unknown-prop"],
    // A Width moves its neighbour. It is not Overridable, so the mobile Stage
    // rebalances the desktop row or refuses.
    [
      "desktop",
      "desktop",
      "left",
      { share: 60 },
      ["left.share = 60 @ desktop", "right.share = 40 @ desktop"],
    ],
    [
      "desktop",
      "refuse",
      "left",
      { share: 60 },
      ["left.share = 60 @ desktop", "right.share = 40 @ desktop"],
    ],
    [
      "mobile",
      "desktop",
      "left",
      { share: 60 },
      ["left.share = 60 @ desktop", "right.share = 40 @ desktop"],
    ],
    ["mobile", "refuse", "left", { share: 60 }, "not-overridable"],
    // A Listed Asset prop is not Overridable: an unlisted picture is refused on
    // either Stage, before the Stage is asked.
    ["desktop", "desktop", "logo", { asset: UPLOADED }, "unlisted-asset"],
    ["desktop", "refuse", "logo", { asset: UPLOADED }, "unlisted-asset"],
    ["mobile", "desktop", "logo", { asset: UPLOADED }, "unlisted-asset"],
    ["mobile", "refuse", "logo", { asset: UPLOADED }, "unlisted-asset"],
    [
      "mobile",
      "desktop",
      "logo",
      { asset: LISTED },
      [`logo.asset = ${JSON.stringify(LISTED)} @ desktop`],
    ],
    ["mobile", "refuse", "logo", { asset: LISTED }, "not-overridable"],
  ] as const)(
    "on %s, fallback %s, %s %o",
    (stage, fallback, blockId, values, expected) => {
      expect(summary(write(blockId, values, stage, fallback))).toEqual(
        expected,
      );
    },
  );
});

describe("the prop-write rule, refusing", () => {
  it.each([
    ["a Block that is not there", "gone", { fontSize: 20 }, "missing-block"],
    [
      "a Block with no Definition",
      "unknown",
      { speed: 2 },
      "unregistered-block",
    ],
    ["no props at all", "copy", {}, "no-props"],
    ["an unset Width", "left", { share: undefined }, "not-a-width"],
    ["a Width that is not a number", "left", { share: "60" }, "not-a-width"],
    [
      "a picture the Asset prop does not list",
      "logo",
      { asset: UPLOADED },
      "unlisted-asset",
    ],
    // All or nothing: a linked control that cannot show one side shows none.
    ["one prop of several", "copy", { fontSize: 20, extra: 1 }, "unknown-prop"],
  ] as const)("%s", (_, blockId, values, reason) => {
    expect(summary(write(blockId, values, "desktop", "refuse"))).toBe(reason);
  });
});

describe("the prop-write rule, on Listed Assets", () => {
  it("writes a listed picture", () => {
    expect(
      summary(write("logo", { asset: LISTED }, "desktop", "desktop")),
    ).toEqual([`logo.asset = ${JSON.stringify(LISTED)} @ desktop`]);
  });

  it("writes any picture an Image Request resolved", () => {
    expect(
      summary(write("logo", { asset: UPLOADED }, "desktop", "desktop", true)),
    ).toEqual([`logo.asset = ${JSON.stringify(UPLOADED)} @ desktop`]);
  });

  it("lets a clear through", () => {
    expect(
      summary(write("logo", { asset: undefined }, "desktop", "desktop")),
    ).toEqual([]);
  });
});

describe("the prop-write rule, on no-ops", () => {
  it("writes nothing for the value already there", () => {
    expect(
      summary(write("copy", { fontSize: 14 }, "desktop", "desktop")),
    ).toEqual([]);
    expect(
      summary(write("copy", { fontSize: 12 }, "mobile", "refuse")),
    ).toEqual([]);
  });

  it("writes nothing for a Width already there", () => {
    expect(summary(write("left", { share: 50 }, "desktop", "desktop"))).toEqual(
      [],
    );
  });
});

describe("the prop-write rule, clearing a Mobile Override", () => {
  it("drops a stored override", () => {
    expect(
      summary(write("copy", { fontSize: undefined }, "mobile", "refuse")),
    ).toEqual(["copy.fontSize = unset @ mobile"]);
  });

  it("refuses one on a prop no longer Overridable, which counts for nothing", () => {
    expect(
      summary(write("copy", { content: undefined }, "mobile", "refuse")),
    ).toBe("not-overridable");
  });

  it("unsets the desktop value of such a prop in desktop mode, as setProp does", () => {
    expect(
      summary(write("copy", { content: undefined }, "mobile", "desktop")),
    ).toEqual(["copy.content = unset @ desktop"]);
  });

  it("writes nothing when no override is stored", () => {
    expect(
      summary(
        propWrite({
          document: documentOf(
            block("email", {}, [block("text", { id: "copy" })]),
          ),
          registry,
          origin: "local",
          blockId: "copy",
          values: { fontSize: undefined },
          stage: "mobile",
          fallback: "refuse",
        }),
      ),
    ).toEqual([]);
  });
});
