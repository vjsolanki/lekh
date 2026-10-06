import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEditor,
  MOBILE_CLASSES,
  type EmailDocument,
  type Editor,
} from "../../index";
import {
  definitions,
  definitionsResponsive,
  REVERSE_RULE,
  sequentialIds,
} from "../../testing/blocks";
import { markupOf, stylesheetOf } from "../../testing/markup";

/**
 * Responsiveness, at the two seams that can see it (ADR-0007).
 *
 * Nearly all of it is resolution and CSS, so nearly all of it needs no browser:
 * the editor instance decides what an Author's change on the mobile Stage means,
 * and the render path decides what comes out the other end. How the mobile
 * stylesheet is collected is in `core/responsive.unit.test.tsx`, and how the
 * Canvas keeps it is in `canvas/tree.unit.test.tsx`. The only thing left
 * for the browser is that switching Stage really does narrow the frame — that
 * lives in `responsive.browser.test.tsx`.
 */

/** A Document with one text Block, and whatever else is asked for. */
function documentWith(children: EmailDocument["root"]["children"]) {
  return { root: { id: "root", type: "email", props: {}, children } };
}

const mediaQuery = (body: string) =>
  `@media only screen and (max-width:480px){${body}}`;

const STACK_RULE =
  `.${MOBILE_CLASSES.stack}{display:inline-block!important;width:100%!important;` +
  `max-width:100%!important;box-sizing:border-box!important}`;

