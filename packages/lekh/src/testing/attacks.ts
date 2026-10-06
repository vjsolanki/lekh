/**
 * Known attack strings, as rows.
 *
 * One table, run against the shared markup-safety module and against each
 * public sanitiser, so a new bypass is one row to add.
 */

/**
 * Links that could run script, each as an `href` would be written in markup:
 * entities still encoded, and nothing that would end the attribute.
 */
export const SCRIPTABLE_LINKS: readonly (readonly [
  name: string,
  href: string,
])[] = [
  ["a plain javascript link", "javascript:alert(1)"],
  ["a tab inside the scheme", "java\tscript:alert(1)"],
  ["a newline inside the scheme", "java\nscript:alert(1)"],
  ["a NUL inside the scheme", "java\u0000script:alert(1)"],
  ["an encoded tab with its semicolon", "java&#x09;script:alert(1)"],
  ["an encoded newline with its semicolon", "java&#10;script:alert(1)"],
  ["an encoded tab without its semicolon", "java&#x09script:alert(1)"],
  ["an encoded letter", "&#106;avascript:alert(1)"],
  ["an encoded letter without its semicolon", "&#106avascript:alert(1)"],
  ["an encoded colon", "javascript&#58alert(1)"],
  ["a named colon", "javascript&colon;alert(1)"],
  ["leading spaces", "   javascript:alert(1)"],
  ["mixed case", "JaVaScRiPt:alert(1)"],
  ["vbscript", "vbscript:msgbox(1)"],
  ["an html data url", "data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"],
  ["an image data url outside an image", "data:image/png;base64,AAAA"],
];

/** Links an email may carry, written so they come back out unchanged. */
export const SAFE_LINKS: readonly string[] = [
  "https://example.com/a?b=1&amp;c=2",
  "http://example.com",
  "HTTP://EXAMPLE.COM",
  "mailto:someone@example.com",
  "tel:+441234567890",
  "/relative",
  "#anchor",
  "?a=1&amp;b=2",
];

/**
 * CSS declarations that must never reach a stylesheet or a `style` attribute,
 * as a property and a value.
 */
export const UNSAFE_DECLARATIONS: readonly (readonly [
  name: string,
  property: string,
  value: string,
])[] = [
  ["an expression", "width", "expression(alert(1))"],
  ["an escaped expression", "width", "expr\\65ssion(alert(1))"],
  ["a javascript url", "background", "url(javascript:alert(1))"],
  ["a quoted javascript url", "background", "url('javascript:alert(1)')"],
  ["an escaped url", "background", "u\\72l(javascript:alert(1))"],
  ["a vbscript url", "background-image", "url(vbscript:x)"],
  ["a data url", "background-image", 'url("data:text/html,x")'],
  ["an image set", "background-image", 'image-set("javascript:x" 1x)'],
  [
    "a prefixed image set",
    "background-image",
    "-webkit-image-set('vbscript:x' 1x)",
  ],
  ["a src function", "background-image", 'src("javascript:x")'],
  ["a brace that closes the rule", "color", "red}body{display:none"],
  ["a second declaration", "color", "red;behavior:url(x.htc)"],
  ["a tag", "color", "red</style><script>"],
  ["a string that runs off its line", "font-family", '"a\nb'],
  ["a comment", "color", "red/**/"],
  ["a behavior", "behavior", "url(x.htc)"],
  ["a moz binding", "-moz-binding", "url(x.xml#y)"],
  ["a property that is not a name", "color:red;x", "1"],
];
