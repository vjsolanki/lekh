import {
  SchemaKind,
  type BlockDefinition,
  type BoxSide,
  type MailClientNote,
} from "../document/definition";
import type { Block } from "../document/document";
import { originOf, resolveProps, type Origin } from "../document/props";
import { isOverridable, type Stage } from "../layout/responsive";
import { directionOf, type Direction } from "../document/typography";
import { sameValue } from "./suggestion";

/**
 * One editable prop of a Block, described as data.
 *
 * Carries nothing renderable: the Consumer renders every control in their own
 * design system (ADR-0002).
 */
export interface ControlDescriptor {
  readonly blockId: string;
  /** The prop this control edits. */
  readonly name: string;
  /** An open string — a Consumer's Block may declare a kind we never heard of. */
  readonly kind: string;
  readonly label: string;
  /**
   * The value this control is editing: on the mobile Stage the Mobile Override
   * if there is one, otherwise the stored value, otherwise the root's value for
   * a prop that follows one, otherwise the Schema default.
   */
  readonly value: unknown;
  /** Kind-specific constraints, passed through from the Schema untouched. */
  readonly constraints?: Readonly<Record<string, unknown>>;
  /**
   * The group its Schema entry declared, if it declared one.
   *
   * Descriptors arrive in Schema order, so a Consumer who groups them can do it
   * by walking the list once; one who ignores this renders a flat panel that is
   * still in a sensible order.
   */
  readonly group?: string;
  /**
   * Present on an Asset prop that is the Block's Primary Asset (ADR-0026).
   *
   * A Primary Asset is replaced and never removed: the Block is the image. An
   * optional one — absent here — can be chosen through a `"replace"` request
   * for this prop, and removed with `reset`.
   */
  readonly primary?: true;
  /**
   * Present on an {@link SchemaKind.align} prop: which way the email runs, read
   * off the root (ADR-0027).
   *
   * An alignment is stored as `start` or `end`, and which side that is depends
   * on the email. Draw `start` with a right-aligned icon in an `"rtl"` email,
   * so the Author sees the side the text will land on.
   */
  readonly direction?: Direction;
  /**
   * The Box this prop is one side of, from its Schema entry (ADR-0040).
   *
   * Draw the descriptors that share a Box as one control. Whether it is locked
   * is not stored anywhere: it is locked exactly when all its sides'
   * {@link value}s are the same. To move the sides together, open one Pending
   * Change on all of them; on the mobile Stage that writes every side's Mobile
   * Override at once.
   */
  readonly box?: string;
  /** Which side, or sides, of {@link box} this prop is. */
  readonly side?: BoxSide | readonly BoxSide[];
  /**
   * Present when the Schema entry is marked `advanced`: a prop an Author
   * rarely needs. Worth folding away by default, so the common ones are easy
   * to find; a filter that matches its label should open the fold.
   */
  readonly advanced?: true;
  /**
   * Whether this prop is Overridable — whether it can carry a Mobile Override.
   *
   * Always true on the mobile Stage, which describes nothing else. Worth an
   * affordance on the desktop Stage too — it is where an Author finds out that a
   * prop has a mobile life at all.
   */
  readonly overridable: boolean;
  /**
   * Where {@link value} comes from on the Stage in view: its Mobile Override,
   * the Block, the email, or the Schema default.
   *
   * Worth a line under every control. `"email"` says changing the email's
   * colour moves this Block and setting one here stops that (ADR-0022).
   */
  readonly origin: Origin;
  /**
   * What the other Stage holds for this prop: its value and its Origin.
   *
   * Absent when the prop is not Overridable, as the two Stages cannot differ.
   * On the mobile Stage it names the desktop value an Author would break by
   * mistake; on the desktop Stage an `"override"` here says mobile differs.
   */
  readonly otherStage?: { readonly value: unknown; readonly origin: Origin };
  /**
   * On a {@link SchemaKind.color} prop: the colour of the Surface really behind
   * it, as stored. The one its Schema entry names with `on`, or else the
   * nearest beneath it that is not None.
   *
   * For a live contrast meter while an Author drags the colour. Absent when it
   * cannot be known: a background image lies between, a colour cannot be
   * read, or nothing beneath has one. Read from the stored Document, so a
   * Pending Change on the Surface itself does not move it (ADR-0032).
   */
  readonly against?: string;
  /**
   * The Mail Client Notes that apply to {@link value}, in Schema order: what a
   * mail client will do with it that an Author would not expect (ADR-0041).
   *
   * Absent when none applies. Worth a quiet line under the control, apart from
   * Diagnostics: a note says how a client behaves, not that anything is wrong.
   * Read from the stored value, like {@link value}.
   */
  readonly clients?: readonly Omit<MailClientNote, "when">[];
  /**
   * What the front Suggestion would set this prop to, on the Stage in view,
   * and which Suggestion that is (ADR-0042). {@link value} stays the stored
   * value, so a row can strike it through and show this beside it.
   *
   * Absent with nothing selected, as then nothing is in front. Absent too when
   * the front Suggestion is not open, sets nothing here, or would
   * leave the value as it is. So a Mobile Override shows only on the mobile
   * row, and a desktop value shows on the mobile row only when no override
   * holds it.
   */
  readonly suggested?: {
    readonly value: unknown;
    readonly suggestionId: string;
  };
  /**
   * Set the value, on whichever Stage this descriptor came from. On the mobile
   * Stage that writes an override and leaves the desktop value untouched.
   */
  readonly set: (value: unknown) => void;
  /**
   * Show a value on the Canvas without storing it: a Pending Change
   * (ADR-0032). Wire a control's live event here — a colour input's `input`,
   * a slider's `onValueChange`.
   *
   * No Op, no undo entry, and no change announcement, so {@link value} stays
   * the stored value for the whole drag. Refused, opening nothing, for any
   * value `set` would refuse.
   */
  readonly preview: (value: unknown) => void;
  /**
   * End the drag: store what was last previewed, as one Op and one undo step.
   * Wire a control's end event here — a colour input's `change`, a slider's
   * `onValueCommit`.
   *
   * Given a value, that value is stored instead. With nothing pending,
   * `commit(value)` is `set(value)`, so a slider's keyboard commits fold into
   * one undo step as quick sets do. A drag that ends where it began stores
   * nothing.
   */
  readonly commit: (value?: unknown) => void;
  /**
   * Drop the Pending Change. The Canvas goes back to the stored value, and
   * there is nothing to undo. Wire Escape here.
   */
  readonly cancel: () => void;
  /**
   * Drop the Mobile Override, so the prop follows the desktop value again.
   *
   * An ordinary undoable change, and a no-op when there is no override to drop.
   */
  readonly clearOverride: () => void;
  /**
   * Clear the value set on the Block — `set` with `undefined` — so the prop
   * resolves as though the Author had never set it: to the root's value for a
   * prop that follows one, otherwise to the Schema default.
   *
   * An ordinary undoable change.
   */
  readonly reset: () => void;
}

