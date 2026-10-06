/**
 * The inline formatting a Block's text may carry.
 *
 * Text content is not modelled in the Document — it lives in the Text Engine's
 * own representation (ADR-0005), which this library takes to be a string of
 * inline HTML, because every editor worth adapting can already produce one.
 *
 * What this module owns is the *subset* of that HTML the library will accept
 * and re-emit. It is deliberately tiny: the formatting an email client renders
 * the same way everywhere. Anything else — a class, a colour, a table, a
 * script — is dropped on the way in, so a paste from a word processor cannot
 * put markup into an email that no one can be sure of.
 *
 * Parsing is done here rather than with the browser's own parser because the
 * render path is isomorphic: a send pipeline turns a stored Document into
 * markup on a server, where there is no DOM.
 */

import {
  decodeEntities,
  escapeAttribute,
  escapeText,
  isSafeUrl,
} from "./markup-safety";

/** One piece of inline formatting applied to a run of text. */
export type Mark =
  | { readonly kind: "bold" }
  | { readonly kind: "italic" }
  | { readonly kind: "underline" }
  | { readonly kind: "strike" }
  | { readonly kind: "link"; readonly href: string };

/** A run of text carrying the marks that apply to all of it. */
export interface TextRun {
  readonly kind: "text";
  readonly text: string;
  readonly marks: readonly Mark[];
}

/** A hard line break within a Block's text. */
export interface LineBreak {
  readonly kind: "break";
}

/**
 * Where one paragraph ends and the next begins.
 *
 * Only read from text whose Schema entry opts in to paragraphs (ADR-0023). A
 * boundary and not a node holding its runs, so the list stays flat and a value
 * with no paragraphs in it is the same list it always was.
 */
export interface ParagraphBreak {
  readonly kind: "paragraph";
}

/** The two kinds of list a Block's text may hold (ADR-0029). */
export type ListKind = "bullet" | "numbered";

/**
 * Where a list begins, and with it its first item.
 *
 * Only read from text whose Schema entry opts in to lists. A list sits between
 * paragraphs, so no paragraph boundary is written either side of it: its start
 * and its end already say where it is.
 */
export interface ListStart {
  readonly kind: "list";
  readonly list: ListKind;
}

/** Where one item of a list ends and the next begins. */
export interface ItemBreak {
  readonly kind: "item";
}

/** Where a list ends, so two lists in a row stay two lists. */
export interface ListEnd {
  readonly kind: "list-end";
}

/**
 * A Block's text, flattened to runs.
 *
 * A list rather than a tree, and derived rather than stored: this is what the
 * render path walks, and it never reaches the Document.
 */
export type InlineNode =
  TextRun | LineBreak | ParagraphBreak | ListStart | ItemBreak | ListEnd;

/** What a line of text is made of: words and the breaks between them. */
export type Run = TextRun | LineBreak;

/**
 * One stretch of a Block's text that holds paragraphs: a paragraph, or a list
 * of items. What `splitStretches` reads the flat list back into.
 */
export type Stretch =
  | { readonly kind: "paragraph"; readonly runs: readonly Run[] }
  | {
      readonly kind: "list";
      readonly list: ListKind;
      readonly items: readonly (readonly Run[])[];
    };

/**
 * What a Block's text may hold beyond one line of words, as its rich-text
 * Schema entry's `constraints` declare it.
 *
 * Parsing and serialising both take it, so a paste, the stored string and the
 * email agree about where paragraphs fall.
 */
export interface TextShape {
  /**
   * Whether the text holds paragraphs. Off, every block tag collapses to a
   * line break, which is what a heading wants (ADR-0023).
   */
  readonly paragraphs?: boolean;
  /**
   * Whether the text holds bullet and numbered lists, one level deep. Only
   * meaningful with `paragraphs`. Off, a list flattens to paragraphs
   * (ADR-0029).
   */
  readonly lists?: boolean;
}

/**
 * The order marks nest in when written back out.
 *
 * Fixed so that the same text always serialises to the same string — which is
 * what makes a save and reload a no-op rather than a slow drift.
 */
const MARK_ORDER: readonly Mark["kind"][] = [
  "link",
  "bold",
  "italic",
  "underline",
  "strike",
];

/**
 * The element each mark is written as.
 *
 * The single place the library says what bold *is*. Serialisation and the
 * render path both read it, so the string a Block stores and the markup an
 * email carries can never disagree about which tag wraps which.
 */
