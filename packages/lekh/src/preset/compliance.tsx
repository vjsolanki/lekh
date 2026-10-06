/**
 * The compliance Preset, on `lekh-editor/blocks`.
 *
 * Commercial email is regulated. CAN-SPAM wants a working opt-out mechanism and
 * a valid physical postal address in every message; GDPR and CASL add their
 * own. Shipping an editor without these Blocks hands an Author a tool that
 * produces illegal messages, and shipping them as ordinary content hands them
 * one they can break by accident.
 *
 * So the two Blocks here are Required, and the unsubscribe URL is configuration
 * rather than content. Nothing here claims to make a Consumer compliant; it
 * makes the two mechanical requirements hard to lose.
 *
 * A Preset of its own rather than part of the built-in one, so a Consumer
 * building transactional email — a password reset must not carry an
 * unsubscribe link — simply never composes it in.
 */

import { Link, Text } from "@react-email/components";
import { Fragment, type ReactElement, type ReactNode } from "react";

import { missingProp } from "../core/validate/blank";
import { NONE } from "../core/document/color";
import { defineBlock, SchemaKind } from "../core/document/definition";
import type {
  BlockDefinition,
  Preset,
  SchemaEntry,
  Surface,
} from "../core/document/definition";
import type { SetPropRepair } from "../core/validate/repair";
import type { MobileRenderContext } from "../core/layout/responsive";
import {
  alignment,
  ALIGNMENT_BY_READING_ORDER,
  alignSchema,
  DEFAULT_FONT_STACK,
  directionOf,
  type Direction,
  fontFamilyOf,
  lineHeightPercent,
  pixels,
} from "../core/document/typography";

/** The unsubscribe Block's type, for a Consumer composing accepts rules. */
export const UNSUBSCRIBE_TYPE = "unsubscribe";
/** The postal address Block's type. */
export const POSTAL_ADDRESS_TYPE = "postal-address";

/**
 * Every code this Preset raises, keyed by the code in camelCase. A code names
 * its subject first.
 */
export const ComplianceDiagnostic = {
  /** The postal address Block carries no address. */
  postalAddressEmpty: "postal-address-empty",
  /** The unsubscribe link has a label nobody can see. */
  unsubscribeLabelEmpty: "unsubscribe-label-empty",
} as const;

export interface CompliancePresetOptions {
  /**
   * The URL the unsubscribe link points at — whatever the email service
   * provider substitutes per recipient, such as `%%unsubscribe_link%%` or
   * `{{unsubscribe_url}}`.
   *
   * Required, and deliberately without a default: an unsubscribe URL is
   * per-recipient, so it does not exist at design time and no Author can ever
   * supply it. A default would be a guess at somebody else's substitution
   * syntax, silently shipping a dead link.
   *
   * It is baked into the Block's renderer rather than stored as a prop, so it
   * never reaches the Inspector, never enters a Document, and changing
   * provider needs no migration of stored emails.
   */
  readonly unsubscribeUrl: string;
  /**
   * The postal address a Document starts with.
   *
   * Optional where the URL is not, because this one *is* content: it is the
   * same for every recipient, an Author can type it, and it has to be
   * reformattable, since how an address is laid out differs by country. Like
   * every Schema default it is only a starting point — an email an Author has
   * edited keeps what they wrote, and one they have not follows this.
   */
  readonly postalAddress?: string;
  /**
   * Font stack for a root that names none of its own. Under the built-in
   * Preset's root the footer writes the email's font, so it matches the email
   * above it (ADR-0021).
   */
  readonly fontFamily?: string;
}

interface ComplianceDefaults {
  readonly unsubscribeUrl: string;
  readonly postalAddress: string;
  readonly fontFamily: string;
}

/**
 * Grey enough to sit quietly under a footer, dark enough to clear 4.5:1 against
 * white — the shipped defaults must not fail the shipped contrast Validator.
 */
const MUTED = "#6f6f6f";

