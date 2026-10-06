import type { ReactElement, ReactNode } from "react";

import type { Diagnostic, ValidationContext } from "../validate/diagnostic";
import type { Block } from "./document";
import { EditorConfigurationError } from "./errors";
import type { TextShape } from "../markup/inline-markup";
import type { MobileRenderContext } from "../layout/responsive";

/**
 * One editable prop, as declared by a Block Definition's Schema.
 *
 * `kind` is an open string, not a closed union: a Consumer's Block can declare
 * a bespoke kind such as `product-picker` and handle it in their own
 * Inspector. See ADR-0002.
 */
export interface SchemaEntry<TValue = unknown> {
  readonly kind: string;
  readonly label: string;
  /** Where the prop resolves to when an Author has never set it. */
  readonly defaultValue: TValue;
  /** Kind-specific constraints, passed through to the Consumer untouched. */
  readonly constraints?: Readonly<Record<string, unknown>>;
  /**
   * Which set of props this one belongs to, named for an Author.
   *
   * A Block that draws more than one surface has props that mean different
   * things in the same panel — a container painting a band across the window
   * and a column of content inside it has two background colours, and they are
   * not interchangeable. The grouping says which is which.
   *
   * A name rather than a position: the Consumer renders the panel and decides
   * whether a group is a heading, a tab or a fieldset. Props without one are
   * the Block's own and come first, which is why most Schemas declare none.
   */
  readonly group?: string;
  /**
   * The root prop this one takes its value from when the Block stores none:
   * its Email Default.
   *
   * For a colour the whole email shares — the ink of every paragraph — so an
   * Author changes it once on the root rather than on every Block. A value set
   * on the Block always wins, and clearing it puts the Block back to following.
   * A root value that is not a usable colour is passed over for `defaultValue`.
   *
   * Root only, and one level: never a parent, because a Block that reads its
   * parent changes when it is moved (ADR-0022).
   */
  readonly follows?: string;
  /**
   * How this prop's value becomes CSS on the mobile Stage — a `MobileDeclarations`.
   *
   * Declaring it is what opts the prop in to Mobile Overrides: only opted-in
   * props appear on the mobile Stage, and an Author's override for one is
   * emitted through this. Realistically font size, padding and alignment —
   * anything else is a colour or a width Outlook would ignore (ADR-0007).
   *
   * Handed the root's resolved props too, for a value that means a different
   * thing in a different email: `start` is `right` in a right-to-left one.
   *
   * Declared as a method for the same reason `render` is: a Definition with
   * concrete props has to stay assignable to the erased one the registry holds.
   */
  mobile?(
    value: TValue,
    rootProps: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, string>>;
  /**
   * For an {@link SchemaKind.asset} prop: this is the Asset the Block *is* —
   * its Primary Asset (ADR-0026).
   *
   * Only a Primary Asset decides what a dropped or pasted file becomes, and
   * whether placing the Block asks for an image first. Every other Asset is
   * optional decoration, such as a section's background, and is set through a
   * `"replace"` request for its prop. A Definition declares at most one.
   */
  readonly primary?: true;
  /**
   * For an {@link SchemaKind.asset} prop: the image is never shown with alt
   * text, such as a background behind other content.
   *
   * The placement of a request for this prop says so, so a picker need not
   * ask for alt text, and an Agent is told not to write any. A Primary Asset
   * is never decorative: the Block is the image, and its alt text is what a
   * reader with images off is told.
   */
  readonly decorative?: true;
  /**
   * The Box this prop is one side of, such as `"padding"` (ADR-0040).
   *
   * A Box is spacing an Author edits as one thing, though each side stays its
   * own prop with its own Mobile Override. A name, not a guess from the prop's:
   * a button has outer padding and the room round its label, two Boxes. Set
   * with {@link SchemaEntry.side}, or not at all.
   */
  readonly box?: string;
  /**
   * Which side of its {@link SchemaEntry.box} this prop is, or several: one
   * prop can hold the top and the bottom alike. Each side of a Box belongs to
   * one prop at most.
   */
  readonly side?: BoxSide | readonly BoxSide[];
  /**
   * An entry an Author rarely needs, such as inner spacing or a border: an
   * Inspector may fold it away by default, so the common ones are easy to find.
   *
   * Only a hint for drawing. It changes nothing in the Document or the markup,
   * and an Agent is not told it: every prop is the same to a model.
   */
  readonly advanced?: true;
  /**
   * For a colour: the {@link SchemaKind.surface} prop on the same Block it is
   * painted on, such as a button's fill under its label.
   *
   * Without one, a colour is read against the nearest Surface beneath it that
   * is not None. A Block's Surfaces stack in Schema order, the last on top, and
   * above its parent's. An optional Asset declared after a Surface is drawn
   * over it, so a colour on a background image is read against nothing. With
   * one, the walk starts at the named Surface, and goes on beneath it while
   * that is None.
   */
  readonly on?: string;
  /**
   * What an Agent is told this prop holds, or `false` to close it to Agents.
   *
   * An Agent may set a prop only when it can be told the prop's shape. lekh
   * describes every {@link SchemaKind} itself, so a Preset needs none of these.
   * A Consumer's own kind is closed until it gives one: lekh cannot guess what
   * a `product-picker` holds, and a model guessing fills it with junk.
   *
   * A fragment replaces lekh's own description of the prop. `suggest` still
   * holds the value to what the kind takes. `false` closes any prop, such as a
   * legal footer an Author must write by hand: a Suggestion that sets it is
   * refused.
   */
  readonly agent?: JSONSchema | false;
  /**
   * What mail clients will do with this prop's value that an Author would not
   * expect: its Mail Client Notes (ADR-0041).
   *
   * Declared here, not looked up by the CSS the prop emits, because only the
   * Definition knows what its markup does in each client. A Definition that
   * draws VML for Outlook declares no note for it. A Control Descriptor carries
   * the notes whose `when` holds for the value in view. They are not
   * Diagnostics: nothing is wrong with the value.
   */
  readonly clients?: readonly MailClientNote<TValue>[];
}

/**
 * One Mail Client Note: what `client` does with a prop's value while `when`
 * holds for it.
 */
export interface MailClientNote<TValue = unknown> {
  /** Which mail client, as a short id such as `"outlook-windows"`. */
  readonly client: string;
  /**
   * Whether the note applies to this value.
   *
   * A method for the same reason {@link SchemaEntry.mobile} is.
   */
  when(value: TValue): boolean;
  /** What the client does, for an Author: `"Shows square corners"`. */
  readonly note: string;
}

/** One side of a Box. */
export type BoxSide = "top" | "right" | "bottom" | "left";

/**
 * A JSON Schema, as plain data: what an Agent is told a value holds.
 *
 * Open, since lekh only writes and passes these along. It never reads one a
 * Consumer gives it.
 */
export type JSONSchema = { readonly [keyword: string]: unknown };

/** The part of a Block Definition declaring which props an Author may edit. */
export type BlockSchema<TProps> = {
  readonly [TKey in keyof TProps]-?: SchemaEntry<TProps[TKey]>;
};

/** What a Block Definition's render function is given. */
export interface BlockRenderContext<TProps> {
  readonly block: Block;
  /**
   * Stored props with Schema defaults filled in.
   *
   * Always the desktop values, on both Stages: mobile is a stylesheet over the
   * same markup, not a second rendering, which is what makes the Canvas's
   * mobile preview the real thing rather than an approximation.
   */
  readonly props: TProps;
  /** Already-rendered children, keyed. Empty for a leaf. */
  readonly children: readonly ReactNode[];
  /**
   * The Block's responsive behaviour: the class its Mobile Overrides landed
   * under, the structural classes it can ask for, and — for a root Block — the
   * one stylesheet to emit in the head.
   */
  readonly mobile: MobileRenderContext;
  /**
   * The root Block's resolved props.
   *
   * The one thing a Block may read from above it, and it exists for one shape:
   * a container that paints edge to edge while its content stays in a column of
   * the email's width. The band is as wide as the client's window and the column
   * is not, so the Block drawing the band has to know a number that belongs to
   * the email rather than to itself.
   *
   * One level, and the top one: nothing else above a Block is visible to it,
   * because a Block that reads its parent is a Block that cannot be moved. The
   * root is the one ancestor every Block has wherever it is dragged (ADR-0017).
   *
   * Untyped, because the root is a Consumer's Block like any other and the
   * library has no idea what it declares. A Block reading this is coupled to the
   * root it expects — which is a Preset's business, since a Preset ships both.
   */
  readonly rootProps: Readonly<Record<string, unknown>>;
  /**
   * Put markup only classic Outlook on Windows reads round an element's
   * contents — VML, mostly, for what Word's renderer cannot draw from CSS.
   *
   * Hand it a host element, or a component that passes its props through to
   * one, such as react.email's `Column`. `open` goes at the start of its
   * contents and `close` at the end, each inside `<!--[if mso]>`. Both are raw
   * markup written as given, so escape anything an Author wrote before it goes
   * in.
   *
   * On the render path the contents become a string between the two halves.
   * On the Canvas the element comes back as it was: the Canvas is never
   * Outlook, and what is inside has to stay live. So the halves must never be
   * the only copy of anything.
   *
   * `between` is more of the same, one entry per gap between the element's
   * children: `between[i]` goes after child `i`. For things Outlook has to
   * hold in a table of their own, a cell each, such as the icons of a row.
   * An empty entry writes nothing.
   */
  readonly outlook: (
    element: ReactElement,
    open: string,
    close: string,
    between?: readonly string[],
  ) => ReactElement;
}

/**
 * Brings a stored Block forward one version (ADR-0024).
 *
 * Receives the `props` and `mobile` stored at version `n - 1` and returns both
 * at version `n`, where `n` is the key it is registered under. It sees
 * `mobile` so that renaming an Overridable prop can rename its override too.
 *
 * Leaving `mobile` out of the result leaves no overrides on the Block. A
 * migration that never touches overrides passes `mobile` through.
 */
export type Migration = (stored: {
  readonly props: Readonly<Record<string, unknown>>;
  readonly mobile: Readonly<Record<string, unknown>> | undefined;
}) => {
  props: Record<string, unknown>;
  mobile?: Record<string, unknown>;
};

/**
 * The registered description of one kind of Block.
 *
 * Definitions are inert: nothing self-registers, so a bundler can drop the
 * ones a Consumer never composes in.
 */
export interface BlockDefinition<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly type: string;
  /** Human-readable name, for a Consumer's palette. */
  readonly label: string;
  readonly schema: BlockSchema<TProps>;

