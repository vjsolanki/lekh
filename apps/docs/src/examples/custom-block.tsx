import { defineBlock } from "lekh-editor";

// A type alias rather than an interface: an interface has no implicit index
// signature, so it does not satisfy the `Record<string, unknown>` constraint.
type PreferencesProps = {
  label: string;
  color: string;
};

/**
 * A Block every email must carry, and that nobody can delete.
 *
 * The URL is captured here rather than declared in the Schema, so it never
 * becomes a control and nobody can edit it. The link text is an ordinary prop,
 * because a fixed one could not be translated.
 */
export function preferencesLink(config: { url: string }) {
  return defineBlock<PreferencesProps>({
    type: "preferences-link",
    label: "Preference centre",

    // Every email must contain one, and a direct delete is refused.
    required: true,
    deletable: false,

    schema: {
      label: {
        kind: "text",
        label: "Link text",
        defaultValue: "Manage your preferences",
      },
      color: {
        kind: "color",
        label: "Color",
        defaultValue: "#666666",
        mobile: (color) => ({ color }),
      },
    },

    render: ({ props }) => (
      <a href={config.url} style={{ color: props.color }}>
        {props.label}
      </a>
    ),
  });
}