/** Where a footer sits, and what a compliance Block's own styling amounts to. */
const FOOTER_ALIGNMENT = "center";

/**
 * The styling props both compliance Blocks carry, identically.
 *
 * Ordinary Schema props, and there is deliberately no attempt to stop an
 * Author making the link inconspicuous with them: the controls that would have
 * to go are the ones needed to design a footer at all, and the label is a
 * weaker circumvention route than any of them. There is no `hideOnMobile`,
 * though — that one is not a design control, it is a switch that takes the
 * link off most of the opens.
 */
const FOOTER_STYLING: {
  readonly fontSize: SchemaEntry<number>;
  readonly color: SchemaEntry<string>;
  readonly backgroundColor: SchemaEntry<string>;
  readonly align: SchemaEntry<string>;
} = {
  fontSize: {
    kind: SchemaKind.number,
    label: "Font size",
    defaultValue: 12,
    constraints: { min: 10, max: 24, unit: "px" },
    mobile: pixels("font-size"),
  },
  color: { kind: SchemaKind.color, label: "Color", defaultValue: MUTED },
  // Every Block in this library takes a surface of its own, and a footer is one
  // of the places an Author actually reaches for one — a tinted strip under the
  // content. `NONE` by default, so a Block nobody has styled shows the section
  // behind it rather than a colour this file picked for their brand.
  backgroundColor: {
    kind: SchemaKind.surface,
    label: "Background color",
    defaultValue: NONE,
  },
  align: alignSchema(FOOTER_ALIGNMENT, true),
};

/**
 * Both footer Blocks store alignment by reading order from version 1
 * (ADR-0027). A footer stored before it said `left` or `right`.
 */
const FOOTER_VERSIONS = {
  version: 1,
  migrations: { 1: ALIGNMENT_BY_READING_ORDER },
};

/**
 * What `FOOTER_STYLING` resolves to by the time a Block renders.
 *
 * A type alias rather than an interface because a Block Definition's props have
 * to stay assignable to the erased `Record<string, unknown>` the registry holds,
 * and only an alias picks up the implicit index signature that needs.
 */
type FooterStyling = {
  readonly fontSize: number;
  readonly color: string;
  readonly backgroundColor: Surface;
  readonly align: string;
};

/**
 * Build the compliance Block Definitions.
 *
 * A factory because the unsubscribe URL is configuration: a Preset must be
 * configurable where it must be, or every Consumer whose provider substitutes a
 * different token ends up maintaining a fork.
 */
export function createCompliancePreset(
  options: CompliancePresetOptions,
): Preset {
  const config: ComplianceDefaults = {
    unsubscribeUrl: options.unsubscribeUrl,
    postalAddress: options.postalAddress ?? "",
    fontFamily: options.fontFamily ?? DEFAULT_FONT_STACK,
  };

  const definitions: readonly BlockDefinition[] = [
    unsubscribeBlock(config),
    postalAddressBlock(config),
  ];
  return definitions;
}

/**
 * The opt-out an Author may move, restyle and reword, but never break.
 *
 * Required, so every Document must contain one, and non-deletable, so it
 * cannot be removed on its own. Deleting an ancestor that contains it still
 * succeeds: refusing that would make redesigning a footer impossible, so the
 * Document simply becomes invalid and says so through a Diagnostic carrying a
 * Repair, and the render path refuses (ADR-0006).
 */
