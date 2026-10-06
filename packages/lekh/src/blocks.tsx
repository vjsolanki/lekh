/**
 * The shipped Blocks — `lekh-editor/blocks`.
 *
 * Two Presets: the everyday Blocks, and the compliance Blocks (unsubscribe and
 * postal address). The only entry point that imports react.email, and the core
 * imports nothing from it, so a Consumer targeting MJML or a house component
 * set never pulls it in (ADR-0001). `@react-email/components` is an *optional*
 * peer dependency: installing it is the Consumer's choice.
 *
 * Nothing here runs at import. The Block Definitions are built when a factory
 * is called. Each Block is a file of its own under `preset/`, with its
 * Structural child beside it, so a Consumer who picks a few Blocks with
 * `pickReactEmailPreset` ships none of the others. The compliance Preset is
 * its own factory for the same reason: a transactional email, which must not
 * carry an unsubscribe link, never composes it in.
 */

export type { ReactEmailBlock } from "./preset/block";
export { buttonBlock } from "./preset/button";
export { columnsBlock } from "./preset/columns";
export { createReactEmailPreset, pickReactEmailPreset } from "./preset/create";
export { dividerBlock } from "./preset/divider";
export { headingBlock } from "./preset/heading";
export { htmlBlock } from "./preset/html";
export { iconRowBlock } from "./preset/icon-row";
export { imageBlock } from "./preset/image";
export { navBlock } from "./preset/nav";
export { spacerBlock } from "./preset/spacer";
export { textBlock } from "./preset/text";
export { PresetDiagnostic, REACT_EMAIL_ROOT_TYPE } from "./preset/names";
export type {
  ReactEmailColor,
  ReactEmailFont,
  ReactEmailIcon,
  ReactEmailPresetOptions,
} from "./preset/options";
export type { ReactEmailFontFace, ReactEmailWebFont } from "./preset/web-font";

export {
  ComplianceDiagnostic,
  createCompliancePreset,
  POSTAL_ADDRESS_TYPE,
  UNSUBSCRIBE_TYPE,
} from "./preset/compliance";
export type { CompliancePresetOptions } from "./preset/compliance";
