import { NONE } from "../core/document/color";

/**
 * What each tool tells a model, in one place, so the words can be read and
 * tuned together (ADR-0034).
 *
 * The descriptions are the hard part of the tools. They carry lekh's rules:
 * Blocks named by id, places by sibling, the rich-text tags, the colour forms
 * and None, and images only as resolved Assets. A model that reads them
 * writes Edits that apply.
 */

/** Said in each description when the tools are focused on one Block. */
const focusNote = (focus: string | undefined): string =>
  focus === undefined
    ? ""
    : ` The Author is asking about the Block with id "${focus}". Start ` +
      "there, but you may change other Blocks when the request needs it.";

export function readEmailDescription(focus: string | undefined): string {
  return (
    "Read the email as it is stored now: a tree of Blocks, each with an " +
    "`id`, a `type`, the `props` set on it, any `mobile` overrides, and its " +
    "`children`. Props left out take their default from describe_blocks. " +
    "Name Blocks by these ids in suggest." +
    (focus === undefined
      ? ""
      : ` While it is in the email, the focused Block, "${focus}", comes ` +
        "first as `focus`, with the id of the Block it sits in.") +
    focusNote(focus)
  );
}

export const DESCRIBE_BLOCKS_DESCRIPTION =
  "List every Block type this email can hold. For each: its props as a JSON " +
  "Schema object, and `parents`, the types that take it as a child. Only " +
  "the props listed may be set. Any other prop is closed, and suggest " +
  "refuses it. `rootType` is the type of the Block at the top of the tree.";

export function suggestDescription(
  focus: string | undefined,
  autoAccept: boolean,
): string {
  return (
    (autoAccept
      ? "Change the email. The change is stored at once, as one step the " +
        "Author can undo. "
      : "Propose a change to the email. The Author sees it on the Canvas " +
        "and accepts or rejects it whole. Nothing is stored until they " +
        "accept. ") +
    "Pass `edits`, carried out in order, each reading the email the ones " +
    "before it left:\n" +
    '- set-prop: `blockId`, `prop`, `value`. `stage: "mobile"` sets the ' +
    "phone value only.\n" +
    "- insert: a new Block of `type`, with any `props`. Place it with " +
    "`after` or `before` a sibling's id, or `parent` alone to put it last " +
    "inside that Block. Give it an `id` to name it in later Edits.\n" +
    "- remove: `blockId`, with everything inside it.\n" +
    "- move: `blockId`, placed as an insert is.\n" +
    "Name Blocks by the ids read_email gives. Never by position.\n" +
    "Rich text is HTML with only <strong>, <em>, <u>, <s>, <a href> and " +
    "<br>. <p>, <ul>, <ol> and <li> only where describe_blocks says the " +
    "prop takes them.\n" +
    "A colour is #rgb, #rrggbb, rgb() or rgba(). A prop that may be empty " +
    `of colour takes "${NONE}".\n` +
    "An image is a resolved Asset: { src, width, height, alt? }. Never a " +
    "bare URL, and never one you made up. Get Assets from an image tool " +
    "if you have one.\n" +
    "Returns the suggestion id and the Diagnostics the email would have, " +
    "or `refused` with a reason for each Edit that cannot apply. Fix those " +
    "and suggest again." +
    focusNote(focus)
  );
}

export const RENDER_PREVIEW_DESCRIPTION =
  "Render the email as the Author sees it now, open suggestions included: " +
  "the HTML a mail client gets, and the same as plain text. Use it to check " +
  "your work reads well.";