  // Declared as methods rather than function properties so that a Definition
  // with concrete props stays assignable to the erased `BlockDefinition` the
  // registry holds.
  render(context: BlockRenderContext<TProps>): ReactElement | null;

  /**
   * Which Block types may be children. Absent means the Block is a leaf — the
   * common case needs no configuration.
   */
  readonly accepts?: readonly string[];
  /** Upper bound on children, so a two-column row cannot be filled with twelve. */
  readonly maxChildren?: number;
  /**
   * How many children a container is created holding, and the floor it is
   * never taken below.
   *
   * One number doing both jobs, because for the Block that needs it they are
   * one fact: a row of columns is a plural thing, so it arrives holding two
   * and is never left holding one. A row holding one column would contradict
   * its own name and render as a single cell — a second way to say what a
   * plain container already says.
   *
   * What gets created is the accepted type declared {@link
   * BlockDefinition.structural}. A Definition with `minChildren` must accept
   * exactly one of those, checked when the editor is constructed: two would be
   * seeded by whichever `accepts` happens to list first, which is a decision
   * made by array order and nothing else.
   *
   * The floor refuses a delete, which ADR-0006 argues against. It follows the
   * pattern `deletable: false` already set, and the reason ADR-0006 gives for
   * permitting does not reach it: refusing a Required Block's deletion "would
   * make redesigning a footer impossible", and nothing here becomes
   * impossible. An Author who wants the row gone deletes the row.
   */
  readonly minChildren?: number;
  /**
   * The starting props of the children a container is created holding, one
   * object per child (ADR-0030).
   *
   * Only read with `minChildren`, which still says what is created and is
   * still the floor. It may hand over more objects than the floor, and that
   * many are seeded, up to `maxChildren`. Fewer, and the rest start empty.
   * So an icon row starts holding three icons and may go down to one.
   */
  seed?(): readonly Readonly<Record<string, unknown>>[];