/** How a Control Descriptor writes back. */
export interface ControlActions {
  readonly setProp: (blockId: string, prop: string, value: unknown) => void;
  readonly clearOverride: (blockId: string, prop: string) => void;
  /** Unset the prop, as its own step: a button, not a move of a drag. */
  readonly reset: (blockId: string, prop: string) => void;
  readonly preview: (blockId: string, prop: string, value: unknown) => void;
  /** End the drag on this prop, storing `value`. */
  readonly commit: (blockId: string, prop: string, value: unknown) => void;
  /** End whatever drag is open, storing what it last previewed. */
  readonly commitPending: () => void;
  readonly cancel: () => void;
}

/** A Block as the front Suggestion would leave it, for its descriptors. */
export interface SuggestedBlock {
  readonly suggestionId: string;
  /** The Block after the Suggestion. */
  readonly block: Block;
  /** The root's props after the Suggestion, as `rootProps` reads them. */
  readonly rootProps: Readonly<Record<string, unknown>>;
  /** The props it sets on the Block. */
  readonly props: readonly string[];
}

/**
 * Turn a Block's Schema and current props into Control Descriptors.
 *
 * A Block with no Definition yields nothing: an unregistered Block must not be
 * half-edited by an editor that does not understand it.
 *
 * On the mobile Stage only the Overridable props are described, so an Author is
 * never offered a change that would do nothing — there is no CSS to emit for a
 * prop that declared no mobile declarations (ADR-0007).
 */
