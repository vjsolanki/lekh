import { describe, expect, it, vi } from "vitest";

import {
  ComplianceDiagnostic,
  createCompliancePreset,
  createReactEmailPreset,
  POSTAL_ADDRESS_TYPE,
  REACT_EMAIL_ROOT_TYPE,
  UNSUBSCRIBE_TYPE,
} from "../blocks";
import {
  type BlockDefinition,
  createDocument,
  defineBlock,
  DiagnosticCode,
  type Editor,
  type EmailDocument,
  renderDocument,
  toHtml,
} from "../index";
import { editorFor } from "../testing/editor";
import { markupOf } from "../testing/markup";

const UNSUBSCRIBE_URL = "https://esp.example/u/{{recipient_id}}";
const POSTAL_ADDRESS = "Lekh Ltd, 1 Example Street, London N1 1AA";

function presetWith(
  options: { unsubscribeUrl?: string; postalAddress?: string } = {},
): readonly BlockDefinition[] {
  return [
    ...createReactEmailPreset(),
    ...createCompliancePreset({
      unsubscribeUrl: options.unsubscribeUrl ?? UNSUBSCRIBE_URL,
      postalAddress: options.postalAddress ?? POSTAL_ADDRESS,
    }),
  ];
}

const definitions = presetWith();

/** A compliant Document, written the way a Consumer's database would hold one. */
function compliantDocument(): EmailDocument {
  return {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: {},
      children: [
        { id: "opt-out", type: UNSUBSCRIBE_TYPE, props: {} },
        { id: "address", type: POSTAL_ADDRESS_TYPE, props: {} },
      ],
    },
  };
}

/** How many background declarations the markup carries. */
function backgrounds(html: string): number {
  return html.split("background-color").length - 1;
}

function typesIn(document: EmailDocument): readonly string[] {
  return (document.root.children ?? []).map((child) => child.type);
}

/** Carry out every Repair on offer, the way a Consumer's panel would. */
function repairAll(editor: Editor): void {
  for (const { repair } of editor.getDiagnostics()) {
    if (repair) editor.applyRepair(repair);
  }
}

/** What an editor is complaining about, with the parts a Repair would differ in. */
function reported(
  editor: Editor,
): readonly { code: string; severity: string; message: string }[] {
  return editor
    .getDiagnostics()
    .map(({ code, severity, message }) => ({ code, severity, message }));
}

function idOfType(editor: Editor, type: string): string {
  return (
    editor.getDocument().root.children?.find((child) => child.type === type)
      ?.id ?? ""
  );
}

