/**
 * The Preset's Block types and Diagnostic codes, named once.
 *
 * Every Block file reads its own type from here and every accepts rule lists
 * the others from here, so a type is spelt in one place.
 */

/** The root type this Preset's Documents are built around. */
export const REACT_EMAIL_ROOT_TYPE = "email";

/** Every type this Preset registers, by the name its file goes by. */
export const BLOCK_TYPE = {
  email: REACT_EMAIL_ROOT_TYPE,
  section: "section",
  columns: "columns",
  column: "column",
  heading: "heading",
  text: "text",
  image: "image",
  button: "button",
  divider: "divider",
  spacer: "spacer",
  html: "html",
  iconRow: "icon-row",
  icon: "icon",
  nav: "nav",
  navLink: "nav-link",
} as const;

/**
 * The leaf types the compliance Preset ships, named here rather than imported
 * so that this entry point stays independent of that one.
 *
 * They are in the accepts rules because the two shipped Presets have to
 * compose without configuration: a Required Block the root does not accept is a
 * construction-time failure, and an unsubscribe link an Author cannot drag into
 * their footer is not much of a footer. A type nothing claims is inert — only a
 * registered type can be inserted — so a Consumer who never composes the
 * compliance Preset pays two strings for it.
 */
const COMPLIANCE_TYPES = ["unsubscribe", "postal-address"];

/** What a container holds: every Block but the root and the containers. */
export const LEAF_TYPES = [
  BLOCK_TYPE.heading,
  BLOCK_TYPE.text,
  BLOCK_TYPE.image,
  BLOCK_TYPE.button,
  BLOCK_TYPE.divider,
  BLOCK_TYPE.spacer,
  BLOCK_TYPE.html,
  BLOCK_TYPE.iconRow,
  BLOCK_TYPE.nav,
  ...COMPLIANCE_TYPES,
];

/**
 * Every code this Preset raises, keyed by the code in camelCase. A code names
 * its subject first.
 */
export const PresetDiagnostic = {
  /** The root's font is a stack that cannot be emitted, so the default renders. */
  fontFamilyUnsafe: "font-family-unsafe",
  /**
   * The root's text or link colour is not a colour that can be written, so the
   * default renders (ADR-0022).
   */
  emailColorUnusable: "email-color-unusable",
  /**
   * A section or row has a content background image and no content colour, so
   * with images off its text sits on whatever is behind it (#73).
   */
  backgroundImageColorMissing: "background-image-color-missing",
  /** An image has no alt text. */
  imageAltTextMissing: "image-alt-text-missing",
  /** A button links nowhere. */
  buttonHrefMissing: "button-href-missing",
  /** An icon has no image, so the email leaves it out. */
  iconImageMissing: "icon-image-missing",
  /** An icon has an image with no alt text. */
  iconAltTextMissing: "icon-alt-text-missing",
  /** A nav link has no label, so the email leaves it out. */
  navLinkLabelMissing: "nav-link-label-missing",
  /** A nav link links nowhere. */
  navLinkHrefMissing: "nav-link-href-missing",
} as const;
