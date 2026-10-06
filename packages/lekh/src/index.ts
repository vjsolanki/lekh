/**
 * The base — `lekh-editor`.
 *
 * Everything here is pure and runs without a DOM: the editor, the render path,
 * the shipped Validators and the Agent tools. The Canvas and the Text Engine
 * need a browser, and the Blocks need react.email, so those three arrive
 * separately. That is the whole rule for a separate entry point: it needs a
 * browser or an install the base does not (ADR-0045).
 *
 * One entry rather than a send-only one beside it, because nothing here runs
 * at import and the package is free of side effects. A send pipeline that
 * imports `renderDocument` alone bundles none of the editor.
 */

export {
  classNames,
  MOBILE_MAX_WIDTH,
  MOBILE_CLASSES,
  MobileStyles,
} from "./core/layout/responsive";
export type {
  MobileRenderContext,
  MobileRules,
  MobileStructure,
  MobileDeclarations,
  Stage,
} from "./core/layout/responsive";

export { SchemaKind, defineBlock } from "./core/document/definition";
export type {
  BlockDefinition,
  BlockRenderContext,
  BlockSchema,
  BoxSide,
  JSONSchema,
  MailClientNote,
  Migration,
  Preset,
  SchemaEntry,
  Surface,
} from "./core/document/definition";

/**
 * The value a surface prop carries when there is no colour.
 *
 * Exported for the write side alone. A Definition declaring
 * `SchemaKind.surface` never sees this — `render` is handed a colour or
 * `undefined` — but a Consumer's Inspector has to store something when an
 * Author clears a surface, and this is the something. See ADR-0019.
 */
export { NONE } from "./core/document/color";

/**
 * Brand Colours, as a colour or Surface entry's `constraints.brandColors` lists
 * them. A Preset puts them there; an Inspector reads them back with
 * `brandColorsOf(control.constraints)` and stores the value, never the label.
 */
export { brandColorsOf } from "./core/document/color";
export type { BrandColor } from "./core/document/color";

/**
 * An Asset is a prop value, so a Definition declaring `SchemaKind.asset` needs
 * the type to render one and `assetOf` to narrow a stored one before it
 * validates. The editor is what *produces* an Asset; that half stays on
 * `index.ts`.
 */
export { assetOf } from "./core/document/assets";
export type { Asset } from "./core/document/assets";

export { RichText } from "./core/render/rich-text";
export type { RichTextProps } from "./core/render/rich-text";
export { sanitiseInlineMarkup } from "./core/markup/inline-markup";
export { htmlScopeOf, sanitiseHtml } from "./core/markup/html";
export type { TextShape } from "./core/markup/inline-markup";

export type { Block, EmailDocument } from "./core/document/document";

export { DiagnosticCode } from "./core/validate/diagnostic";
export type {
  Diagnostic,
  Severity,
  SeverityOverrides,
  ValidationContext,
  ValidationSetup,
  Validator,
} from "./core/validate/diagnostic";
export { isBlank } from "./core/validate/blank";

/**
 * On both, because the editor shows the size as the Author works and a send
 * pipeline checks it before sending. It is a string in and numbers out.
 */
export { clipCheck, GMAIL_CLIP_BYTES } from "./core/render/clip";
export type { ClipCheck, ClipCheckOptions } from "./core/render/clip";
export type { Edit } from "./core/document/edit";
export type {
  ConsumerRepair,
  KnownRepair,
  Repair,
  RestoreRequiredBlockRepair,
  SetPropRepair,
} from "./core/validate/repair";

export { createDocument, createEditor } from "./core/editor/editor";
export type {
  Action,
  ActionVia,
  AddableChild,
  EditableChild,
  Editor,
  EditorOptions,
  PendingChange,
  PlaceOutcome,
  EditRefusal,
  EditRefusalCode,
  AcceptOutcome,
  ExtendOutcome,
  FinishOutcome,
  SuggestOptions,
  Suggestion,
  SuggestionBase,
  SuggestionBaseValue,
  SuggestionEvent,
  SuggestionJSON,
  SuggestionRefusal,
  SuggestionStatus,
  SuggestionTouch,
  Unsubscribe,
} from "./core/editor/editor";
export { describeBlocks } from "./core/document/agent-schema";
export type { BlockDescription } from "./core/document/agent-schema";
export type { Division, Share } from "./core/layout/division";
export type { TextEditOptions, TextEngine } from "./core/editor/text-engine";
export type { PlacementIntent } from "./core/editor/placement";
export type { ControlDescriptor } from "./core/editor/controls";
export type { Origin } from "./core/document/props";

export type {
  FailedImage,
  ImagePlacement,
  ImageRequest,
  ImageRequestFacts,
  ImageRequestReason,
  ImageRequestState,
  ImageResolver,
  PendingImage,
} from "./core/document/assets";

export { LOCAL_ORIGIN } from "./core/editor/op";
export type {
  InsertOp,
  MoveOp,
  Op,
  RemoveOp,
  SetPropOp,
  TextEditOp,
} from "./core/editor/op";

export { EditorConfigurationError } from "./core/document/errors";

export { createCommands } from "./core/editor/commands";
export type { CommandName, Commands } from "./core/editor/commands";

export type {
  BlockRect,
  DropOutcome,
  DropRefusal,
  DropRefusalCode,
  DropTarget,
  DropTargetQuery,
  DropTargetsQuery,
  LayoutAxis,
  Point,
} from "./core/editor/drop-target";

// The render path. No client-only directive anywhere on `lekh-editor`, so a Server
// Component can render a stored Document.
export { renderDocument } from "./core/render/render-document";
export type { RenderDocumentOptions } from "./core/render/render-document";
export {
  DocumentValidationError,
  UnknownBlockError,
} from "./core/document/errors";

export { toHtml } from "./to-html";
export type { ToHtmlOptions } from "./to-html";

// The shipped Validators. Opt-in: an editor given no Validators reports none.
export {
  minimumContrast,
  minimumFontSize,
  ValidatorDiagnostic,
  workingLinks,
} from "./validators/validators";
export type {
  MinimumContrastOptions,
  MinimumFontSizeOptions,
  WorkingLinksOptions,
} from "./validators/validators";

// Ready tools for any model, and a dispatcher (ADR-0034). lekh calls no model
// and depends on no model or MCP SDK.
export {
  agentTools,
  EDIT_SCHEMA,
  readEmail,
  renderPreview,
} from "./agent/tools";
export type {
  AgentToolDefinition,
  AgentToolName,
  AgentToolResult,
  AgentTools,
  AgentToolsOptions,
  EmailPreview,
  EmailReading,
} from "./agent/tools";
export { plainTextOf } from "./agent/plain-text";
