import { isBlank } from "./blank";

/**
 * What is wrong with a link an Author wrote, and the link they meant where it
 * can be told.
 */
export type LinkProblem =
  | { readonly kind: "empty" }
  | { readonly kind: "no-scheme" | "bad-scheme"; readonly fixed: string };

/**
 * A link that would not take a reader anywhere, or not where it was meant to.
 *
 * Only the mistakes that can be told from a typo are judged. Anything the
 * render path drops for safety is `url-unsafe`'s to report (ADR-0033), so a
 * scheme that is not a near miss of `http` is left alone here, and `mailto:`,
 * `tel:`, a relative link and a merge tag pass. A blank value is no link at
 * all, which only the Block knows whether to mind: an image needs none, and a
 * button says so itself.
 */
export function linkProblem(value: string): LinkProblem | undefined {
  if (isBlank(value)) return undefined;
  const link = value.trim();
  if (link === "#") return { kind: "empty" };

  // Before a scheme is looked for, since `example.com:8080` reads as one.
  if (isHost(link)) return { kind: "no-scheme", fixed: `https://${link}` };

  const scheme = /^([a-z][a-z\d+.-]*):([\s/\\:]*)(.*)$/isu.exec(link);
  if (scheme) {
    const [, name = "", slashes, rest = ""] = scheme;
    const lower = name.toLowerCase();
    const web = isWeb(lower);
    if (!web && !isNearWeb(lower)) {
      return rest === "" && (lower === "mailto" || lower === "tel")
        ? { kind: "empty" }
        : undefined;
    }
    if (rest === "" || rest === "#") return { kind: "empty" };
    // `https://https://example.com`: pasted over a field that had it already.
    const doubled = /^https?:\/\/(.+)$/isu.exec(rest);
    if (doubled) return badScheme(doubled[1] ?? "");
    return web && slashes === "//" ? undefined : badScheme(rest);
  }

  // `https//example.com` and `https;//example.com`: the colon went astray.
  const colonless = /^https?[;.,]?[/\\]{2,}(.*)$/isu.exec(link);
  if (colonless) {
    const [, rest = ""] = colonless;
    return rest === "" ? { kind: "empty" } : badScheme(rest);
  }

  return undefined;
}

/** A host name, maybe with a port, then the end or the rest of a link. */
const HOST =
  /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+([a-z]{2,})(?::\d+)?(?:[/?#]|$)/iu;

/**
 * Endings that make `terms.html` a file beside the page rather than a site.
 * None is a top-level domain anyone sends email from.
 */
const FILE_ENDINGS = new Set([
  "htm",
  "html",
  "php",
  "asp",
  "aspx",
  "jsp",
  "js",
  "css",
  "json",
  "xml",
  "txt",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "map",
]);

/** Whether a link with no scheme starts with what can only be a site. */
function isHost(link: string): boolean {
  const ending = HOST.exec(link)?.[1];
  return ending !== undefined && !FILE_ENDINGS.has(ending.toLowerCase());
}

/** The link meant, from what follows a broken scheme and its slashes. */
function badScheme(rest: string): LinkProblem {
  return { kind: "bad-scheme", fixed: `https://${rest}` };
}

function isWeb(scheme: string): boolean {
  return scheme === "http" || scheme === "https";
}

/** One slip of the keyboard from `http` or `https`. */
function isNearWeb(scheme: string): boolean {
  return (
    editDistance(scheme, "http") <= 1 || editDistance(scheme, "https") <= 1
  );
}

/**
 * Edits from one word to another, a swap of two neighbours counting as one,
 * so `httsp` is one slip from `https` rather than two.
 */
function editDistance(from: string, to: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= from.length; i++) {
    const row: number[] = [];
    for (let j = 0; j <= to.length; j++) {
      if (i === 0 || j === 0) {
        row.push(i + j);
        continue;
      }
      const cost = from[i - 1] === to[j - 1] ? 0 : 1;
      let best = Math.min(
        (rows[i - 1]?.[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (rows[i - 1]?.[j - 1] ?? 0) + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        from[i - 1] === to[j - 2] &&
        from[i - 2] === to[j - 1]
      ) {
        best = Math.min(best, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
      row.push(best);
    }
    rows.push(row);
  }
  return rows[from.length]?.[to.length] ?? 0;
}
