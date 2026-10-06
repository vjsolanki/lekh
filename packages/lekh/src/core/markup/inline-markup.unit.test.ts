import { describe, expect, it } from "vitest";

import {
  parseInlineMarkup,
  sanitiseInlineMarkup,
  serialiseInlineMarkup,
} from "./inline-markup";

describe("parsing inline markup", () => {
  it("reads a plain string as one unformatted run", () => {
    expect(parseInlineMarkup("Hello")).toEqual([
      { kind: "text", text: "Hello", marks: [] },
    ]);
  });

  it("reads the supported inline marks", () => {
    expect(
      parseInlineMarkup("<strong>a</strong><em>b</em><u>c</u><s>d</s>"),
    ).toEqual([
      { kind: "text", text: "a", marks: [{ kind: "bold" }] },
      { kind: "text", text: "b", marks: [{ kind: "italic" }] },
      { kind: "text", text: "c", marks: [{ kind: "underline" }] },
      { kind: "text", text: "d", marks: [{ kind: "strike" }] },
    ]);
  });

  it("treats a word processor's tags as the marks they mean", () => {
    expect(parseInlineMarkup("<b>a</b><i>b</i><strike>c</strike>")).toEqual([
      { kind: "text", text: "a", marks: [{ kind: "bold" }] },
      { kind: "text", text: "b", marks: [{ kind: "italic" }] },
      { kind: "text", text: "c", marks: [{ kind: "strike" }] },
    ]);
  });

  it("nests marks over the same run", () => {
    expect(parseInlineMarkup("<strong><em>both</em></strong>")).toEqual([
      {
        kind: "text",
        text: "both",
        marks: [{ kind: "bold" }, { kind: "italic" }],
      },
    ]);
  });

  it("reads a link with its destination", () => {
    expect(parseInlineMarkup('<a href="https://example.com">here</a>')).toEqual(
      [
        {
          kind: "text",
          text: "here",
          marks: [{ kind: "link", href: "https://example.com" }],
        },
      ],
    );
  });

  it("decodes entities", () => {
    expect(
      parseInlineMarkup("a &amp; b &lt;c&gt; &#65; &#x42; &nbsp;"),
    ).toEqual([{ kind: "text", text: "a & b <c> A B \u00A0", marks: [] }]);
  });

  it("reads a line break", () => {
    expect(parseInlineMarkup("a<br />b")).toEqual([
      { kind: "text", text: "a", marks: [] },
      { kind: "break" },
      { kind: "text", text: "b", marks: [] },
    ]);
  });

  it("keeps the words of an unsupported tag and drops the tag", () => {
    expect(parseInlineMarkup('<span class="x">kept</span>')).toEqual([
      { kind: "text", text: "kept", marks: [] },
    ]);
  });

  it("drops a script outright rather than keeping its source as words", () => {
    expect(parseInlineMarkup("a<script>alert(1)</script>b")).toEqual([
      { kind: "text", text: "ab", marks: [] },
    ]);
  });

  it("separates block-level content with a break", () => {
    expect(parseInlineMarkup("<p>one</p><p>two</p>")).toEqual([
      { kind: "text", text: "one", marks: [] },
      { kind: "break" },
      { kind: "text", text: "two", marks: [] },
    ]);
  });

  it("collapses runs of whitespace the way a browser would", () => {
    expect(parseInlineMarkup("a  \n  b")).toEqual([
      { kind: "text", text: "a b", marks: [] },
    ]);
  });

  it("closes marks a paste left open", () => {
    expect(parseInlineMarkup("<strong>a")).toEqual([
      { kind: "text", text: "a", marks: [{ kind: "bold" }] },
    ]);
  });

  it("ignores a close tag that was never opened", () => {
    expect(parseInlineMarkup("a</strong>b")).toEqual([
      { kind: "text", text: "ab", marks: [] },
    ]);
  });

  it("drops comments", () => {
    expect(parseInlineMarkup("a<!-- note -->b")).toEqual([
      { kind: "text", text: "ab", marks: [] },
    ]);
  });

  it("reads nothing from a value that is not text", () => {
    expect(parseInlineMarkup(undefined)).toEqual([]);
    expect(parseInlineMarkup(42)).toEqual([]);
  });
});