export const MARK_ELEMENTS: Readonly<Record<Mark["kind"], string>> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  strike: "s",
  link: "a",
};

/** Which mark a tag means. Synonyms a word processor emits are included. */
const MARKS_BY_TAG: Readonly<Record<string, Mark["kind"]>> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  ins: "underline",
  s: "strike",
  strike: "strike",
  del: "strike",
  a: "link",
};

/**
 * The boundary a parse is holding until the next run of words arrives: a line
 * break, or the start of a new stretch — a paragraph or a list item.
 */
type PendingBoundary = "break" | "stretch" | undefined;

/**
 * How each kind of list is written: its tag, and the marker it asks for.
 *
 * The one place a bullet list is said to be a `<ul>` of discs. The stored
 * string and the email both read it, so they never disagree.
 */
export const LIST_MARKUP: Readonly<
  Record<ListKind, { readonly tag: "ul" | "ol"; readonly marker: string }>
> = {
  bullet: { tag: "ul", marker: "disc" },
  numbered: { tag: "ol", marker: "decimal" },
};

/** Tags that make a list, and the kind each one makes. */
const LIST_TAGS: Readonly<Record<string, ListKind>> = {
  ul: "bullet",
  ol: "numbered",
};

/**
 * One list as a parse found it. Compared by identity, so two lists written one
 * after the other stay two.
 */
interface ParsedList {
  readonly list: ListKind;
}

/** What a stretch of parsed text sits in: a paragraph, or an item of a list. */
type Container = ParsedList | undefined;

/** A stretch of parsed text, before empty ones are dropped. */
interface RawStretch {
  readonly container: Container;
  readonly runs: Run[];
}

/** Tags whose content is a line of its own rather than part of the same one. */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "div",
  "dd",
  "dt",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "pre",
  "section",
  "td",
  "th",
  "tr",
]);

/** Tags whose content is source code, not words, and is dropped with them. */
const OPAQUE_TAGS = new Set(["script", "style", "template", "title"]);

/**
 * Read a Block's stored text into runs.
 *
 * Forgiving by design (ADR-0006): unclosed tags are closed, stray close tags
 * are ignored, and an unsupported tag keeps its words and loses itself. A
 * value that is not a string reads as no text at all, so a Block whose prop
 * has never been set renders empty rather than throwing.
 */
