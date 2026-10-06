import { defineBlock, isBlank } from "lekh-editor";
import type { Preset, SetPropRepair } from "lekh-editor";

import { resolvedProp } from "./resolved-prop";

/** Your codes. Stable ids, so your panel can word the finding itself. */
export const EMPTY_PREFERENCES_LABEL = "preferences-label-empty";
export const EMPTY_DISCLAIMER = "disclaimer-empty";

export const PREFERENCES_TYPE = "preference-centre";
export const DISCLAIMER_TYPE = "legal-disclaimer";

export interface HouseFooterOptions {
  /** Where the preference centre lives. Configuration, so it is never a prop. */
  readonly preferencesUrl: string;
  /** The wording a new email starts with. Content, so it is an ordinary prop. */
  readonly disclaimer?: string;
}

const DEFAULT_LABEL = "Manage your preferences";

/**
 * A footer of your own that no one can lose.
 *
 * A factory, because the URL is configuration: a Preset that hard-coded it
 * would leave anybody with a different one maintaining a fork.
 */
export function createHouseFooterPreset(options: HouseFooterOptions): Preset {
  return [preferencesLink(options), disclaimerBlock(options)];
}

/** The link every email must carry, and nobody may delete on its own. */
function preferencesLink({ preferencesUrl }: HouseFooterOptions) {
  return defineBlock<{ label: string }>({
    type: PREFERENCES_TYPE,
    label: "Preference centre link",
    // Every Document must hold one of these.
    required: true,
    // And a direct delete is refused.
    deletable: false,
    schema: {
      // The words are editable. They have to be, or the Block cannot produce a
      // footer in any language but English.
      label: { kind: "text", label: "Link text", defaultValue: DEFAULT_LABEL },
    },

    validate: (block, context) => {
      if (!isBlank(resolvedProp(block, context, "label"))) return [];

      // Unset the prop rather than write the words back. The Schema default is
      // already right, in whatever language you set it to.
      const repair: SetPropRepair = {
        kind: "set-prop",
        blockId: block.id,
        prop: "label",
        value: undefined,
      };

      return [
        {
          code: EMPTY_PREFERENCES_LABEL,
          message: "The preferences link has no text, so nobody can find it.",
          // An error. A link nobody can see is the same as no link, and this
          // is a fact rather than a guess.
          severity: "error",
          blockId: block.id,
          repair,
        },
      ];
    },

    render: ({ props }) => (
      <p style={{ margin: 0, fontSize: 12, textAlign: "center" }}>
        <a href={preferencesUrl} style={{ color: "#6f6f6f" }}>
          {props.label}
        </a>
      </p>
    ),
  });
}

/** The wording legal want on every email. */
function disclaimerBlock({ disclaimer = "" }: HouseFooterOptions) {
  return defineBlock<{ text: string }>({
    type: DISCLAIMER_TYPE,
    label: "Legal disclaimer",
    required: true,
    deletable: false,
    schema: {
      text: {
        kind: "text",
        label: "Disclaimer",
        defaultValue: disclaimer,
        constraints: { multiline: true },
      },
    },

    validate: (block, context) =>
      isBlank(resolvedProp(block, context, "text"))
        ? [
            {
              code: EMPTY_DISCLAIMER,
              message: "This email carries no disclaimer.",
              // A warning, because the usual way to reach it is you not having
              // configured one yet. Escalate it with `severities` when your
              // product needs the send to fail on it.
              severity: "warning",
              blockId: block.id,
              // No repair. Nothing here knows what your lawyers wrote.
            },
          ]
        : [],

    render: ({ props }) => (
      <p style={{ margin: 0, fontSize: 11, color: "#6f6f6f" }}>{props.text}</p>
    ),
  });
}
