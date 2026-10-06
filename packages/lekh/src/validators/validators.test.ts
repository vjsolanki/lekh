import { describe, expect, it } from "vitest";

import {
  type Block,
  type BlockDefinition,
  createEditor,
  defineBlock,
  type Diagnostic,
  DiagnosticCode,
  type EmailDocument,
  minimumContrast,
  minimumFontSize,
  renderDocument,
  SchemaKind,
  type Validator,
  ValidatorDiagnostic,
  workingLinks,
} from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { SAFE_LINKS, SCRIPTABLE_LINKS } from "../testing/attacks";

const preset = createReactEmailPreset();

/** Run a Validator the way an editor does, and report what it found. */
function findings(
  document: EmailDocument,
  validators: readonly Validator[],
  definitions: readonly BlockDefinition[] = preset,
): readonly Diagnostic[] {
  return createEditor({
    definitions,
    rootType: document.root.type,
    document,
    validators,
  }).getDiagnostics();
}

/** A Document of one Block inside a white Section. */
function emailWith(...children: readonly Block[]): EmailDocument {
  return {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: {},
      children: [
        { id: "body", type: "section", props: {}, children: [...children] },
      ],
    },
  };
}

describe("the minimum font size Validator", () => {
  it("catches text too small to read", () => {
    const found = findings(
      emailWith({ id: "small", type: "text", props: { fontSize: 9 } }),
      [minimumFontSize()],
    );

    expect(found).toMatchObject([
      {
        code: ValidatorDiagnostic.fontSizeTooSmall,
        severity: "warning",
        blockId: "small",
        prop: "fontSize",
      },
    ]);
    expect(found[0]).not.toHaveProperty("stage");
    expect(found[0]?.message).toContain("9px");
  });

  it("says nothing about text at the minimum", () => {
    expect(
      findings(
        emailWith({ id: "fine", type: "text", props: { fontSize: 12 } }),
        [minimumFontSize()],
      ),
    ).toEqual([]);
  });

  it("judges an unset prop by the Schema default", () => {
    // The Preset's text Block defaults to 16px, which nobody stored.
    expect(
      findings(emailWith({ id: "plain", type: "text", props: {} }), [
        minimumFontSize({ minimum: 20 }),
      ]),
    ).toMatchObject([
      { code: ValidatorDiagnostic.fontSizeTooSmall, blockId: "plain" },
    ]);
  });

  it("takes the minimum a Consumer's brand asks for", () => {
    expect(
      findings(
        emailWith({ id: "body", type: "text", props: { fontSize: 13 } }),
        [minimumFontSize({ minimum: 14 })],
      ),
    ).toHaveLength(1);
  });

  it("catches a Mobile Override that is too small", () => {
    const shrunk = emailWith({
      id: "title",
      type: "heading",
      props: { fontSize: 28 },
      mobile: { fontSize: 8 },
    });

    // Desktop is fine, so the finding is the mobile value's alone.
    expect(findings(shrunk, [minimumFontSize()])).toMatchObject([
      {
        code: ValidatorDiagnostic.fontSizeTooSmall,
        blockId: "title",
        prop: "fontSize",
        stage: "mobile",
      },
    ]);
    expect(findings(shrunk, [minimumFontSize()])[0]?.message).toContain(
      "mobile",
    );
  });

  it("reports a desktop value and a mobile Override separately", () => {
    const tiny = emailWith({
      id: "title",
      type: "heading",
      props: { fontSize: 9 },
      mobile: { fontSize: 8 },
    });

    expect(
      findings(tiny, [minimumFontSize()]).map(({ prop, stage }) => ({
        prop,
        stage,
      })),
    ).toEqual([
      { prop: "fontSize", stage: undefined },
      { prop: "fontSize", stage: "mobile" },
    ]);
  });

  it("does not report the same value twice for a Block with no Override", () => {
    expect(
      findings(
        emailWith({ id: "title", type: "heading", props: { fontSize: 9 } }),
        [minimumFontSize()],
      ),
    ).toHaveLength(1);
  });

  it("leaves a Block no Definition claims alone", () => {
    // Nothing may judge data the editor does not understand — an unregistered
    // Block reports as itself and nothing more.
    const alien = emailWith({
      id: "grid",
      type: "product-grid",
      props: { fontSize: 4 },
    });

    expect(
      findings(alien, [minimumFontSize()]).map((finding) => finding.code),
    ).toEqual([DiagnosticCode.blockUnregistered]);
  });
});