describe("sanitising inline markup", () => {
  it("keeps only the supported formatting", () => {
    expect(
      sanitiseInlineMarkup(
        '<h1>Title</h1><p>A <b class="lead">word</b> and <span style="color:red">color</span>.</p>',
      ),
    ).toBe("Title<br />A <strong>word</strong> and color.");
  });

  it("writes marks in a canonical order, so a round trip is stable", () => {
    const once = sanitiseInlineMarkup("<em><strong>both</strong></em>");
    expect(once).toBe("<strong><em>both</em></strong>");
    expect(sanitiseInlineMarkup(once)).toBe(once);
  });

  it("merges adjacent runs that carry the same marks", () => {
    expect(sanitiseInlineMarkup("<strong>a</strong><strong>b</strong>")).toBe(
      "<strong>ab</strong>",
    );
  });

  it("escapes text that would otherwise be read as markup", () => {
    expect(sanitiseInlineMarkup("5 &lt; 6 &amp; 7 > 4")).toBe(
      "5 &lt; 6 &amp; 7 &gt; 4",
    );
  });

  it("drops a link whose scheme could run code", () => {
    expect(
      sanitiseInlineMarkup('<a href="javascript:alert(1)">click</a>'),
    ).toBe("click");
    expect(sanitiseInlineMarkup('<a href="data:text/html,x">click</a>')).toBe(
      "click",
    );
  });

  // The full attack table runs through both sanitisers in
  // `markup-safety.test.ts`.

  it("survives a save and reload unchanged", () => {
    const stored = sanitiseInlineMarkup(
      'Hello <strong>world</strong>, see <a href="https://example.com">this</a>.<br />Bye',
    );
    expect(sanitiseInlineMarkup(stored)).toBe(stored);
    expect(serialiseInlineMarkup(parseInlineMarkup(stored))).toBe(stored);
  });
});

// ADR-0023: a rich-text prop may hold paragraphs.
describe("text that holds paragraphs", () => {
  const PARAGRAPHS = { paragraphs: true } as const;

  it("keeps pasted paragraphs apart, where text without the option joins them", () => {
    expect(sanitiseInlineMarkup("<p>a</p><p>b</p>", PARAGRAPHS)).toBe(
      "<p>a</p><p>b</p>",
    );
    expect(sanitiseInlineMarkup("<p>a</p><p>b</p>")).toBe("a<br />b");
  });

  it("reads every block tag as a paragraph boundary, so a list becomes paragraphs", () => {
    expect(
      sanitiseInlineMarkup("<ul><li>a</li><li>b</li></ul>", PARAGRAPHS),
    ).toBe("<p>a</p><p>b</p>");
    expect(
      sanitiseInlineMarkup("<h2>Title</h2><div>Body</div>", PARAGRAPHS),
    ).toBe("<p>Title</p><p>Body</p>");
  });

  it("reads a paragraph's edges and its line breaks as different things", () => {
    expect(parseInlineMarkup("<p>a<br />b</p><p>c</p>", PARAGRAPHS)).toEqual([
      { kind: "text", text: "a", marks: [] },
      { kind: "break" },
      { kind: "text", text: "b", marks: [] },
      { kind: "paragraph" },
      { kind: "text", text: "c", marks: [] },
    ]);
  });

  it("reads a value with no paragraph in it as one", () => {
    expect(sanitiseInlineMarkup("a<br />b", PARAGRAPHS)).toBe(
      "<p>a<br />b</p>",
    );
  });

  it("drops empty paragraphs, and the breaks that separate nothing", () => {
    expect(
      sanitiseInlineMarkup(
        "<p></p><p>a</p><p> </p><p><br /></p><p><br />b<br /></p><p></p>",
        PARAGRAPHS,
      ),
    ).toBe("<p>a</p><p>b</p>");
    expect(sanitiseInlineMarkup("<p></p><p><br /></p>", PARAGRAPHS)).toBe("");
  });

  it("keeps marks inside the paragraph they were written in", () => {
    expect(
      sanitiseInlineMarkup("<p><strong>a</p><p>b</strong></p>", PARAGRAPHS),
    ).toBe("<p><strong>a</strong></p><p><strong>b</strong></p>");
  });

  it("survives a save and reload unchanged", () => {
    const stored = sanitiseInlineMarkup(
      '<p>Hello <b>world</b></p>\n<p>see <a href="https://example.com">this</a>.<br>Bye</p>',
      PARAGRAPHS,
    );
    expect(stored).toBe(
      '<p>Hello <strong>world</strong></p><p>see <a href="https://example.com">this</a>.<br />Bye</p>',
    );
    expect(sanitiseInlineMarkup(stored, PARAGRAPHS)).toBe(stored);
    expect(
      serialiseInlineMarkup(parseInlineMarkup(stored, PARAGRAPHS), PARAGRAPHS),
    ).toBe(stored);
  });
});

