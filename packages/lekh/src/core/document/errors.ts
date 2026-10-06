import type { Diagnostic } from "../validate/diagnostic";
import type { Block } from "./document";

/** Thrown when a set of Block Definitions cannot produce a usable editor. */
export class EditorConfigurationError extends Error {
  override readonly name = "EditorConfigurationError";
}

/**
 * A Document reached the render path carrying a Block nothing can render.
 *
 * Thrown whether or not validation was opted out of: an unregistered Block is
 * a structural impossibility, not a policy finding.
 */
export class UnknownBlockError extends Error {
  override readonly name = "UnknownBlockError";
  readonly blockId: string;
  readonly blockType: string;

  constructor(block: Block) {
    super(
      `Cannot render Block "${block.id}": no Block Definition is registered ` +
        `for the type "${block.type}".`,
    );
    this.blockId = block.id;
    this.blockType = block.type;
  }
}

/** A Document reached the render path with error-severity Diagnostics. */
export class DocumentValidationError extends Error {
  override readonly name = "DocumentValidationError";
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const errors = diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    super(
      `Cannot render this Document:\n${errors
        .map((diagnostic) => `  - [${diagnostic.code}] ${diagnostic.message}`)
        .join("\n")}`,
    );
    this.diagnostics = diagnostics;
  }
}