export function describeControls(
  block: Block,
  definition: BlockDefinition | undefined,
  stage: Stage,
  actions: ControlActions,
  rootProps: Readonly<Record<string, unknown>>,
  /** The Surface colour behind one of the Block's colour props, if known. */
  against: (prop: string) => string | undefined,
  /** The Block as the front Suggestion would leave it, if one touches it. */
  suggestion?: SuggestedBlock,
): readonly ControlDescriptor[] {
  if (!definition) return [];

  const resolved = resolveProps(block, definition, { stage, rootProps });
  const other: Stage = stage === "mobile" ? "desktop" : "mobile";
  const otherResolved = resolveProps(block, definition, {
    stage: other,
    rootProps,
  });
  const after =
    suggestion &&
    resolveProps(suggestion.block, definition, {
      stage,
      rootProps: suggestion.rootProps,
    });
  const suggestedOf = (name: string) =>
    after &&
    suggestion.props.includes(name) &&
    !sameValue(after[name], resolved[name])
      ? {
          suggested: {
            value: after[name],
            suggestionId: suggestion.suggestionId,
          },
        }
      : {};
  return Object.entries(definition.schema)
    .filter(([, entry]) => stage === "desktop" || isOverridable(entry))
    .map(([name, entry]) => {
      const overridable = isOverridable(entry);
      const behind =
        entry.kind === SchemaKind.color ? against(name) : undefined;
      const clients = (entry.clients ?? [])
        .filter((note) => note.when(resolved[name]))
        .map(({ client, note }) => ({ client, note }));
      return {
        blockId: block.id,
        name,
        kind: entry.kind,
        label: entry.label,
        value: resolved[name],
        ...(entry.constraints === undefined
          ? {}
          : { constraints: entry.constraints }),
        ...(entry.group === undefined ? {} : { group: entry.group }),
        ...(entry.primary === true ? { primary: true as const } : {}),
        ...(entry.kind === SchemaKind.align
          ? { direction: directionOf(rootProps) }
          : {}),
        ...(entry.box === undefined || entry.side === undefined
          ? {}
          : { box: entry.box, side: entry.side }),
        ...(entry.advanced === true ? { advanced: true as const } : {}),
        overridable,
        origin: originOf(block, name, entry, stage, rootProps),
        ...(overridable
          ? {
              otherStage: {
                value: otherResolved[name],
                origin: originOf(block, name, entry, other, rootProps),
              },
            }
          : {}),
        ...(behind === undefined ? {} : { against: behind }),
        ...(clients.length === 0 ? {} : { clients }),
        ...suggestedOf(name),
        set: (value: unknown) => {
          actions.setProp(block.id, name, value);
        },
        preview: (value: unknown) => {
          actions.preview(block.id, name, value);
        },
        // A rest parameter, because `commit(undefined)` stores `undefined` — a
        // reset — and `commit()` stores the preview. Only the count tells them
        // apart.
        commit: (...value: readonly unknown[]) => {
          if (value.length === 0) actions.commitPending();
          else actions.commit(block.id, name, value[0]);
        },
        cancel: actions.cancel,
        clearOverride: () => {
          actions.clearOverride(block.id, name);
        },
        reset: () => {
          actions.reset(block.id, name);
        },
      };
    });
}
