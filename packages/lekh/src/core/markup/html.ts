/**
 * Markup an Author wrote by hand, cleaned on the way out (ADR-0028).
 *
 * A prop of the {@link SchemaKind.html} kind is stored exactly as the Author
 * wrote it. This module is what turns it into markup an email may carry, and
 * the Canvas and the render path call the same function, so the Author sees
 * what is sent.
 *
 * It walks tags one at a time with the inline-markup reader rather than
 * building a tree. Render runs on a server with no DOM, and a tree would mean
 * rebalancing, which the ADR rules out: the Author's structure goes out as
 * written.
 *
 * Every tag is written back out from what was read, never copied. A tag, an
 * attribute or a URL scheme nobody thought of is dropped by default. Text
 * between tags never holds a `<`, a comment ends where a browser ends it, and
 * a `<style>` never holds `</`. So the browser reading the result sees the same
 * tags this module wrote.
 */

import { SchemaKind } from "../document/definition";
import {
  DiagnosticCode,
  type Diagnostic,
  type ValidationContext,
} from "../validate/diagnostic";
import type { EmailDocument } from "../document/document";
import { commentEnd, readTag, type Tag } from "./inline-markup";
import {
  classSafe,
  cssClass,
  cssStringEnd,
  decodeEntities,
  escapeAttribute,
  escapeWrittenAttribute,
  isSafeDeclaration,
  isSafeUrl,
} from "./markup-safety";
import { collectBlocks } from "../document/tree";

/** What cleaning did, besides the markup it produced. */
export interface HtmlReport {
  /** A tag, an attribute, a declaration or a rule was dropped. */
  readonly removed: boolean;
  /** The markup was a whole document, and only its body was kept. */
  readonly bodyOnly: boolean;
  /** Tags do not open and close in equal numbers, or a close has no open. */
  readonly unbalanced: boolean;
}

export interface CleanedHtml {
  readonly html: string;
  readonly report: HtmlReport;
}

/** The class an html Block's wrapper carries, which its `<style>` is scoped to. */
export function htmlScopeOf(blockId: string): string {
  return `lekh-h-${classSafe(blockId)}`;
}

/**
 * Clean an `"html"` prop's markup, scoping its `<style>` rules to `scope`.
 *
 * A value that is not a string is no markup at all. Cleaning clean markup
 * changes nothing.
 */
export function sanitiseHtml(value: unknown, scope: string): string {
  return cleanHtml(value, scope).html;
}

/** {@link sanitiseHtml}, with what it did. One pass, two outputs. */
export function cleanHtml(value: unknown, scope: string): CleanedHtml {
  if (typeof value !== "string" || value === "") {
    return { html: "", report: NOTHING_TO_REPORT };
  }
  return new Cleaner(scope).clean(tokenise(value));
}

const NOTHING_TO_REPORT: HtmlReport = {
  removed: false,
  bodyOnly: false,
  unbalanced: false,
};

/**
 * A Diagnostic for every `"html"` prop whose markup will not go out as
 * written.
 *
 * Severity `warning` only. Render never refuses over cleaned markup
 * (ADR-0028).
 */
export function htmlDiagnostics(
  document: EmailDocument,
  context: ValidationContext,
): readonly Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const block of collectBlocks(document.root)) {
    const definition = context.getDefinition(block.type);
    if (!definition) continue;

    for (const [name, entry] of Object.entries(definition.schema)) {
      if (entry.kind !== SchemaKind.html) continue;
      // Only the report is read, and it is the same whatever the scope.
      const { report } = cleanHtml(block.props[name], htmlScopeOf(block.id));
      const warn = (code: string, message: string): void => {
        found.push({
          code,
          message,
          severity: "warning",
          blockId: block.id,
          prop: name,
        });
      };
      if (report.removed) {
        warn(
          DiagnosticCode.htmlMarkupRemoved,
          "Some markup will be removed when this email is sent.",
        );
      }
      if (report.unbalanced) {
        warn(
          DiagnosticCode.htmlMarkupUnbalanced,
          "This markup looks unbalanced. It may break the Blocks after it.",
        );
      }
      if (report.bodyOnly) {
        warn(
          DiagnosticCode.htmlWholeDocument,
          "This looks like a whole email. Only its body is kept.",
        );
      }
    }
  }
  return found;
}