describe("the minimum contrast Validator", () => {
  it("catches a link hidden against its background", () => {
    const found = findings(
      emailWith({
        id: "faint",
        type: "text",
        props: { color: "#f2f2f2", content: "Terms apply" },
      }),
      [minimumContrast()],
    );

    expect(found).toMatchObject([
      {
        code: ValidatorDiagnostic.contrastTooLow,
        severity: "warning",
        blockId: "faint",
      },
    ]);
  });

  it("judges the color a Block follows from the email", () => {
    const document = emailWith({
      id: "faint",
      type: "text",
      props: { content: "Terms apply" },
    });
    const pale: EmailDocument = {
      root: { ...document.root, props: { textColor: "#f2f2f2" } },
    };

    expect(findings(pale, [minimumContrast()])).toMatchObject([
      { code: ValidatorDiagnostic.contrastTooLow, blockId: "faint" },
    ]);
  });

  it("says which Block and how bad it looks, and no more", () => {
    const [found] = findings(
      emailWith({
        id: "faint",
        type: "text",
        props: { color: "#f2f2f2", content: "Terms apply" },
      }),
      [minimumContrast()],
    );

    // No ratio: a panel of twenty of these is scanned, not studied, and
    // `1.0:1` is the part of the finding an Author cannot act on.
    expect(found?.message).toBe("Text is almost invisible.");
    expect(found).toMatchObject({ blockId: "faint", prop: "color" });
  });

  it("names the Block without saying text twice", () => {
    const [found] = findings(
      emailWith({
        id: "cta",
        type: "button",
        props: {
          backgroundColor: "#ffffff",
          color: "#f4f4f4",
          label: "Shop now",
          href: "https://example.com",
        },
      }),
      [minimumContrast()],
    );

    // "Button" alone would read as the fill being invisible rather than the
    // label; "Text text" would read as a typo.
    expect(found?.message).toBe("Button text is almost invisible.");
  });

  it("saves its worst words for the text nobody can see", () => {
    const wording = (color: string): string | undefined =>
      findings(
        emailWith({
          id: "copy",
          type: "text",
          props: { color, content: "Hi" },
        }),
        [minimumContrast()],
      )[0]?.message;

    expect(wording("#f2f2f2")).toContain("almost invisible");
    expect(wording("#aaaaaa")).toContain("very hard to read");
    expect(wording("#808080")).toContain("hard to read");
    expect(wording("#808080")).not.toContain("very hard");
  });

  it("carries a Repair that clears the minimum", () => {
    const editor = createEditor({
      definitions: preset,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: emailWith({
        id: "faint",
        type: "text",
        props: { color: "#f2f2f2", content: "Terms apply" },
      }),
      validators: [minimumContrast()],
    });

    const [found] = editor.getDiagnostics();
    expect(found?.repair).toMatchObject({
      kind: "set-prop",
      blockId: "faint",
      prop: "color",
      stage: "desktop",
    });

    // From the mobile Stage too, since the desktop value is the one at fault.
    editor.setStage("mobile");
    expect(editor.applyRepair(found?.repair ?? { kind: "none" })).toBe(true);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("repairs the text and never the background an Author chose", () => {
    const onBrand: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [
          {
            id: "body",
            type: "section",
            props: { backgroundColor: "#1d4ed8" },
            children: [
              {
                id: "copy",
                type: "text",
                props: { color: "#5b7fe0", content: "On brand, off contrast" },
              },
            ],
          },
        ],
      },
    };

    expect(findings(onBrand, [minimumContrast()])[0]?.repair).toMatchObject({
      blockId: "copy",
      prop: "color",
    });
  });

  it("offers no Repair when no color would reach the minimum", () => {
    // Against a mid-grey, neither black nor white clears AAA. A Repair that
    // landed short would be a fix an Author clicked and did not get.
    const [found] = findings(
      unresolvable,
      [minimumContrast({ ratio: 7 })],
      backgroundlessDefinitions("#808080"),
    );

    expect(found).toMatchObject({ code: ValidatorDiagnostic.contrastTooLow });
    expect(found?.repair).toBeUndefined();
  });

  it("says nothing about text a recipient can read", () => {
    expect(
      findings(
        emailWith({
          id: "body",
          type: "text",
          props: { color: "#333333", content: "Legible" },
        }),
        [minimumContrast()],
      ),
    ).toEqual([]);
  });

  it("resolves the background from the nearest ancestor that declares one", () => {
    const onDark: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [
          {
            id: "body",
            type: "section",
            props: { backgroundColor: "#111111" },
            children: [
              {
                id: "copy",
                type: "text",
                props: { color: "#222222", content: "Nearly invisible" },
              },
            ],
          },
        ],
      },
    };

    expect(findings(onDark, [minimumContrast()])).toMatchObject([
      { code: ValidatorDiagnostic.contrastTooLow, blockId: "copy" },
    ]);
  });

  it("judges a Block against a background of its own before its ancestors'", () => {
    // White on white, inside a black Section: reading the Section's colour
    // instead would call this the most legible text in the email.
    const invisible: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {},
        children: [
          {
            id: "body",
            type: "section",
            props: { backgroundColor: "#000000" },
            children: [
              {
                id: "cta",
                type: "button",
                props: {
                  backgroundColor: "#ffffff",
                  color: "#ffffff",
                  href: "https://example.com",
                },
              },
            ],
          },
        ],
      },
    };

    expect(findings(invisible, [minimumContrast()])).toMatchObject([
      { code: ValidatorDiagnostic.contrastTooLow, blockId: "cta" },
    ]);
  });

  it("takes the ratio and the severity a Consumer asks for", () => {
    const found = findings(
      emailWith({
        id: "grey",
        type: "text",
        props: { color: "#767676", content: "Just about AA" },
      }),
      [minimumContrast({ ratio: 7, severity: "error" })],
    );

    expect(found).toMatchObject([
      { code: ValidatorDiagnostic.contrastTooLow, severity: "error" },
    ]);
  });

  it("ignores a Block that renders no text", () => {
    // The Preset's divider is #e6e6e6 on white, which is exactly the point: a
    // hairline rule is not text and is not meant to be read.
    expect(
      findings(emailWith({ id: "rule", type: "divider", props: {} }), [
        minimumContrast(),
      ]),
    ).toEqual([]);
  });

  it("ignores a Block whose text is empty", () => {
    expect(
      findings(
        emailWith({
          id: "blank",
          type: "text",
          props: { color: "#f2f2f2", content: "" },
        }),
        [minimumContrast()],
      ),
    ).toEqual([]);
  });
});

