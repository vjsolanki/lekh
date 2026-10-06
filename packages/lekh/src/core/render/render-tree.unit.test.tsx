import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { Block, BlockDefinition } from "../../index";
import { UnknownBlockError } from "../../index";
import { definitions, image } from "../../testing/blocks";
import { markupOfNode } from "../../testing/markup";
import { renderTree, type RenderPolicy } from "./render-tree";

/**
 * The one Block-tree recursion, and the two policies over it (ADR-0006).
 *
 * The render path refuses what it does not understand; the Canvas stands in for
 * it. Everything else — recursion, child keying, prop resolution, the Mobile
 * Override collection — is the same job, so it is tested here once. What the
 * Canvas adds on top is in `canvas/tree.unit.test.tsx`.
 */

/** Find a Definition by type, the way an editor's registry does. */
function lookupIn(
  set: readonly BlockDefinition[],
): (type: string) => BlockDefinition | undefined {
  return (type) => set.find((definition) => definition.type === type);
}

/** The render path's policy: refuse a Block nobody registered. */
const strict: RenderPolicy = {
  lookup: lookupIn(definitions),
  unregistered: (block) => {
    throw new UnknownBlockError(block);
  },
  // Nothing here is mobile-only or Outlook-only; the wrappers are tested in
  // responsive and the Preset.
  mobileOnly: (element) => element,
  outlook: (element) => element,
};

/** A minimal forgiving policy, standing in rather than refusing. */
const forgiving: RenderPolicy = {
  lookup: lookupIn(definitions),
  unregistered: (block, children) =>
    createElement("div", { "data-stand-in": block.id }, children),
  mobileOnly: (element) => element,
  outlook: (element) => element,
};

const documentWith = (children: Block["children"]): Block => ({
  id: "root",
  type: "email",
  props: {},
  children,
});

describe("the Block-tree recursion", () => {
  it("renders a Document through whichever policy it is handed", () => {
    const root = documentWith([
      { id: "copy", type: "text", props: { content: "Hello" } },
    ]);

    expect(markupOfNode(renderTree(root, strict))).toContain("Hello");
    expect(markupOfNode(renderTree(root, forgiving))).toContain("Hello");
  });

  it("refuses an unregistered Block under the strict policy", () => {
    const root = documentWith([{ id: "mystery", type: "nope", props: {} }]);

    expect(() => renderTree(root, strict)).toThrow(UnknownBlockError);
  });

  it("stands in for an unregistered Block under the forgiving policy, keeping its children", () => {
    const root = documentWith([
      {
        id: "mystery",
        type: "nope",
        props: {},
        children: [{ id: "copy", type: "text", props: { content: "Kept" } }],
      },
    ]);

    const html = markupOfNode(renderTree(root, forgiving));
    expect(html).toContain('data-stand-in="mystery"');
    // An Author must still be able to see what the editor did not understand.
    expect(html).toContain("Kept");
  });

  it("collects Mobile Override rules from the root it is handed", () => {
    // Not from a root a caller supplied separately: the rules and the markup
    // they style cannot come from different trees, because there is no way to
    // ask for that.
    const root = documentWith([
      {
        id: "row",
        type: "section",
        props: {},
        children: [
          { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
        ],
      },
    ]);

    const html = markupOfNode(renderTree(root, strict));
    expect(html).toContain('class="lekh-m-copy"');
    expect(html).toContain(".lekh-m-copy{font-size:18px!important}");
  });
});

/**
 * The Canvas gives a Block with nothing to show a box, so an Author can still
 * hit it. The render path gives it nothing: the email is emitted as written.
 */
describe("a Block with nothing to show", () => {
  const emptySection: Block = {
    id: "row",
    type: "section",
    props: { padding: 16 },
    children: [],
  };

  const assetlessImage: Block = { id: "pic", type: "image", props: {} };

  it("leaves an empty container empty on the render path", () => {
    const root = documentWith([emptySection]);
    const html = markupOfNode(renderTree(root, strict));

    expect(html).not.toContain("min-height");
    expect(html).toContain('<td style="padding:16px"></td>');
  });

  it("drops that Block from the email entirely", () => {
    const root = documentWith([assetlessImage]);

    expect(markupOfNode(renderTree(root, strict))).not.toContain("min-height");
  });

  describe("a Definition with a stand-in of its own", () => {
    // An icon in a row of icons: a full-width box would break the row, so the
    // Definition says what room it takes when it has nothing to show.
    const shaped = {
      ...image,
      standIn: () => (
        <span style={{ display: "inline-block", width: 32, height: 32 }} />
      ),
    };
    const shapedDefinitions = definitions.map((definition) =>
      definition.type === "image" ? shaped : definition,
    );
    const root = documentWith([assetlessImage]);

    it("never reaches the email", () => {
      const html = markupOfNode(
        renderTree(root, { ...strict, lookup: lookupIn(shapedDefinitions) }),
      );

      expect(html).not.toContain("<span");
    });
  });
});
