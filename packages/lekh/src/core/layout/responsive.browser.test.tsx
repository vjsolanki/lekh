import { describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider } from "../../canvas";
import {
  classNames,
  createEditor,
  defineBlock,
  MobileStyles,
  type BlockDefinition,
  type Editor,
  type EmailDocument,
} from "../../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../../blocks";
import { sequentialIds } from "../../testing/blocks";
import { blockElement, mount, whenRendered } from "../../testing/browser";
import { createTiptapTextEngine } from "../../tiptap";

/**
 * The Stage, in a browser.
 *
 * Everything else about responsiveness is resolution and CSS and is covered
 * without a DOM in `responsive.test.tsx`. This file exists for the one claim
 * that cannot be checked anywhere else: switching Stage narrows the frame, so
 * the email's own media queries fire and what an Author sees is a rendering
 * rather than a simulation of one (ADR-0003).
 */

const DESKTOP_SIZE = 30;
const MOBILE_SIZE = 12;

const definitions: readonly BlockDefinition[] = [
  defineBlock<Record<string, never>>({
    type: "email",
    label: "Email",
    accepts: ["heading", "aside"],
    schema: {},
    render: ({ children, mobile }) => (
      <div>
        <MobileStyles css={mobile.stylesheet()} />
        {children}
      </div>
    ),
  }),
  defineBlock<{ fontSize: number }>({
    type: "heading",
    label: "Heading",
    schema: {
      fontSize: {
        kind: "number",
        label: "Font size",
        defaultValue: DESKTOP_SIZE,
        mobile: (size) => ({ "font-size": `${String(size)}px` }),
      },
    },
    render: ({ props, mobile }) => (
      <p className={mobile.className} style={{ fontSize: props.fontSize }}>
        Ship it
      </p>
    ),
  }),
  defineBlock<{ hideOnMobile: boolean }>({
    type: "aside",
    label: "Aside",
    schema: {
      hideOnMobile: {
        kind: "boolean",
        label: "Hide on mobile",
        defaultValue: false,
      },
    },
    render: ({ props, mobile }) => (
      <p className={classNames(props.hideOnMobile && mobile.use("hide"))}>
        Decoration
      </p>
    ),
  }),
];

/** How wide the frame the email is rendered in actually is. */
const frameWidth = (frame: HTMLIFrameElement): number =>
  frame.getBoundingClientRect().width;

function editorWithHeading(): { editor: Editor; heading: string } {
  const editor = createEditor({
    definitions,
    rootType: "email",
    createId: sequentialIds("block"),
  });
  const heading =
    editor.insertBlock("heading", editor.getDocument().root.id) ?? "";
  return { editor, heading };
}