describe("the mobile Stage", () => {
  let editor: Editor;
  let copy: string;

  beforeEach(() => {
    editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
    });
    copy = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.select(copy);
  });

  const controlFor = (name: string) =>
    editor.getControls().find((control) => control.name === name);

  it("opens on the desktop Stage", () => {
    expect(editor.getStage()).toBe("desktop");
  });

  it("can be the Stage the editor opens in", () => {
    const mobileFirst = createEditor({
      definitions,
      rootType: "email",
      stage: "mobile",
    });

    expect(mobileFirst.getStage()).toBe("mobile");
  });

  it("announces a switch, so both surfaces follow it at once", () => {
    let changes = 0;
    editor.subscribe(() => {
      changes += 1;
    });

    editor.setStage("mobile");
    editor.setStage("mobile");

    expect(changes).toBe(1);
    expect(editor.getStage()).toBe("mobile");
  });

  it("writes an override, leaving the desktop value untouched", () => {
    editor.setProp(copy, "fontSize", 22);
    editor.setStage("mobile");
    editor.setProp(copy, "fontSize", 12);

    expect(editor.getBlock(copy)?.props).toEqual({ fontSize: 22 });
    expect(editor.getBlock(copy)?.mobile).toEqual({ fontSize: 12 });
  });

  it("resolves through the override, then the stored value, then the default", () => {
    expect(controlFor("fontSize")?.value).toBe(14);

    editor.setProp(copy, "fontSize", 22);
    editor.setStage("mobile");
    // Nothing overridden yet, so mobile still follows desktop — which is what
    // makes changing the desktop value change both.
    expect(controlFor("fontSize")?.value).toBe(22);

    editor.setProp(copy, "fontSize", 12);
    expect(controlFor("fontSize")?.value).toBe(12);

    editor.setStage("desktop");
    expect(controlFor("fontSize")?.value).toBe(22);
  });

  it("restores the desktop value when the override is cleared", () => {
    editor.setProp(copy, "fontSize", 22);
    editor.setStage("mobile");
    editor.setProp(copy, "fontSize", 12);

    expect(editor.clearMobileOverride(copy, "fontSize")).toBe(true);
    expect(controlFor("fontSize")?.value).toBe(22);
  });

  it("stores overrides sparsely, so reverting one leaves nothing behind", () => {
    const before = structuredClone(editor.getBlock(copy));
    editor.setStage("mobile");
    editor.setProp(copy, "fontSize", 12);
    editor.clearMobileOverride(copy, "fontSize");

    // Not merely an empty object: the Block is exactly what it was, so a
    // Document an Author experimented on round-trips unchanged.
    expect(editor.getBlock(copy)).toEqual(before);
  });

  it("refuses to clear an override that is not there", () => {
    expect(editor.clearMobileOverride(copy, "fontSize")).toBe(false);
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    // Only the insertion, so nothing was quietly pushed onto the stack.
    expect(editor.canUndo()).toBe(false);
  });

  it("describes only the props whose Schema opted in", () => {
    expect(editor.getControls().map((control) => control.name)).toEqual([
      "content",
      "fontSize",
    ]);

    editor.setStage("mobile");
    // `content` is rich text and has no mobile declarations, so an Author is never
    // offered a change that would emit nothing.
    expect(editor.getControls().map((control) => control.name)).toEqual([
      "fontSize",
    ]);
  });

  it("reports which props can be overridden, on either Stage", () => {
    expect(controlFor("content")?.overridable).toBe(false);
    expect(controlFor("fontSize")?.overridable).toBe(true);
  });

  it("reports whether an override exists", () => {
    expect(controlFor("fontSize")?.otherStage?.origin).toBe("default");

    editor.setStage("mobile");
    controlFor("fontSize")?.set(12);
    expect(controlFor("fontSize")?.origin).toBe("override");

    // Visible from the desktop Stage too, so an Author can see what differs.
    editor.setStage("desktop");
    expect(controlFor("fontSize")?.otherStage).toEqual({
      value: 12,
      origin: "override",
    });
  });

  it("reports no override for a prop that no longer opts in", () => {
    // A Definition that has dropped its `mobile` leaves stored overrides that
    // resolve to nothing. Reporting it as an override would offer an Author a
    // revert that changes nothing they can see.
    const dropped = createEditor({
      definitions: definitions.map((definition) =>
        definition.type === "text"
          ? {
              ...definition,
              schema: {
                ...definition.schema,
                fontSize: {
                  kind: "number",
                  label: "Font size",
                  defaultValue: 14,
                },
              },
            }
          : definition,
      ),
      document: {
        root: {
          id: "root",
          type: "email",
          props: {},
          children: [
            { id: "copy", type: "text", props: {}, mobile: { fontSize: 12 } },
          ],
        },
      },
      rootType: "email",
    });
    dropped.select("copy");

    const fontSize = dropped
      .getControls()
      .find((control) => control.name === "fontSize");
    expect(fontSize?.overridable).toBe(false);
    expect(fontSize?.otherStage).toBeUndefined();
    expect(fontSize?.value).toBe(14);
  });

  it("reverts an override through the descriptor, in one action", () => {
    editor.setStage("mobile");
    controlFor("fontSize")?.set(12);
    controlFor("fontSize")?.clearOverride();

    expect(editor.getBlock(copy)?.mobile).toBeUndefined();
  });

  it("makes an override undoable like any other change", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    editor.setStage("mobile");
    editor.setProp(copy, "fontSize", 12);
    // Past `newGroupDelay`, or the two sets would undo as one drag.
    vi.advanceTimersByTime(1000);
    editor.setProp(copy, "fontSize", 10);
    vi.useRealTimers();

    editor.undo();
    expect(editor.getBlock(copy)?.mobile).toEqual({ fontSize: 12 });

    editor.undo();
    expect(editor.getBlock(copy)?.mobile).toBeUndefined();

    editor.redo();
    expect(editor.getBlock(copy)?.mobile).toEqual({ fontSize: 12 });
  });

  it("makes clearing an override undoable too", () => {
    editor.setStage("mobile");
    editor.setProp(copy, "fontSize", 12);
    editor.clearMobileOverride(copy, "fontSize");
    editor.undo();

    expect(editor.getBlock(copy)?.mobile).toEqual({ fontSize: 12 });
  });

  it("sets the desktop value for a prop that never opted in", () => {
    // A resolved image, a text edit, or anything else the mobile Stage does not
    // describe: it has no override to write, so it writes the value it has.
    editor.setStage("mobile");
    editor.setProp(copy, "content", "Changed");

    expect(editor.getBlock(copy)?.props).toEqual({ content: "Changed" });
    expect(editor.getBlock(copy)?.mobile).toBeUndefined();
  });

  it("refuses that same prop from a control held over from the desktop Stage", () => {
    // A mobile control never shows a value it cannot store, so it writes no
    // desktop value from mobile either.
    const content = controlFor("content");
    editor.setStage("mobile");
    content?.set("Changed");
    content?.reset();

    expect(editor.getBlock(copy)?.props).toEqual({});
  });

  it("carries the Stage on the Op, so a Consumer can persist the patch", () => {
    const ops: unknown[] = [];
    editor.onOp((op) => {
      ops.push(op);
    });

    editor.setStage("mobile");
    editor.setProp(copy, "fontSize", 12);

    expect(ops).toEqual([
      {
        kind: "set-prop",
        origin: "local",
        blockId: copy,
        prop: "fontSize",
        value: 12,
        previousValue: undefined,
        stage: "mobile",
      },
    ]);
  });
});

