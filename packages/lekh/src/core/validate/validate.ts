import { assetOf } from "../document/assets";
import { SchemaKind } from "../document/definition";
import {
  DiagnosticCode,
  type Diagnostic,
  type SeverityOverrides,
  type ValidationContext,
  type Validator,
} from "./diagnostic";
import type { Block, EmailDocument } from "../document/document";
import { htmlDiagnostics } from "../markup/html";
import { safeUrl } from "../markup/markup-safety";
import { rootPropsOf } from "../document/props";
import { overrideOf } from "../layout/responsive";
import type { Registry } from "../document/registry";
import type { RestoreRequiredBlockRepair, SetPropRepair } from "./repair";
import { collectBlocks } from "../document/tree";

export interface CollectDiagnosticsOptions {
  readonly registry: Registry;
  readonly validators?: readonly Validator[];
  readonly severities?: SeverityOverrides;
}

/**
 * Everything wrong with a Document, from all three sources, on one channel:
 * built-in checks (an `"html"` prop's markup among them), each Block
 * Definition's own `validate`, and the Validators a Consumer supplied at
 * construction.
 *
 * Nothing here needs an editor, which is what lets the render path reach it
 * without dragging the store behind: a Repair is described here and carried
 * out by `Editor.applyRepair` (ADR-0015).
 */
export function collectDiagnostics(
  document: EmailDocument,
  options: CollectDiagnosticsOptions,
): readonly Diagnostic[] {
  const { registry, validators = [], severities = {} } = options;
  const context: ValidationContext = {
    getDefinition: (type) => registry.get(type),
    definitions: registry.all,
    rootProps: rootPropsOf(document.root, (type) => registry.get(type)),
  };

  const found: Diagnostic[] = [
    ...findUnregistered(document.root, registry).map((block) => ({
      code: DiagnosticCode.blockUnregistered,
      message: `No Block Definition is registered for the type "${block.type}".`,
      severity: "error" as const,
      blockId: block.id,
    })),
    ...missingRequiredBlocks(document, registry),
    ...wrongShapes(document, registry),
    ...unsafeUrls(document, registry),
    ...htmlDiagnostics(document, context),
  ];

  for (const block of collectBlocks(document.root)) {
    const definition = registry.get(block.type);
    if (definition?.validate) {
      found.push(...definition.validate(block, context));
    }
  }

  for (const validator of validators) {
    found.push(...validator(document, context));
  }

  return found.map((diagnostic) => {
    // Escalation only: an error may never be softened into a warning, or the
    // render path's refusal becomes opt-out (ADR-0006).
    return severities[diagnostic.code] === "error" &&
      diagnostic.severity === "warning"
      ? { ...diagnostic, severity: "error" as const }
      : diagnostic;
  });
}

/**
 * Every Block whose type no Block Definition claims, in Document order.
 *
 * One scan with two readers, which is what stops them disagreeing about what
 * is unregistered: this list becomes the Diagnostics above, and it is what the
 * render path refuses on. The render path takes the first of them, which is
 * the one an Author would find first — the recursion underneath it would
 * report the innermost, because a Block's children render before it does.
 */
export function findUnregistered(
  root: Block,
  registry: Registry,
): readonly Block[] {
  return collectBlocks(root).filter((block) => !registry.has(block.type));
}

function missingRequiredBlocks(
  document: EmailDocument,
  registry: Registry,
): readonly Diagnostic[] {
  if (registry.required.length === 0) return [];

  const present = new Set(
    collectBlocks(document.root).map((block) => block.type),
  );

  return registry.required
    .filter((definition) => !present.has(definition.type))
    .map((definition) => {
      // Annotated as the member it is, not as `Repair`: the open kind that
      // lets a Consumer describe their own costs the union its
      // construction-time checking, and this is where it is wanted back.
      const repair: RestoreRequiredBlockRepair = {
        kind: "restore-required-block",
        type: definition.type,
      };
      return {
        code: DiagnosticCode.requiredBlockMissing,
        message: `This email is missing its "${definition.label}".`,
        severity: "error" as const,
        repair,
      };
    });
}

