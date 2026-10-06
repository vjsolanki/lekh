import { describe, expect, it } from "vitest";

import {
  type Asset,
  assetOf,
  createEditor,
  defineBlock,
  DocumentValidationError,
  type EmailDocument,
  isBlank,
  renderDocument,
  SchemaKind,
  toHtml,
  UnknownBlockError,
  type Validator,
} from "../../index";
import {
  definitions,
  definitionsWithRequired,
  email,
} from "../../testing/blocks";
import { markupOf } from "../../testing/markup";

/** A rule the library knows nothing about, supplied by the Consumer. */
const noEmptyEmails: Validator = (document) =>
  (document.root.children ?? []).length === 0
    ? [
        {
          code: "empty-email",
          message: "This email has no content.",
          severity: "error",
        },
      ]
    : [];

const hello: EmailDocument = {
  root: {
    id: "root",
    type: "email",
    props: { contentWidth: 480 },
    children: [
      {
        id: "row",
        type: "section",
        props: { padding: 24 },
        children: [{ id: "copy", type: "text", props: { content: "Hello" } }],
      },
    ],
  },
};

describe("render", () => {
  it("renders a template to static markup", () => {
    expect(toHtml(<p>Hello</p>, { doctype: false })).toBe("<p>Hello</p>");
  });

  it("prepends the doctype by default", () => {
    expect(toHtml(<p>Hello</p>)).toContain("<!DOCTYPE html");
  });

  it("emits no hydration markers", () => {
    expect(toHtml(<div>{"a"}</div>, { doctype: false })).toBe("<div>a</div>");
  });

  it("writes no image preload, whichever React renders it", () => {
    const html = toHtml(
      <html>
        <head />
        <body>
          <img src="https://cdn.example.com/cat.jpg" alt="A cat" />
        </body>
      </html>,
      { doctype: false },
    );

    expect(html).not.toContain('rel="preload"');
    expect(html).toContain("<head></head>");
  });
});

