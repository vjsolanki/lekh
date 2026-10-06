import { describe, expect, it } from "vitest";

import { cleanHtml, sanitiseHtml } from "./html";

const SCOPE = "lekh-h-x";

function clean(value: string): string {
  return sanitiseHtml(value, SCOPE);
}

describe("cleaning html: what never comes out active", () => {
  it.each([
    [
      "a script",
      "<p>a</p><script>alert(1)</script><p>b</p>",
      "<p>a</p><p>b</p>",
    ],
    [
      "an onerror on an image",
      '<img src=x onerror="alert(1)">',
      '<img src="x">',
    ],
    ["an svg onload", "<svg onload=alert(1)><p>a</p></svg>", "<p>a</p>"],
    ["a javascript link", '<a href="javascript:alert(1)">go</a>', "<a>go</a>"],
    [
      "an entity-encoded javascript link",
      '<a href="&#106;avascript&#x3A;alert(1)">go</a>',
      "<a>go</a>",
    ],
    [
      "an entity with no semicolon",
      '<a href="&#106avascript:alert(1)">go</a>',
      "<a>go</a>",
    ],
    [
      "a named entity a browser knows and we do not",
      '<a href="javascript&colon;alert(1)">go</a>',
      "<a>go</a>",
    ],
    [
      "a tab-split javascript link",
      '<a href="java\tscript:alert(1)">go</a>',
      "<a>go</a>",
    ],
    [
      "an encoded tab in a javascript link",
      '<a href="java&#9;script:alert(1)">go</a>',
      "<a>go</a>",
    ],
    [
      "a javascript link in capitals with leading space",
      '<a href="  JaVaScRiPt:alert(1)">go</a>',
      "<a>go</a>",
    ],
    ["an iframe", '<iframe src="https://x.test">a</iframe>b', "b"],
    ["an object", '<object data="x"><p>fallback</p></object>b', "b"],
    ["an embed", '<embed src="x">b', "b"],
    ["a base", '<base href="https://evil.test">b', "b"],
    [
      "a meta refresh",
      '<meta http-equiv="refresh" content="0;url=https://evil.test">b',
      "b",
    ],
    ["a form", '<form action="x"><p>a</p></form>', "<p>a</p>"],
    ["an unquoted handler", "<img src=x onerror=alert(1)>", '<img src="x">'],
    [
      "a backtick-quoted handler",
      "<img src=`x` onerror=`alert(1)`>",
      '<img src="`x`">',
    ],
    [
      "a handler after a slash",
      "<img/src=x/onerror=alert(1)>",
      '<img src="x/onerror=alert(1)">',
    ],
    [
      "a javascript background in a style attribute",
      '<td style="color:red;background:url(javascript:alert(1))">a</td>',
      '<td style="color:red">a</td>',
    ],
    [
      "an escaped javascript url in a style attribute",
      '<td style="background:u\\72l(javascript\\3a alert(1))">a</td>',
      "<td>a</td>",
    ],
    [
      "an expression",
      '<td style="width:expression(alert(1));color:red">a</td>',
      '<td style="color:red">a</td>',
    ],
    [
      "an escaped expression",
      '<td style="width:expr\\65ssion(alert(1))">a</td>',
      "<td>a</td>",
    ],
    [
      "a style breakout",
      "<style>td{color:red}</style><img src=x onerror=alert(1)></style>",
      '<style>.lekh-h-x td{color:red}</style><img src="x">',
    ],
    [
      "a string in a style that tries to close it",
      '<style>td{font-family:"</style><script>alert(1)</script>"}</style>',
      '<style></style>"}',
    ],
    [
      "a style import",
      "<style>@import url(https://evil.test/x.css);td{color:red}</style>",
      "<style>.lekh-h-x td{color:red}</style>",
    ],
    [
      "a quote inside a tag that hides a handler",
      '<img alt="a>" onerror=alert(1)>',
      '<img alt="a&gt;">',
    ],
    [
      "a comment a browser closes early",
      "<!--><img src=x onerror=alert(1)>-->",
      '<!--><img src="x">-->',
    ],
    [
      "a comment closed with --!>",
      "<!-- a --!><img src=x onerror=alert(1)>",
      '<!-- a --!><img src="x">',
    ],
    ["a data url in a link", '<a href="data:text/html,x">a</a>', "<a>a</a>"],
    [
      "a data image anywhere but src",
      '<td background="data:image/png;base64,AAAA">a</td>',
      "<td>a</td>",
    ],
    ["a vbscript url", '<img src="vbscript:x">', "<img>"],
    ["a noscript", "<noscript><p>a</p></noscript>b", "b"],
    ["a template", "<template><p>a</p></template>b", "b"],
    ["a self-closed script", "<script/>alert(1)</script>b", "b"],
    ["a self-closed title", "<title/>secret</title>b", "b"],
    ["a self-closed object", "<object/><p>a</p></object>b", "b"],
  ])("%s", (_, input, output) => {
    expect(clean(input)).toBe(output);
  });

  it("escapes a stray < so it can never begin a tag", () => {
    expect(clean("a < b <3 </ x>")).toBe("a &lt; b &lt;3 &lt;/ x>");
  });

  it("drops a behaviour or binding property", () => {
    expect(
      clean(
        '<p style="behavior:url(x.htc);-moz-binding:url(x);color:red">a</p>',
      ),
    ).toBe('<p style="color:red">a</p>');
  });

  it("drops the attribute, not the element, when a url is refused", () => {
    expect(clean('<a href="javascript:x" title="t">go</a>')).toBe(
      '<a title="t">go</a>',
    );
  });
});

