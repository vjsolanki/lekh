import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import manifest from "../package.json" with { type: "json" };
import budgets from "../size-budget.json" with { type: "json" };

// Two numbers matter, and they are not the same number.
//
// `own` is lekh's own code with every package left external: what the library
// itself weighs. `shipped` folds in the runtime dependencies a Consumer never
// asked for and cannot drop — today only @dnd-kit, reached through
// lekh/canvas — while still leaving the peer dependencies out, because React
// is already in the bundle and react.email and Tiptap are the Consumer's own
// choice. Only `shipped` is held to a budget: it is the bill.
//
// Bundled here rather than read off dist/, because dist/ is unminified and
// split into shared chunks. Neither number would survive the question "what
// does importing this actually cost me".

type Measurement = { readonly own: number; readonly shipped: number };

type Report = Record<string, Measurement>;

const packageRoot = join(import.meta.dirname, "..");

// size-budget.json is imported rather than parsed, so its shape is checked by
// the compiler instead of trusted at runtime: the most gzipped bytes each
// entry point may cost. Read through a Map, because an entry point name is a
// plain string and the imported literal carries no index signature.
const budget = new Map<string, number>(Object.entries(budgets));
const peerNames = Object.keys(manifest.peerDependencies);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMeasurement = (value: unknown): value is Measurement =>
  isRecord(value) &&
  typeof value["own"] === "number" &&
  typeof value["shipped"] === "number";

// The baseline a change is compared against: this script's own --report, run
// by CI against the base commit. That makes it a file this
// script is handed rather than one it can import, so its shape is a runtime
// question. A malformed or half-written baseline reads as no baseline at all:
// every entry point shows as new, which is honest, where throwing would fail
// a pull request over a file the author never touched.
function readBaseline(path: string | undefined): Map<string, Measurement> {
  if (path === undefined || !existsSync(path)) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return new Map();
  }
  if (!isRecord(parsed)) return new Map();
  const measurements = new Map<string, Measurement>();
  for (const [name, value] of Object.entries(parsed)) {
    if (isMeasurement(value)) measurements.set(name, value);
  }
  return measurements;
}

/**
 * What is measured: a file, or an app written here that imports one.
 *
 * `source`, when set, is that app. It is bundled in place of `file`, so an
 * import of `file` in it is what tree-shaking starts from.
 */
type Entry = {
  readonly name: string;
  readonly file: string;
  readonly source?: string;
};

// The entry points are read from the exports map rather than listed again, so
// a new entry point is measured the moment it is published.
const entryPoints: readonly Entry[] = Object.entries(manifest.exports).flatMap(
  ([subpath, target]) => {
    if (subpath === "./package.json" || typeof target === "string") return [];
    const name = subpath === "." ? "lekh" : `lekh/${subpath.slice(2)}`;
    return [{ name, file: join(packageRoot, target.default) }];
  },
);

// Two imports smaller than a whole entry point. Neither has a budget or a
// badge. They are there so the number is on every pull request, and a change
// that quietly breaks tree-shaking shows up as a jump.
//
// What a Consumer saves by picking Blocks rather than taking them all: a
// typical short list. And a send pipeline, which imports the render path from
// `lekh` and must not bundle the editor that sits beside it (ADR-0045).
const blocksFile = join(packageRoot, manifest.exports["./blocks"].default);
const baseFile = join(packageRoot, manifest.exports["."].default);
const picked = ["headingBlock", "textBlock", "imageBlock", "buttonBlock"];
const scenarios: readonly Entry[] = [
  {
    name: "lekh/blocks, four Blocks picked",
    file: blocksFile,
    source:
      `import { pickReactEmailPreset, ${picked.join(", ")} } from ${JSON.stringify(blocksFile)};\n` +
      `export default pickReactEmailPreset([${picked.join(", ")}]);\n`,
  },
  {
    name: "lekh, the render path alone",
    file: baseFile,
    source: `export { renderDocument, toHtml } from ${JSON.stringify(baseFile)};\n`,
  },
];

const entries = [...entryPoints, ...scenarios];

const isBuiltin = (id: string) => id.startsWith("node:");
const isPackage = (id: string) => !id.startsWith(".") && !id.startsWith("/");
const isPeer = (id: string) =>
  peerNames.some((peer) => id === peer || id.startsWith(`${peer}/`));

// The id a scenario's app is bundled under. The leading NUL marks it as a
// module no file backs, as the plugin convention has it.
const APP = "\0app";

