/**
 * The Document model.
 *
 * A Document is plain serialisable data — nothing in it is a function, a class
 * instance or a React element — so a Consumer can store it in any column
 * without a custom serialiser.
 */

/** A single node in a Document. */
export interface Block {
  /** Stable identity, unique within the Document. */
  readonly id: string;
  /** The type of the Block, matching a Block Definition's `type`. */
  readonly type: string;
  /** Values an Author has set. Absent props resolve to the Schema default. */
  readonly props: Readonly<Record<string, unknown>>;
  /**
   * Values an Author has set on the mobile Stage only.
   *
   * Sparse and separate from `props`, holding nothing but the props explicitly
   * changed on that Stage: an absent key follows the desktop value, so changing
   * desktop still moves mobile, and reverting an override is deleting the key.
   * Absent entirely on a Block with none, which is nearly all of them.
   */
  readonly mobile?: Readonly<Record<string, unknown>>;
  /** Present on container Blocks. Absent on leaves. */
  readonly children?: readonly Block[];
  /**
   * The Block Definition version this Block was written at. Absent means
   * version 0, so a Definition that introduces versioning later can migrate
   * Documents that predate it.
   */
  readonly version?: number;
}

/**
 * The canonical form of an email.
 *
 * Its root is an ordinary Block: email-wide settings such as background colour
 * and content width are that Block's props, so there is no separate theme or
 * document-settings concept.
 */
export interface EmailDocument {
  readonly root: Block;
}