describe("switching Stage", () => {
  it("narrows the frame the email renders in", async () => {
    const { editor } = editorWithHeading();
    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas width={600} mobileWidth={375} />
      </EditorProvider>,
    );
    const { frame } = await whenRendered(host);

    expect(frameWidth(frame)).toBeCloseTo(600, 0);

    editor.setStage("mobile");
    await vi.waitFor(() => {
      expect(frameWidth(frame)).toBeCloseTo(375, 0);
    });

    editor.setStage("desktop");
    await vi.waitFor(() => {
      expect(frameWidth(frame)).toBeCloseTo(600, 0);
    });
  });

  it("makes the email's own mobile rules fire, rather than simulating them", async () => {
    const { editor, heading } = editorWithHeading();
    editor.setStage("mobile");
    editor.setProp(heading, "fontSize", MOBILE_SIZE);
    editor.setStage("desktop");

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas width={600} mobileWidth={375} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const { frameDocument } = mounted;
    const element = blockElement(mounted, heading);

    const sizeNow = (): string =>
      frameDocument.defaultView?.getComputedStyle(element).fontSize ?? "";

    // Same markup on both Stages — the desktop value is inline and the mobile
    // value is a forced rule inside a media query that the narrowed frame
    // satisfies.
    expect(sizeNow()).toBe(`${String(DESKTOP_SIZE)}px`);

    editor.setStage("mobile");
    await vi.waitFor(() => {
      expect(sizeNow()).toBe(`${String(MOBILE_SIZE)}px`);
    });
  });

  it("hides a Block an Author left off the small screen", async () => {
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds("block"),
    });
    const root = editor.getDocument().root.id;
    const aside =
      editor.insertBlock("aside", root, undefined, { hideOnMobile: true }) ??
      "";

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas width={600} mobileWidth={375} />
      </EditorProvider>,
    );
    const element = blockElement(await whenRendered(host), aside);

    expect(element.getBoundingClientRect().height).toBeGreaterThan(0);

    editor.setStage("mobile");
    await vi.waitFor(() => {
      // Structural behaviour, from an ordinary boolean prop and one static rule.
      expect(element.getBoundingClientRect().height).toBe(0);
    });
  });

  it("shows a mobile-only Block on the mobile Stage alone, still editable", async () => {
    // ADR-0025: the Canvas gets the wrapper with live children, so the text
    // inside it is the Text Engine's like any other.
    const text = createTiptapTextEngine();
    const editor = createEditor({
      definitions: createReactEmailPreset(),
      rootType: REACT_EMAIL_ROOT_TYPE,
      textEngine: text,
      document: {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: {},
          children: [
            {
              id: "teaser",
              type: "text",
              props: { content: "Only on a phone", showOn: "mobile" },
            },
          ],
        },
      },
    });

    const host = mount(
      <EditorProvider editor={editor} editableText={text.EditableText}>
        <Canvas width={600} mobileWidth={375} />
      </EditorProvider>,
    );
    const element = blockElement(await whenRendered(host), "teaser");

    expect(element.getBoundingClientRect().height).toBe(0);

    editor.setStage("mobile");
    await vi.waitFor(() => {
      expect(element.getBoundingClientRect().height).toBeGreaterThan(0);
    });

    editor.edit("teaser");
    const editable = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>(
        "[contenteditable='true']",
      );
      if (!found) throw new Error("The text is not editable yet.");
      return found;
    });
    expect(editable.textContent).toBe("Only on a phone");
  });

  it("resizes every paragraph of the Preset's text by one override", async () => {
    // ADR-0023: the class is on the text's cell, and each paragraph sizes
    // itself at 1em of it, so one rule reaches all of them.
    const editor = createEditor({
      definitions: createReactEmailPreset(),
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: {},
          children: [
            {
              id: "copy",
              type: "text",
              props: {
                content: "<p>One</p><p>Two</p><p>Three</p>",
                fontSize: 20,
              },
              mobile: { fontSize: 13 },
            },
          ],
        },
      },
    });

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas width={600} mobileWidth={375} />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);
    const sizes = (): string[] =>
      [...frameDocument.querySelectorAll('[data-block-id="copy"] p')].map(
        (paragraph) =>
          frameDocument.defaultView?.getComputedStyle(paragraph).fontSize ?? "",
      );

    expect(sizes()).toEqual(["20px", "20px", "20px"]);

    editor.setStage("mobile");
    await vi.waitFor(() => {
      expect(sizes()).toEqual(["13px", "13px", "13px"]);
    });
  });

  it("stacks the built-in Preset's columns, and reverses them", async () => {
    // The Preset's own markup, in a real layout engine: the classes are what the
    // Node suites assert, and this is whether the technique behind them works.
    const twoUp: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [
          {
            id: "row",
            type: "columns",
            props: { reverseOnMobile: true },
            children: [
              { id: "left", type: "column", props: {}, children: [] },
              { id: "right", type: "column", props: {}, children: [] },
            ],
          },
        ],
      },
    };
    const editor = createEditor({
      definitions: createReactEmailPreset(),
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: twoUp,
    });

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas width={600} mobileWidth={375} />
      </EditorProvider>,
    );
    const mounted = await whenRendered(host);
    const boxes = (): readonly DOMRect[] =>
      ["left", "right"].map((id) =>
        blockElement(mounted, id).getBoundingClientRect(),
      );

    const [left, right] = boxes();
    // Side by side on the desktop Stage: same row, different columns.
    expect(left?.top).toBeCloseTo(right?.top ?? -1, 0);
    expect(left?.left).toBeLessThan(right?.left ?? 0);

    editor.setStage("mobile");
    await vi.waitFor(() => {
      const [first, second] = boxes();
      // Stacked, and in the opposite order: the column that was on the left is
      // now the lower of the two.
      expect(first?.left).toBeCloseTo(second?.left ?? -1, 0);
      expect(first?.top).toBeGreaterThan(second?.top ?? 0);
    });
  });
});