/** Pale grey copy in a Section with the given props, on a white email. */
function paleIn(
  section: Readonly<Record<string, unknown>>,
  rootProps: Readonly<Record<string, unknown>> = {},
): EmailDocument {
  return {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: rootProps,
      children: [
        {
          id: "body",
          type: "section",
          props: section,
          children: [
            {
              id: "copy",
              type: "text",
              props: { color: "#cccccc", content: "Pale" },
            },
          ],
        },
      ],
    },
  };
}

describe("what the contrast Validator reads text against", () => {
  it("reads a Section's column before its band", () => {
    // Pale on a dark column is fine, though the band round it is white.
    expect(
      findings(
        paleIn({
          backgroundColor: "#ffffff",
          contentBackgroundColor: "#111111",
        }),
        [minimumContrast()],
      ),
    ).toEqual([]);
    // And pale on a white column is not, though the band is dark.
    expect(
      findings(
        paleIn({
          backgroundColor: "#111111",
          contentBackgroundColor: "#ffffff",
        }),
        [minimumContrast()],
      ),
    ).toMatchObject([
      { code: ValidatorDiagnostic.contrastTooLow, blockId: "copy" },
    ]);
  });

  it("reads the column the email gives every Section", () => {
    expect(
      findings(paleIn({}, { contentBackgroundColor: "#ffffff" }), [
        minimumContrast(),
      ]),
    ).toMatchObject([{ blockId: "copy" }]);
  });

  it("says nothing when a background image lies between", () => {
    expect(
      findings(
        paleIn({
          contentBackgroundColor: "#ffffff",
          contentBackgroundImage: {
            src: "https://cdn.test/photo.jpg",
            width: 600,
            height: 400,
          },
        }),
        [minimumContrast()],
      ),
    ).toEqual([]);
  });

  it("says nothing when the email's wallpaper lies between", () => {
    const onWallpaper: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {
          backgroundImage: {
            src: "https://cdn.test/paper.png",
            width: 32,
            height: 32,
          },
        },
        children: [
          {
            id: "copy",
            type: "text",
            props: { color: "#cccccc", content: "Pale" },
          },
        ],
      },
    };

    expect(findings(onWallpaper, [minimumContrast()])).toEqual([]);
  });

  it("reads text on the email against the page, not the email's column", () => {
    // The email draws no column of its own: a Block placed on it sits on the
    // page, and the column colour is only what each Section follows.
    const onPage: EmailDocument = {
      root: {
        id: "root",
        type: REACT_EMAIL_ROOT_TYPE,
        props: {
          backgroundColor: "#111111",
          contentBackgroundColor: "#ffffff",
        },
        children: [
          {
            id: "copy",
            type: "text",
            props: { color: "#cccccc", content: "Pale" },
          },
        ],
      },
    };

    expect(findings(onPage, [minimumContrast()])).toEqual([]);
  });

  it("reads a button's label against its fill, not what is round it", () => {
    expect(
      findings(
        emailWith({
          id: "cta",
          type: "button",
          props: {
            backgroundColor: "#111111",
            color: "#cccccc",
            label: "Go",
            href: "https://example.com",
          },
        }),
        [minimumContrast()],
      ),
    ).toEqual([]);
  });

  it("judges the stored colour while a new one is only previewed", () => {
    const editor = createEditor({
      definitions: preset,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: emailWith({
        id: "copy",
        type: "text",
        props: { color: "#333333", content: "Legible" },
      }),
      validators: [minimumContrast()],
    });
    editor.select("copy");

    const color = editor
      .getControls()
      .find((control) => control.name === "color");
    color?.preview("#f2f2f2");
    // A Pending Change is not the Document (ADR-0032).
    expect(editor.getDiagnostics()).toEqual([]);

    color?.commit();
    expect(editor.getDiagnostics()).toMatchObject([
      { code: ValidatorDiagnostic.contrastTooLow, blockId: "copy" },
    ]);
  });
});