  /**
   * The version this Definition currently writes. Absent means version 0.
   * Versioning is per Definition, so an independently published Block can
   * evolve without a library release.
   */
  readonly version?: number;
  /**
   * Migrations keyed by the version they produce. Loading a Document runs
   * every key from the Block's stored version + 1 up to `version`, in order.
   */
  readonly migrations?: Readonly<Record<number, Migration>>;

  /** Every Document must contain at least one Block of this type. */
  readonly required?: boolean;
  /** Defaults to `true`. A non-deletable Block cannot be removed directly. */
  readonly deletable?: boolean;

  /**
   * A Block that exists as part of another Block's structure rather than as
   * something an Author places — a column inside a row. Its parent creates it,
   * and the Author reaches it only through the Block that owns it.
   *
   * It governs what an Author can reach and nothing else: the palette does not
   * offer it, and the Canvas does not make it draggable. So the row keeps
   * owning its columns — a column cannot be carried in from the palette, and
   * cannot be carried out into a different row.
   *
   * Every editor method stays open on one. `getAddableChildren`'s `add` is
   * built on `insertBlock`, so a rule enforced there would have to exempt the
   * one caller that matters, and `duplicateBlock` on a column is the useful
   * "another one like this". What an Author cannot do is reach for one
   * directly, which is the whole of the concept.
   *
   * A Block that still needs to be in the Document but never in an Author's
   * hand. See CONTEXT.md.
   */
  readonly structural?: boolean;