/** The tags an email may carry. Anything else is dropped and keeps its text. */
const TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  "div",
  "span",
  "p",
  "br",
  "img",
  "a",
  "font",
  "center",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "hr",
  "sup",
  "sub",
  "style",
]);

/** Tags with no content and no close, which balancing ignores. */
const VOID_TAGS = new Set(["br", "img", "hr", "col"]);

/** Tags dropped with everything inside them. */
const DROPPED_WITH_CONTENT = new Set([
  "script",
  "title",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "head",
]);

/**
 * Tags whose content a browser reads as raw text to the matching close. Read
 * the same way here, so a tag-like string inside one is never taken for a tag.
 */
const RAW_TEXT = new Set(["script", "style", "title", "iframe", "noscript"]);

/** The root's tags. Dropped wherever they are, and not called a removal. */
const DOCUMENT_TAGS = new Set(["html", "body"]);

const ATTRIBUTES = new Set([
  "style",
  "class",
  "id",
  "width",
  "height",
  "align",
  "valign",
  "bgcolor",
  "background",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "color",
  "face",
  "size",
  "href",
  "src",
  "alt",
  "title",
  "dir",
  "lang",
  "role",
]);

const URL_ATTRIBUTES = new Set(["href", "src", "background"]);

type Token =
  | { readonly kind: "text"; readonly text: string }
  /** A comment, or a `<![if …]>` conditional, written back as it stands. */
  | { readonly kind: "comment"; readonly raw: string; readonly open: boolean }
  /** A doctype, `<?…>`, or a `<!…>` that is not a conditional. */
  | { readonly kind: "declaration"; readonly doctype: boolean }
  | { readonly kind: "tag"; readonly tag: Tag }
  /** What a raw-text tag holds, straight after its opening tag. */
  | { readonly kind: "raw"; readonly text: string };

/** Split markup into tokens, the way a browser's tokeniser would. */
function tokenise(value: string): readonly Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let text = "";
  const flush = (): void => {
    if (text !== "") tokens.push({ kind: "text", text });
    text = "";
  };

  while (index < value.length) {
    const next = value.indexOf("<", index);
    if (next === -1) {
      text += value.slice(index);
      break;
    }
    text += value.slice(index, next);

    if (value.startsWith("<!--", next)) {
      flush();
      const end = commentEnd(value, next);
      tokens.push({
        kind: "comment",
        raw: value.slice(next, end ?? value.length),
        open: end === undefined,
      });
      index = end ?? value.length;
      continue;
    }
    if (value.startsWith("<!", next) || value.startsWith("<?", next)) {
      flush();
      const close = value.indexOf(">", next);
      const end = close === -1 ? value.length : close + 1;
      const raw = value.slice(next, end);
      tokens.push(
        raw.startsWith("<![") && close !== -1
          ? { kind: "comment", raw, open: false }
          : { kind: "declaration", doctype: /^<!doctype/iu.test(raw) },
      );
      index = end;
      continue;
    }

    const tag = readTag(value, next);
    if (!tag) {
      // A `<` that begins nothing is a character the Author typed.
      text += "&lt;";
      index = next + 1;
      continue;
    }
    flush();
    tokens.push({ kind: "tag", tag });
    index = tag.end;

    // A browser ignores the slash in `<script/>`, so the raw text still opens.
    if (!tag.closing && RAW_TEXT.has(tag.name)) {
      const close = rawTextEnd(value, tag.name, index);
      tokens.push({ kind: "raw", text: value.slice(index, close) });
      index = close;
    }
  }
  flush();
  return tokens;
}

/** Where a raw-text tag's content ends: at its close, or at the end. */
function rawTextEnd(value: string, name: string, from: number): number {
  const lower = value.toLowerCase();
  let at = lower.indexOf(`</${name}`, from);
  while (at !== -1) {
    const after = value[at + name.length + 2];
    if (after === undefined || /[\t\n\f\r />]/u.test(after)) return at;
    at = lower.indexOf(`</${name}`, at + 1);
  }
  return value.length;
}

