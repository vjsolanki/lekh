/**
 * The first email the scripted agent writes, once the email has no Blocks.
 *
 * A real model would send these Edits itself. Each batch is one section: the
 * section first, with an id of its own, then the Blocks that go in it, placed
 * by `parent`. Nothing here counts an index.
 */

import type { Asset, Edit } from "lekh";

import { HERO, WORDMARK } from "@/components/editor/stock";

const INK = "#12141a";
const BODY = "#3d4453";
const MUTED = "#6f7686";
const PAPER = "#ffffff";

/** An image from the asset library, as the Asset a Block stores. */
function asset(image: Asset, alt: string): Asset {
  return { src: image.src, width: image.width, height: image.height, alt };
}

/** A section with the example's paper and padding, and an id to place by. */
function section(id: string, top: number, bottom: number): Edit {
  return {
    kind: "insert",
    type: "section",
    id,
    parent: "root",
    props: {
      backgroundColor: PAPER,
      paddingTop: top,
      paddingRight: 32,
      paddingBottom: bottom,
      paddingLeft: 32,
    },
  };
}

/** One section of the first email, and what the chat says as it lands. */
export interface Section {
  readonly label: string;
  readonly edits: readonly Edit[];
}

export const FIRST_EMAIL: readonly Section[] = [
  {
    label: "Masthead",
    edits: [
      section("masthead", 28, 20),
      {
        kind: "insert",
        type: "image",
        id: "masthead-mark",
        parent: "masthead",
        props: { asset: asset(WORDMARK, "lekh"), width: 132 },
      },
    ],
  },
  {
    label: "Headline and intro",
    edits: [
      section("lead", 4, 8),
      {
        kind: "insert",
        type: "heading",
        id: "headline",
        parent: "lead",
        props: {
          content: "Your spring workshop seat is saved",
          fontSize: 32,
          color: INK,
        },
      },
      {
        kind: "insert",
        type: "text",
        id: "intro",
        parent: "lead",
        props: {
          content:
            "<p>Thanks for signing up. Your seat at the spring workshop is " +
            "saved, and we can't wait to see you there. The day starts at " +
            "10am with coffee, and ends at 4pm with a small exhibition of " +
            "everything people made.</p>",
          color: BODY,
        },
      },
    ],
  },
  {
    label: "Picture",
    edits: [
      section("picture", 8, 8),
      {
        kind: "insert",
        type: "image",
        id: "hero",
        parent: "picture",
        props: {
          asset: asset(HERO, "The harbour studio at dawn"),
          width: 536,
        },
      },
    ],
  },
  {
    label: "Button",
    edits: [
      section("action", 12, 20),
      {
        kind: "insert",
        type: "button",
        id: "add-to-calendar",
        parent: "action",
        props: {
          label: "Add to calendar",
          href: "https://example.com/workshop/calendar",
          backgroundColor: "#12141a",
          borderRadius: 6,
        },
      },
    ],
  },
  {
    label: "Footer",
    edits: [
      section("footer", 16, 28),
      {
        kind: "insert",
        type: "divider",
        parent: "footer",
        props: { color: "#e3e5ea" },
      },
      {
        kind: "insert",
        type: "text",
        id: "footer-note",
        parent: "footer",
        props: {
          content:
            "<p>You're getting this because you booked a workshop. " +
            "Questions? Reply to this email.</p>",
          fontSize: 12,
          color: MUTED,
          align: "center",
        },
      },
      {
        kind: "insert",
        type: "unsubscribe",
        parent: "footer",
        props: { color: MUTED, align: "center" },
      },
      {
        kind: "insert",
        type: "postal-address",
        parent: "footer",
        props: { color: MUTED, align: "center" },
      },
    ],
  },
];

export const DEFAULT_PROMPT =
  "A confirmation for our spring workshop. Warm, short. One button to add it to a calendar.";

/**
 * What an empty email offers to start from, one tap each: a short label, and
 * the brief it sends. The scripted agent writes the same draft for all of
 * them. A model would write to the brief.
 */
export const STARTERS: readonly {
  readonly label: string;
  readonly prompt: string;
}[] = [
  { label: "Workshop confirmation", prompt: DEFAULT_PROMPT },
  {
    label: "Welcome email",
    prompt:
      "A welcome email for new members. One button to set up their account.",
  },
  {
    label: "Monthly newsletter",
    prompt: "A short monthly newsletter: one story, one picture, one link.",
  },
];
