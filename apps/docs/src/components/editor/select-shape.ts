/**
 * Whether a select is a row of buttons or a dropdown.
 */

/** The most buttons a row holds before it is a dropdown again. */
const MOST_BUTTONS = 4;

/** The longest label one button holds, in characters. */
const LONGEST_LABEL = 6;

/**
 * The most characters the whole row holds. The buttons share the panel's
 * narrow control column, so four buttons get fewer each than two.
 */
const ROW_CHARACTERS = 12;

/**
 * Buttons for two to four options whose labels are all a few characters, so
 * an Author sees every choice at once. Anything longer stays a dropdown.
 */
export function fitsButtonRow(
  choices: readonly { readonly label: string }[],
): boolean {
  return (
    choices.length >= 2 &&
    choices.length <= MOST_BUTTONS &&
    choices.every((choice) => choice.label.length <= LONGEST_LABEL) &&
    choices.reduce((total, choice) => total + choice.label.length, 0) <=
      ROW_CHARACTERS
  );
}
