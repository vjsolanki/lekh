import { describe, expect, it } from "vitest";

import { defineBlock, RichText, type BlockDefinition } from "../../index";
import { markupOf, markupOfNode } from "../../testing/markup";
import { block, documentOf } from "../../testing/tree";

describe("rendering rich text", () => {
  it("renders unformatted text as itself", () => {
    expect(markupOfNode(<RichText value={"Hello"} />)).toBe("Hello");
  });

  it("inlines the styles rather than relying on classes", () => {
    const html = markupOfNode(<RichText value={"<strong>bold</strong>"} />);
    expect(html).toBe('<strong style="font-weight:bold">bold</strong>');
    expect(html).not.toContain("class");
  });

  it("renders every supported mark to email-safe markup", () => {
    expect(markupOfNode(<RichText value={"<em>a</em>"} />)).toBe(
      '<em style="font-style:italic">a</em>',
    );
    expect(markupOfNode(<RichText value={"<u>a</u>"} />)).toBe(
      '<u style="text-decoration:underline">a</u>',
    );
    expect(markupOfNode(<RichText value={"<s>a</s>"} />)).toBe(
      '<s style="text-decoration:line-through">a</s>',
    );
  });

  it("renders a link with its destination and an inline style", () => {
    expect(
      markupOfNode(
        <RichText value={'<a href="https://example.com">here</a>'} />,
      ),
    ).toBe(
      '<a href="https://example.com" style="text-decoration:underline">here</a>',
    );
  });

  it("renders a line break", () => {
    expect(markupOfNode(<RichText value={"a<br />b"} />)).toBe("a<br/>b");
  });

  it("escapes text rather than emitting it as markup", () => {
    expect(markupOfNode(<RichText value={"&lt;script&gt;"} />)).toBe(
      "&lt;script&gt;",
    );
  });

  it("renders unsupported markup as the words it wrapped", () => {
    expect(
      markupOfNode(<RichText value={'<div class="x">plain</div>'} />),
    ).toBe("plain");
  });

  it("renders nothing for a value that is not text", () => {
    expect(markupOfNode(<RichText value={undefined} />)).toBe("");
  });
});

/**
 * A Block that holds paragraphs and one that does not, each drawing its text
 * through `RichText` with the same paragraph style.
 */
const paragraphBlocks: readonly BlockDefinition[] = [
  defineBlock<Record<string, never>>({
    type: "email",
    label: "Email",
    accepts: ["copy", "line"],
    schema: {},
    render: ({ children }) => <div>{children}</div>,
  }),
  ...(["copy", "line"] as const).map((type) =>
    defineBlock<{ content: string }>({
      type,
      label: type,
      schema: {
        content: {
          kind: "rich-text",
          label: "Content",
          defaultValue: "",
          ...(type === "copy" ? { constraints: { paragraphs: true } } : {}),
        },
      },
      render: ({ props }) => (
        <div>
          <RichText
            value={props.content}
            paragraphStyle={{ color: "red", marginBottom: 12 }}
            paragraphClassName="para"
          />
        </div>
      ),
    }),
  ),
];

/** The markup one Block of this type renders its text to. */
function drawn(type: "copy" | "line", content: string): string {
  return markupOf(documentOf(block("email", {}, [block(type, { content })])), {
    definitions: paragraphBlocks,
  });
}

describe("rendering text that holds paragraphs", () => {
  it("writes one styled paragraph each, the last with no space below it", () => {
    expect(drawn("copy", "<p>a</p><p><strong>b</strong></p>")).toBe(
      "<div><div>" +
        '<p class="para" style="color:red;margin-bottom:12px">a</p>' +
        '<p class="para" style="color:red;margin-bottom:0">' +
        '<strong style="font-weight:bold">b</strong></p>' +
        "</div></div>",
    );
  });

  it("writes a stored line break as one paragraph with a break in it", () => {
    expect(drawn("copy", "a<br />b")).toBe(
      '<div><div><p class="para" style="color:red;margin-bottom:0">a<br/>b</p></div></div>',
    );
  });

  it("leaves text without the option as one line, whatever style it is handed", () => {
    expect(drawn("line", "<p>a</p><p>b</p>")).toBe(
      "<div><div>a<br/>b</div></div>",
    );
  });
});