describe("the compliance Preset", () => {
  it("composes with the built-in Preset without any configuration", () => {
    // The two shipped Presets have to fit together out of the box: a Required
    // Block the root does not accept is a construction-time failure.
    expect(() =>
      editorFor(undefined, { definitions, rootType: REACT_EMAIL_ROOT_TYPE }),
    ).not.toThrow();
  });

  it("seeds a new Document with the Blocks the law requires", () => {
    expect(
      typesIn(createDocument({ definitions, rootType: REACT_EMAIL_ROOT_TYPE })),
    ).toEqual([UNSUBSCRIBE_TYPE, POSTAL_ADDRESS_TYPE]);
  });

  it("starts an Author off with nothing to fix", () => {
    expect(
      editorFor(undefined, {
        definitions,
        rootType: REACT_EMAIL_ROOT_TYPE,
      }).getDiagnostics(),
    ).toEqual([]);
  });

  it("refuses to delete the unsubscribe Block directly", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const id = idOfType(editor, UNSUBSCRIBE_TYPE);

    expect(editor.removeBlock(id)).toBe(false);
    expect(typesIn(editor.getDocument())).toContain(UNSUBSCRIBE_TYPE);
    // A refused Command leaves no undo entry.
    expect(editor.canUndo()).toBe(false);
  });

  it("refuses to delete the postal address Block directly", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });

    expect(editor.removeBlock(idOfType(editor, POSTAL_ADDRESS_TYPE))).toBe(
      false,
    );
  });

  it("lets an Author redesign a footer that happens to hold it", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const footer =
      editor.insertBlock("section", editor.getDocument().root.id) ?? "";
    editor.moveBlock(idOfType(editor, UNSUBSCRIBE_TYPE), footer, 0);
    expect(editor.getDiagnostics()).toEqual([]);

    // Deleting the container succeeds; the Document simply becomes invalid and
    // says so (ADR-0006).
    expect(editor.removeBlock(footer)).toBe(true);
    expect(editor.getDiagnostics()).toMatchObject([
      { code: DiagnosticCode.requiredBlockMissing, severity: "error" },
    ]);
  });

  it("reports the same Diagnostic however the Block went missing", () => {
    const viaAncestor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const footer =
      viaAncestor.insertBlock("section", viaAncestor.getDocument().root.id) ??
      "";
    viaAncestor.moveBlock(idOfType(viaAncestor, UNSUBSCRIBE_TYPE), footer, 0);
    viaAncestor.removeBlock(footer);

    // Deleting the Block directly is refused, so the third route to a missing
    // one is an Op from somewhere the editor does not police — another tab, or
    // a Consumer replaying history.
    const viaRemoteOp = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    viaRemoteOp.applyExternalOps([
      {
        kind: "remove",
        origin: "remote",
        parentId: viaRemoteOp.getDocument().root.id,
        index: 0,
        block: {
          id: idOfType(viaRemoteOp, UNSUBSCRIBE_TYPE),
          type: UNSUBSCRIBE_TYPE,
          props: {},
        },
      },
    ]);

    const viaStoredDocument = editorFor(
      {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: {},
          children: [{ id: "address", type: POSTAL_ADDRESS_TYPE, props: {} }],
        },
      },
      { definitions },
    );

    // The rule is that the Document must contain the Required Block. How it
    // came to be missing is irrelevant.
    expect(reported(viaAncestor)).toEqual(reported(viaStoredDocument));
    expect(reported(viaRemoteOp)).toEqual(reported(viaStoredDocument));
  });

  it("carries a Repair that appends the Block and selects it", () => {
    const editor = editorFor(
      {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: {},
          children: [{ id: "address", type: POSTAL_ADDRESS_TYPE, props: {} }],
        },
      },
      { definitions },
    );
    const revealed = vi.fn();
    editor.onReveal(revealed);

    repairAll(editor);

    expect(typesIn(editor.getDocument())).toEqual([
      POSTAL_ADDRESS_TYPE,
      UNSUBSCRIBE_TYPE,
    ]);
    const restored = idOfType(editor, UNSUBSCRIBE_TYPE);
    // A compliance repair must never happen off-screen.
    expect(editor.getSelection()).toBe(restored);
    expect(revealed).toHaveBeenCalledWith(restored);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("restores whichever compliance Block has gone missing", () => {
    const editor = editorFor(
      {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: {},
          children: [],
        },
      },
      { definitions },
    );

    repairAll(editor);

    expect(typesIn(editor.getDocument())).toEqual([
      UNSUBSCRIBE_TYPE,
      POSTAL_ADDRESS_TYPE,
    ]);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("reports an unsubscribe label an Author has emptied", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    editor.setProp(idOfType(editor, UNSUBSCRIBE_TYPE), "label", "   ");

    // An invisible link is not a working opt-out mechanism, so this is an
    // error rather than a heuristic's warning.
    expect(editor.getDiagnostics()).toMatchObject([
      {
        code: ComplianceDiagnostic.unsubscribeLabelEmpty,
        severity: "error",
        blockId: idOfType(editor, UNSUBSCRIBE_TYPE),
        prop: "label",
      },
    ]);
  });

  it("carries a Repair that puts the emptied label back to its default", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const unsubscribe = idOfType(editor, UNSUBSCRIBE_TYPE);
    editor.setProp(unsubscribe, "label", "   ");

    expect(editor.getDiagnostics()[0]?.repair).toEqual({
      kind: "set-prop",
      blockId: unsubscribe,
      prop: "label",
      value: undefined,
    });

    repairAll(editor);

    // Unset, so it resolves to the Schema default rather than to a word this
    // Repair picked — a localised Definition gets its own back.
    expect(editor.getBlock(unsubscribe)?.props["label"]).toBeUndefined();
    expect(markupOf(editor.getDocument(), { definitions })).toContain(
      "Unsubscribe",
    );
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("puts that repair on the undo stack, so an Author can take it back", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const unsubscribe = idOfType(editor, UNSUBSCRIBE_TYPE);
    editor.setProp(unsubscribe, "label", "   ");
    repairAll(editor);
    editor.undo();

    expect(editor.getBlock(unsubscribe)?.props["label"]).toBe("   ");
  });

  it("reports a postal address nobody filled in, without blocking the send", () => {
    const unconfigured = presetWith({ postalAddress: "" });
    const editor = editorFor(undefined, { definitions: unconfigured });

    // A warning, because the usual way to reach it is a Consumer who has not
    // configured an address yet, and refusing to render anything at all until
    // they do would teach them to turn validation off.
    expect(editor.getDiagnostics()).toMatchObject([
      { code: ComplianceDiagnostic.postalAddressEmpty, severity: "warning" },
    ]);
    expect(() =>
      markupOf(editor.getDocument(), { definitions: unconfigured }),
    ).not.toThrow();
  });

  it("lets a Consumer escalate the missing address to a refusal", () => {
    const unconfigured = presetWith({ postalAddress: "" });
    const document = createDocument({
      definitions: unconfigured,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });

    expect(() =>
      toHtml(
        renderDocument(document, {
          definitions: unconfigured,
          severities: { [ComplianceDiagnostic.postalAddressEmpty]: "error" },
        }),
        { doctype: false },
      ),
    ).toThrow(/postal address/iu);
  });

  it("lets an Author write the link in their own language", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const id = idOfType(editor, UNSUBSCRIBE_TYPE);
    editor.setProp(id, "label", "Se désabonner");

    expect(markupOf(editor.getDocument(), { definitions })).toContain(
      "Se désabonner",
    );
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("never offers the unsubscribe URL to an Author", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    editor.select(idOfType(editor, UNSUBSCRIBE_TYPE));

    const controls = editor.getControls();
    expect(controls.map((control) => control.name)).not.toContain("href");
    expect(JSON.stringify(controls)).not.toContain(UNSUBSCRIBE_URL);
  });

  it("still lets an Author style and place the link", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    editor.select(idOfType(editor, UNSUBSCRIBE_TYPE));

    expect(editor.getControls().map((control) => control.name)).toEqual([
      "label",
      "fontSize",
      "color",
      "backgroundColor",
      "align",
    ]);
  });

  it("gives each footer Block a surface of its own, painted only when set", () => {
    // Every Block in the library takes a background, and a tinted strip under
    // the content is one of the places an Author reaches for one. It starts at
    // `none`, so an untouched footer emits no declaration and shows the section
    // behind it.
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    const id = idOfType(editor, UNSUBSCRIBE_TYPE);

    // Counted rather than searched for, because the root paints one of its own
    // and the question here is whether the footer adds to it.
    const before = backgrounds(markupOf(editor.getDocument(), { definitions }));

    editor.setProp(id, "backgroundColor", "#f0f0f0");
    const after = markupOf(editor.getDocument(), { definitions });

    expect(after).toContain("background-color:#f0f0f0");
    expect(backgrounds(after)).toBe(before + 1);
  });
});

