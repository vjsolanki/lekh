/**
 * The web font a `fonts` entry loads (ADR-0021, #137).
 *
 * Preset config, not Document data: the URL is the Consumer's, checked once
 * when the Preset is built, and written by lekh alone. No react.email `Font`,
 * which loads one weight and adds a `*` rule over every stack a Block writes.
 */

/** One file of a web font: a weight, or a range of them, in one style. */
export interface ReactEmailFontFace {
  /** Where the file lives. An absolute `https:` URL. */
  readonly url: string;
  /**
   * The weight this file draws, or `[min, max]` for a variable font. Defaults
   * to 400.
   */
  readonly weight?: number | readonly [number, number];
  /** Defaults to `"normal"`. */
  readonly style?: "normal" | "italic";
}

/** The files a `fonts` entry loads, under the first name of its stack. */
export interface ReactEmailWebFont {
  readonly faces: readonly ReactEmailFontFace[];
}

/**
 * Names a stack may not start with when it loads a web font: the face would be
 * declared under a name every client already reads as something else.
 */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
]);

/**
 * An absolute `https:` URL with nothing in it that could end the quoted
 * `url("…")` it is written into, or the `<style>` round that.
 */
const FONT_URL = /^https:\/\/[^\s"'\\<>\p{Cc}]+$/u;

/** The `format()` hint for a file, by its extension. */
const FORMATS: Readonly<Record<string, string>> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  otf: "opentype",
};

/**
 * The `@font-face` rules a font entry loads, or throws where the Consumer will
 * see it. `label` and `stack` are already checked: the stack is a safe one.
 *
 * Inside `@media screen`, which classic Outlook skips whole. Outlook loads no
 * web font, and one that sees a face it cannot load may set the text in Times
 * New Roman rather than fall through the stack.
 */
export function fontFaceCss(
  label: string,
  stack: string,
  webFont: ReactEmailWebFont,
): string {
  const first = (stack.split(",")[0] ?? "").trim();
  const family = first.replaceAll(/^['"]|['"]$/gu, "");
  if (family === first && GENERIC_FAMILIES.has(family.toLowerCase())) {
    throw new Error(
      `The font "${label}" loads a web font, so its stack must start with ` +
        `the font's own name, not "${family}"`,
    );
  }
  if (webFont.faces.length === 0) {
    throw new Error(`The font "${label}" has a web font with no faces`);
  }
  const rules = webFont.faces.map((face) => faceRule(label, family, face));
  return `@media screen{${rules.join("")}}`;
}

/** One face as a rule. */
function faceRule(
  label: string,
  family: string,
  { url, weight = 400, style = "normal" }: ReactEmailFontFace,
): string {
  if (typeof url !== "string" || !FONT_URL.test(url)) {
    throw new Error(
      `The font "${label}" has a web font URL that is not a safe https URL: ` +
        JSON.stringify(url),
    );
  }
  const [from, to = from] = typeof weight === "number" ? [weight] : weight;
  const weights = from === to ? [from] : [from, to];
  if (
    !weights.every(
      (value) => Number.isFinite(value) && value >= 1 && value <= 1000,
    ) ||
    from > to
  ) {
    throw new Error(
      `The font "${label}" has a web font weight outside 1 to 1000: ` +
        JSON.stringify(weight),
    );
  }
  if (style !== "normal" && style !== "italic") {
    throw new Error(
      `The font "${label}" has a web font style that is not normal or ` +
        `italic: ${JSON.stringify(style)}`,
    );
  }
  const format = formatOf(url);
  return (
    `@font-face{font-family:'${family}';font-style:${style};` +
    `font-weight:${weights.join(" ")};src:url("${url}")` +
    `${format === undefined ? "" : ` format('${format}')`}}`
  );
}

/** The format hint for a URL's file, if its extension names one. */
function formatOf(url: string): string | undefined {
  const path = url.split(/[?#]/u, 1)[0] ?? "";
  const extension = /\.([a-z\d]+)$/iu.exec(path)?.[1]?.toLowerCase();
  return extension === undefined ? undefined : FORMATS[extension];
}