  /**
   * The room the Canvas gives this Block when `render` returns `null`.
   *
   * Without one it is a full-width box. That suits a Block on a line of its
   * own, and breaks one that sits beside others, such as an icon in a row. It
   * is handed what `render` was. The Canvas marks it as a stand-in, and the
   * render path never asks for it: in the email the Block is not there.
   */
  standIn?(context: BlockRenderContext<TProps>): ReactElement;

  /** A Validator that travels with the Block. */
  validate?(block: Block, context: ValidationContext): readonly Diagnostic[];
}

/**
 * Declare a Block Definition.
 *
 * Identity at runtime — it exists so that `render` and `validate` are
 * contextually typed by the Schema.
 */
export function defineBlock<TProps extends Record<string, unknown>>(
  definition: BlockDefinition<TProps>,
): BlockDefinition<TProps> {
  const taken = new Map<string, string>();
  const schema: Readonly<Record<string, SchemaEntry | undefined>> =
    definition.schema;
  for (const [name, entry] of Object.entries<SchemaEntry>(definition.schema)) {
    if ((entry.box === undefined) !== (entry.side === undefined)) {
      throw new EditorConfigurationError(
        `Block Definition "${definition.type}" gives "${name}" ` +
          `${entry.box === undefined ? "a side but no box" : "a box but no side"}. ` +
          `A side of a Box needs both.`,
      );
    }
    for (const side of sidesOf(entry)) {
      const key = `${side} of ${entry.box ?? ""}`;
      const holder = taken.get(key);
      if (holder !== undefined) {
        throw new EditorConfigurationError(
          `Block Definition "${definition.type}" puts "${holder}" and ` +
            `"${name}" on the ${side} of Box "${entry.box ?? ""}". ` +
            `Each side of a Box is one prop.`,
        );
      }
      taken.set(key, name);
    }
    if (
      entry.on !== undefined &&
      schema[entry.on]?.kind !== SchemaKind.surface
    ) {
      throw new EditorConfigurationError(
        `Block Definition "${definition.type}" puts "${name}" on ` +
          `"${entry.on}", which is not a Surface on the same Block.`,
      );
    }
    const constraints =
      entry.kind === SchemaKind.richText ? entry.constraints : {};
    // A list is a stretch of the text the way a paragraph is, so it needs the
    // paragraphs under it (ADR-0029).
    if (constraints?.["lists"] === true && constraints["paragraphs"] !== true) {
      throw new EditorConfigurationError(
        `Block Definition "${definition.type}" lets "${name}" hold lists ` +
          `without paragraphs. A list sits between paragraphs, so set ` +
          `"paragraphs: true" as well.`,
      );
    }
  }
  return definition;
}

/** The sides of a Box an entry is, as a list: empty when it is none. */
function sidesOf(entry: SchemaEntry): readonly BoxSide[] {
  if (entry.side === undefined) return [];
  return typeof entry.side === "string" ? [entry.side] : entry.side;
}