export function parseInlineMarkup(
  value: unknown,
  shape: TextShape = {},
): readonly InlineNode[] {
  if (typeof value !== "string" || value === "") return [];

  const lists = shape.paragraphs === true && shape.lists === true;
  const stretches: RawStretch[] = [];
  const open: Mark[] = [];
  // A block boundary is only worth a break once there is something on either
  // side of it, so it is held until the next run arrives. That is also what
  // drops an empty paragraph: nothing arrives between its two boundaries.
  let pending: PendingBoundary;
  let index = 0;

  // The list being read, how many list tags are open inside it, and how many
  // items. A nested list adds to the depth and not a new list, which is what
  // flattens it into its parent. A stray `<li>` opens a bullet list with no
  // tag of its own, which lasts only while an item is open.
  let list: ParsedList | undefined;
  let depth = 0;
  let items = 0;
  // How many stray items were open when the outermost list tag opened.
  let outerItems = 0;

  const openList = (kind: ListKind): void => {
    // A list opening inside a stray item belongs to that item's list.
    if (depth === 0) {
      outerItems = items;
      if (items === 0) list = { list: kind };
    }
    depth += 1;
  };

  const closeList = (): void => {
    if (depth === 0) return;
    depth -= 1;
    if (depth > 0) return;
    // Items left unclosed inside the list end with it.
    items = outerItems;
    if (items === 0) list = undefined;
  };

  const container = (): Container =>
    list !== undefined && (depth > 0 || items > 0) ? list : undefined;

  /** The stretch the next run goes in, starting one if a boundary says so. */
  const current = (): RawStretch => {
    const now = container();
    const last = stretches.at(-1);
    if (last && pending !== "stretch" && last.container === now) {
      if (pending === "break" && last.runs.length > 0) {
        last.runs.push({ kind: "break" });
      }
      pending = undefined;
      return last;
    }
    pending = undefined;
    const started: RawStretch = { container: now, runs: [] };
    stretches.push(started);
    return started;
  };

  const atLineStart = (): boolean => {
    const last = stretches.at(-1);
    return (
      pending !== undefined ||
      last === undefined ||
      last.container !== container() ||
      last.runs.at(-1)?.kind !== "text"
    );
  };

  const push = (raw: string): void => {
    const text = collapse(raw, stretches.at(-1)?.runs.at(-1), atLineStart());
    if (text === "") return;
    current().runs.push({ kind: "text", text, marks: [...open] });
  };

  while (index < value.length) {
    const next = value.indexOf("<", index);
    if (next === -1) {
      push(decodeEntities(value.slice(index)));
      break;
    }
    if (next > index) push(decodeEntities(value.slice(index, next)));

    const tag = readTag(value, next);
    if (!tag) {
      // A bare `<` that begins nothing is a character an Author typed.
      push("<");
      index = next + 1;
      continue;
    }
    index = tag.end;

    if (tag.name === "br") {
      // A break stands in for a held one, but not for a stretch's end.
      if (pending === "break") pending = undefined;
      current().runs.push({ kind: "break" });
      continue;
    }
    if (OPAQUE_TAGS.has(tag.name)) {
      if (!tag.closing && !tag.selfClosing)
        index = skipTo(value, tag.name, index);
      continue;
    }
    const listKind = LIST_TAGS[tag.name];
    if (lists && listKind !== undefined) {
      if (tag.selfClosing) continue;
      if (tag.closing) closeList();
      else openList(listKind);
      pending = "stretch";
      continue;
    }
    if (lists && tag.name === "li") {
      if (tag.selfClosing) continue;
      if (!tag.closing) {
        list ??= { list: "bullet" };
        items += 1;
      } else if (items > 0) {
        // A stray list stays open for the next stray item. A run outside any
        // item reads as a paragraph, which is what ends it.
        items -= 1;
      }
      pending = "stretch";
      continue;
    }
    if (BLOCK_TAGS.has(tag.name)) {
      // Either side of a paragraph is a boundary: `a<p>b</p>` is two of them.
      // Inside a list item, or without paragraphs, only the close counts, and
      // it is a line break.
      if (shape.paragraphs === true && container() === undefined) {
        pending = "stretch";
      } else if (tag.closing && pending === undefined) {
        pending = "break";
      }
      continue;
    }

    const kind = MARKS_BY_TAG[tag.name];
    if (kind === undefined) continue;

    if (tag.closing) {
      const at = open.findLastIndex((mark) => mark.kind === kind);
      if (at !== -1) open.splice(at, 1);
      continue;
    }
    if (tag.selfClosing) continue;

    if (kind === "link") {
      const written = tag.rawAttributes.find(([name]) => name === "href");
      const href = safeHref(written?.[1]);
      // A link that goes nowhere safe is not a link; its words stay.
      if (href !== undefined) open.push({ kind, href });
      continue;
    }
    open.push({ kind });
  }

  return flatten(groupStretches(stretches));
}

/**
 * Gather parsed stretches into paragraphs and lists, dropping every one with
 * no words in it. Items next to each other in the same list make one list.
 */
function groupStretches(raw: readonly RawStretch[]): readonly Stretch[] {
  const stretches: Stretch[] = [];
  let lastList: ParsedList | undefined;
  for (const stretch of raw) {
    const runs = tidyRuns(stretch.runs);
    if (runs.length === 0) continue;
    const last = stretches.at(-1);
    if (stretch.container === undefined) {
      stretches.push({ kind: "paragraph", runs });
      lastList = undefined;
    } else if (last?.kind === "list" && lastList === stretch.container) {
      stretches[stretches.length - 1] = {
        ...last,
        items: [...last.items, runs],
      };
    } else {
      stretches.push({
        kind: "list",
        list: stretch.container.list,
        items: [runs],
      });
      lastList = stretch.container;
    }
  }
  return stretches;
}

/** Write paragraphs and lists back out as the flat list. */
function flatten(stretches: readonly Stretch[]): readonly InlineNode[] {
  const nodes: InlineNode[] = [];
  stretches.forEach((stretch, at) => {
    if (stretch.kind === "paragraph") {
      if (at > 0 && stretches[at - 1]?.kind === "paragraph") {
        nodes.push({ kind: "paragraph" });
      }
      nodes.push(...stretch.runs);
      return;
    }
    nodes.push({ kind: "list", list: stretch.list });
    stretch.items.forEach((item, index) => {
      if (index > 0) nodes.push({ kind: "item" });
      nodes.push(...item);
    });
    nodes.push({ kind: "list-end" });
  });
  return nodes;
}

