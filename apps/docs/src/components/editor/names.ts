import {
  assetOf,
  SchemaKind,
  type Block,
  type DropTarget,
  type Editor,
} from "lekh-editor";

/**
 * What an Author reads for a Block, a container and a place in the email.
 *
 * One set of names for the Layers panel, the drop label and Move to…, so a
 * Block is called the same thing wherever it is pointed at.
 */

/** How much of a Block's own words fit on a Layers row. */
const PREVIEW_LENGTH = 60;

/** How much of a sibling's words name a place beside it. */
const PLACE_LENGTH = 32;

/**
 * What this Block actually says, if it says anything.
 *
 * Read off the Schema rather than the type, so a Consumer's own Block gets a
 * preview for free: the first prop holding words wins, then an image's alt.
 */
export function previewOf(
  block: Block,
  editor: Editor,
  length = PREVIEW_LENGTH,
): string | undefined {
  const schema = editor.getDefinition(block.type)?.schema;
  if (!schema) return undefined;

  for (const [name, entry] of Object.entries(schema)) {
    const value = block.props[name];

    if (entry.kind === SchemaKind.richText || entry.kind === SchemaKind.text) {
      const text = plainText(typeof value === "string" ? value : "");
      if (text !== "") return clip(text, length);
    }

    // Only the picture the Block is. A section's background is decoration,
    // and its alt is ignored.
    if (entry.kind === SchemaKind.asset && entry.primary === true) {
      const alt = assetOf(value)?.alt;
      if (alt !== undefined && alt !== "") return clip(alt, length);
    }
  }

  return undefined;
}

/** A Block's type, as its Definition names it. */
export function labelOf(block: Block, editor: Editor): string {
  return editor.getDefinition(block.type)?.label ?? block.type;
}

/**
 * A container, as an Author tells it apart from the ones around it.
 *
 * Containers have no names an Author gives them, so one is its type and, when
 * its parent holds others of the same type, its place among them: the second
 * of three columns is "Column 2". The email itself is "Email".
 */
export function containerName(editor: Editor, blockId: string): string {
  const root = editor.getDocument().root;
  if (blockId === root.id) return "Email";
  const block = editor.getBlock(blockId);
  if (!block) return "";
  const label = labelOf(block, editor);
  const parent = parentOf(root, blockId);
  const same = (parent?.children ?? []).filter(
    (child) => child.type === block.type,
  );
  if (same.length < 2) return label;
  return `${label} ${String(same.findIndex((child) => child.id === blockId) + 1)}`;
}

/**
 * A container and the ones it sits in, from the email down: "Columns 2 ›
 * Column 1". Two first columns in two rows have the same name, and only the
 * row tells them apart. The email itself is "Email".
 */
export function containerPath(editor: Editor, blockId: string): string {
  const root = editor.getDocument().root;
  if (blockId === root.id) return "Email";
  const names: string[] = [];
  for (
    let id: string | undefined = blockId;
    id !== undefined && id !== root.id;
    id = parentOf(root, id)?.id
  ) {
    names.unshift(containerName(editor, id));
  }
  return names.join(" › ");
}

/**
 * A place a Block could go, in words: beside a sibling, or into an empty
 * container. The sibling is named by what it says, because three Text Blocks
 * in a column would all be "Text". One that says nothing, like a Section, is
 * named by its place among its kind.
 */
export function placeName(editor: Editor, target: DropTarget): string {
  if (target.position === "inside") {
    return `Into ${containerName(editor, target.parentId)}`;
  }
  const sibling =
    target.referenceBlockId === undefined
      ? undefined
      : editor.getBlock(target.referenceBlockId);
  const side = target.position === "before" ? "Before" : "After";
  if (!sibling) return side;
  const name =
    previewOf(sibling, editor, PLACE_LENGTH) ??
    containerName(editor, sibling.id);
  return `${side} ${name}`;
}

/**
 * Whether a place is where the Block already is: the gap just before it or
 * just after it. Moving there changes nothing.
 */
export function isWhereItIs(
  editor: Editor,
  target: DropTarget,
  blockId: string,
): boolean {
  const parent = parentOf(editor.getDocument().root, blockId);
  if (!parent || parent.id !== target.parentId) return false;
  const index = (parent.children ?? []).findIndex(
    (child) => child.id === blockId,
  );
  return target.index === index || target.index === index + 1;
}

/** The Block holding this one, or nothing for the root. */
export function parentOf(root: Block, blockId: string): Block | undefined {
  for (const child of root.children ?? []) {
    if (child.id === blockId) return root;
    const found = parentOf(child, blockId);
    if (found) return found;
  }
  return undefined;
}

function clip(text: string, length: number): string {
  return text.length > length
    ? `${text.slice(0, length - 1).trimEnd()}…`
    : text;
}

/**
 * Rich text is markup, and a name wants the words out of it. Outside a
 * browser, as under test, the tags are dropped without decoding entities.
 */
function plainText(html: string): string {
  if (html === "") return "";
  const text =
    typeof DOMParser === "undefined"
      ? html.replaceAll(/<[^>]*>/gu, " ")
      : (new DOMParser().parseFromString(html, "text/html").body.textContent ??
        "");
  return text.replaceAll(/\s+/gu, " ").trim();
}