class Cleaner {
  private readonly scope: string;
  private removed = false;
  private unbalanced = false;
  private readonly open = new Map<string, number>();

  constructor(scope: string) {
    this.scope = cssClass(scope);
  }

  clean(all: readonly Token[]): CleanedHtml {
    const tokens = bodyOf(all);
    const out: string[] = [];
    // A tag dropped with its content, and how deep inside it the walk is.
    let skipping: { name: string; depth: number } | undefined;

    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token === undefined) continue;

      if (skipping) {
        if (token.kind !== "tag" || token.tag.name !== skipping.name) continue;
        if (!token.tag.closing) skipping.depth += 1;
        else if (--skipping.depth === 0) skipping = undefined;
        continue;
      }

      switch (token.kind) {
        case "text":
          out.push(token.text);
          break;
        case "comment":
          if (token.open) this.unbalanced = true;
          out.push(token.open ? `${token.raw}-->` : token.raw);
          break;
        case "declaration":
          if (!token.doctype) this.removed = true;
          break;
        case "raw":
          // Only ever reached for a raw-text tag that was dropped.
          break;
        case "tag": {
          const { tag } = token;
          if (DOCUMENT_TAGS.has(tag.name)) break;
          if (DROPPED_WITH_CONTENT.has(tag.name)) {
            this.removed = true;
            // A slash does not make `<object/>` empty, so it is not trusted.
            if (tag.closing || tag.name === "embed") break;
            if (RAW_TEXT.has(tag.name)) index += 1;
            else skipping = { name: tag.name, depth: 1 };
            break;
          }
          if (tag.name === "style") {
            if (tag.closing) break;
            if (tag.rawAttributes.length > 0) this.removed = true;
            const next = tokens[index + 1];
            const css = next?.kind === "raw" ? next.text : "";
            if (next?.kind === "raw") index += 1;
            out.push(`<style>${this.stylesheet(css)}</style>`);
            break;
          }
          if (!TAGS.has(tag.name)) {
            this.removed = true;
            break;
          }
          out.push(this.tag(tag));
        }
      }
    }

    for (const count of this.open.values()) {
      if (count !== 0) this.unbalanced = true;
    }

    return {
      html: out.join(""),
      report: {
        removed: this.removed,
        bodyOnly: tokens !== all,
        unbalanced: this.unbalanced,
      },
    };
  }

  /** An allowed tag, written back out from what was read. */
  private tag(tag: Tag): string {
    if (tag.closing) {
      const count = this.open.get(tag.name) ?? 0;
      if (count === 0) this.unbalanced = true;
      else this.open.set(tag.name, count - 1);
      return `</${tag.name}>`;
    }
    if (!VOID_TAGS.has(tag.name)) {
      this.open.set(tag.name, (this.open.get(tag.name) ?? 0) + 1);
    }

    let out = `<${tag.name}`;
    for (const [name, raw] of tag.rawAttributes) {
      const written = this.attribute(tag.name, name, raw);
      if (written === undefined) this.removed = true;
      else if (written !== "") out += ` ${written}`;
    }
    return `${out}${tag.selfClosing ? " />" : ">"}`;
  }

  /**
   * One attribute as it goes out, `undefined` when it is dropped, or `""` when
   * it is kept but has nothing left to say.
   */
  private attribute(
    tag: string,
    name: string,
    raw: string | undefined,
  ): string | undefined {
    if (!ATTRIBUTES.has(name) && !/^aria-[a-z-]+$/u.test(name)) {
      return undefined;
    }
    if (raw === undefined) return name;

    if (name === "style") {
      const declarations = this.declarations(decodeEntities(raw));
      return declarations === ""
        ? ""
        : `style="${escapeAttribute(declarations)}"`;
    }
    if (URL_ATTRIBUTES.has(name)) {
      const allowsImage = name === "src" && tag === "img";
      if (!isSafeUrl(decodeEntities(raw), allowsImage)) return undefined;
    }
    // The value as written, so an entity this module does not know reaches
    // the browser unchanged.
    return `${name}="${escapeWrittenAttribute(raw)}"`;
  }

  /** A declaration list, keeping only what is safe. */
  private declarations(css: string): string {
    const kept: string[] = [];
    for (const part of splitTopLevel(stripComments(css), ";")) {
      const declaration = part.trim();
      if (declaration === "") continue;
      const colon = declaration.indexOf(":");
      const safe =
        colon !== -1 &&
        isSafeDeclaration(
          declaration.slice(0, colon),
          declaration.slice(colon + 1),
        );
      if (safe) kept.push(declaration);
      else this.removed = true;
    }
    return kept.join(";");
  }

  /**
   * A `<style>` element's content, with every rule scoped to the Block and
   * every at-rule but `@media` and `@font-face` dropped.
   */
  private stylesheet(css: string): string {
    // `</` is the one thing that could end the element early. Escaped as CSS,
    // it means the same to the stylesheet and nothing to the markup.
    return this.rules(stripComments(css), true).replaceAll("</", "<\\/");
  }

  private rules(css: string, topLevel: boolean): string {
    let out = "";
    for (const rule of readRules(css)) {
      if (rule === "broken") {
        this.removed = true;
        continue;
      }
      const prelude = rule.prelude.trim();

      if (prelude.startsWith("@")) {
        const name = /^@(?<name>[a-z-]+)/iu
          .exec(prelude)
          ?.groups?.["name"]?.toLowerCase();
        const rest = prelude.slice((name?.length ?? 0) + 1).trim();
        if (topLevel && name === "media" && rule.block !== undefined) {
          out += `@media ${rest}{${this.rules(rule.block, false)}}`;
        } else if (
          topLevel &&
          name === "font-face" &&
          rule.block !== undefined &&
          rest === ""
        ) {
          out += `@font-face{${this.declarations(rule.block)}}`;
        } else {
          this.removed = true;
        }
        continue;
      }

      if (rule.block === undefined) {
        this.removed = true;
        continue;
      }
      const selectors: string[] = [];
      for (const part of splitTopLevel(prelude, ",")) {
        const scoped = scopeSelector(part.trim(), this.scope);
        if (scoped === undefined) this.removed = true;
        else selectors.push(scoped);
      }
      if (selectors.length === 0) continue;
      out += `${selectors.join(",")}{${this.declarations(rule.block)}}`;
    }
    return out;
  }
}