describe("renderDocument", () => {
  it("turns a Document into a React element and stops there", () => {
    const element = renderDocument(hello, { definitions });

    expect(element.type).toBe("body");
    expect(typeof element).toBe("object");
  });

  it("renders each Block through its Definition, composing children", () => {
    expect(markupOf(hello)).toBe(
      '<body style="background-color:#ffffff">' +
        '<table width="480"><tbody>' +
        '<tr><td style="padding:24px">' +
        '<p style="font-size:14px">Hello</p>' +
        "</td></tr>" +
        "</tbody></table></body>",
    );
  });

  it("fills unset props in from the Schema, exactly as the editor does", () => {
    const bare: EmailDocument = {
      root: { id: "root", type: "email", props: {}, children: [] },
    };

    expect(markupOf(bare)).toContain('width="600"');
  });

  it("migrates a stored Document on the way through", () => {
    const stored: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "copy", type: "text", props: {}, version: 0 }],
      },
    };

    expect(markupOf(stored)).toContain("<p");
  });

  it("throws on a Block no Definition can render", () => {
    const alien: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "x", type: "product-grid", props: {} }],
      },
    };

    // A send job that fails loudly beats fifty thousand recipients receiving
    // an email with a hole in it.
    expect(() => renderDocument(alien, { definitions })).toThrow(
      UnknownBlockError,
    );
    expect(() =>
      renderDocument(alien, { definitions, validate: false }),
    ).toThrow(UnknownBlockError);
  });

  it("names the offending Block when it throws", () => {
    const alien: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "x", type: "product-grid", props: {} }],
      },
    };

    try {
      renderDocument(alien, { definitions });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownBlockError);
      expect(error).toMatchObject({ blockId: "x", blockType: "product-grid" });
    }
  });

  it("throws when a Required Block is missing", () => {
    expect(() =>
      renderDocument(hello, { definitions: definitionsWithRequired() }),
    ).toThrow(DocumentValidationError);
  });

  it("carries the Diagnostics on the error it throws", () => {
    try {
      renderDocument(hello, { definitions: definitionsWithRequired() });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError);
      if (!(error instanceof DocumentValidationError)) throw error;
      expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "required-block-missing",
      ]);
    }
  });

  it("renders anyway when validation is explicitly opted out of", () => {
    expect(
      markupOf(hello, {
        definitions: definitionsWithRequired(),
        validate: false,
      }),
    ).toContain("Hello");
  });

  it("does not let a warning block a send", () => {
    // An image with an Asset but no alternative text: a Diagnostic, and one
    // that must not stop fifty thousand people receiving the email.
    const withImage: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          {
            id: "photo",
            type: "image",
            props: {
              asset: {
                src: "https://cdn.example.com/c.jpg",
                width: 8,
                height: 6,
              },
            },
          },
        ],
      },
    };

    expect(markupOf(withImage)).toContain("<img");
  });

  it("renders an Asset with explicit dimensions and alternative text", () => {
    const withImage: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [
          {
            id: "photo",
            type: "image",
            props: {
              asset: {
                src: "https://cdn.example.com/cat.jpg",
                width: 800,
                height: 600,
                alt: "A cat",
              },
            },
          },
        ],
      },
    };

    // Both dimensions, because several mail clients render an image at its
    // intrinsic size when the markup does not say otherwise.
    expect(markupOf(withImage)).toContain(
      '<img src="https://cdn.example.com/cat.jpg" alt="A cat" width="800" height="600"/>',
    );
  });

  it("runs the Validators a Consumer supplies, the same ones the editor runs", () => {
    expect(() =>
      renderDocument(
        { root: { id: "root", type: "email", props: {}, children: [] } },
        { definitions, validators: [noEmptyEmails] },
      ),
    ).toThrow(DocumentValidationError);
  });

  it("takes an editor's own Validators, so the two cannot disagree", () => {
    const editor = createEditor({
      definitions: definitionsWithRequired(),
      rootType: "email",
      validators: [noEmptyEmails],
      document: hello,
    });

    // The editor sees the problem; handing its setup straight to the render
    // path means the render path sees exactly the same one.
    expect(editor.getDiagnostics().map((finding) => finding.code)).toEqual([
      "required-block-missing",
    ]);
    expect(() =>
      renderDocument(editor.getDocument(), editor.getRenderOptions()),
    ).toThrow(DocumentValidationError);
  });

  it("honours a severity override, so a warning can be made to block", () => {
    const withImage: EmailDocument = {
      root: {
        id: "root",
        type: "email",
        props: {},
        children: [{ id: "photo", type: "image", props: {} }],
      },
    };

    expect(() =>
      renderDocument(withImage, {
        definitions,
        severities: { "image-alt-text-missing": "error" },
      }),
    ).toThrow(DocumentValidationError);
  });
});

// Everything below renders without an editor — the position a send pipeline
// is in. An image Block is the case that used to fall outside it, back when
// the render path had an entry point of its own, kept as a second list by
// hand: it named neither SchemaKind.asset, `Asset` nor `assetOf`.
const page = defineBlock({
  type: "page",
  label: "Page",
  accepts: ["photo"],
  schema: {},
  render: ({ children }) => <body>{children}</body>,
});

const photo = defineBlock<{ asset: Asset | undefined }>({
  type: "photo",
  label: "Photo",
  schema: {
    asset: { kind: SchemaKind.asset, label: "Image", defaultValue: undefined },
  },
  validate: (block) =>
    isBlank(assetOf(block.props["asset"])?.alt)
      ? [
          {
            code: "photo-needs-alt-text",
            message: "This image has no alt text.",
            severity: "warning" as const,
            blockId: block.id,
          },
        ]
      : [],
  render: ({ props }) =>
    props.asset ? (
      <img
        src={props.asset.src}
        alt={props.asset.alt ?? ""}
        width={props.asset.width}
        height={props.asset.height}
      />
    ) : null,
});