/** A set of Block Definitions distributed together as a starting point. */
export type Preset = readonly BlockDefinition[];

/**
 * Every Schema `kind` the shipped Presets use, on one object.
 *
 * `kind` stays an open string (ADR-0002): a Consumer's own Block may declare
 * any kind it likes, and the library passes it through to their Inspector. The
 * first seven keys are the exceptions, the kinds the library itself acts on:
 * `richText`, `asset`, `width`, `surface`, `align`, `html` and `url`. The rest
 * — `text`, `number`, `boolean`, `select` and `color` — are plain, and are here
 * so a Preset spells every kind the same way.
 */
export const SchemaKind = {
  /**
   * The Block's rich text.
   *
   * The store has to know which prop the Text Engine's text belongs in, and
   * asking every Definition to say so twice would be a second way to get it
   * wrong. See ADR-0009.
   */
  richText: "rich-text",
  /**
   * An Asset.
   *
   * A resolved Asset has to go somewhere, and the Block Definition is the only
   * thing that knows where. The prop's value *is* the Asset — location,
   * dimensions and alternative text together, never spread across
   * neighbouring props that could drift apart. Editing an image's alternative
   * text afterwards is therefore setting this one prop with a changed Asset,
   * which is what keeps a description from outliving the image it describes.
   * See ADR-0010.
   */
  asset: "asset",
  /**
   * The Block's share of its parent's width, as a percentage.
   *
   * Recognised not for where a value goes but for what the value has to add
   * up to. A container's children divide it, so no one child's width is its
   * own business: setting one has to move another, and adding one has to be
   * paid for. That arithmetic can only live where the siblings are visible,
   * which is the editor — a Definition renders one Block and cannot see the
   * row around it.
   *
   * The kind is what the editor recognises; the name of the prop is the
   * Definition's own. The floor comes from the entry's `constraints.min`, so a
   * Preset says how narrow its columns may be in the same place it says
   * everything else about the number, and the core holds no opinion about
   * pixels. See ADR-0016.
   */
  width: "width",
  /**
   * A surface — something a colour is painted on, or is not.
   *
   * Recognised in order to take a value *away*. A surface with no colour must
   * emit no declaration rather than the word for one, and until this kind
   * existed that rule was a helper eleven Definitions had to remember to call.
   * Two of them did not. The kind moves the rule to the two paths that turn a
   * prop into CSS — the inline style and the mobile stylesheet — so a
   * Definition receives a colour or nothing and cannot reach the sentinel at
   * all. See ADR-0019.
   *
   * It may appear more than once on a Block, because nothing ever looks it up:
   * a Section paints a band across the window and a column of content inside
   * it, and both are surfaces. Every prop of the kind is resolved and none is
   * singled out.
   *
   * Membership is decided by where the value lands, not by where it starts. A
   * button's fill is a surface that happens to default to black, and an Author
   * emptying it gets a button with no fill rather than the string `none`.
   */
  surface: "surface-color",
  /**
   * An alignment: `"start"`, `"center"` or `"end"`, by reading order
   * (ADR-0027).
   *
   * Recognised only to tell a Consumer something. Its Control Descriptor
   * carries the email's direction, so an Inspector can draw `start` on the
   * right in a right-to-left email. Turning it into `left` or `right` is the
   * Definition's job, at render.
   */
  align: "align",
  /**
   * Markup the Author wrote by hand.
   *
   * Stored exactly as written and cleaned on the way out, the same way in the
   * Canvas and in render: a Definition's `render` receives it already cleaned,
   * with every `<style>` rule scoped to the class `htmlScopeOf(block.id)`,
   * which the Definition puts on the element round the markup. A Validator
   * reports a Diagnostic when cleaning will change it. See ADR-0028.
   */
  html: "html",
  /**
   * A link: a URL that becomes an `href`.
   *
   * Checked on the way out, the same way in the Canvas and in render: a
   * Definition's `render` receives the stored value when its scheme is one an
   * email may carry, or a relative path or fragment, and `""` otherwise. So
   * putting it straight into an `href` is correct, and `""` should mean no
   * link. See ADR-0033.
   */
  url: "url",

  // Plain kinds. The library passes these through to the Consumer untouched.

  /** A line of plain text. */
  text: "text",
  /** A number. */
  number: "number",
  /** On or off. */
  boolean: "boolean",
  /** One of the entry's `constraints.options`. */
  select: "select",
  /**
   * A CSS colour that always has one. A colour that may be none is a surface.
   *
   * Either kind may list Brand Colours as `constraints.brandColors`, each a
   * `{ label, value }`. An Agent is told them; the Document stores the value.
   * Read them with `brandColorsOf`.
   */
  color: "color",
} as const;