function unsubscribeBlock(config: ComplianceDefaults) {
  return defineBlock<FooterStyling & { label: string }>({
    type: UNSUBSCRIBE_TYPE,
    label: "Unsubscribe link",
    required: true,
    ...FOOTER_VERSIONS,
    deletable: false,
    schema: {
      // Freely editable, and it has to be: a fixed label would leave the
      // library unable to produce a compliant email in any language but
      // English.
      label: {
        kind: SchemaKind.text,
        label: "Link text",
        defaultValue: "Unsubscribe",
      },
      ...FOOTER_STYLING,
    },
    validate: (block, context) => {
      // Unset it rather than write the word: the Schema default is already
      // "Unsubscribe", and a Consumer who localised the Definition gets their
      // own default back rather than an English one this file chose.
      const repair: SetPropRepair = {
        kind: "set-prop",
        blockId: block.id,
        prop: "label",
        value: undefined,
      };
      return missingProp(block, context, "label", {
        code: ComplianceDiagnostic.unsubscribeLabelEmpty,
        message:
          "The unsubscribe link has no text, so a recipient cannot find it.",
        // An invisible opt-out is not a working opt-out mechanism. This is a
        // fact rather than a heuristic, so it blocks the send — and it is the
        // library's only error-severity finding that an Author could reach
        // and then have no way out of, which is why it is the one that
        // carries a Repair.
        severity: "error",
        repair,
      });
    },
    render: ({ props, mobile, rootProps }) =>
      footerText(
        props,
        mobile,
        fontFamilyOf(rootProps, config),
        directionOf(rootProps),
        <Link
          href={config.unsubscribeUrl}
          style={{ color: props.color, textDecoration: "underline" }}
        >
          {props.label}
        </Link>,
      ),
  });
}

/**
 * The second CAN-SPAM requirement, as easy to keep as the first.
 *
 * Required and non-deletable for the same reasons, but the address itself is an
 * ordinary prop: unlike the unsubscribe URL it is the same for every recipient,
 * so an Author can perfectly well type it — and needs to be able to.
 */
function postalAddressBlock(config: ComplianceDefaults) {
  return defineBlock<FooterStyling & { address: string }>({
    type: POSTAL_ADDRESS_TYPE,
    label: "Postal address",
    required: true,
    ...FOOTER_VERSIONS,
    deletable: false,
    schema: {
      address: {
        kind: SchemaKind.text,
        label: "Postal address",
        defaultValue: config.postalAddress,
        constraints: { multiline: true },
      },
      ...FOOTER_STYLING,
    },
    validate: (block, context) =>
      missingProp(block, context, "address", {
        code: ComplianceDiagnostic.postalAddressEmpty,
        message:
          "This email carries no postal address, which commercial email is required to.",
        // A warning, unlike the empty label, because the usual way to reach
        // it is a Consumer who has not configured an address yet — and a
        // library that refused to render anything at all until they did would
        // be teaching them to turn validation off. Escalate it through
        // `severities` to make a send fail on it.
        severity: "warning",
      }),
    render: ({ props, mobile, rootProps }) =>
      footerText(
        props,
        mobile,
        fontFamilyOf(rootProps, config),
        directionOf(rootProps),
        addressLines(props.address),
      ),
  });
}

/** The one paragraph both compliance Blocks are, differing only in what is in it. */
function footerText(
  props: FooterStyling,
  mobile: MobileRenderContext,
  fontFamily: string,
  direction: Direction,
  children: ReactNode,
): ReactElement {
  return (
    <Text
      className={mobile.className}
      style={{
        color: props.color,
        backgroundColor: props.backgroundColor,
        fontFamily,
        fontSize: props.fontSize,
        // Fixed, so the footer stops taking `Text`'s 24px, which overlaps at
        // a large size.
        lineHeight: lineHeightPercent(1.5),
        margin: 0,
        textAlign: alignment(props.align, direction, FOOTER_ALIGNMENT),
      }}
    >
      {children}
    </Text>
  );
}

/**
 * An address as an Author typed it, line breaks and all.
 *
 * `<br>` rather than `white-space: pre-line`, which Outlook does not honour —
 * and an address that collapses onto one line is the requirement half met.
 */
function addressLines(address: string): readonly ReactNode[] {
  return address.split("\n").map((line, index) => (
    // Keyed by position because a line of an address has no other identity.
    // Nothing is ever inserted between two of them: the whole list is rebuilt
    // from the prop on every render.
    <Fragment key={`line-${String(index)}`}>
      {index === 0 ? null : <br />}
      {line}
    </Fragment>
  ));
}