/**
 * The tokens inside a whole document's `<body>`, or every token when there is
 * no body. The same array back means there was none.
 */
function bodyOf(tokens: readonly Token[]): readonly Token[] {
  const open = tokens.findIndex((token) => isBody(token, false));
  if (open === -1) return tokens;
  const close = tokens.findLastIndex((token) => isBody(token, true));
  return tokens.slice(open + 1, close > open ? close : tokens.length);
}

function isBody(token: Token | undefined, closing: boolean): boolean {
  return (
    token?.kind === "tag" &&
    token.tag.name === "body" &&
    token.tag.closing === closing
  );
}

/**
 * A selector with the scope in front of it, or `undefined` when no prefix can
 * keep it inside the Block.
 *
 * `html`, `body` and `:root` at the start stand for the Block's own wrapper,
 * and so does the scope itself, which is what makes this idempotent. What is
 * left may go down into the Block but never sideways: `~` or `+` straight
 * after the wrapper would reach a Block it does not own.
 */
function scopeSelector(selector: string, scope: string): string | undefined {
  if (selector === "") return undefined;
  const root = new RegExp(
    `^(?:html|body|:root|${escapeRegExp(`.${scope}`)})(?![\\w\\\\-])`,
    "iu",
  );

  let rest = selector;
  let matched = false;
  for (let found = root.exec(rest); found; found = root.exec(rest)) {
    matched = true;
    rest = rest.slice(found[0].length);
    // Only a descendant step moves on to another leading root, as in
    // `html body td`. `body > td` keeps its `>`.
    const space = /^\s+/u.exec(rest)?.[0];
    if (space === undefined || !root.test(rest.slice(space.length))) break;
    rest = rest.slice(space.length);
  }

  if (matched) {
    return stepsSideways(rest) ? undefined : `.${scope}${rest.trimEnd()}`;
  }
  if (/^[+~]/u.test(rest.trim())) return undefined;
  return `.${scope} ${selector}`;
}

