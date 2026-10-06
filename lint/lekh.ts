// lekh's own oxlint rules, loaded through `jsPlugins` in .oxlintrc.json.

import path from "node:path";

// Just the parts of oxlint's plugin API this file uses. oxlint doesn't export
// its own types for a plugin yet.
interface Source {
  readonly type: string;
  readonly value?: unknown;
}

interface WithSource {
  readonly source?: Source | null;
}

// `vi.mock("./x")` and its kin name a module the same way an import does.
interface Call {
  readonly callee: {
    readonly type: string;
    readonly object?: { readonly type: string; readonly name?: string };
    readonly property?: { readonly type: string; readonly name?: string };
  };
  readonly arguments: readonly Source[];
}

const viModuleMethods = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

interface Options {
  readonly src: string;
  readonly harness: string;
  readonly entryPoints: readonly string[];
}

interface Context {
  readonly filename: string;
  readonly options: readonly [Options?];
  report(problem: {
    node: Source;
    messageId: string;
    data: Record<string, string>;
  }): void;
}

const root = path.dirname(import.meta.dirname);

const withoutExtension = (file: string): string =>
  file.replace(/\.[cm]?[jt]sx?$/u, "");

/**
 * A test reaches lekh only through an entry point or the test harness, so
 * moving code inside lekh breaks only the tests about that code. A
 * `*.unit.test.ts(x)` file may also import the one module it is named after.
 * The harness itself is held to the same rule, so it could ship as a public
 * entry point later.
 *
 * Options: `src` is the source folder, `harness` the harness folder and
 * `entryPoints` the entry files, all relative to the repo root.
 */
const testImports = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          src: { type: "string" },
          harness: { type: "string" },
          entryPoints: { type: "array", items: { type: "string" } },
        },
        required: ["src", "harness", "entryPoints"],
        additionalProperties: false,
      },
    ],
    messages: {
      internal:
        "A test imports only entry points ({{entryPoints}}) and the harness ({{harness}}). " +
        "`{{specifier}}` is internal. A `.unit.test` file may also import its own module.",
    },
  },
  create(context: Context) {
    const options = context.options[0];
    if (options === undefined) return {};
    const src = path.join(root, options.src);
    const harness = path.join(root, options.harness);
    const entryPoints = new Set(
      options.entryPoints.map((entry) =>
        withoutExtension(path.join(root, entry)),
      ),
    );

    const file = context.filename;
    const unit = /\.unit\.test\.[cm]?[jt]sx?$/u.exec(file);
    const ownModule = unit ? file.slice(0, unit.index) : undefined;

    const check = ({ source }: WithSource): void => {
      if (source?.type !== "Literal" || typeof source.value !== "string") {
        return;
      }
      const specifier = source.value;
      if (!specifier.startsWith(".")) return;

      const target = withoutExtension(
        path.resolve(path.dirname(file), specifier),
      );
      const inside = (folder: string): boolean =>
        target.startsWith(folder + path.sep);
      if (!inside(src)) return;
      if (entryPoints.has(target) || inside(harness) || target === ownModule) {
        return;
      }

      context.report({
        node: source,
        messageId: "internal",
        data: {
          specifier,
          entryPoints: [...entryPoints]
            .map((entry) => path.relative(src, entry))
            .join(", "),
          harness: path.relative(src, harness),
        },
      });
    };

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
      CallExpression: ({ callee, arguments: [first] }: Call) => {
        if (
          callee.type === "MemberExpression" &&
          callee.object?.type === "Identifier" &&
          callee.object.name === "vi" &&
          callee.property?.type === "Identifier" &&
          viModuleMethods.has(callee.property.name ?? "")
        ) {
          check({ source: first });
        }
      },
    };
  },
};

export default {
  meta: { name: "lekh" },
  rules: { "test-imports": testImports },
};
