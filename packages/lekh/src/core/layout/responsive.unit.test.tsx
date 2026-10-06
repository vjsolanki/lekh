import { describe, expect, it } from "vitest";

import {
  MOBILE_CLASSES,
  NONE,
  SchemaKind,
  type BlockDefinition,
  type EmailDocument,
  type SchemaEntry,
} from "../../index";
import {
  definitionsResponsive,
  REVERSE_RULE,
  text,
} from "../../testing/blocks";
import { collectMobileRules, overrideRulesOf } from "./responsive";

/**
 * The mobile rules a Document implies (ADR-0007), worked out without rendering
 * anything. What a rendered email does with them is in `responsive.test.tsx`.
 */

/** A Document with one text Block, and whatever else is asked for. */
function documentWith(children: EmailDocument["root"]["children"]) {
  return { root: { id: "root", type: "email", props: {}, children } };
}

/** What the collection is handed to find a Block's Definition. */
const lookup = (type: string): BlockDefinition | undefined =>
  definitionsResponsive.find((definition) => definition.type === type);

/** The rules a Document implies, without rendering anything. */
const rulesOf = (document: EmailDocument) =>
  overrideRulesOf(document.root, lookup, {});

/** The collection a render would drive, without rendering anything. */
const collect = (document: EmailDocument) =>
  collectMobileRules(document.root, lookup, {});

const mediaQuery = (body: string) =>
  `@media only screen and (max-width:480px){${body}}`;

const STACK_RULE =
  `.${MOBILE_CLASSES.stack}{display:inline-block!important;width:100%!important;` +
  `max-width:100%!important;box-sizing:border-box!important}`;

/**
 * A lookup whose `text` Block declares `fontSize` however a test needs it —
 * a Definition that dropped its `mobile`, forced its own value, or emitted
 * something it should not have.
 */
const textWhoseFontSize = (
  entry: SchemaEntry<number>,
): ((type: string) => BlockDefinition | undefined) => {
  const rewritten: BlockDefinition = {
    ...text,
    schema: { ...text.schema, fontSize: entry },
  };
  return (type) => (type === "text" ? rewritten : lookup(type));
};