/**
 * Whether the first combinator after the wrapper's compound is `~` or `+`,
 * which would leave the wrapper for a sibling. Brackets and strings are
 * skipped, so `:nth-child(2n+1)` is not one.
 */
function stepsSideways(rest: string): boolean {
  let depth = 0;
  let index = 0;
  while (index < rest.length) {
    const character = rest[index] ?? "";
    if (character === '"' || character === "'") {
      index = cssStringEnd(rest, index).index;
      continue;
    }
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s>+~]/u.test(character)) {
      const combinator = rest.slice(index).trimStart()[0];
      return combinator === "+" || combinator === "~";
    }
    index += 1;
  }
  return false;
}

type Rule =
  { readonly prelude: string; readonly block: string | undefined } | "broken";

/**
 * Read a stylesheet, already stripped of comments, into its rules.
 *
 * A string ends at its quote or at a newline, as CSS ends one. A rule with a
 * string that runs off a line is broken and dropped, so no rule is ever read
 * differently here and in a browser.
 */
function readRules(css: string): readonly Rule[] {
  const rules: Rule[] = [];
  let index = 0;
  let start = 0;
  let broken = false;

  while (index < css.length) {
    const character = css[index];
    if (character === '"' || character === "'") {
      const end = cssStringEnd(css, index);
      if (end.broken) broken = true;
      index = end.index;
      continue;
    }
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === ";") {
      rules.push(
        broken
          ? "broken"
          : { prelude: css.slice(start, index), block: undefined },
      );
      index += 1;
      start = index;
      broken = false;
      continue;
    }
    if (character === "}") {
      // A close with no open: whatever came before it is not a rule.
      if (css.slice(start, index).trim() !== "") rules.push("broken");
      index += 1;
      start = index;
      broken = false;
      continue;
    }
    if (character === "{") {
      const close = blockEnd(css, index);
      const prelude = css.slice(start, index);
      const block = css.slice(index + 1, close.index);
      rules.push(broken || close.broken ? "broken" : { prelude, block });
      index = close.index + 1;
      start = index;
      broken = false;
      continue;
    }
    index += 1;
  }
  if (css.slice(start).trim() !== "") rules.push("broken");
  return rules;
}

/** The index of the `}` that closes the block opening at `open`. */
function blockEnd(
  css: string,
  open: number,
): { readonly index: number; readonly broken: boolean } {
  let depth = 0;
  let broken = false;
  let index = open;
  while (index < css.length) {
    const character = css[index];
    if (character === '"' || character === "'") {
      const end = cssStringEnd(css, index);
      if (end.broken) broken = true;
      index = end.index;
      continue;
    }
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return { index, broken };
    index += 1;
  }
  // A block a browser would close at the end of the sheet.
  return { index: css.length, broken };
}

/**
 * Split on a separator that is not inside a string, brackets or a block.
 */
function splitTopLevel(css: string, separator: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '"' || character === "'") {
      index = cssStringEnd(css, index).index;
      continue;
    }
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    }
    if (character === separator && depth === 0) {
      parts.push(css.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  parts.push(css.slice(start));
  return parts;
}

/** Drop comments and the HTML-comment markers CSS ignores, outside strings. */
function stripComments(css: string): string {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '"' || character === "'") {
      const end = cssStringEnd(css, index).index;
      out += css.slice(index, end);
      index = end;
      continue;
    }
    if (character === "\\") {
      out += css.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (css.startsWith("/*", index)) {
      const close = css.indexOf("*/", index + 2);
      index = close === -1 ? css.length : close + 2;
      out += " ";
      continue;
    }
    // A space in place of each, like a comment, so what is either side can
    // never join into a `/*` the scanners after this would not see.
    if (css.startsWith("<!--", index)) {
      index += 4;
      out += " ";
      continue;
    }
    if (css.startsWith("-->", index)) {
      index += 3;
      out += " ";
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