describe("cleaning html: what an email keeps", () => {
  it("keeps tables with their email attributes", () => {
    const table =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff">' +
      '<tr><td align="center" valign="top" colspan="2" style="padding:8px 0">a</td></tr></table>';
    expect(clean(table)).toBe(table);
  });

  it("keeps inline styles as written", () => {
    expect(
      clean('<p style="color: red; font-family: &quot;Arial&quot;">a</p>'),
    ).toBe('<p style="color: red;font-family: &quot;Arial&quot;">a</p>');
  });

  it("keeps a background image from a safe url", () => {
    const value =
      "<td style=\"background-image:url('https://x.test/a.png')\">a</td>";
    expect(clean(value)).toBe(value);
  });

  it("keeps MSO conditional comments", () => {
    const value =
      '<!--[if mso]><table><tr><td width="300"><![endif]--><div>a</div>' +
      "<!--[if mso]></td></tr></table><![endif]-->" +
      "<!--[if !mso]><!--><p>b</p><!--<![endif]-->";
    expect(clean(value)).toBe(value);
  });

  it.each([
    "{{url}}",
    "*|UNSUB|*",
    "%%view_email_url%%",
    "/relative/path",
    "#top",
    "?a=1&amp;b=2",
    "{{url}}&amp;utm=x",
    "https://x.test/?a=1&amp;b=2",
    "mailto:a@x.test",
    "tel:+100",
    "HTTP://X.TEST",
  ])("keeps the url %s", (url) => {
    expect(clean(`<a href="${url}">a</a>`)).toBe(`<a href="${url}">a</a>`);
  });

  it("keeps a data image in src", () => {
    const value = '<img src="data:image/png;base64,AAAA" alt="a">';
    expect(clean(value)).toBe(value);
  });

  it("keeps entities in text as written", () => {
    expect(clean("<p>&copy; 2026 &amp; co&nbsp;</p>")).toBe(
      "<p>&copy; 2026 &amp; co&nbsp;</p>",
    );
  });

  it("keeps aria attributes and drops the rest of the unknown ones", () => {
    expect(
      clean('<div aria-label="x" data-x="1" onclick="y" hidden>a</div>'),
    ).toBe('<div aria-label="x">a</div>');
  });

  it("keeps the text of a tag it drops", () => {
    expect(clean("<section><article>a</article></section>")).toBe("a");
  });

  it("keeps a tag written self-closing", () => {
    expect(clean("a<br/>b<br>c<hr />")).toBe("a<br />b<br>c<hr />");
  });

  it("writes every attribute back in double quotes", () => {
    expect(clean("<td width=10 align='center' title='say \"hi\"'>a</td>")).toBe(
      '<td width="10" align="center" title="say &quot;hi&quot;">a</td>',
    );
  });

  it("reads a value-less attribute as written", () => {
    expect(clean("<td nowrap align>a</td>")).toBe("<td align>a</td>");
  });

  it("reads nothing at all from a value that is not a string", () => {
    expect(sanitiseHtml(undefined, SCOPE)).toBe("");
    expect(sanitiseHtml(42, SCOPE)).toBe("");
  });
});