describe("the compliance Preset on the render path", () => {
  it("refuses a Document with no unsubscribe Block", () => {
    const withoutOptOut: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [{ id: "address", type: POSTAL_ADDRESS_TYPE, props: {} }],
      },
    };

    // A send job that fails loudly beats fifty thousand recipients receiving
    // an email with no way out of the list.
    expect(() => markupOf(withoutOptOut, { definitions })).toThrow(
      /unsubscribe/iu,
    );
  });

  it("puts the configured URL in the markup", () => {
    expect(markupOf(compliantDocument(), { definitions })).toContain(
      UNSUBSCRIBE_URL,
    );
  });

  it("puts the configured address in the markup", () => {
    expect(markupOf(compliantDocument(), { definitions })).toContain(
      POSTAL_ADDRESS,
    );
  });

  it("keeps the URL out of the Document itself", () => {
    const editor = editorFor(undefined, {
      definitions,
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    editor.setProp(idOfType(editor, UNSUBSCRIBE_TYPE), "label", "Opt out");

    expect(JSON.stringify(editor.getDocument())).not.toContain(UNSUBSCRIBE_URL);
  });

  it("writes both footer Blocks at a line height of 150%, not 24px", () => {
    const html = markupOf(compliantDocument(), { definitions });

    expect(html.split("line-height:150%").length - 1).toBe(2);
    expect(html).not.toContain("line-height:24px");
  });

  it("writes the footer in the email's own font", () => {
    const stored = compliantDocument();
    const html = markupOf(
      {
        root: { ...stored.root, props: { fontFamily: "Georgia, serif" } },
      },
      { definitions },
    );

    // The body, then the two footer Blocks.
    expect(html.split("font-family:Georgia, serif").length - 1).toBe(3);
  });

  it("falls back to its own font under a root that names none", () => {
    // A Consumer's own root, with no font on it: the footer's own option is
    // what is left.
    const bareRoot = defineBlock<Record<string, unknown>>({
      type: "bare",
      label: "Bare",
      accepts: [UNSUBSCRIBE_TYPE, POSTAL_ADDRESS_TYPE],
      schema: {},
      render: ({ children }) => <div>{children}</div>,
    });
    const set = [
      bareRoot,
      ...createCompliancePreset({
        unsubscribeUrl: UNSUBSCRIBE_URL,
        fontFamily: "Courier, monospace",
      }),
    ];
    const html = markupOf(
      { root: { ...compliantDocument().root, type: "bare" } },
      { definitions: set },
    );

    expect(html.split("font-family:Courier, monospace").length - 1).toBe(2);
  });

  it("follows a change of email service provider with no migration", () => {
    // The same stored Document, rendered by an editor configured for a
    // different provider.
    const stored = compliantDocument();
    const moved = presetWith({
      unsubscribeUrl: "%%unsubscribe_link%%",
    });

    expect(markupOf(stored, { definitions: moved })).toContain(
      "%%unsubscribe_link%%",
    );
    expect(markupOf(stored, { definitions: moved })).not.toContain(
      UNSUBSCRIBE_URL,
    );
  });
});

