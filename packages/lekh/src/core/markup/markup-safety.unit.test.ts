import { describe, expect, it } from "vitest";

import {
  SAFE_LINKS,
  SCRIPTABLE_LINKS,
  UNSAFE_DECLARATIONS,
} from "../../testing/attacks";
import {
  classSafe,
  decodeEntities,
  escapeAttribute,
  escapeText,
  escapeWrittenAttribute,
  isSafeDeclaration,
  isSafeUrl,
  safeUrl,
} from "./markup-safety";

describe("the URL check", () => {
  it.each(SCRIPTABLE_LINKS)("refuses %s", (_, href) => {
    expect(isSafeUrl(decodeEntities(href))).toBe(false);
  });

  it.each(SAFE_LINKS)("allows %s", (href) => {
    expect(isSafeUrl(decodeEntities(href))).toBe(true);
  });

  it("allows a data image only for an image", () => {
    expect(isSafeUrl("data:image/png;base64,AAAA", true)).toBe(true);
    expect(isSafeUrl("data:image/png;base64,AAAA")).toBe(false);
  });

  it("refuses a named entity it cannot decode before the scheme", () => {
    expect(isSafeUrl("javascript&colon;alert(1)")).toBe(false);
    // After the path starts, an entity can no longer be a scheme's colon.
    expect(isSafeUrl("/a&copy;b")).toBe(true);
  });

  it("reads a URL prop's value as text, not markup", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeUrl("vbscript:x")).toBe("");
    expect(safeUrl(42)).toBe("");
  });
});

describe("the entity decoder", () => {
  it.each([
    ["a named entity", "a &amp; b", "a & b"],
    ["a named entity in capitals", "&AMP;", "&"],
    ["a decimal entity", "&#106;", "j"],
    ["a hex entity", "&#x6A;", "j"],
    ["a decimal entity without its semicolon", "&#106x", "jx"],
    ["a hex entity without its semicolon", "&#x09script", "\tscript"],
  ])("decodes %s", (_, written, decoded) => {
    expect(decodeEntities(written)).toBe(decoded);
  });

  it.each([
    ["a named entity it does not know", "&copy;"],
    ["a named entity without its semicolon", "&amp"],
    ["a code point of nothing", "&#0;"],
    ["a code point past the last", "&#x110000;"],
  ])("leaves %s as written", (_, written) => {
    expect(decodeEntities(written)).toBe(written);
  });
});

describe("escaping", () => {
  it("escapes text so it reads as words", () => {
    expect(escapeText('a & <b> "c"')).toBe('a &amp; &lt;b&gt; "c"');
  });

  it("escapes all four characters in an attribute", () => {
    expect(escapeAttribute('a & <b> "c"')).toBe(
      "a &amp; &lt;b&gt; &quot;c&quot;",
    );
  });

  it("escapes a written attribute and keeps its entities as written", () => {
    expect(escapeWrittenAttribute('&copy; & <b> "c" &#106 &amp')).toBe(
      "&copy; &amp; &lt;b&gt; &quot;c&quot; &#106 &amp",
    );
  });

  it("leaves a written attribute that is already escaped alone", () => {
    const once = escapeWrittenAttribute('a & <b> "c"');
    expect(escapeWrittenAttribute(once)).toBe(once);
  });
});

describe("the CSS declaration check", () => {
  it.each(UNSAFE_DECLARATIONS)("refuses %s", (_, property, value) => {
    expect(isSafeDeclaration(property, value)).toBe(false);
  });

  it.each([
    ["color", "red"],
    ["font-size", "18px !important"],
    ["font-family", '"Segoe UI", sans-serif'],
    ["background-image", "url('https://x.test/a.png')"],
    ["--brand", "#123456"],
    ["content", '"a;b"'],
    ["colo\\72", "red"],
    ["background-image", 'image-set("a.png" 1x, "https://x.test/b.png" 2x)'],
    ["content", '"Note: this"'],
  ])("allows %s: %s", (property, value) => {
    expect(isSafeDeclaration(property, value)).toBe(true);
  });
});

describe("the class-name check", () => {
  it("leaves a plain id alone", () => {
    expect(classSafe("copy-2")).toBe("copy-2");
  });

  it("escapes what a class cannot carry, one-to-one", () => {
    expect(classSafe("a.b")).toBe("a_2eb");
    expect(classSafe("a_2eb")).toBe("a_5f2eb");
    expect(classSafe("a{b}")).toMatch(/^[\w-]+$/u);
  });
});