describe("cleaning html: a whole document", () => {
  const email =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    "<title>Spring sale</title><style>body{margin:0}</style></head>" +
    '<body style="margin:0"><table><tr><td>Hi</td></tr></table></body></html>';

  it("keeps only what is inside the body", () => {
    expect(clean(email)).toBe("<table><tr><td>Hi</td></tr></table>");
  });

  it("never leaks the title as text", () => {
    expect(clean(email)).not.toContain("Spring sale");
  });

  it("says it kept only the body", () => {
    expect(cleanHtml(email, SCOPE).report.bodyOnly).toBe(true);
  });

  it("does not call what was outside the body removed", () => {
    expect(cleanHtml(email, SCOPE).report.removed).toBe(false);
  });

  it("keeps a body with no closing tag to the end", () => {
    expect(clean("<html><body><p>a</p>")).toBe("<p>a</p>");
  });

  it("drops html, head and body tags wherever they are", () => {
    expect(clean("<p>a</p></body><html>b<head><title>t</title></head>")).toBe(
      "<p>a</p>b",
    );
  });

  it("does not take a body inside a comment for the real one", () => {
    expect(clean("<!-- <body> --><p>a</p>")).toBe("<!-- <body> --><p>a</p>");
  });
});

describe("cleaning html: <style> scoping", () => {
  const style = (css: string): string => clean(`<style>${css}</style>`);

  it("prefixes a selector with the scope", () => {
    expect(style("td{padding:0}")).toBe(
      "<style>.lekh-h-x td{padding:0}</style>",
    );
  });

  it("prefixes every selector in a list", () => {
    expect(style("a, .cta{color:red}")).toBe(
      "<style>.lekh-h-x a,.lekh-h-x .cta{color:red}</style>",
    );
  });

  it("prefixes rules inside @media", () => {
    expect(
      style("@media (max-width:600px){td{padding:0}.a,.b{color:red}}"),
    ).toBe(
      "<style>@media (max-width:600px){.lekh-h-x td{padding:0}" +
        ".lekh-h-x .a,.lekh-h-x .b{color:red}}</style>",
    );
  });

  it.each([
    ["body{color:red}", ".lekh-h-x{color:red}"],
    ["html{color:red}", ".lekh-h-x{color:red}"],
    [":root{color:red}", ".lekh-h-x{color:red}"],
    ["html body td{color:red}", ".lekh-h-x td{color:red}"],
    ["body > table{color:red}", ".lekh-h-x > table{color:red}"],
    ["body.dark p{color:red}", ".lekh-h-x.dark p{color:red}"],
    ["> td{color:red}", ".lekh-h-x > td{color:red}"],
    ["bodyx{color:red}", ".lekh-h-x bodyx{color:red}"],
  ])("scopes %s", (css, scoped) => {
    expect(style(css)).toBe(`<style>${scoped}</style>`);
  });

  it.each(["~ p{color:red}", "body + p{color:red}", "html ~ div{color:red}"])(
    "drops %s, which would reach past the Block",
    (css) => {
      expect(style(css)).toBe("<style></style>");
    },
  );

  it("lets @font-face through", () => {
    expect(
      style("@font-face{font-family:X;src:url(https://x.test/x.woff2)}"),
    ).toBe(
      "<style>@font-face{font-family:X;src:url(https://x.test/x.woff2)}</style>",
    );
  });

  it.each([
    "@import url(x.css);",
    '@import "x.css";',
    "@namespace svg url(x);",
    "@keyframes spin{from{opacity:0}to{opacity:1}}",
    "@supports (display:grid){td{color:red}}",
    '@charset "utf-8";',
  ])("drops %s", (css) => {
    expect(style(`${css}td{color:red}`)).toBe(
      "<style>.lekh-h-x td{color:red}</style>",
    );
  });

  it("drops an at-rule nested inside @media", () => {
    expect(
      style("@media print{@media screen{td{color:red}}p{color:blue}}"),
    ).toBe("<style>@media print{.lekh-h-x p{color:blue}}</style>");
  });

  it("drops comments, and keeps a brace inside a string from ending the rule", () => {
    expect(style('/* a{} */ td{content:"}"; color:red}')).toBe(
      "<style>.lekh-h-x td{color:red}</style>",
    );
  });

  it("filters url() inside a stylesheet", () => {
    expect(style("td{background:url(javascript:alert(1));color:red}")).toBe(
      "<style>.lekh-h-x td{color:red}</style>",
    );
  });

  it("drops a nested rule inside a declaration block", () => {
    expect(style("td{color:red;.x{color:blue}}")).toBe(
      "<style>.lekh-h-x td{color:red}</style>",
    );
  });

  it.each([
    "/<!--*(*/,td{color:red}",
    "/-->*(*/,td{color:red}",
    "@media x/<!--*(*/{td{color:red}}",
  ])("never lets a removed marker join a new comment: %s", (css) => {
    const once = style(css);
    expect(once).not.toContain("/*");
    expect(clean(once)).toBe(once);
  });

  it.each([
    "body:not(.q) ~ *{color:red}",
    ":root:hover + td{color:red}",
    ".lekh-h-x.y ~ td{color:red}",
    "html body ~ td{color:red}",
  ])("drops %s, which steps sideways off the wrapper", (css) => {
    expect(style(css)).toBe("<style></style>");
  });

  it("keeps siblings that stay inside the Block", () => {
    expect(style("body td + td, li:nth-child(2n+1){color:red}")).toBe(
      "<style>.lekh-h-x td + td,.lekh-h-x li:nth-child(2n+1){color:red}</style>",
    );
  });

  it("escapes a scope that is not a plain class name", () => {
    expect(sanitiseHtml("<style>td{color:red}</style>", "a.b")).toBe(
      "<style>.a\\2e b td{color:red}</style>",
    );
  });
});

