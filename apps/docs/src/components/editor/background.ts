import { NONE, type Editor } from "lekh";

/**
 * A background image and the colour that stands in for it.
 *
 * The Preset gives a section and a row a content image that fills its box, and
 * the email a page image that tiles. Each has a colour beside it that a reader
 * with images off sees instead. Keyed by prop name: the example draws the
 * Preset's Blocks, so it knows their names.
 */
export interface Background {
  /** The Asset prop. */
  readonly image: string;
  /** The colour shown when images are off. */
  readonly color: string;
  /** How the image renders: filling the box, or repeating across it. */
  readonly fit: "cover" | "tile";
}

const BACKGROUNDS: readonly Background[] = [
  {
    image: "contentBackgroundImage",
    color: "contentBackgroundColor",
    fit: "cover",
  },
  { image: "backgroundImage", color: "backgroundColor", fit: "tile" },
];

/** The background an Asset prop is, if it is one. */
export function backgroundOfImage(prop: string): Background | undefined {
  return BACKGROUNDS.find((background) => background.image === prop);
}

/** The background a colour prop stands in for, if it does. */
export function backgroundOfColor(prop: string): Background | undefined {
  return BACKGROUNDS.find((background) => background.color === prop);
}

/** The grey line under an image row, saying how it renders. */
export function renderingOf(fit: Background["fit"]): string {
  return fit === "cover"
    ? "Fills the background and stays centred."
    : "Tiles across the page.";
}

/**
 * The colour a Block shows behind its background image, or `undefined` when it
 * has none.
 *
 * Its own value first, then the email's for a colour that follows one, then the
 * default, as the library resolves it (ADR-0022).
 */
export function fallbackColorOf(
  editor: Editor,
  blockId: string,
  background: Background,
): string | undefined {
  const block = editor.getBlock(blockId);
  if (!block) return undefined;
  const entry = editor.getDefinition(block.type)?.schema[background.color];
  const root = editor.getDocument().root;
  const follows = entry?.follows;
  const fromEmail =
    follows === undefined
      ? undefined
      : (root.props[follows] ??
        editor.getDefinition(root.type)?.schema[follows]?.defaultValue);

  const value =
    block.props[background.color] ??
    (usable(fromEmail) ? fromEmail : entry?.defaultValue);
  return usable(value) ? value : undefined;
}

function usable(value: unknown): value is string {
  return typeof value === "string" && value !== NONE && value !== "";
}
