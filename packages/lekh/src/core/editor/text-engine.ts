/**
 * The seam ADR-0005 defines: rich text inside a Block is delegated to a
 * pluggable implementation, and the library never learns which one.
 *
 * Its own module because both halves of the store depend on it and neither
 * should depend on the other — the Document store drives it and reads it back,
 * and the History asks it what it can still carry out.
 */

/**
 * The pluggable implementation responsible for rich text inside a Block.
 *
 * The library owns document history and the engine owns text history, so a
 * text edit pushes a marker onto the document stack and undoing that marker
 * delegates back here — one strictly chronological timeline (ADR-0005).
 */
export interface TextEngine {
  undo(blockId: string): void;
  redo(blockId: string): void;
  canUndo(blockId: string): boolean;
  /**
   * Whether the engine still has a redo for this Block.
   *
   * Asked separately from `canUndo` because they are different questions: an
   * engine that has just undone a Block's only edit reports `canUndo` false
   * while the redo is perfectly available. The store steps over a marker the
   * engine can no longer carry out, and one predicate answering for both would
   * step over every redoable text edit there is.
   */
  canRedo(blockId: string): boolean;
  /**
   * The Block's text as the engine now holds it, in the form the Document
   * stores it — inline HTML, reduced to the supported subset on the way in.
   *
   * The store reads it after every edit and after every delegated undo, so a
   * Document written to a database carries the text an Author last saw. One
   * member beyond the interface ADR-0005 fixed, for the reason in ADR-0009.
   */
  getText(blockId: string): string | undefined;
  /**
   * Replace the Block's text from outside, as one undoable change in the
   * engine's own history, and show it. Called when an Author accepts a
   * Suggestion that rewords the Block (ADR-0037). The text is inline HTML in
   * the subset the Block holds, as `getText` hands it back.
   *
   * False when the engine holds no text for the Block, because its surface is
   * not mounted. The store keeps the prop it wrote then, and the surface seeds
   * from it when it mounts.
   */
  replaceText(blockId: string, text: string): boolean;
}

/** How a text edit joins the document history. */
export interface TextEditOptions {
  /**
   * Fold this edit into the entry the stack already holds for this Block,
   * rather than adding one.
   *
   * This is typing coalescence: the engine decides what a chunk of typing is,
   * and passing `true` for a change it folded into its own last history entry
   * keeps the two stacks the same depth. Undo then removes a word rather than
   * a character.
   */
  readonly coalesce?: boolean;
}