describe("cleaning html: structure", () => {
  it.each([
    "<table><tr><td>a",
    "</td></tr></table><p>b</p>",
    "<div><span>a</div></span>",
  ])("leaves unbalanced markup as written: %s", (value) => {
    expect(clean(value)).toBe(value);
  });

  it("closes a comment that never ends, so it cannot swallow the email", () => {
    expect(clean("<p>a</p><!-- b")).toBe("<p>a</p><!-- b-->");
  });
});

describe("cleaning html is idempotent", () => {
  it.each([
    "<p>a</p><script>x</script>",
    '<a href="javascript&colon;x" title="&copy; &quot;">a</a>',
    "<style>body{color:red}@media (max-width:1px){a,b{color:blue}}</style>",
    "<!DOCTYPE html><html><head><title>t</title></head><body><p>a</body></html>",
    "<td style=\"font-family:&quot;A&quot;;background:url('x.png')\">a</td>",
    "<!-- open",
    "a < b",
    "<img alt='a\"b' src=x>",
    '<td style="content:&amp;colon;">a</td>',
  ])("%s", (value) => {
    const once = clean(value);
    expect(clean(once)).toBe(once);
  });
});

describe("cleaning html: the report", () => {
  it("says nothing about clean markup", () => {
    expect(
      cleanHtml('<table><tr><td style="color:red">a</td></tr></table>', SCOPE)
        .report,
    ).toEqual({ removed: false, bodyOnly: false, unbalanced: false });
  });

  it.each([
    "<script>x</script>",
    "<p onclick=x>a</p>",
    '<a href="javascript:x">a</a>',
    '<p style="width:expression(x)">a</p>',
    "<style>@import 'x';</style>",
    "<blink>a</blink>",
  ])("says something was removed from %s", (value) => {
    expect(cleanHtml(value, SCOPE).report.removed).toBe(true);
  });

  it.each([
    "<table><tr><td>a",
    "</td><p>a</p>",
    "<div>a</div></div>",
    "<!-- open",
  ])("says %s looks unbalanced", (value) => {
    expect(cleanHtml(value, SCOPE).report.unbalanced).toBe(true);
  });

  it("does not count void elements as unbalanced", () => {
    expect(cleanHtml("a<br>b<img src=x><hr>", SCOPE).report.unbalanced).toBe(
      false,
    );
  });

  it("does not count tags inside a comment", () => {
    expect(
      cleanHtml("<!--[if mso]><table><tr><td><![endif]-->a", SCOPE).report
        .unbalanced,
    ).toBe(false);
  });
});