function album(alt?: string): EmailDocument {
  return {
    root: {
      id: "root",
      type: "page",
      props: {},
      children: [
        {
          id: "photo",
          type: "photo",
          props: {
            asset: {
              src: "https://cdn.example.com/cat.jpg",
              width: 800,
              height: 600,
              ...(alt === undefined ? {} : { alt }),
            },
          },
        },
      ],
    },
  };
}

/** A Consumer's own link, declared under the URL kind and checked for free. */
const go = defineBlock<{ href: string }>({
  type: "go",
  label: "Go",
  schema: {
    href: { kind: SchemaKind.url, label: "Links to", defaultValue: "" },
  },
  render: ({ props }) =>
    props.href === "" ? <span>Go</span> : <a href={props.href}>Go</a>,
});

function goingTo(href: string): EmailDocument {
  return {
    root: {
      id: "root",
      type: "page",
      props: {},
      children: [{ id: "go", type: "go", props: { href } }],
    },
  };
}

describe("a Consumer's own Block holding a link", () => {
  const goPage = { ...page, accepts: ["go"] };
  const html = (href: string): string =>
    toHtml(
      // Unvalidated, because an unsafe link is an error that stops the render
      // before the emit path is reached.
      renderDocument(goingTo(href), {
        definitions: [goPage, go],
        validate: false,
      }),
      { doctype: false },
    );

  it("receives no link in place of one that could run script", () => {
    expect(html("vbscript:msgbox(1)")).toBe("<body><span>Go</span></body>");
    expect(html("java\tscript:alert(1)")).toBe("<body><span>Go</span></body>");
  });

  it("receives a link an email uses as it was stored", () => {
    expect(html("mailto:a@example.com")).toBe(
      '<body><a href="mailto:a@example.com">Go</a></body>',
    );
  });
});

describe("the render path without an editor", () => {
  it("carries everything a Block Definition is made of, Assets included", () => {
    expect(
      toHtml(renderDocument(album("A cat"), { definitions: [page, photo] }), {
        doctype: false,
      }),
    ).toContain(
      "<body>" +
        '<img src="https://cdn.example.com/cat.jpg" alt="A cat" width="800" height="600"/>' +
        "</body>",
    );
  });

  it("judges a blank value the same way the editor does", () => {
    expect(() =>
      renderDocument(album("   "), {
        definitions: [page, photo],
        severities: { "photo-needs-alt-text": "error" },
      }),
    ).toThrow(DocumentValidationError);
  });
});

/** A test `text` Block's paragraph, as it renders. */
const p = (content: string) => `<p style="font-size:14px">${content}</p>`;

describe("markup only Outlook reads", () => {
  // A row of things that sit side by side: in Outlook they need a table of
  // their own, with a cell each, so the container writes the markup between
  // its children as well as round them.
  const strip = defineBlock<Record<string, never>>({
    type: "strip",
    label: "Strip",
    accepts: ["text"],
    schema: {},
    render: ({ children, outlook }) =>
      outlook(<td>{children}</td>, "<table><tr><td>", "</td></tr></table>", [
        "</td><td>",
        '</td><td class="last">',
      ]),
  });

  const document: EmailDocument = {
    root: {
      id: "root",
      type: "email",
      props: {},
      children: [
        {
          id: "row",
          type: "strip",
          props: {},
          children: ["A", "B", "C"].map((content) => ({
            id: content,
            type: "text",
            props: { content },
          })),
        },
      ],
    },
  };

  it("goes between the children as well as round them", () => {
    const html = markupOf(document, {
      definitions: [
        { ...email, accepts: ["strip"] },
        ...definitions.slice(1),
        strip,
      ],
    });

    expect(html).toContain(
      "<td><!--[if mso]><table><tr><td><![endif]-->" +
        p("A") +
        "<!--[if mso]></td><td><![endif]-->" +
        p("B") +
        '<!--[if mso]></td><td class="last"><![endif]-->' +
        p("C") +
        "<!--[if mso]></td></tr></table><![endif]--></td>",
    );
  });
});
