/**
 * Email HTML as plain text, for a model to read back what it wrote.
 *
 * Not a send-quality converter: lekh ships none (`renderDocument`). It keeps
 * the words, breaks lines where blocks end, spells out a link's address, and
 * drops the head, comments and Outlook's conditional sections. The preview
 * text stays, first, as an inbox shows it. Pure string work, so it runs with
 * no DOM.
 */
export function plainTextOf(html: string): string {
  const text = html
    .replaceAll(/<!--[\s\S]*?-->/gu, "")
    .replaceAll(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/giu, "")
    .replaceAll(
      /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/giu,
      (
        _,
        double: string | undefined,
        single: string | undefined,
        inner: string,
      ) => linkText(double ?? single ?? "", inner),
    )
    .replaceAll(/<br\b[^>]*>/giu, "\n")
    .replaceAll(/<li\b[^>]*>/giu, "\n- ")
    .replaceAll(
      /<\/?(?:p|div|h[1-6]|table|tr|td|th|ul|ol|blockquote|hr|body)\b[^>]*>/giu,
      "\n\n",
    )
    .replaceAll(/<\/li\s*>/giu, "")
    .replaceAll(/<[^>]*>/gu, "");

  return (
    decode(text)
      // What pads the preview text out, and other marks nobody reads.
      .replaceAll(/[\u200B-\u200F\u2060\uFEFF\u00AD]|\u034F/gu, "")
      .replaceAll("\u00A0", " ")
      .split("\n")
      .map((line) => line.replaceAll(/[ \t\r\f\v]+/gu, " ").trim())
      .join("\n")
      .replaceAll(/\n{3,}/gu, "\n\n")
      .trim()
  );
}

/** A link's words, and where it goes when the words do not say. */
function linkText(href: string, inner: string): string {
  const words = decode(inner.replaceAll(/<[^>]*>/gu, "")).trim();
  const to = decode(href).trim();
  if (to === "" || to.startsWith("#") || words === to) return inner;
  if (words === "") return href;
  return `${inner} (${href})`;
}

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
};

/** HTML character references, the few that email markup carries. */
function decode(text: string): string {
  return text.replaceAll(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu,
    (match, name: string) => {
      if (name.startsWith("#")) {
        // `Number` reads "0x41" as hex and "65" as decimal.
        const code = Number(
          name[1] === "x" || name[1] === "X"
            ? `0${name.slice(1)}`
            : name.slice(1),
        );
        return code >= 0 && code <= 0x10_ff_ff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED[name.toLowerCase()] ?? match;
    },
  );
}