async function bundledSize(
  entry: Entry,
  external: (id: string) => boolean,
): Promise<number> {
  const { source } = entry;
  const bundle = await rolldown({
    input: source === undefined ? entry.file : APP,
    external: (id) => id !== APP && external(id),
    platform: "neutral",
    logLevel: "silent",
    plugins:
      source === undefined
        ? []
        : [
            {
              name: "app",
              resolveId: (id) => (id === APP ? id : null),
              load: (id) => (id === APP ? source : null),
            },
          ],
  });
  const { output } = await bundle.generate({ format: "esm", minify: true });
  await bundle.close();

  const code = output
    .filter((chunk) => chunk.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
  return gzipSync(code, { level: 9 }).byteLength;
}

async function measure(): Promise<Report> {
  const report: Report = {};
  for (const entry of entries) {
    report[entry.name] = {
      own: await bundledSize(entry, isPackage),
      shipped: await bundledSize(
        entry,
        (id) => isBuiltin(id) || (isPackage(id) && isPeer(id)),
      ),
    };
  }
  return report;
}

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

const delta = (now: number, before: number | undefined) => {
  if (before === undefined) return "new";
  const difference = now - before;
  if (difference === 0) return "—";
  return `${difference > 0 ? "+" : "−"}${kB(Math.abs(difference))}`;
};

function humanTable(report: Report): string {
  const rows = entries.map((entry) => {
    const size = report[entry.name];
    const limit = budget.get(entry.name);
    return [
      entry.name,
      size ? kB(size.own) : "",
      size ? kB(size.shipped) : "",
      limit === undefined ? "" : kB(limit),
    ];
  });
  const header = ["Import", "lekh's code", "In your bundle", "Budget"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column] ?? 0)
          : cell.padStart(widths[column] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map((row) => line(row))].join("\n");
}

// Padded to the widest cell in each column, so the table is readable as plain
// text in the job summary as well as rendered in the pull request comment.
function markdownTable(rows: readonly (readonly string[])[]): string {
  const widths =
    rows[0]?.map((_, column) =>
      Math.max(...rows.map((row) => (row[column] ?? "").length)),
    ) ?? [];
  const render = (cells: readonly string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ")} |`;
  const [header, ...body] = rows;
  if (!header) return "";
  return [
    render(header),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...body.map((row) => render(row)),
  ].join("\n");
}

const commentTable = (report: Report) =>
  markdownTable([
    ["Import", "In your bundle", "Change", "Budget"],
    ...entries.map((entry) => {
      const size = report[entry.name];
      if (!size) return [`\`${entry.name}\``, "—", "—", "—"];
      const limit = budget.get(entry.name);
      const over = limit !== undefined && size.shipped > limit;
      return [
        `\`${entry.name}\``,
        `${kB(size.shipped)}${over ? " ⚠️" : ""}`,
        delta(size.shipped, previous.get(entry.name)?.shipped),
        limit === undefined ? "—" : kB(limit),
      ];
    }),
  ]);

// A shields.io endpoint badge per entry point, keyed by file name. The page
// points an <img> at the JSON, so the number changes without the page
// changing. Colour tracks the budget, because a badge nobody has to read is
// worth more than one nobody trusts.
//
// These are served from a public Gist rather than from this repository, which
// is private: shields.io fetches anonymously, and cannot read a private repo.
function badgeFiles(report: Report): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of entryPoints) {
    const size = report[entry.name];
    if (!size) continue;
    const limit = budget.get(entry.name);
    const used = limit === undefined ? 0 : size.shipped / limit;
    const badge = {
      schemaVersion: 1,
      label: entry.name,
      message: kB(size.shipped),
      color: used > 1 ? "red" : used > 0.9 ? "yellow" : "brightgreen",
    };
    const slug = entry.name.replace("/", "-");
    files.set(`${slug}.json`, `${JSON.stringify(badge, null, 2)}\n`);
  }
  return files;
}

// The body of a PATCH to the Gists API, which replaces the named files and
// leaves any other file in the Gist alone.
const gistPayload = (report: Report) =>
  JSON.stringify({
    files: Object.fromEntries(
      [...badgeFiles(report)].map(([name, content]) => [name, { content }]),
    ),
  });

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    markdown: { type: "boolean", default: false },
    baseline: { type: "string" },
    report: { type: "string" },
    badges: { type: "string" },
    "gist-payload": { type: "string" },
  },
});

const previous = readBaseline(values.baseline);

const missing = entryPoints.filter((entry) => !existsSync(entry.file));
if (missing.length > 0) {
  console.error(
    `dist/ is missing ${missing.map((entry) => entry.name).join(", ")}. Run \`pnpm --filter lekh build\` first.`,
  );
  process.exit(1);
}

const report = await measure();

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else if (values.markdown) {
  console.log(commentTable(report));
} else {
  console.log(humanTable(report));
}

if (values.report !== undefined) {
  mkdirSync(dirname(values.report), { recursive: true });
  writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`);
}

if (values.badges !== undefined) {
  mkdirSync(values.badges, { recursive: true });
  for (const [name, content] of badgeFiles(report)) {
    writeFileSync(join(values.badges, name), content);
  }
}

const payloadPath = values["gist-payload"];
if (payloadPath !== undefined) {
  mkdirSync(dirname(payloadPath), { recursive: true });
  writeFileSync(payloadPath, gistPayload(report));
}

if (values.check) {
  const over = entries.flatMap((entry) => {
    const size = report[entry.name]?.shipped;
    const limit = budget.get(entry.name);
    if (size === undefined || limit === undefined || size <= limit) return [];
    return [`${entry.name}: ${kB(size)} over a budget of ${kB(limit)}`];
  });
  if (over.length > 0) {
    console.error(
      `\nOver budget:\n${over.map((line) => `  ${line}`).join("\n")}\n\nEither make it smaller or raise the limit in packages/lekh/size-budget.json, deliberately.`,
    );
    process.exit(1);
  }
}
