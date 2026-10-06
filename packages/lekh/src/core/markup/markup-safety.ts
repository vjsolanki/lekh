/**
 * The rules that keep markup safe, in one place.
 *
 * The HTML Block (ADR-0028), rich text, every `SchemaKind.url` prop (ADR-0033)
 * and the mobile stylesheet all ask the same questions: is this link one an
 * email may carry, what does this entity mean, how is this attribute escaped,
 * is this CSS declaration safe, can this id sit in a class name. Each is
 * answered once, here. Where old copies disagreed, the strictest answer won, so
 * a fix in one place fixes all of them.
 */

/** Schemes a link may use. Anything else can run code in a mail client. */
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * Whether a URL keeps a scheme from the allowlist, or has none.
 *
 * Read after entities are decoded, with every whitespace and control character
 * gone and case ignored. A scheme is whatever comes before the first `:`, if
 * no `/`, `?` or `#` comes first. A named entity this module cannot decode,
 * before any of those, is refused: it could be a `:` in disguise.
 *
 * `allowsImage` lets a `data:image/` URL through, for an image's source.
 */
export function isSafeUrl(decoded: string, allowsImage = false): boolean {
  let url = "";
  for (const character of decoded) {
    if (!isSpaceOrControl(character)) url += character.toLowerCase();
  }
  const head = url.split(/[/?#]/u, 1)[0] ?? "";
  if (/&[a-z][a-z0-9]*;/u.test(head)) return false;

  const colon = head.indexOf(":");
  if (colon === -1) return true;
  const scheme = head.slice(0, colon);
  if (SAFE_SCHEMES.has(scheme)) return true;
  return allowsImage && scheme === "data" && url.startsWith("data:image/");
}

/** A space, or a character from the C0 controls or DEL. */
function isSpaceOrControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x20 || code === 0x7f;
}

/**
 * A `SchemaKind.url` prop's value as an email may carry it: the value itself,
 * or `""`, which every Block reads as no link.
 *
 * The value is already text, not markup, so it is checked as it stands. An
 * entity in it is characters, and a browser will not decode it again.
 */
export function safeUrl(value: unknown): string {
  return typeof value === "string" && isSafeUrl(value) ? value : "";
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
};

const ENTITY = /&(?:#(\d+);?|#[xX]([\da-fA-F]+);?|([a-zA-Z]+);)/gu;

/**
 * Entities decoded the way a browser decodes them: the named ones in the
 * table above, and every numeric one, with its semicolon or without.
 *
 * A named entity not in the table stays as written. Where that could matter,
 * as a link's scheme, {@link isSafeUrl} refuses it.
 */
export function decodeEntities(text: string): string {
  return text.replaceAll(
    ENTITY,
    (whole: string, decimal?: string, hex?: string, name?: string) => {
      if (decimal !== undefined) {
        return codePoint(Number.parseInt(decimal, 10), whole);
      }
      if (hex !== undefined) return codePoint(Number.parseInt(hex, 16), whole);
      return NAMED_ENTITIES[name?.toLowerCase() ?? ""] ?? whole;
    },
  );
}

/** An entity that names no character stays as the text it was. */
function codePoint(value: number, whole: string): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10_ff_ff
    ? String.fromCodePoint(value)
    : whole;
}

/** Text that reads as words, never as markup. */
export function escapeText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A value written into a double-quoted attribute: `& " < >` escaped. */
export function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

/**
 * An attribute value as an Author wrote it in markup, put back in double
 * quotes: `" < >` escaped, and every `&` that does not begin an entity.
 *
 * An entity is kept as written, so one this module cannot decode reaches the
 * browser unchanged. A bare `&` already means itself to a browser, so the
 * value means the same, and escaping it twice changes nothing.
 */
export function escapeWrittenAttribute(raw: string): string {
  return raw
    .replaceAll(/&(?![#a-zA-Z])/gu, "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Properties that once ran code in some browser. */
const UNSAFE_PROPERTIES = new Set(["behavior", "-moz-binding"]);

/**
 * Whether one CSS declaration is safe to emit, in a `style` attribute or a
 * stylesheet.
 *
 * The property is a plain name and not one that runs code. The value has no
 * brace or `<` that could end its rule or its element, no `;` or comment
 * outside a string, no string that runs off its line, no `expression(…)`, and
 * every `url(…)`, `image-set(…)` or `src(…)` URL is one the URL rule allows. Both are judged with their CSS
 * escapes decoded, because a browser decodes them before it reads `url` or
 * `expression`.
 */
export function isSafeDeclaration(property: string, value: string): boolean {
  const name = decodeCssEscapes(property).trim().toLowerCase();
  if (!/^-{0,2}[a-z][a-z0-9-]*$/u.test(name)) return false;
  if (UNSAFE_PROPERTIES.has(name)) return false;

  if (/[{}<]/u.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = cssStringEnd(value, index);
      if (end.broken) return false;
      index = end.index - 1;
      continue;
    }
    if (character === ";" || value.startsWith("/*", index)) return false;
  }

  const decoded = decodeCssEscapes(value).toLowerCase();
  if (/expression\s*\(/u.test(decoded)) return false;

  for (const match of decoded.matchAll(
    /url\s*\(\s*(?<url>"[^"]*"|'[^']*'|[^)]*)/gu,
  )) {
    const written = match.groups?.["url"] ?? "";
    const url = /^["']/u.test(written) ? written.slice(1, -1) : written;
    if (!isSafeUrl(url, false)) return false;
  }
  // `image-set(…)` and `src(…)` take a URL as a bare string, so where either
  // is used every string in the value is read as one.
  if (/(?:image-set|\bsrc)\s*\(/u.test(decoded)) {
    for (const match of decoded.matchAll(/"(?<a>[^"]*)"|'(?<b>[^']*)'/gu)) {
      const url = match.groups?.["a"] ?? match.groups?.["b"] ?? "";
      if (!isSafeUrl(url, false)) return false;
    }
  }
  return true;
}

/**
 * Where a CSS string that opens at `start` ends, and whether it ended badly:
 * at a newline, as CSS ends one, or at the end of the text.
 */
export function cssStringEnd(
  css: string,
  start: number,
): { readonly index: number; readonly broken: boolean } {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    const character = css[index];
    if (character === quote) return { index: index + 1, broken: false };
    if (character === "\n" || character === "\r" || character === "\f") {
      return { index, broken: true };
    }
    index += character === "\\" ? 2 : 1;
  }
  return { index, broken: true };
}

/** CSS escapes decoded: `\72` is `r`, and `\(` is `(`. */
function decodeCssEscapes(css: string): string {
  return css.replaceAll(
    /\\(?:([\da-f]{1,6})[\t\n\f\r ]?|(\r\n|[\n\r\f])|([\s\S]))/giu,
    (_whole: string, hex?: string, newline?: string, character?: string) => {
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        return code > 0 && code <= 0x10_ff_ff
          ? String.fromCodePoint(code)
          : "�";
      }
      if (newline !== undefined) return "";
      return character ?? "";
    },
  );
}

/**
 * A Block's id as it may follow a prefix in a class name.
 *
 * The prefix guarantees a valid start, so only the characters CSS cannot carry
 * in a class name need escaping — as `_` and their code point, with `_` itself
 * escaped so the mapping stays one-to-one.
 */
export function classSafe(blockId: string): string {
  return blockId.replaceAll(
    /[^\w-]|_/gu,
    (character) => `_${character.codePointAt(0)?.toString(16) ?? ""}`,
  );
}

/**
 * A class name as it may sit in a selector, escaped as a CSS identifier
 * wherever it needs to be. For a name that did not come from
 * {@link classSafe}.
 */
export function cssClass(name: string): string {
  return name.replaceAll(
    /[^\w-]/gu,
    (character) => `\\${character.codePointAt(0)?.toString(16) ?? ""} `,
  );
}