/** Both footer Blocks, under a root running one way. */
const footer = (
  props: Record<string, unknown>,
  direction?: string,
  mobile?: Record<string, unknown>,
): EmailDocument => ({
  root: {
    id: "root",
    type: REACT_EMAIL_ROOT_TYPE,
    props: direction === undefined ? {} : { direction },
    children: [
      {
        id: "opt-out",
        type: UNSUBSCRIBE_TYPE,
        props,
        ...(mobile && { mobile }),
      },
      { id: "address", type: POSTAL_ADDRESS_TYPE, props },
    ],
  },
});

/** The side each footer paragraph is written on. */
const aligns = (html: string): string[] =>
  [...html.matchAll(/<p\b[^>]*text-align:(\w+)/gu)].map(
    (match) => match[1] ?? "",
  );

// ADR-0027: the footer aligns by reading order too.
describe("the footer's alignment", () => {
  it("stores start, center or end, centred by default", () => {
    for (const definition of createCompliancePreset({
      unsubscribeUrl: UNSUBSCRIBE_URL,
      postalAddress: POSTAL_ADDRESS,
    })) {
      expect(definition.schema["align"]).toMatchObject({
        kind: "align",
        defaultValue: "center",
        constraints: { options: ["start", "center", "end"] },
      });
    }
  });

  it.each([
    ["start", "ltr", "left"],
    ["start", "rtl", "right"],
    ["end", "ltr", "right"],
    ["end", "rtl", "left"],
    ["center", "rtl", "center"],
  ])("renders %s in %s as %s", (align, direction, side) => {
    expect(
      aligns(markupOf(footer({ align }, direction), { definitions })),
    ).toEqual([side, side]);
  });

  it("writes a mobile start as right in an rtl email", () => {
    expect(
      markupOf(footer({}, "rtl", { align: "start" }), { definitions }),
    ).toContain("text-align:right!important");
  });

  it("writes a junk mobile alignment centred, like its inline default", () => {
    expect(
      markupOf(footer({}, "rtl", { align: "justify" }), { definitions }),
    ).toContain("text-align:center!important");
  });

  it("migrates a stored left and right to start and end", () => {
    const editor = editorFor(
      footer({ align: "left" }, undefined, { align: "right" }),
      { definitions },
    );
    const block = editor.getBlock("opt-out");

    expect(block?.props["align"]).toBe("start");
    expect(block?.mobile?.["align"]).toBe("end");
    expect(block?.version).toBe(1);
    expect(
      aligns(markupOf(footer({ align: "left" }), { definitions })),
    ).toEqual(["left", "left"]);
  });
});
