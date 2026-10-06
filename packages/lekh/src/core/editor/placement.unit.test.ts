import { describe, expect, it } from "vitest";

import type { EmailDocument } from "../../index";
import { definitions } from "../../testing/blocks";
import {
  decidePlacement,
  reindex,
  type PlacementContext,
  type PlacementIntent,
} from "./placement";

/**
 * Where a Block goes, and what it takes to put it there.
 *
 * The arbitration used to be spread across a drag callback, two native event
 * listeners and a Consumer's palette, so the only way to reach it was through
 * a live editor with a stubbed resolver. It is a pure function now, and this
 * suite needs neither.
 *
 *   root
 *     head    text
 *     row     section, one of its two slots used
 *       a     text
 *     full    section, both slots used
 *       c     text
 *       d     text
 */
const document: EmailDocument = {
  root: {
    id: "root",
    type: "email",
    props: {},
    children: [
      { id: "head", type: "text", props: {} },
      {
        id: "row",
        type: "section",
        props: {},
        children: [{ id: "a", type: "text", props: {} }],
      },
      {
        id: "full",
        type: "section",
        props: {},
        children: [
          { id: "c", type: "text", props: {} },
          { id: "d", type: "text", props: {} },
        ],
      },
    ],
  },
};

/** The test Blocks, looked up by type the way an editor's registry does. */
const byType = new Map(
  definitions.map((definition) => [definition.type, definition]),
);
const registry: Parameters<typeof decidePlacement>[1] = {
  get: (type) => byType.get(type),
  has: (type) => byType.has(type),
  all: definitions,
  required: definitions.filter((definition) => definition.required === true),
};

const RESOLVING: PlacementContext = {
  selection: undefined,
  canRequest: true,
  imageType: "image",
};

function decide(
  intent: PlacementIntent,
  context: Partial<PlacementContext> = {},
) {
  return decidePlacement(
    document,
    registry,
    { ...RESOLVING, ...context },
    intent,
  );
}

function file(): File {
  return new File(["binary"], "cat.png", { type: "image/png" });
}

describe("deciding what a gesture means", () => {
  it("asks for an Asset before a Block that holds one enters the Document", () => {
    expect(decide({ reason: "insert", type: "image" })).toMatchObject({
      kind: "request",
      facts: { reason: "insert", placement: { kind: "insert", type: "image" } },
    });
  });

  it("inserts a Block that holds no Asset straight away", () => {
    expect(decide({ reason: "insert", type: "text" })).toMatchObject({
      kind: "insert",
      type: "text",
    });
  });

  it("inserts an image Block empty when no resolver can fill it", () => {
    expect(
      decide({ reason: "insert", type: "image" }, { canRequest: false }),
    ).toMatchObject({ kind: "insert", type: "image" });
  });

  it("refuses files when no resolver can turn them into an Asset", () => {
    // The one case where declining beats inserting: an empty Block would be
    // the Author's file silently discarded (ADR-0010).
    expect(
      decide({ reason: "drop", files: [file()] }, { canRequest: false }),
    ).toEqual({ kind: "refuse" });
  });

  it("refuses a type nothing knows about", () => {
    expect(decide({ reason: "insert", type: "carousel" })).toEqual({
      kind: "refuse",
    });
  });

  it("refuses when there is no image Block to become and no type given", () => {
    expect(
      decide({ reason: "paste", files: [file()] }, { imageType: undefined }),
    ).toEqual({ kind: "refuse" });
  });

  it("refuses a position that has no room left", () => {
    expect(
      decide({
        reason: "insert",
        type: "text",
        target: { parentId: "full", index: 2, position: "inside" },
      }),
    ).toEqual({ kind: "refuse" });
  });
});

describe("where a Block goes when the Author pointed at nothing", () => {
  it("lands after the selected Block", () => {
    expect(
      decide({ reason: "paste", type: "text" }, { selection: "head" }),
    ).toMatchObject({
      kind: "insert",
      parentId: "root",
      index: 1,
    });
  });

  it("lands inside the selection's own parent, not beside it", () => {
    expect(
      decide({ reason: "insert", type: "text" }, { selection: "a" }),
    ).toMatchObject({
      parentId: "row",
      index: 1,
    });
  });

  it("falls back to the end of the email when the selection's parent is full", () => {
    expect(
      decide({ reason: "insert", type: "text" }, { selection: "c" }),
    ).toMatchObject({
      parentId: "root",
      index: 3,
    });
  });

  it("falls back to the end of the email when nothing is selected", () => {
    expect(decide({ reason: "insert", type: "text" })).toMatchObject({
      parentId: "root",
      index: 3,
    });
  });

  it("is the same rule for a paste and for a clicked palette entry", () => {
    expect(
      decide({ reason: "paste", type: "text" }, { selection: "head" }),
    ).toEqual(
      decide({ reason: "insert", type: "text" }, { selection: "head" }),
    );
  });
});

describe("bringing the new Block into view", () => {
  it("scrolls to it when the library chose the position", () => {
    expect(decide({ reason: "insert", type: "text" })).toMatchObject({
      reveal: true,
    });
  });

  it("leaves the Author where they are when they chose it themselves", () => {
    expect(
      decide({
        reason: "insert",
        type: "text",
        target: { parentId: "root", index: 0, position: "before" },
      }),
    ).toMatchObject({ reveal: false });
  });

  it("carries the decision into a request, which outlives the gesture", () => {
    // By the time an Asset arrives the Author has stopped watching, so whether
    // to scroll cannot be worked out then — it is decided here and kept.
    expect(decide({ reason: "insert", type: "image" })).toMatchObject({
      kind: "request",
      reveal: true,
    });
  });
});

describe("re-reading a position when an Asset finally arrives", () => {
  it("follows the Block it was aimed at rather than the recorded index", () => {
    // Recorded when `head` was still above `row`: after it, at index 2.
    const target = {
      parentId: "root",
      index: 2,
      position: "after",
      referenceBlockId: "row",
    } as const;

    const moved: EmailDocument = {
      root: {
        ...document.root,
        children: (document.root.children ?? []).filter(
          (block) => block.id !== "head",
        ),
      },
    };

    expect(reindex(document, target)).toBe(2);
    expect(reindex(moved, target)).toBe(1);
  });

  it("stands by the recorded index when that Block has gone too", () => {
    const gone: EmailDocument = {
      root: { ...document.root, children: [] },
    };

    expect(
      reindex(gone, {
        parentId: "root",
        index: 2,
        position: "after",
        referenceBlockId: "row",
      }),
    ).toBe(2);
  });

  it("stands by it when the Block moved to another parent entirely", () => {
    const elsewhere: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          {
            id: "full",
            type: "section",
            props: {},
            children: [{ id: "head", type: "text", props: {} }],
          },
        ],
      },
    };

    expect(
      reindex(elsewhere, {
        parentId: "root",
        index: 1,
        position: "after",
        referenceBlockId: "head",
      }),
    ).toBe(1);
  });

  it("needs no re-reading for a position with no Block behind it", () => {
    expect(
      reindex(document, { parentId: "root", index: 3, position: "inside" }),
    ).toBe(3);
  });
});