/**
 * A definition set that gives the contrast Validator nothing to work with:
 * text in a container that never says what is behind it.
 */
function backgroundlessDefinitions(
  rootBackground?: string,
): readonly BlockDefinition[] {
  // Two shapes of unresolvable: a root that declares no Surface at all, and
  // one whose value is something no parser should guess at.
  const page: BlockDefinition =
    rootBackground === undefined
      ? defineBlock<{ width: number }>({
          type: "page",
          label: "Page",
          accepts: ["note"],
          schema: {
            width: { kind: "number", label: "Width", defaultValue: 600 },
          },
          render: () => null,
        })
      : defineBlock<{ backgroundColor: string }>({
          type: "page",
          label: "Page",
          accepts: ["note"],
          schema: {
            backgroundColor: {
              kind: SchemaKind.surface,
              label: "Background color",
              defaultValue: rootBackground,
            },
          },
          render: () => null,
        });

  const note = defineBlock<{ content: string; color: string }>({
    type: "note",
    label: "Note",
    schema: {
      content: { kind: "text", label: "Content", defaultValue: "Read me" },
      color: { kind: "color", label: "Color", defaultValue: "#dddddd" },
    },
    render: () => null,
  });

  return [page, note];
}

const unresolvable: EmailDocument = {
  root: {
    id: "page",
    type: "page",
    props: {},
    children: [{ id: "note", type: "note", props: {} }],
  },
};

