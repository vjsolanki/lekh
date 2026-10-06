import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ComplianceDiagnostic, PresetDiagnostic } from "../../blocks";
import {
  createEditor,
  defineBlock,
  DiagnosticCode,
  DocumentValidationError,
  type Edit,
  type Editor,
  renderDocument,
  SchemaKind,
  type Validator,
  ValidatorDiagnostic,
} from "../../index";
import {
  definitions,
  definitionsWithRequired,
  sequentialIds,
} from "../../testing/blocks";
import { SAFE_LINKS, SCRIPTABLE_LINKS } from "../../testing/attacks";
import { editorFor, suggested } from "../../testing/editor";
import { markupOf, parseMarkup } from "../../testing/markup";
import { block, documentOf, onMobile } from "../../testing/tree";

/** Rejects the widest email a Consumer's brand guidelines allow. */
const contentWidthCap: Validator = (document) =>
  Number(document.root.props["contentWidth"] ?? 600) > 700
    ? [
        {
          code: "content-too-wide",
          message: "This email is wider than 700px.",
          severity: "warning",
          blockId: document.root.id,
        },
      ]
    : [];

/** Carry out the first Diagnostic's Repair, the way a Consumer's panel would. */
function repairFirst(editor: Editor): boolean {
  const repair = editor.getDiagnostics()[0]?.repair;
  return repair !== undefined && editor.applyRepair(repair);
}

describe("Diagnostics", () => {
  it("report everything wrong with a Document on one channel", () => {
    const editor = createEditor({
      definitions: definitionsWithRequired(),
      rootType: "email",
      createId: sequentialIds(),
      validators: [contentWidthCap],
      document: {
        root: {
          id: "root",
          type: "email",
          props: { contentWidth: 900 },
          children: [
            { id: "alien", type: "product-grid", props: {} },
            { id: "photo", type: "image", props: {} },
          ],
        },
      },
    });

    expect(editor.getDiagnostics().map((finding) => finding.code)).toEqual([
      DiagnosticCode.blockUnregistered,
      DiagnosticCode.requiredBlockMissing,
      PresetDiagnostic.imageAltTextMissing,
      "content-too-wide",
    ]);
  });

  it("flag a Block whose type is not registered, and say which one", () => {
    const editor = editorFor({
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "alien", type: "product-grid", props: {} }],
      },
    });

    expect(editor.getDiagnostics()[0]).toMatchObject({
      code: DiagnosticCode.blockUnregistered,
      severity: "error",
      blockId: "alien",
    });
  });

  it("carry Diagnostics a Block Definition contributes itself", () => {
    const editor = editorFor();
    const id = editor.insertBlock("image", editor.getDocument().root.id) ?? "";

    expect(editor.getDiagnostics()).toMatchObject([
      {
        code: PresetDiagnostic.imageAltTextMissing,
        severity: "warning",
        blockId: id,
      },
    ]);

    editor.setProp(id, "asset", {
      src: "https://cdn.example.com/cat.jpg",
      width: 800,
      height: 600,
      alt: "A cat",
    });
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("appear the moment an Author causes the problem", () => {
    const editor = editorFor();
    expect(editor.getDiagnostics()).toEqual([]);

    editor.insertBlock("image", editor.getDocument().root.id);
    expect(editor.getDiagnostics()).toHaveLength(1);
  });

  it("distinguish error from warning", () => {
    const editor = editorFor({
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          { id: "alien", type: "product-grid", props: {} },
          { id: "photo", type: "image", props: {} },
        ],
      },
    });

    expect(editor.getDiagnostics().map((finding) => finding.severity)).toEqual([
      "error",
      "warning",
    ]);
  });

  it("take a severity override, so a regulated product can escalate", () => {
    const editor = createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
      severities: { [PresetDiagnostic.imageAltTextMissing]: "error" },
    });
    editor.insertBlock("image", editor.getDocument().root.id);

    expect(editor.getDiagnostics()[0]?.severity).toBe("error");
  });

  it("refuse to soften an error into a warning", () => {
    const editor = createEditor({
      definitions: definitionsWithRequired(),
      rootType: "email",
      createId: sequentialIds(),
      severities: { [DiagnosticCode.requiredBlockMissing]: "warning" },
      document: {
        root: { id: "root", type: "email", props: {}, children: [] },
      },
    });

    // Downgrading would be a back door around the render path's refusal: a
    // Consumer who does not want an unsubscribe link declines to declare one
    // required instead (ADR-0006).
    expect(editor.getDiagnostics()[0]?.severity).toBe("error");
  });

  it("hand a Validator the registered Block Definitions", () => {
    const seen = vi.fn<Validator>(() => []);
    createEditor({
      definitions,
      rootType: "email",
      createId: sequentialIds(),
      validators: [seen],
    }).getDiagnostics();

    expect(seen.mock.calls[0]?.[1].getDefinition("text")?.label).toBe("Text");
  });

  it("hand every check the root's props, defaults filled in", () => {
    const seen = vi.fn<Validator>(() => []);
    const editor = editorFor(
      documentOf(block("email", { id: "root", contentWidth: 640 }, [])),
      { validators: [seen] },
    );
    editor.getDiagnostics();

    // The stored width, and the Schema's colour for the prop nobody set.
    expect(seen.mock.calls[0]?.[1].rootProps).toMatchObject({
      contentWidth: 640,
      backgroundColor: "#ffffff",
    });
  });
});