/**
 * Read the flat list back into paragraphs and lists.
 *
 * Forgiving, like the parse: an item boundary outside a list starts a
 * paragraph, and a list never closed ends with the text. Empty paragraphs,
 * items and lists are dropped, and so are the breaks at either end of each.
 * A list with no boundary in it is one paragraph, which is how a value stored
 * before its Block opted in reads afterwards.
 */
export function splitStretches(
  nodes: readonly InlineNode[],
  shape: TextShape = {},
): readonly Stretch[] {
  const raw: RawStretch[] = [];
  let list: ParsedList | undefined;
  const start = (container: Container): void => {
    raw.push({ container, runs: [] });
  };
  for (const node of nodes) {
    if (node.kind === "text" || node.kind === "break") {
      if (raw.length === 0) start(list);
      raw.at(-1)?.runs.push(node);
    } else if (node.kind === "list") {
      list = { list: node.list };
      start(list);
    } else if (node.kind === "list-end") {
      list = undefined;
      start(undefined);
    } else {
      start(list);
    }
  }
  const stretches = groupStretches(raw);
  // Text that does not hold lists writes each item as the paragraph it is.
  return shape.lists === true
    ? stretches
    : stretches.flatMap((stretch) =>
        stretch.kind === "list"
          ? stretch.items.map((runs) => ({ kind: "paragraph" as const, runs }))
          : [stretch],
      );
}

/**
 * Write runs back out as the string a Block stores.
 *
 * Marks nest in a fixed order and shared marks are kept open across adjacent
 * runs, so the output is both stable and the shape a person would have
 * written.
 */