describe("rendering a responsive Document", () => {
  // What only a rendered email can show: that the class reaches the element, the
  // stylesheet reaches the head, and the two meet the way a mail client needs.

  it("emits no stylesheet element at all when nothing uses one", () => {
    const html = markupOf(
      documentWith([{ id: "copy", type: "text", props: {} }]),
      { definitions: definitionsResponsive },
    );

    expect(html).not.toContain("<style");
    expect(html).not.toContain("@media");
  });

  it("puts the class on the element whose inline style it beats", () => {
    const html = markupOf(
      documentWith([
        { id: "copy", type: "text", props: {}, mobile: { fontSize: 20 } },
      ]),
      { definitions: definitionsResponsive },
    );

    expect(html).toContain(
      `<style>${mediaQuery(".lekh-m-copy{font-size:20px!important}")}</style>`,
    );
    // Forced because a Block Definition's own inline style would otherwise win.
    expect(html).toContain('<p class="lekh-m-copy" style="font-size:14px">');
  });

  it("leaves the desktop values inline", () => {
    const html = markupOf(
      documentWith([
        {
          id: "copy",
          type: "text",
          props: { fontSize: 32 },
          mobile: { fontSize: 18 },
        },
      ]),
      { definitions: definitionsResponsive },
    );

    // One rendering, two sizes: the desktop value is the markup and the mobile
    // value is a rule over it. Nothing re-renders when the Stage changes.
    expect(html).toContain('style="font-size:32px"');
    expect(html).toContain(".lekh-m-copy{font-size:18px!important}");
  });

  it("collects every Block's rules into the one stylesheet in the head", () => {
    const html = markupOf(
      documentWith([
        {
          id: "row",
          type: "columns",
          props: { reverseOnMobile: true },
          children: [
            {
              id: "left",
              type: "column",
              props: { hideOnMobile: true },
              children: [{ id: "copy", type: "text", props: {} }],
            },
            { id: "right", type: "column", props: {}, children: [] },
          ],
        },
      ]),
      { definitions: definitionsResponsive },
    );

    expect(html.match(/<style>/gu)).toHaveLength(1);
    expect(html).toContain('class="reverse-row"');
    expect(html).toContain(
      `class="${MOBILE_CLASSES.stack} ${MOBILE_CLASSES.hide}"`,
    );
    expect(html).toContain(`.${MOBILE_CLASSES.hide}{display:none!important}`);
    expect(html).toContain(REVERSE_RULE);
  });

  it("renders the same Document identically every time", () => {
    const document = documentWith([
      {
        id: "row",
        type: "columns",
        props: { reverseOnMobile: true },
        children: [
          {
            id: "left",
            type: "column",
            props: {},
            children: [
              { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
            ],
          },
        ],
      },
    ]);

    // Class assignment and rule order have to be deterministic, or diffing
    // stored output becomes impossible.
    expect(markupOf(document, { definitions: definitionsResponsive })).toBe(
      markupOf(document, { definitions: definitionsResponsive }),
    );
  });

  it("emits an Override for a Block the editor put the Overrides on", () => {
    // The editor writes them and the render path reads them, with no shared
    // state between the two beyond the Document itself.
    const editor = createEditor({
      definitions: definitionsResponsive,
      rootType: "email",
      createId: sequentialIds(),
      stage: "mobile",
    });
    const id = editor.insertBlock("text", editor.getDocument().root.id) ?? "";
    editor.setProp(id, "fontSize", 11);

    expect(
      markupOf(editor.getDocument(), { definitions: definitionsResponsive }),
    ).toContain(".lekh-m-id-2{font-size:11px!important}");
  });
});

/** The class the library's mobile-only wrapper carries. */
const MOBILE_ONLY_CLASS = "lekh-mobile-only";

/** The rule that shows a mobile-only wrapper inside the media query. */
const REVEAL_RULE =
  `.${MOBILE_ONLY_CLASS}{display:block!important;max-height:none!important;` +
  `overflow:visible!important}`;

/** The wrapper's opening tag, hidden inline until the reveal fires. */
const MOBILE_ONLY_OPEN =
  `<div class="${MOBILE_ONLY_CLASS}" ` +
  `style="display:none;max-height:0;overflow:hidden">`;

describe("a Block shown only on a phone", () => {
  // ADR-0025: the library builds the wrapper, so every Definition that asks
  // for it gets the same hiding, the same reveal and the same Outlook comment.

  const teased = documentWith([
    {
      id: "teaser",
      type: "teaser",
      props: {},
      children: [
        { id: "copy", type: "text", props: {}, mobile: { fontSize: 18 } },
        {
          id: "row",
          type: "columns",
          props: {},
          children: [{ id: "cell", type: "column", props: {}, children: [] }],
        },
      ],
    },
  ]);

  it("is hidden inline, with its markup inside the comment Outlook skips", () => {
    const html = markupOf(teased, { definitions: definitionsResponsive });

    expect(html).toContain(
      `${MOBILE_ONLY_OPEN}<!--[if !mso]><!--><div class="teaser">`,
    );
    expect(html).toContain("</div><!--<![endif]--></div>");
  });

  it("puts the reveal rule in the stylesheet", () => {
    expect(
      stylesheetOf(markupOf(teased, { definitions: definitionsResponsive })),
    ).toContain(REVEAL_RULE);
  });

  it("leaves the reveal rule out of an email that shows everything everywhere", () => {
    const html = markupOf(
      documentWith([{ id: "copy", type: "text", props: {} }]),
      { definitions: definitionsResponsive },
    );

    expect(html).not.toContain(MOBILE_ONLY_CLASS);
  });

  it("still collects the mobile rules of what it holds", () => {
    // The Definitions below ran before the wrapper turned their markup into a
    // string, so what they asked the stylesheet for is already in it.
    const css = stylesheetOf(
      markupOf(teased, { definitions: definitionsResponsive }),
    );

    expect(css).toContain(".lekh-m-copy{font-size:18px!important}");
    expect(css).toContain(STACK_RULE);
  });
});