describe("the contrast Validator's silence", () => {
  it("says nothing when no ancestor declares a background at all", () => {
    // #dddddd on an unknown background could be anything. Guessing white would
    // be a false positive, and a false positive in a Validator a Consumer has
    // escalated is a blocked send.
    expect(
      findings(unresolvable, [minimumContrast()], backgroundlessDefinitions()),
    ).toEqual([]);
  });

  it("says nothing when the background is not a color it can read", () => {
    expect(
      findings(
        unresolvable,
        [minimumContrast()],
        backgroundlessDefinitions("linear-gradient(#fff, #000)"),
      ),
    ).toEqual([]);
  });

  it("says nothing when the background is transparent to the top", () => {
    expect(
      findings(
        unresolvable,
        [minimumContrast()],
        backgroundlessDefinitions("transparent"),
      ),
    ).toEqual([]);
  });

  it("reads a Preset's `none` as the absence it means", () => {
    // The word a colour prop uses for no colour at all. A walk that stopped at
    // it would give up on the first container an Author never styled — which,
    // since every surface starts that way, is most of them.
    expect(
      findings(
        unresolvable,
        [minimumContrast()],
        backgroundlessDefinitions("none"),
      ),
    ).toEqual([]);
  });

  it("says nothing when the background is only partly opaque", () => {
    expect(
      findings(
        unresolvable,
        [minimumContrast()],
        backgroundlessDefinitions("rgba(255, 255, 255, 0.6)"),
      ),
    ).toEqual([]);
  });

  it("does read a background it can resolve, in every notation", () => {
    for (const background of ["#fff", "#ffffff", "rgb(255,255,255)"]) {
      expect(
        findings(
          unresolvable,
          [minimumContrast()],
          backgroundlessDefinitions(background),
        ),
      ).toMatchObject([
        { code: ValidatorDiagnostic.contrastTooLow, blockId: "note" },
      ]);
    }
  });
});

/** A Document of one button inside a white Section, linking to `href`. */
function buttonTo(href: string): EmailDocument {
  return emailWith({ id: "cta", type: "button", props: { href } });
}

/** What the link Validator says about a button linking to `href`. */
const linkFindings = (href: string): readonly Diagnostic[] =>
  findings(buttonTo(href), [workingLinks()]);