/**
 * Every stored prop whose value is not the shape its Schema kind says.
 *
 * A Document comes from storage, a peer's Ops or a paste as often as from an
 * Inspector, and `setProp` stores whatever it is handed. A Definition's
 * `render` trusts the shape, so one wrong value would throw deep inside it,
 * with nothing said beforehand. As an error here, the render path refuses
 * with a reason instead (#119).
 *
 * Only the kinds the library names are judged. A kind is an open string
 * (ADR-0002), and a Consumer's own kind means whatever they say it does.
 * Unset is never wrong: it resolves to the default.
 */
function wrongShapes(
  document: EmailDocument,
  registry: Registry,
): readonly Diagnostic[] {
  return propFindings(document, registry, {
    code: DiagnosticCode.propWrongShape,
    message: (label) => `"${label}" holds a value of the wrong shape.`,
    isWrong: (kind, value) => hasShape(kind, value) === false,
  });
}

/**
 * Every stored `"url"` prop the render path would leave out (ADR-0033).
 *
 * Judged by `safeUrl`, the very check the render path makes, so a stored link
 * is reported exactly when it would be dropped. A Schema default is the
 * Definition's own and is not judged, the same as every other check here. A
 * value of the wrong shape is left to {@link wrongShapes}, so one bad value is
 * one finding.
 */
function unsafeUrls(
  document: EmailDocument,
  registry: Registry,
): readonly Diagnostic[] {
  return propFindings(document, registry, {
    code: DiagnosticCode.urlUnsafe,
    message: (label) =>
      `"${label}" holds a link an email may not carry, so it is left out.`,
    isWrong: (kind, value) =>
      kind === SchemaKind.url &&
      typeof value === "string" &&
      safeUrl(value) !== value,
  });
}

/** One kind of stored prop value that is wrong, and how to report it. */
interface PropCheck {
  readonly code: string;
  readonly message: (label: string) => string;
  readonly isWrong: (kind: string, value: unknown) => boolean;
}

/**
 * An error for every stored prop the check finds wrong, naming the prop, with
 * a Repair that unsets it. Unset is never wrong.
 *
 * A Mobile Override is judged on its own. When it alone is wrong, the finding
 * says `stage: "mobile"`, and its Repair drops the override, so the prop
 * follows desktop again. The desktop finding's Repair names the desktop Stage,
 * so carrying it out on the mobile Stage never touches the override instead.
 */
function propFindings(
  document: EmailDocument,
  registry: Registry,
  check: PropCheck,
): readonly Diagnostic[] {
  return collectBlocks(document.root).flatMap((block) => {
    const definition = registry.get(block.type);
    if (!definition) return [];
    return Object.entries(definition.schema).flatMap(([name, entry]) =>
      (
        [
          ["desktop", block.props[name]],
          ["mobile", overrideOf(block, name, entry)],
        ] as const
      )
        .filter(
          ([, value]) =>
            value !== undefined && check.isWrong(entry.kind, value),
        )
        .map(([stage]): Diagnostic => {
          const repair: SetPropRepair = {
            kind: "set-prop",
            blockId: block.id,
            prop: name,
            value: undefined,
            stage,
          };
          return {
            code: check.code,
            message: check.message(entry.label),
            severity: "error",
            blockId: block.id,
            prop: name,
            ...(stage === "mobile" ? { stage } : {}),
            repair,
          };
        }),
    );
  });
}

/**
 * Whether a value is the shape a kind says. `undefined` for a kind the library
 * does not know, which is never judged.
 */
export function hasShape(kind: string, value: unknown): boolean | undefined {
  switch (kind) {
    case SchemaKind.text:
    case SchemaKind.richText:
    case SchemaKind.html:
    case SchemaKind.url:
    case SchemaKind.color:
    case SchemaKind.surface:
    case SchemaKind.align: {
      return typeof value === "string";
    }
    case SchemaKind.number:
    case SchemaKind.width: {
      return typeof value === "number";
    }
    case SchemaKind.boolean: {
      return typeof value === "boolean";
    }
    case SchemaKind.select: {
      // An option's value may be either; whether it is one of the options is
      // a different question.
      return typeof value === "string" || typeof value === "number";
    }
    case SchemaKind.asset: {
      return assetOf(value) !== undefined;
    }
    default: {
      return undefined;
    }
  }
}

/** Whether anything on the list blocks rendering. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