// ADR-0029: a rich-text prop may hold lists.
describe("text that holds lists", () => {
  const LISTS = { paragraphs: true, lists: true } as const;

  it("keeps a bullet and a numbered list between paragraphs", () => {
    expect(
      sanitiseInlineMarkup(
        "<p>a</p><ul><li>b</li><li>c</li></ul><ol><li>d</li></ol><p>e</p>",
        LISTS,
      ),
    ).toBe("<p>a</p><ul><li>b</li><li>c</li></ul><ol><li>d</li></ol><p>e</p>");
  });

  it("reads a list as its start, its items and its end, beside the paragraphs", () => {
    expect(
      parseInlineMarkup("<p>a</p><ol><li>b<br>c</li><li>d</li></ol>", LISTS),
    ).toEqual([
      { kind: "text", text: "a", marks: [] },
      { kind: "list", list: "numbered" },
      { kind: "text", text: "b", marks: [] },
      { kind: "break" },
      { kind: "text", text: "c", marks: [] },
      { kind: "item" },
      { kind: "text", text: "d", marks: [] },
      { kind: "list-end" },
    ]);
  });

  it("keeps two lists apart when nothing sits between them", () => {
    expect(
      sanitiseInlineMarkup("<ul><li>a</li></ul><ul><li>b</li></ul>", LISTS),
    ).toBe("<ul><li>a</li></ul><ul><li>b</li></ul>");
  });

  it("flattens a nested list into its parent, in reading order", () => {
    expect(
      sanitiseInlineMarkup(
        "<ol><li>a<ul><li>b</li><li>c<ol><li>d</li></ol></li></ul></li><li>e</li></ol>",
        LISTS,
      ),
    ).toBe("<ol><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li></ol>");
  });

  it("makes a stray item into an item of a bullet list", () => {
    expect(sanitiseInlineMarkup("<li>a</li><li>b</li>", LISTS)).toBe(
      "<ul><li>a</li><li>b</li></ul>",
    );
    expect(
      sanitiseInlineMarkup("<p>x</p><li>a</li><p>y</p><li>b</li>", LISTS),
    ).toBe("<p>x</p><ul><li>a</li></ul><p>y</p><ul><li>b</li></ul>");
  });

  it("drops every attribute on a list and its items", () => {
    expect(
      sanitiseInlineMarkup(
        '<ol start="3" reversed type="a" class="x"><li value="7" style="color:red">a</li></ol>',
        LISTS,
      ),
    ).toBe("<ol><li>a</li></ol>");
  });

  it("drops empty items, and a list with no items left", () => {
    expect(
      sanitiseInlineMarkup(
        "<ul><li></li><li>a</li><li> <br></li><li><br>b<br></li></ul><ol><li></li></ol><p>c</p>",
        LISTS,
      ),
    ).toBe("<ul><li>a</li><li>b</li></ul><p>c</p>");
    expect(sanitiseInlineMarkup("<ul><li></li></ul>", LISTS)).toBe("");
  });

  it("reads a paragraph inside an item as part of the item", () => {
    expect(
      sanitiseInlineMarkup(
        "<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>",
        LISTS,
      ),
    ).toBe("<ul><li>a<br />b</li><li>c</li></ul>");
  });

  it("keeps flattening lists to paragraphs in text without the option", () => {
    expect(
      sanitiseInlineMarkup("<ul><li>a</li><li>b</li></ul>", {
        paragraphs: true,
      }),
    ).toBe("<p>a</p><p>b</p>");
  });

  it("survives a save and reload unchanged", () => {
    const stored = sanitiseInlineMarkup(
      "<p>Intro</p>\n<ul>\n  <li>One <b>bold</b></li>\n  <li>Two<br>lines</li>\n</ul>\n<ol><li>First</li></ol>",
      LISTS,
    );
    expect(stored).toBe(
      "<p>Intro</p><ul><li>One <strong>bold</strong></li><li>Two<br />lines</li></ul><ol><li>First</li></ol>",
    );
    expect(sanitiseInlineMarkup(stored, LISTS)).toBe(stored);
    expect(serialiseInlineMarkup(parseInlineMarkup(stored, LISTS), LISTS)).toBe(
      stored,
    );
  });
});
