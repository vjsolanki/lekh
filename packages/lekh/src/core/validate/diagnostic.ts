import type { BlockDefinition } from "../document/definition";
import type { EmailDocument } from "../document/document";
import type { Stage } from "../layout/responsive";
import type { Repair } from "./repair";

/**
 * Whether a Diagnostic merely surfaces or blocks rendering.
 *
 * Errors block the render path; warnings never do, so a heuristic that
 * misfires cannot stop a send.
 */
export type Severity = "error" | "warning";

/**
 * Every code lekh itself raises, keyed by the code in camelCase.
 *
 * A code names its subject first, so a key can be guessed from a code in a
 * log. Diagnostics are not stored, so a code may be renamed without a
 * migration.
 */
export const DiagnosticCode = {
  /** A Block in the Document has a type no Block Definition claims. */
  blockUnregistered: "block-unregistered",
  /** The Document contains no Block of a type marked required. */
  requiredBlockMissing: "required-block-missing",
  /** Some of an `"html"` prop's markup will not reach the email. */
  htmlMarkupRemoved: "html-markup-removed",
  /** An `"html"` prop's tags do not open and close in equal numbers. */
  htmlMarkupUnbalanced: "html-markup-unbalanced",
  /** An `"html"` prop holds a whole document, and only its body is kept. */
  htmlWholeDocument: "html-whole-document",
  /** A stored prop's value is not the shape its Schema kind says it is. */
  propWrongShape: "prop-wrong-shape",
  /**
   * A `"url"` prop holds a link an email may not carry, which the render path
   * leaves out (ADR-0033).
   */
  urlUnsafe: "url-unsafe",
} as const;

/** A finding about a Document. */
export interface Diagnostic {
  /** Stable identifier, so a Consumer can present the finding in their own words. */
  readonly code: string;
  /** Human-readable fallback message. */
  readonly message: string;
  readonly severity: Severity;
  /** The Block the finding concerns, when it concerns one. */
  readonly blockId?: string;
  /**
   * The prop on that Block the finding concerns, when it concerns one, so an
   * Inspector can show it under that prop's control.
   */
  readonly prop?: string;
  /**
   * Set only when the prop's Mobile Override alone is at fault, and then
   * always `"mobile"`. Absent, the finding is about the value desktop shows,
   * which mobile follows unless it overrides it.
   */
  readonly stage?: Stage;
  /**
   * What would put this right, when anything would.
   *
   * Optional because some findings have no repair — nothing knows a Consumer's
   * postal address — and not because of where the Diagnostic was produced. It
   * is a description rather than an act: the render path describes repairs and
   * carries out none of them, and `Editor.applyRepair` is the only thing that
   * runs one (ADR-0015).
   */
  readonly repair?: Repair;
}

/** What a Validator is given. */
export interface ValidationContext {
  getDefinition(type: string): BlockDefinition | undefined;
  readonly definitions: readonly BlockDefinition[];
  /**
   * The root Block's resolved props, which an Email Default is read from
   * (ADR-0022). Pass them when resolving a Block's props, so a check
   * judges the value that renders.
   */
  readonly rootProps: Readonly<Record<string, unknown>>;
}

/** A function that inspects a Document and produces Diagnostics. */
export type Validator = (
  document: EmailDocument,
  context: ValidationContext,
) => readonly Diagnostic[];

/**
 * Severity overrides keyed by Diagnostic code, so a regulated product can
 * escalate a warning to an error without forking the Validator.
 *
 * Escalation only. An error cannot be softened to a warning, because that
 * would be a back door around the render path's refusal (ADR-0006) — a
 * Consumer who does not want an unsubscribe link declines to declare one
 * required rather than downgrading the Diagnostic that says it is missing.
 */
export type SeverityOverrides = Readonly<Record<string, Severity>>;

/**
 * What it takes to decide whether a Document is valid.
 *
 * Shared by the editor and the render path so the two can never disagree:
 * `Editor.getRenderOptions()` returns exactly this, ready to hand to
 * `renderDocument`.
 */
export interface ValidationSetup {
  /** The Block Definitions the Document is judged against. */
  readonly definitions: readonly BlockDefinition[];
  /** Extra checks the library knows nothing about. */
  readonly validators?: readonly Validator[];
  readonly severities?: SeverityOverrides;
}
