import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The public surface, pinned — and documented.
 *
 * Every name below is a promise to somebody outside this repo, and every one
 * of them has to appear on one of its entry point's Reference pages. Two checks keep
 * that true, and they fail for different reasons:
 *
 *   - The snapshot means adding, renaming or removing an export cannot happen
 *     quietly. The diff is the list of pages that now need editing.
 *   - The documentation check means the editing actually happened. It reads
 *     the pages and names what is missing.
 *
 * The second exists because the first is only a reminder, and reminders lose.
 * Twenty-four names on `lekh-editor` and twenty-six on what was then `lekh/render`
 * had drifted out of the pages before it was written.
 *
 * When the snapshot fails, the fix is two steps, in this order:
 *
 *   1. Update `apps/docs/src/content/docs/reference/<page>.mdx`.
 *   2. Re-run with `-u` to accept the new surface.
 *
 * Read from `dist/` rather than from source: tsdown flattens every re-export
 * into one explicit list, which is exactly the set a Consumer can import.
 * Source would have to be parsed and resolved to say the same thing.
 */

/** One entry point, under the three names it goes by. */
interface EntryPoint {
  /** The file the bundler emits, and so the declaration this test reads. */
  readonly name: string;
  /** The import path a Consumer writes. */
  readonly importPath: string;
  /**
   * The Reference pages documenting it.
   *
   * Pages are by topic, not by import path, so one entry point may span
   * several: `lekh-editor` carries the editor, the render path, the Validators and
   * the Agent tools, and each has a page of its own.
   */
  readonly pages: readonly string[];
}

const ENTRY_POINTS: readonly EntryPoint[] = [
  {
    name: "index",
    importPath: "lekh-editor",
    pages: ["lekh", "render", "validators", "agent"],
  },
  { name: "canvas", importPath: "lekh-editor/canvas", pages: ["canvas"] },
  {
    name: "blocks",
    importPath: "lekh-editor/blocks",
    pages: ["blocks", "compliance"],
  },
  { name: "tiptap", importPath: "lekh-editor/tiptap", pages: ["tiptap"] },
];

const referencePagesOf = (entry: EntryPoint): string =>
  entry.pages
    .map((page) => {
      const path = fileURLToPath(
        new URL(
          `../../../apps/docs/src/content/docs/reference/${page}.mdx`,
          import.meta.url,
        ),
      );
      try {
        return readFileSync(path, "utf8");
      } catch {
        throw new Error(`${path} is missing.`);
      }
    })
    .join("\n");

const declarationOf = (entry: string): string => {
  const path = fileURLToPath(new URL(`../dist/${entry}.d.ts`, import.meta.url));
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `${path} is missing. This test reads the built declarations — run \`pnpm --filter lekh-editor build\` first.`,
    );
  }
};

/**
 * The body of an interface, wherever the bundler put it.
 *
 * Every declaration file, because the bundler puts a type shared by two entry
 * points in a chunk of its own.
 */
const interfaceBody = (name: string): string => {
  const declarations = readdirSync(
    fileURLToPath(new URL("../dist/", import.meta.url)),
  )
    .filter((file) => file.endsWith(".d.ts"))
    .map((file) => declarationOf(file.replace(/\.d\.ts$/u, "")))
    .join("\n");
  const body = new RegExp(
    String.raw`interface ${name} \{([\s\S]*?)\n\}`,
    "u",
  ).exec(declarations)?.[1];
  if (body === undefined) throw new Error(`${name} is not declared.`);
  return body;
};

/**
 * The names one entry point offers, sorted and with `type` markers dropped.
 *
 * A Consumer cannot tell a type export from a value export at the import site,
 * and both are equally breaking to remove, so both are pinned the same way.
 */