/** One overridden text Block, which is all most of these need. */
const overriddenCopy = documentWith([
  { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
]);

describe("the Override rules a Document implies", () => {
  // Worked out from the Document alone, before anything renders — so they are
  // assertable as data rather than dug back out of a rendered email.

  it("emits one rule per overridden prop, in Schema order", () => {
    const rules = rulesOf(
      documentWith([
        {
          id: "row",
          type: "section",
          props: {},
          mobile: { padding: 8 },
          children: [
            { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
          ],
        },
      ]),
    );

    expect(rules).toEqual([
      {
        blockId: "row",
        className: "lekh-m-row",
        declarations: [["padding", "8px!important"]],
      },
      {
        blockId: "copy",
        className: "lekh-m-copy",
        declarations: [["font-size", "18px!important"]],
      },
    ]);
  });

  it("ignores an override for a prop the Schema does not declare", () => {
    const rules = rulesOf(
      documentWith([
        {
          id: "row",
          type: "section",
          props: {},
          mobile: { padding: 8, unknownProp: "ignored" },
          children: [],
        },
      ]),
    );

    expect(rules).toEqual([
      {
        blockId: "row",
        className: "lekh-m-row",
        declarations: [["padding", "8px!important"]],
      },
    ]);
  });

  it("ignores an override for a prop that is no longer Overridable", () => {
    // A Definition that has dropped its `mobile` leaves stored overrides behind.
    // They are inert: there are no declarations to put them through.
    const dropped = textWhoseFontSize({
      kind: "number",
      label: "Font size",
      defaultValue: 14,
    });

    expect(overrideRulesOf(overriddenCopy.root, dropped, {})).toEqual([]);
  });

  it("names the class after the Block, escaped for CSS", () => {
    const rules = rulesOf(
      documentWith([
        { id: "copy:1", type: "text", props: {}, mobile: { fontSize: 18 } },
      ]),
    );

    expect(rules[0]?.className).toBe("lekh-m-copy_3a1");
  });

  it("never lands two Blocks on one class", () => {
    // Escaped rather than stripped: an id with an awkward character in it must
    // not collide with the id that has a dash in the same place, or an Author
    // would change one Block and watch another move.
    const rules = rulesOf(
      documentWith([
        { id: "a.b", type: "text", props: {}, mobile: { fontSize: 18 } },
        { id: "a-b", type: "text", props: {}, mobile: { fontSize: 22 } },
        { id: "a_b", type: "text", props: {}, mobile: { fontSize: 26 } },
      ]),
    );

    expect(new Set(rules.map((rule) => rule.className)).size).toBe(3);
  });

  it("hands each declaration the root's props", () => {
    // An alignment needs the email's direction to know which side `start` is.
    const scaled = textWhoseFontSize({
      ...text.schema.fontSize,
      mobile: (size, rootProps) => ({
        "font-size": `${String(size * Number(rootProps["scale"]))}px`,
      }),
    });

    expect(
      overrideRulesOf(overriddenCopy.root, scaled, { scale: 2 })[0]
        ?.declarations,
    ).toEqual([["font-size", "36px!important"]]);
  });

  it("forces a declaration a Definition already forced, only once", () => {
    const shouty = textWhoseFontSize({
      ...text.schema.fontSize,
      mobile: (size) => ({ "font-size": `${String(size)}px !important` }),
    });

    expect(
      overrideRulesOf(overriddenCopy.root, shouty, {})[0]?.declarations,
    ).toEqual([["font-size", "18px!important"]]);
  });

  it("drops a declaration that could close its own rule", () => {
    // An Override is stored data, and stored data reaching a stylesheet must not
    // be able to end the Block's rule and start whatever came after it.
    const injecting = textWhoseFontSize({
      ...text.schema.fontSize,
      mobile: (size) => ({
        "font-size": `${String(size)}px`,
        color: "red}body{display:none",
      }),
    });

    expect(
      overrideRulesOf(overriddenCopy.root, injecting, {})[0]?.declarations,
    ).toEqual([["font-size", "18px!important"]]);
  });

  it("emits nothing for a surface an Author cleared on the phone", () => {
    // The second path a surface prop has to CSS, and the one `render` never
    // sees. Without the check in `overrideDeclarationsOf` this emits
    // `background-color: none !important` — `isSafeDeclaration` has no reason
    // to stop it, because the value cannot close the rule, only paint the
    // wrong thing. See ADR-0019.
    const surfaced: BlockDefinition = {
      ...text,
      schema: {
        ...text.schema,
        backgroundColor: {
          kind: SchemaKind.surface,
          label: "Background color",
          defaultValue: NONE,
          mobile: (color) => ({ "background-color": String(color) }),
        },
      },
    };
    const lookupSurfaced = (type: string): BlockDefinition | undefined =>
      type === "text" ? surfaced : lookup(type);

    const painted = documentWith([
      {
        id: "copy",
        type: "text",
        props: {},
        mobile: { backgroundColor: "#123456" },
      },
    ]);
    const emptied = documentWith([
      {
        id: "copy",
        type: "text",
        props: {},
        mobile: { backgroundColor: NONE },
      },
    ]);

    // A colour still reaches the stylesheet, so the check is not simply
    // refusing the kind outright.
    expect(
      overrideRulesOf(painted.root, lookupSurfaced, {})[0]?.declarations,
    ).toEqual([["background-color", "#123456!important"]]);
    expect(overrideRulesOf(emptied.root, lookupSurfaced, {})).toEqual([]);
  });

  it("gives a Block with no Override that counts no rule at all", () => {
    expect(
      rulesOf(documentWith([{ id: "copy", type: "text", props: {} }])),
    ).toEqual([]);
  });
});

describe("the mobile stylesheet", () => {
  // The collection a render drives: structural classes and a Block's own rules
  // arrive as each Definition renders and asks for them.

  it("is empty when nothing uses one", () => {
    const rules = collect(
      documentWith([{ id: "copy", type: "text", props: {} }]),
    );

    expect(rules.stylesheet()).toBe("");
  });

  it("carries a structural rule only once the class is asked for", () => {
    const rules = collect(
      documentWith([{ id: "copy", type: "text", props: {} }]),
    );

    expect(rules.stylesheet()).toBe("");
    expect(rules.use("stack")).toBe(MOBILE_CLASSES.stack);
    expect(rules.stylesheet()).toBe(mediaQuery(STACK_RULE));
  });

  it("emits structural rules in a fixed order, whatever order they were asked in", () => {
    const rules = collect(documentWith([]));
    rules.use("stack");
    rules.use("hide");

    // Render order must not decide the stylesheet, or two identical Documents
    // could differ by the order their Blocks happened to render in.
    expect(rules.stylesheet().indexOf(`.${MOBILE_CLASSES.hide}{`)).toBeLessThan(
      rules.stylesheet().indexOf(`.${MOBILE_CLASSES.stack}{`),
    );
  });

  it("takes rules a Block Definition emits for itself", () => {
    const rules = collect(documentWith([]));
    rules.add(REVERSE_RULE);

    // Structural responsiveness is not limited to what the library anticipated.
    expect(rules.stylesheet()).toBe(mediaQuery(REVERSE_RULE));
  });

  it("emits a rule two Blocks both asked for exactly once", () => {
    const rules = collect(documentWith([]));
    rules.add(REVERSE_RULE);
    rules.add(REVERSE_RULE);

    // Two reversing rows are one rule, not the same rule twice in every email.
    expect(rules.stylesheet()).toBe(mediaQuery(REVERSE_RULE));
  });

  it("ignores an empty rule", () => {
    const rules = collect(documentWith([]));
    rules.add("   ");

    expect(rules.stylesheet()).toBe("");
  });

  it("keeps a Block's own Override after the generic structural rules", () => {
    const rules = collect(
      documentWith([
        { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
      ]),
    );
    rules.use("stack");
    rules.add(REVERSE_RULE);

    // One Block's own value must beat a generic rule, and both are forced, so
    // the later of the two wins.
    expect(rules.stylesheet()).toBe(
      mediaQuery(
        STACK_RULE + REVERSE_RULE + ".lekh-m-copy{font-size:18px!important}",
      ),
    );
  });

  it("hands a Block the class its own Overrides landed under, and no other", () => {
    const rules = collect(
      documentWith([
        { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
        { id: "plain", type: "text", props: {} },
      ]),
    );

    expect(rules.classOf("copy")).toBe("lekh-m-copy");
    expect(rules.classOf("plain")).toBeUndefined();
  });
});