function editorMissingRequired() {
  return editorFor(documentOf(block("email", { id: "root" }, [])), {
    definitions: definitionsWithRequired(),
  });
}

describe("a missing Required Block", () => {
  it("is reported as an error, however it came to be missing", () => {
    expect(editorMissingRequired().getDiagnostics()).toMatchObject([
      { code: DiagnosticCode.requiredBlockMissing, severity: "error" },
    ]);
  });

  it("is still reported after an Author deletes the container holding it", () => {
    const editor = createEditor({
      definitions: definitionsWithRequired(),
      rootType: "email",
      createId: sequentialIds(),
    });
    const root = editor.getDocument().root.id;
    const sectionId = editor.insertBlock("section", root) ?? "";
    const required = editor.getDocument().root.children?.[0]?.id ?? "";
    editor.moveBlock(required, sectionId, 0);
    expect(editor.getDiagnostics()).toEqual([]);

    editor.removeBlock(sectionId);
    expect(editor.getDiagnostics()).toMatchObject([
      { code: DiagnosticCode.requiredBlockMissing },
    ]);
  });

  it("carries a Repair that restores it at the end of the email", () => {
    const editor = editorMissingRequired();
    expect(repairFirst(editor)).toBe(true);

    expect(
      editor.getDocument().root.children?.map((child) => child.type),
    ).toEqual(["unsubscribe"]);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("describes the Repair as data, naming the type rather than a position", () => {
    expect(editorMissingRequired().getDiagnostics()[0]?.repair).toEqual({
      kind: "restore-required-block",
      type: "unsubscribe",
    });
  });

  it("selects and reveals what it restored", () => {
    const editor = editorMissingRequired();
    const revealed = vi.fn();
    editor.onReveal(revealed);

    repairFirst(editor);
    const restored = editor.getDocument().root.children?.[0]?.id;

    // A compliance repair must never happen off-screen.
    expect(editor.getSelection()).toBe(restored);
    expect(revealed).toHaveBeenCalledWith(restored);
  });

  it("puts the restoration on the undo stack like any other action", () => {
    const editor = editorMissingRequired();
    repairFirst(editor);
    editor.undo();

    expect(editor.getDocument().root.children).toEqual([]);
  });

  it("announces the restoration once, however many calls it takes", () => {
    const editor = editorMissingRequired();
    const woken = vi.fn();
    editor.subscribe(woken);

    repairFirst(editor);

    // An insertion, a selection and a reveal — one action.
    expect(woken).toHaveBeenCalledTimes(1);
  });
});

/** A Section whose padding is right on desktop and a string on mobile. */
const editorWithStringOnMobile = (): Editor =>
  editorFor(
    documentOf(
      block("email", {}, [
        onMobile(block("section", { id: "band", padding: 24 }), {
          padding: "16",
        }),
      ]),
    ),
  );

describe("a prop of the wrong shape", () => {
  const picture = {
    src: "https://cdn.example.com/a.png",
    width: 600,
    height: 400,
  };

  /** An email whose preview text, a text prop, holds a picture. */
  const editorWithPictureForText = (): Editor =>
    editorFor(documentOf(block("email", { id: "root", previewText: picture })));

  it("is reported as an error on its Block, however it got there", () => {
    expect(editorWithPictureForText().getDiagnostics()).toMatchObject([
      {
        code: DiagnosticCode.propWrongShape,
        severity: "error",
        blockId: "root",
        prop: "previewText",
      },
    ]);
    expect(editorWithPictureForText().getDiagnostics()[0]).not.toHaveProperty(
      "stage",
    );
  });

  it("stops the render with that Diagnostic, rather than a crash inside it", () => {
    const editor = editorWithPictureForText();

    expect(() =>
      renderDocument(editor.getDocument(), editor.getRenderOptions()),
    ).toThrow(DocumentValidationError);
  });

  it("carries a Repair that unsets it, back to the Schema default", () => {
    const editor = editorWithPictureForText();

    expect(editor.getDiagnostics()[0]?.repair).toEqual({
      kind: "set-prop",
      blockId: "root",
      prop: "previewText",
      value: undefined,
      stage: "desktop",
    });
    expect(repairFirst(editor)).toBe(true);
    expect(editor.getDocument().root.props).not.toHaveProperty("previewText");
    expect(editor.getDiagnostics()).toEqual([]);
  });

  describe("held in a Mobile Override", () => {
    it("names the prop and the mobile Stage, since desktop is fine", () => {
      expect(editorWithStringOnMobile().getDiagnostics()).toEqual([
        expect.objectContaining({
          code: DiagnosticCode.propWrongShape,
          blockId: "band",
          prop: "padding",
          stage: "mobile",
        }),
      ]);
    });

    it("is put right by dropping the override, from either Stage", () => {
      for (const stage of ["desktop", "mobile"] as const) {
        const editor = editorWithStringOnMobile();
        editor.setStage(stage);

        expect(repairFirst(editor)).toBe(true);
        expect(editor.getBlock("band")).toMatchObject({
          props: { padding: 24 },
        });
        expect(editor.getBlock("band")?.mobile ?? {}).not.toHaveProperty(
          "padding",
        );
        expect(editor.getDiagnostics()).toEqual([]);
      }
    });

    it("leaves the override alone when only desktop is wrong", () => {
      const editor = editorFor(
        documentOf(
          block("email", {}, [
            onMobile(block("section", { id: "band", padding: "24" }), {
              padding: 16,
            }),
          ]),
        ),
      );
      editor.setStage("mobile");

      expect(editor.getDiagnostics()).toEqual([
        expect.not.objectContaining({ stage: expect.anything() }),
      ]);
      expect(repairFirst(editor)).toBe(true);
      expect(editor.getBlock("band")?.props).not.toHaveProperty("padding");
      expect(editor.getBlock("band")?.mobile).toEqual({ padding: 16 });
    });

    it("is not raised for an override on a prop with no mobile life", () => {
      const editor = editorFor(
        documentOf(onMobile(block("email", {}), { previewText: { a: 1 } })),
      );

      expect(editor.getDiagnostics()).toEqual([]);
    });
  });

  it.each([
    ["a string in a number prop", "section", { padding: "16" }],
    ["a number in a rich-text prop", "text", { content: 7 }],
    ["text in an Asset prop", "image", { asset: "a.png" }],
    ["an Asset with no width", "image", { asset: { src: "a.png", height: 1 } }],
    ["null in a text prop", "email", { previewText: null }],
  ])("is caught for %s", (_, type, props) => {
    const editor = editorFor(
      documentOf(block("email", {}, [block(type, props)])),
    );

    expect(editor.getDiagnostics().map((finding) => finding.code)).toContain(
      DiagnosticCode.propWrongShape,
    );
  });

  it.each([
    ["a number in a number prop", "section", { padding: 0 }],
    ["an unset Asset", "image", { asset: undefined }],
    ["a whole Asset", "image", { asset: { ...picture, alt: "A" } }],
    ["a prop the Schema does not declare", "section", { legacy: { a: 1 } }],
  ])("is not raised for %s", (_, type, props) => {
    const editor = editorFor(
      documentOf(block("email", {}, [block(type, props)])),
    );

    expect(
      editor.getDiagnostics().map((finding) => finding.code),
    ).not.toContain(DiagnosticCode.propWrongShape);
  });

  it("is never raised for a kind the library does not know", () => {
    const rating = defineBlock<{ stars: unknown }>({
      type: "rating",
      label: "Rating",
      schema: {
        stars: { kind: "star-picker", label: "Stars", defaultValue: 3 },
      },
      render: () => null,
    });
    const editor = createEditor({
      definitions: [...definitions, rating],
      rootType: "email",
      document: documentOf(
        block("email", {}, [block("rating", { stars: { half: true } })]),
      ),
    });

    expect(editor.getDiagnostics()).toEqual([]);
  });
});

/** A Consumer's own Block with one link on it. */
const link = defineBlock<{ href: string }>({
  type: "link",
  label: "Link",
  schema: {
    href: { kind: SchemaKind.url, label: "Link", defaultValue: "" },
  },
  render: ({ props }) => createElement("a", { href: props.href }, "Go"),
});
const linkDefinitions = [...definitions, link];

/** An email with one link on it, to `href`. */
const linkingTo = (href: string) =>
  documentOf(block("email", {}, [block("link", { id: "go", href })]));

describe("a link that could run script", () => {
  const editorLinkingTo = (href: string): Editor =>
    createEditor({ definitions: linkDefinitions, document: linkingTo(href) });

  /** Whether the Diagnostic is raised, and whether the link reaches the email. */
  const reportedAndDropped = (href: string) => {
    const html = markupOf(linkingTo(href), {
      definitions: linkDefinitions,
      validate: false,
    });
    return {
      reported: editorLinkingTo(href)
        .getDiagnostics()
        .some((finding) => finding.code === DiagnosticCode.urlUnsafe),
      // `""` is no link, however React writes it.
      dropped: parseMarkup(html).all('a[href]:not([href=""])').length === 0,
    };
  };

  it("is reported as an error on its Block, and dropped from the email", () => {
    expect(reportedAndDropped("javascript:alert(1)")).toEqual({
      reported: true,
      dropped: true,
    });
    expect(editorLinkingTo("javascript:alert(1)").getDiagnostics()).toEqual([
      expect.objectContaining({
        code: DiagnosticCode.urlUnsafe,
        severity: "error",
        blockId: "go",
        prop: "href",
      }),
    ]);
  });

  it("carries a Repair that unsets it", () => {
    const editor = editorLinkingTo("javascript:alert(1)");

    expect(editor.getDiagnostics()[0]?.repair).toEqual({
      kind: "set-prop",
      blockId: "go",
      prop: "href",
      value: undefined,
      stage: "desktop",
    });
    expect(repairFirst(editor)).toBe(true);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("shows on a Suggestion that writes it, before it is accepted", () => {
    const editor = editorLinkingTo("https://example.com");
    const suggestion = suggested(editor, [
      { kind: "set-prop", blockId: "go", prop: "href", value: "vbscript:x" },
    ]);

    expect(suggestion.diagnostics).toEqual([
      expect.objectContaining({
        code: DiagnosticCode.urlUnsafe,
        blockId: "go",
      }),
    ]);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("is still dropped by the render path, when validation is off", () => {
    const html = markupOf(linkingTo("javascript:alert(1)"), {
      definitions: linkDefinitions,
      validate: false,
    });

    expect(html).not.toContain("javascript:");
    expect(html).toContain("Go");
  });

  it("stops a validated render", () => {
    expect(() =>
      markupOf(linkingTo("javascript:alert(1)"), {
        definitions: linkDefinitions,
      }),
    ).toThrow(DocumentValidationError);
  });

  // The Diagnostic and the emit path ask one question, so they never disagree:
  // a link that is dropped is reported, and one that is kept is not. A row
  // that is only an attack as markup, like an encoded tab, is plain text in a
  // stored prop, and both keep it.
  it.each(SCRIPTABLE_LINKS)(
    "is judged the same way by both with %s",
    (_, href) => {
      const { reported, dropped } = reportedAndDropped(href);
      expect(reported).toBe(dropped);
    },
  );

  it.each(SAFE_LINKS)(
    "is not raised for %s, which reaches the email",
    (href) => {
      expect(reportedAndDropped(href)).toEqual({
        reported: false,
        dropped: false,
      });
    },
  );

  it.each([
    ["an empty link", ""],
    ["an unset link", undefined],
  ])("is not raised for %s", (_, href) => {
    const editor = createEditor({
      definitions: linkDefinitions,
      document: documentOf(
        block("email", {}, [block("link", href === undefined ? {} : { href })]),
      ),
    });

    expect(editor.getDiagnostics()).toEqual([]);
  });
});

describe("A Repair", () => {
  it("is described on the render path too, where nothing can carry it out", () => {
    const editor = editorMissingRequired();
    let described: unknown;
    try {
      renderDocument(editor.getDocument(), editor.getRenderOptions());
    } catch (error) {
      if (error instanceof DocumentValidationError) {
        described = error.diagnostics.map((finding) => finding.repair);
      }
    }

    // The same description the editor produced. Nothing about it needed an
    // editor to write down — only to act on.
    expect(described).toEqual([
      { kind: "restore-required-block", type: "unsubscribe" },
    ]);
  });

  it("is refused when the library never described its kind", () => {
    const editor = editorMissingRequired();

    expect(editor.applyRepair({ kind: "swap-the-hero-image" })).toBe(false);
    expect(editor.getDiagnostics()).toMatchObject([
      { code: DiagnosticCode.requiredBlockMissing },
    ]);
  });

  it("is refused when a known kind arrives without its detail", () => {
    const editor = editorMissingRequired();

    // Data can come from anywhere — an untyped call site, a stored Diagnostic,
    // a Consumer who reused the kind. Matching the kind establishes nothing.
    expect(editor.applyRepair({ kind: "restore-required-block" })).toBe(false);
    expect(
      editor.applyRepair({ kind: "restore-required-block", type: 7 }),
    ).toBe(false);
    expect(editor.applyRepair({ kind: "set-prop", blockId: "root" })).toBe(
      false,
    );
  });

  it("is refused when the Document has moved on since it was described", () => {
    const editor = editorMissingRequired();
    const repair = editor.getDiagnostics()[0]?.repair;

    // Put it right by hand, then apply the Repair that was held all along.
    editor.insertBlock("unsubscribe", editor.getDocument().root.id);
    expect(repair && editor.applyRepair(repair)).toBe(false);
    expect(
      editor.getDocument().root.children?.map((child) => child.type),
    ).toEqual(["unsubscribe"]);
  });

  it("can be an Edit, carried out as one undo step", () => {
    const editor = editorFor(
      documentOf(
        block("email", {}, [block("text", { id: "t", fontSize: 14 })]),
      ),
    );
    const edit: Edit = {
      kind: "set-prop",
      blockId: "t",
      prop: "fontSize",
      value: 18,
    };

    expect(editor.applyRepair(edit)).toBe(true);
    expect(editor.getDocument().root.children?.[0]?.props).toEqual({
      fontSize: 18,
    });

    editor.undo();
    expect(editor.getDocument().root.children?.[0]?.props).toEqual({
      fontSize: 14,
    });
  });

  it("can be an insert, remove or move Edit", () => {
    const editor = editorFor(
      documentOf(
        block("email", {}, [
          block("text", { id: "a" }),
          block("text", { id: "b" }),
        ]),
      ),
    );
    const ids = () =>
      editor.getDocument().root.children?.map((child) => child.id);

    expect(
      editor.applyRepair({
        kind: "insert",
        type: "text",
        after: "a",
        id: "n",
      } satisfies Edit),
    ).toBe(true);
    expect(
      editor.applyRepair({
        kind: "move",
        blockId: "a",
        after: "b",
      } satisfies Edit),
    ).toBe(true);
    expect(
      editor.applyRepair({ kind: "remove", blockId: "n" } satisfies Edit),
    ).toBe(true);
    expect(ids()).toEqual(["b", "a"]);

    expect(editor.applyRepair({ kind: "remove", blockId: "n" })).toBe(false);
  });

  it("writes a set-prop Edit on the Stage it names", () => {
    const editor = editorFor(
      documentOf(
        block("email", {}, [block("text", { id: "t", fontSize: 14 })]),
      ),
    );

    // The editor is on desktop, and the Edit asks for mobile.
    expect(
      editor.applyRepair({
        kind: "set-prop",
        blockId: "t",
        prop: "fontSize",
        value: 12,
        stage: "mobile",
      } satisfies Edit),
    ).toBe(true);
    const text = editor.getDocument().root.children?.[0];
    expect(text?.props).toEqual({ fontSize: 14 });
    expect(text?.mobile).toEqual({ fontSize: 12 });
  });

  it("is refused when a set-prop names a Stage that does not exist", () => {
    const editor = editorFor(
      documentOf(
        block("email", {}, [block("text", { id: "t", fontSize: 14 })]),
      ),
    );

    expect(
      editor.applyRepair({
        kind: "set-prop",
        blockId: "t",
        prop: "fontSize",
        value: 12,
        stage: "tablet",
      }),
    ).toBe(false);
    expect(editor.getDocument().root.children?.[0]?.props).toEqual({
      fontSize: 14,
    });
  });
});

const camelCase = (code: string): string =>
  code.replaceAll(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());

describe("the Diagnostic codes", () => {
  it.each([
    ["lekh", DiagnosticCode],
    ["the built-in Preset", PresetDiagnostic],
    ["the compliance Preset", ComplianceDiagnostic],
    ["the shipped Validators", ValidatorDiagnostic],
  ])("are kebab-case on %s, each keyed by itself in camelCase", (_, codes) => {
    for (const [key, code] of Object.entries(codes)) {
      expect(code).toMatch(/^[a-z]+(-[a-z]+)*$/u);
      expect(key).toBe(camelCase(code));
    }
  });
});