const exportedNames = (declaration: string): readonly string[] => {
  const statements = declaration.matchAll(/^export \{([\s\S]*?)\};$/gmu);
  const names = new Set<string>();

  for (const [, body] of statements) {
    for (const specifier of (body ?? "").split(",")) {
      const trimmed = specifier.trim().replace(/^type\s+/u, "");
      if (!trimmed) continue;
      // `X as Y` is published as Y.
      const renamed = trimmed.split(/\s+as\s+/u).at(-1);
      if (renamed !== undefined && renamed !== "") names.add(renamed);
    }
  }

  return [...names].toSorted((a, b) => a.localeCompare(b));
};

describe("public API", () => {
  for (const entry of ENTRY_POINTS) {
    const { importPath } = entry;

    it(`${importPath} exports a pinned set of names`, () => {
      expect(exportedNames(declarationOf(entry.name))).toMatchSnapshot();
    });

    it(`${importPath} documents every name it exports`, () => {
      const page = referencePagesOf(entry);

      // Whole word, so `Repair` is not counted as documented because
      // `ConsumerRepair` happens to be on the page.
      const undocumented = exportedNames(declarationOf(entry.name)).filter(
        (name) => !new RegExp(String.raw`\b${name}\b`, "u").test(page),
      );

      expect(
        undocumented,
        `${undocumented.length} name(s) exported by ${importPath} appear on none of its Reference pages. Document them, or list them under "Everything this entry point exports".`,
      ).toEqual([]);
    });
  }

  // A Slot is a name a Consumer writes as a key, so dropping one breaks them
  // as surely as dropping an export — and the export list cannot see it,
  // because `CanvasSlots` itself is still there.
  it("lekh-editor/canvas offers a pinned set of Slots", () => {
    const body = /interface CanvasSlots \{([\s\S]*?)\n\}/u.exec(
      declarationOf("canvas"),
    )?.[1];
    if (body === undefined) throw new Error("CanvasSlots is not declared.");

    // Every member, optional or not, so a Slot made required still shows.
    const slots = [...body.matchAll(/^\s*(?:readonly\s+)?(\w+)\??:/gmu)]
      .flatMap(([, name]) => name ?? [])
      .toSorted((a, b) => a.localeCompare(b));

    expect(slots).toMatchSnapshot();
  });

  // A Consumer calls these on every control they render, so dropping one
  // breaks them as surely as dropping an export.
  it("lekh offers a pinned set of Control Descriptor fields", () => {
    // Fields sit at one indent. Deeper lines are inside a field's own type.
    const fields = [
      ...interfaceBody("ControlDescriptor").matchAll(
        /^ {2}(?:readonly\s+)?(\w+)\??:/gmu,
      ),
    ]
      .flatMap(([, name]) => name ?? [])
      .toSorted((a, b) => a.localeCompare(b));

    expect(fields).toMatchSnapshot();
  });

  // The Editor is what a Consumer calls most, so renaming one of its methods
  // breaks them as surely as renaming an export.
  it("lekh offers a pinned set of Editor methods", () => {
    // Members sit at one indent. Deeper lines are inside a parameter's type.
    const methods = [
      ...interfaceBody("Editor").matchAll(
        /^ {2}(?:readonly\s+)?(\w+)\??[(<:]/gmu,
      ),
    ]
      .flatMap(([, name]) => name ?? [])
      .toSorted((a, b) => a.localeCompare(b));

    expect(methods).toMatchSnapshot();
  });

  it("pins every entry point the package declares", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    );

    const exported =
      typeof manifest === "object" && manifest !== null && "exports" in manifest
        ? manifest.exports
        : undefined;

    if (typeof exported !== "object" || exported === null) {
      throw new TypeError("package.json declares no exports map.");
    }

    const declared = Object.keys(exported)
      .filter((path) => path !== "./package.json")
      .map((path) =>
        path
          .replace(/^\.\/?/u, "lekh-editor/")
          .replace(/^lekh-editor\/$/u, "lekh-editor"),
      )
      .toSorted((a, b) => a.localeCompare(b));

    expect(declared).toEqual(
      ENTRY_POINTS.map(({ importPath }) => importPath).toSorted((a, b) =>
        a.localeCompare(b),
      ),
    );
  });
});