/**
 * What a Definition's `render` receives for a {@link SchemaKind.surface} prop:
 * a CSS colour, or `undefined` when the Author has cleared it.
 *
 * Declare a surface prop as this and putting it straight into a style is
 * correct — React omits an `undefined` style value, which is exactly the
 * "no declaration at all" the rule asks for.
 *
 * A convention rather than a guarantee. `render` is called through the erased
 * `BlockDefinition` the registry holds, where every prop is `unknown`, so the
 * library cannot make a Definition declare this. One that declares `string`
 * still behaves correctly — it is only lying to its own reader.
 */
export type Surface = string | undefined;

/**
 * Which prop a Block Definition keeps its rich text in, if any.
 *
 * A Block has at most one: the Text Engine interface is scoped to a Block
 * (ADR-0005), so a second rich-text prop would have nowhere to put its
 * history. The first one declared wins.
 */
export function richTextPropOf(
  definition: BlockDefinition | undefined,
): string | undefined {
  return propOfKind(definition, SchemaKind.richText);
}

/**
 * What the Block's rich text may hold, as its Schema entry's `constraints`
 * declare it.
 *
 * Read by the store, the render path and the Text Engine alike, so the text an
 * Author types, the string the Document stores and the email all agree about
 * where paragraphs and lists fall (ADR-0023, ADR-0029). A Block with no rich
 * text holds nothing.
 */
export function textShapeOf(
  definition: BlockDefinition | undefined,
): TextShape {
  const prop = richTextPropOf(definition);
  return entryTextShape(
    prop === undefined ? undefined : definition?.schema[prop],
  );
}

/**
 * What one rich-text Schema entry may hold. A Block can have more than one,
 * and each holds what its own `constraints` say.
 */
export function entryTextShape(entry: SchemaEntry | undefined): TextShape {
  const constraints = entry?.constraints;
  const paragraphs = constraints?.["paragraphs"] === true;
  return { paragraphs, lists: paragraphs && constraints?.["lists"] === true };
}

/**
 * Which prop a Block Definition keeps its Primary Asset in, if any.
 *
 * Also the test for whether a Block is an image at all: a Definition with one
 * is what a dropped file or a pasted screenshot becomes. An optional Asset — a
 * section's background — is never the answer, because a section is not an
 * image (ADR-0026). The registry refuses a Definition with two.
 */
export function assetPropOf(
  definition: BlockDefinition | undefined,
): string | undefined {
  return primaryAssetPropsOf(definition)[0];
}

/** Every Asset prop a Definition marks primary, in Schema order. */
export function primaryAssetPropsOf(
  definition: BlockDefinition | undefined,
): readonly string[] {
  if (!definition) return [];
  return Object.entries(definition.schema)
    .filter(
      ([, entry]) => entry.kind === SchemaKind.asset && entry.primary === true,
    )
    .map(([name]) => name);
}

/**
 * Which prop a Block Definition keeps its share of its parent's width in.
 *
 * Also the test for whether a Block takes part in the division at all: a
 * container whose children have one divides itself between them, and one whose
 * children do not is left alone. The first one declared wins.
 */
export function widthPropOf(
  definition: BlockDefinition | undefined,
): string | undefined {
  return propOfKind(definition, SchemaKind.width);
}

/** The narrowest a width may go, as its Schema entry declares it. */
export function widthFloorOf(
  definition: BlockDefinition | undefined,
  prop: string,
): number {
  const min = definition?.schema[prop]?.constraints?.["min"];
  return typeof min === "number" ? min : 0;
}

function propOfKind(
  definition: BlockDefinition | undefined,
  kind: string,
): string | undefined {
  if (!definition) return undefined;
  for (const [name, entry] of Object.entries(definition.schema)) {
    if (entry.kind === kind) return name;
  }
  return undefined;
}