describe("the working links Validator", () => {
  it("warns about a link with nothing in it, with no Repair", () => {
    const found = linkFindings("https://");

    expect(found).toMatchObject([
      {
        code: ValidatorDiagnostic.urlEmpty,
        severity: "warning",
        blockId: "cta",
        prop: "href",
      },
    ]);
    expect(found[0]).not.toHaveProperty("repair");
    expect(found[0]?.message).toContain("Links to");
  });

  it.each(["#", "http://", "  https://  ", "https://#", "mailto:", "tel:"])(
    "counts %j as empty",
    (href) => {
      expect(linkFindings(href).map((finding) => finding.code)).toEqual([
        ValidatorDiagnostic.urlEmpty,
      ]);
    },
  );

  it("leaves a link nobody wrote to the Block that owns it", () => {
    // An image with no link is fine, and a button says so itself
    // (`button-href-missing`), so a blank link is never this Validator's.
    expect(linkFindings("").map((finding) => finding.code)).toEqual([
      "button-href-missing",
    ]);
  });

  it("flags a link with no scheme, with a Repair to https", () => {
    const editor = createEditor({
      definitions: preset,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: buttonTo("example.com"),
      validators: [workingLinks()],
    });

    expect(editor.getDiagnostics()).toMatchObject([
      {
        code: ValidatorDiagnostic.urlNoScheme,
        severity: "warning",
        blockId: "cta",
        prop: "href",
        repair: {
          kind: "set-prop",
          blockId: "cta",
          prop: "href",
          value: "https://example.com",
          stage: "desktop",
        },
      },
    ]);

    const [found] = editor.getDiagnostics();
    expect(editor.applyRepair(found?.repair ?? { kind: "none" })).toBe(true);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it.each([
    ["www.example.com/sale?a=1#top", "https://www.example.com/sale?a=1#top"],
    ["  shop.example.co.uk ", "https://shop.example.co.uk"],
    // Starts like a scheme, and is not one.
    ["httpbin.example.com", "https://httpbin.example.com"],
  ])("repairs %j to %j", (href, fixed) => {
    expect(linkFindings(href)).toMatchObject([
      {
        code: ValidatorDiagnostic.urlNoScheme,
        repair: { value: fixed },
      },
    ]);
  });

  it.each([
    ["htps://example.com", "https://example.com"],
    ["htp://example.com", "https://example.com"],
    ["httsp://example.com", "https://example.com"],
    ["hhttps://example.com/a", "https://example.com/a"],
    ["http:/example.com", "https://example.com"],
    ["https:example.com", "https://example.com"],
    ["https:///example.com", "https://example.com"],
    ["https:\\\\example.com", "https://example.com"],
    ["https//example.com", "https://example.com"],
    ["https;//example.com", "https://example.com"],
    ["https:://example.com", "https://example.com"],
    ["https: //example.com", "https://example.com"],
    ["https://https://example.com", "https://example.com"],
    ["HTTP:/Example.com/Path", "https://Example.com/Path"],
  ])("flags the scheme of %j, with a Repair to %j", (href, fixed) => {
    const found = linkFindings(href).filter(
      (finding) => finding.code === ValidatorDiagnostic.urlBadScheme,
    );

    expect(found).toMatchObject([
      {
        code: ValidatorDiagnostic.urlBadScheme,
        severity: "warning",
        blockId: "cta",
        prop: "href",
        repair: {
          kind: "set-prop",
          blockId: "cta",
          prop: "href",
          value: fixed,
          stage: "desktop",
        },
      },
    ]);
  });

  it("fixes a host with a port, which the render path reads as a scheme", () => {
    // `example.com:` is no scheme an email may carry, so `url-unsafe` reports
    // it too, and the fix here clears both.
    const editor = createEditor({
      definitions: preset,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: buttonTo("example.com:8080/sale"),
      validators: [workingLinks()],
    });
    const fix = editor
      .getDiagnostics()
      .find((finding) => finding.code === ValidatorDiagnostic.urlNoScheme);

    expect(fix?.repair).toMatchObject({
      value: "https://example.com:8080/sale",
    });
    expect(editor.applyRepair(fix?.repair ?? { kind: "none" })).toBe(true);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("fixes a misspelled scheme the render path would drop", () => {
    // `htps:` is no scheme an email may carry, so `url-unsafe` reports it too.
    // Its fix is the useful one, and it clears both.
    const editor = createEditor({
      definitions: preset,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: buttonTo("htps://example.com"),
      validators: [workingLinks()],
    });
    const fix = editor
      .getDiagnostics()
      .find((finding) => finding.code === ValidatorDiagnostic.urlBadScheme);

    expect(editor.applyRepair(fix?.repair ?? { kind: "none" })).toBe(true);
    expect(editor.getDiagnostics()).toEqual([]);
  });

  it.each([
    "https://example.com",
    "mailto:someone@example.com?subject=Hi",
    "tel:+441234567890",
    "{{unsubscribe_url}}",
    "{{ view_in_browser }}",
    "*|ARCHIVE|*",
    "%%view_email_url%%",
    "https://{{domain}}/offer",
    "/relative",
    // A file beside the page, not a site.
    "terms.html",
    "page.php?id=1",
  ])("passes %j", (href) => {
    expect(linkFindings(href)).toEqual([]);
  });

  it.each(SAFE_LINKS)("passes the safe link %j", (href) => {
    expect(linkFindings(href)).toEqual([]);
  });

  // The attacks stay `url-unsafe`'s: this adds nothing to what it says.
  it.each(SCRIPTABLE_LINKS)("adds nothing to %s", (_, href) => {
    const codes = (validators: readonly Validator[]) =>
      findings(buttonTo(href), validators).map((finding) => finding.code);

    expect(codes([workingLinks()])).toEqual(codes([]));
  });

  it("never stops a render", () => {
    const editor = createEditor({
      definitions: preset,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: emailWith(
        { id: "a", type: "button", props: { href: "example.com" } },
        { id: "b", type: "button", props: { href: "http:/example.com" } },
        { id: "c", type: "button", props: { href: "https://" } },
      ),
      validators: [workingLinks()],
    });

    expect(editor.getDiagnostics().map((finding) => finding.severity)).toEqual([
      "warning",
      "warning",
      "warning",
    ]);
    expect(() =>
      renderDocument(editor.getDocument(), editor.getRenderOptions()),
    ).not.toThrow();
  });

  it("judges every url prop, and only those", () => {
    const document = emailWith(
      {
        id: "logo",
        type: "image",
        props: { href: "example.com", alt: "example.com" },
      },
      { id: "copy", type: "text", props: { content: "example.com" } },
    );

    const linkCodes: readonly string[] = [
      ValidatorDiagnostic.urlEmpty,
      ValidatorDiagnostic.urlNoScheme,
      ValidatorDiagnostic.urlBadScheme,
    ];

    expect(
      findings(document, [workingLinks()])
        .filter((finding) => linkCodes.includes(finding.code))
        .map(({ code, blockId, prop }) => ({ code, blockId, prop })),
    ).toEqual([
      { code: ValidatorDiagnostic.urlNoScheme, blockId: "logo", prop: "href" },
    ]);
  });
});

describe("a shipped Validator", () => {
  it("warns rather than blocks, so a heuristic cannot stop a legitimate send", () => {
    const found = findings(
      emailWith({
        id: "small",
        type: "text",
        props: { fontSize: 8, color: "#eeeeee" },
      }),
      [minimumFontSize(), minimumContrast()],
    );

    expect(found.map((finding) => finding.severity)).toEqual([
      "warning",
      "warning",
    ]);
  });

  it("can be escalated to an error by the Consumer who wants it strict", () => {
    const editor = createEditor({
      definitions: preset,
      rootType: REACT_EMAIL_ROOT_TYPE,
      document: emailWith({
        id: "small",
        type: "text",
        props: { fontSize: 8 },
      }),
      validators: [minimumFontSize()],
      severities: { [ValidatorDiagnostic.fontSizeTooSmall]: "error" },
    });

    expect(editor.getDiagnostics()).toMatchObject([
      { code: ValidatorDiagnostic.fontSizeTooSmall, severity: "error" },
    ]);
  });

  it("can be escalated where it is built, without a severity map", () => {
    expect(
      findings(
        emailWith({ id: "small", type: "text", props: { fontSize: 8 } }),
        [minimumFontSize({ severity: "error" })],
      ),
    ).toMatchObject([{ severity: "error" }]);
  });

  it("is opt-in: an editor given none reports none", () => {
    expect(
      findings(
        emailWith({
          id: "small",
          type: "text",
          props: { fontSize: 4, color: "#fdfdfd" },
        }),
        [],
      ),
    ).toEqual([]);
  });
});
