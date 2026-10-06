import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "lekh/blocks";

/**
 * The Blocks this editor offers.
 *
 * An ordinary array, so adding your own later is a spread. Nothing
 * self-registers: a Definition that is not in this list does not exist as far
 * as the editor is concerned.
 */
export const definitions = createReactEmailPreset({
  fontFamily: "Inter, Arial, sans-serif",
  contentWidth: 600,
});

/** Re-exported so the rest of the tutorial never types the string "email". */
export const rootType = REACT_EMAIL_ROOT_TYPE;