export function serialiseInlineMarkup(
  nodes: readonly InlineNode[],
  shape: TextShape = {},
): string {
  const stretches = splitStretches(nodes, shape);
  if (shape.paragraphs !== true) {
    // One line: every stretch is joined to the next by a line break.
    return serialiseRuns(
      stretches
        .flatMap((stretch) =>
          stretch.kind === "paragraph" ? [stretch.runs] : stretch.items,
        )
        .flatMap((line, at) =>
          at === 0 ? line : [{ kind: "break" } as const, ...line],
        ),
    );
  }
  return stretches
    .map((stretch) => {
      if (stretch.kind === "paragraph") {
        return `<p>${serialiseRuns(stretch.runs)}</p>`;
      }
      const { tag } = LIST_MARKUP[stretch.list];
      const items = stretch.items
        .map((item) => `<li>${serialiseRuns(item)}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    })
    .join("");
}

/** Write one line of runs. */
function serialiseRuns(merged: readonly Run[]): string {
  let out = "";
  let open: readonly Mark[] = [];

  for (const node of merged) {
    if (node.kind !== "text") {
      out += "<br />";
      continue;
    }

    const wanted = orderMarks(node.marks);
    let shared = 0;
    while (
      shared < open.length &&
      shared < wanted.length &&
      sameMark(open[shared], wanted[shared])
    ) {
      shared += 1;
    }

    for (const mark of open.slice(shared).toReversed()) out += closeTag(mark);
    for (const mark of wanted.slice(shared)) out += openTag(mark);

    out += escapeText(node.text);
    open = wanted;
  }

  for (const mark of open.toReversed()) out += closeTag(mark);
  return out;
}

/**
 * Reduce arbitrary HTML to the supported subset.
 *
 * This is the paste path: whatever a word processor put on the clipboard
 * arrives here and leaves as text with, at most, formatting an email client
 * renders reliably. It is also idempotent, so storing an already-sanitised
 * value changes nothing.
 */
export function sanitiseInlineMarkup(
  value: unknown,
  shape: TextShape = {},
): string {
  return serialiseInlineMarkup(parseInlineMarkup(value, shape), shape);
}

/**
 * The first markup in this text that the subset would drop, in words: a tag
 * it does not hold, or a link to nowhere safe. None when every tag would be
 * kept.
 *
 * The strict half of the paste path. A sanitise forgives, which is right for
 * an Author's clipboard. An Agent is told instead, so it learns the subset
 * rather than having its markup vanish (ADR-0037). Comments are dropped
 * either way and carry nothing, so they pass.
 */
export function unsupportedMarkup(
  value: string,
  shape: TextShape = {},
): string | undefined {
  const lists = shape.paragraphs === true && shape.lists === true;
  const held = (name: string): boolean =>
    name === "" ||
    name === "br" ||
    MARKS_BY_TAG[name] !== undefined ||
    (shape.paragraphs === true && name === "p") ||
    (lists && (LIST_TAGS[name] !== undefined || name === "li"));

  for (let at = value.indexOf("<"); at !== -1; at = value.indexOf("<", at)) {
    const tag = readTag(value, at);
    if (!tag) {
      at += 1;
      continue;
    }
    if (!held(tag.name)) return `<${tag.name}>`;
    if (tag.name === "a" && !tag.closing) {
      const written = tag.rawAttributes.find(([name]) => name === "href");
      if (safeHref(written?.[1]) === undefined) {
        return `a link to "${decodeEntities(written?.[1] ?? "")}"`;
      }
    }
    at = tag.end;
  }
  return undefined;
}

export interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  /** Each attribute's value with its entities decoded. The first of a name wins. */
  readonly attributes: Readonly<Record<string, string>>;
  /**
   * Each attribute as written, in order: its value undecoded, or `undefined`
   * for one written without a value. What a cleaner that writes the tag back
   * out needs, so an entity it does not know survives as the Author wrote it.
   */
  readonly rawAttributes: readonly (readonly [
    name: string,
    value: string | undefined,
  ])[];
  /** Where the character after the tag is. */
  readonly end: number;
}

/**
 * Read one tag, comment or doctype starting at `<`.
 *
 * Attributes are read the way a browser reads them: a quoted value runs to its
 * closing quote, `>` included, and an unquoted one to whitespace or `>`. So the
 * tag ends where a browser would end it.
 */
export function readTag(value: string, start: number): Tag | undefined {
  if (value.startsWith("<!--", start)) {
    return blank(commentEnd(value, start) ?? value.length);
  }
  if (value.startsWith("<!", start) || value.startsWith("<?", start)) {
    const close = value.indexOf(">", start);
    return blank(close === -1 ? value.length : close + 1);
  }

  const match = /^<(?<slash>\/?)(?<name>[a-z][^\t\n\f\r />]*)/iu.exec(
    value.slice(start, start + 256),
  );
  const name = match?.groups?.["name"];
  if (!match || name === undefined) return undefined;

  const rawAttributes: [string, string | undefined][] = [];
  const attributes: Record<string, string> = {};
  let selfClosing = false;
  let index = start + match[0].length;
  let end = value.length;

  while (index < value.length) {
    index = skipSpace(value, index);
    const character = value[index];
    if (character === undefined) break;
    if (character === ">") {
      end = index + 1;
      break;
    }
    if (character === "/") {
      index += 1;
      if (value[index] === ">") {
        selfClosing = true;
        end = index + 1;
        break;
      }
      continue;
    }

    // A name runs to whitespace, `/`, `>` or `=`. A leading `=` is part of it.
    const nameStart = index;
    index += 1;
    while (
      index < value.length &&
      !/[\t\n\f\r />=]/u.test(value[index] ?? "")
    ) {
      index += 1;
    }
    const attribute = value.slice(nameStart, index).toLowerCase();

    let written: string | undefined;
    const afterName = skipSpace(value, index);
    if (value[afterName] === "=") {
      index = skipSpace(value, afterName + 1);
      const quote = value[index];
      if (quote === '"' || quote === "'") {
        const close = value.indexOf(quote, index + 1);
        written = value.slice(index + 1, close === -1 ? value.length : close);
        index = close === -1 ? value.length : close + 1;
      } else {
        const valueStart = index;
        while (
          index < value.length &&
          !/[\t\n\f\r >]/u.test(value[index] ?? "")
        ) {
          index += 1;
        }
        written = value.slice(valueStart, index);
      }
    }

    if (Object.hasOwn(attributes, attribute)) continue;
    rawAttributes.push([attribute, written]);
    attributes[attribute] = decodeEntities(written ?? "");
  }

  return {
    name: name.toLowerCase(),
    closing: match.groups?.["slash"] === "/",
    selfClosing,
    attributes,
    rawAttributes,
    end,
  };
}

function skipSpace(value: string, from: number): number {
  let index = from;
  while (/[\t\n\f\r ]/u.test(value[index] ?? "")) index += 1;
  return index;
}

/**
 * Where a comment that opens at `start` ends, the way a browser ends it, or
 * `undefined` if it never does.
 *
 * `<!-->` and `<!--->` are whole comments, and `--!>` closes one as well as
 * `-->` does. Reading either differently would let markup a browser sees as
 * live pass as part of a comment.
 */
export function commentEnd(value: string, start: number): number | undefined {
  const inside = start + 4;
  if (value.startsWith(">", inside)) return inside + 1;
  if (value.startsWith("->", inside)) return inside + 2;
  const ends = [value.indexOf("-->", inside), value.indexOf("--!>", inside)]
    .filter((at) => at !== -1)
    .map((at) => (value.startsWith("-->", at) ? at + 3 : at + 4));
  return ends.length === 0 ? undefined : Math.min(...ends);
}

/** A tag that means nothing — a comment or a doctype — and is simply skipped. */
function blank(end: number): Tag {
  return {
    name: "",
    closing: false,
    selfClosing: true,
    attributes: {},
    rawAttributes: [],
    end,
  };
}

/** Skip to just past the close of a tag whose content is not words. */
function skipTo(value: string, name: string, from: number): number {
  const close = value.toLowerCase().indexOf(`</${name}`, from);
  if (close === -1) return value.length;
  const end = value.indexOf(">", close);
  return end === -1 ? value.length : end + 1;
}

/**
 * Collapse runs of whitespace the way a browser lays text out.
 *
 * Whitespace that would begin a line is dropped, so the newlines and
 * indentation in pasted source do not become gaps in an email. Non-breaking
 * spaces are left alone: an Author who typed one meant it.
 */
function collapse(
  text: string,
  last: Run | undefined,
  atLineStart: boolean,
): string {
  const collapsed = text.replaceAll(/[\t\n\f\r ]+/gu, " ");
  const afterSpace = last?.kind === "text" && last.text.endsWith(" ");
  return (atLineStart || afterSpace) && collapsed.startsWith(" ")
    ? collapsed.slice(1)
    : collapsed;
}

/**
 * Fold adjacent runs that carry the same marks, drop empty ones, and drop the
 * breaks at either end of the line.
 *
 * A line holding only breaks comes to nothing, and is dropped by its caller —
 * an empty paragraph is a gap no one can size (ADR-0023).
 */
function tidyRuns(runs: readonly Run[]): Run[] {
  const merged: Run[] = [];
  for (const run of runs) {
    if (run.kind === "text" && run.text === "") continue;
    const last = merged.at(-1);
    if (run.kind === "break" && last === undefined) continue;
    if (
      run.kind === "text" &&
      last?.kind === "text" &&
      sameMarks(last.marks, run.marks)
    ) {
      merged[merged.length - 1] = { ...last, text: last.text + run.text };
      continue;
    }
    merged.push(run);
  }
  while (merged.at(-1)?.kind === "break") merged.pop();
  return merged;
}

/**
 * Marks in the order they nest, outermost first.
 *
 * Shared by serialisation and rendering, so the stored string and the markup
 * an email carries agree about which tag wraps which.
 */
export function orderMarks(marks: readonly Mark[]): readonly Mark[] {
  return marks.toSorted(
    (a, b) => MARK_ORDER.indexOf(a.kind) - MARK_ORDER.indexOf(b.kind),
  );
}

function sameMark(a: Mark | undefined, b: Mark | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "link") return b.kind === "link" && a.href === b.href;
  return true;
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  const left = orderMarks(a);
  const right = orderMarks(b);
  return (
    left.length === right.length &&
    left.every((mark, at) => sameMark(mark, right[at]))
  );
}

function openTag(mark: Mark): string {
  const element = MARK_ELEMENTS[mark.kind];
  return mark.kind === "link"
    ? `<${element} href="${escapeAttribute(mark.href)}">`
    : `<${element}>`;
}

function closeTag(mark: Mark): string {
  return `</${MARK_ELEMENTS[mark.kind]}>`;
}

/**
 * A link's destination, or `undefined` if it is one an email must not carry.
 *
 * Decoded the way a browser decodes it, and kept that way: what is stored is
 * what the browser would have followed, so the check and the link can never
 * disagree.
 */
function safeHref(written: string | undefined): string | undefined {
  const href = decodeEntities(written ?? "").trim();
  return href !== "" && isSafeUrl(href) ? href : undefined;
}
