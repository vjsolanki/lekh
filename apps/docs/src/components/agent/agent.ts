/**
 * The scripted agent: the stand-in for your model.
 *
 * It knows a few phrases per Block type and turns them into Edits. A real
 * model gets the same two things this does: what `read_email` gave back, and
 * the words your users typed. What it sends to `suggest` has the same shape.
 */

import type { Block, Edit, EmailDocument, EmailReading } from "lekh-editor";

/** What the agent decided: Edits to suggest, or only words. */
export type Plan =
  | { readonly reply: string; readonly edits?: undefined }
  | {
      readonly reply: string;
      readonly edits: readonly Edit[];
      readonly note: string;
    };

const TEAL = "#0f766e";

/** Rewrites the agent cycles through on "Try again". */
const SHORTER = [
  "<p>Your seat is saved. Coffee's on at 10am, and we finish at 4pm.</p>",
  "<p>You're in. Doors open at 10am. Bring nothing but yourself.</p>",
  "<p>Seat saved. See you at 10am, with coffee.</p>",
];
const FRIENDLIER = [
  "<p>You're in, and we're so glad! Your seat at the spring workshop is " +
    "saved. Come for coffee at 10am, make something lovely, and stay for " +
    "the little show at 4pm.</p>",
  "<p>Hooray, your seat is saved! We'll have the coffee ready at 10am. By " +
    "4pm you'll have made something to show off.</p>",
];
const URGENT = [
  "Only 3 days to go: your seat is saved",
  "This Saturday: your workshop seat is saved",
  "See you Saturday at 10am",
];
const POSTSCRIPT =
  "<p><em>P.S.</em> Bring a friend. Their seat is half price.</p>";

function pick(list: readonly string[], attempt: number): string {
  return list[attempt % list.length] ?? list[0] ?? "";
}

/** Quick asks, by the type of the Block the ask is about. */
const QUICK: Readonly<Record<string, readonly string[]>> = {
  heading: ["Make it more urgent", "Bigger", "Centre it"],
  text: ["Shorter please", "Friendlier", "Add a P.S. under it"],
  button: ['Teal, and say "Save my seat"', "Full width", "Round it"],
  image: ["Round the corners", "Make it smaller"],
  section: ["Remove this section"],
};

/** What to offer when no Block is in scope. */
const WHOLE_EMAIL = ["Make the buttons teal"];

export function quickAsks(type: string | undefined): readonly string[] {
  if (type === undefined) return WHOLE_EMAIL;
  return QUICK[type] ?? ["Remove this"];
}

const HELP =
  'A real model would take this one. The scripted agent knows "shorter", ' +
  '"friendlier", "urgent", "bigger", "centre", "round", "remove", "add a ' +
  'P.S.", a color, or a quoted "new text".';

/** Decide what to suggest, from what `read_email` gave back. */
export function plan(
  reading: EmailReading,
  text: string,
  attempt: number,
): Plan {
  const asked = text.toLowerCase();
  const block = reading.focus;

  if (!block) {
    if (/teal|green/u.test(asked)) {
      const buttons = blocksOfType(reading.document, "button");
      if (buttons.length === 0) {
        return { reply: "There are no buttons in this email yet." };
      }
      return {
        reply: `Turning ${countOf(buttons.length, "button")} teal.`,
        note: "Make the buttons teal",
        edits: buttons.map((button) => ({
          kind: "set-prop",
          blockId: button.id,
          prop: "backgroundColor",
          value: TEAL,
        })),
      };
    }
    return {
      reply:
        "Click a block to talk about it. For the whole email, the scripted " +
        'agent only knows "make the buttons teal".',
    };
  }

  if (/\b(remove|delete|drop)\b/u.test(asked)) {
    return {
      reply: "I'll take this out. Everything around it stays put.",
      note: "Remove it",
      edits: [{ kind: "remove", blockId: block.id }],
    };
  }

  // An ask about one Block may still touch its neighbours.
  if (/p\.?s\b/u.test(asked)) {
    return {
      reply: "Adding a P.S. just under it.",
      note: "Add a P.S.",
      edits: [
        {
          kind: "insert",
          type: "text",
          after: block.id,
          props: { content: POSTSCRIPT, fontSize: 14, color: "#3d4453" },
        },
      ],
    };
  }

  const changes = propsFor(block, asked, text, attempt);
  const props = Object.keys(changes);
  if (props.length === 0) return { reply: HELP };

  const what = props.map((prop) => WORDS[prop] ?? prop).join(" and ");
  return {
    reply: `Changing ${what}. Nothing else moves.`,
    note: `Change ${what}`,
    edits: props.map((prop) => ({
      kind: "set-prop",
      blockId: block.id,
      prop,
      value: changes[prop],
    })),
  };
}

/** How the agent names a prop to your users. */
const WORDS: Readonly<Record<string, string>> = {
  content: "the wording",
  label: "the label",
  fontSize: "the size",
  align: "the alignment",
  backgroundColor: "the color",
  fullWidth: "the width",
  borderRadius: "the corners",
  width: "the width",
};

function propsFor(
  block: Block,
  asked: string,
  text: string,
  attempt: number,
): Record<string, unknown> {
  const props = block.props ?? {};
  const quoted = /["“](.+?)["”]/u.exec(text)?.[1];
  const changes: Record<string, unknown> = {};
  const centre = /\bcent(re|er)/u.test(asked);

  switch (block.type) {
    case "heading": {
      if (/urgent/u.test(asked)) changes.content = pick(URGENT, attempt);
      if (/bigger|larger/u.test(asked)) {
        changes.fontSize = Number(props.fontSize ?? 28) + 6;
      }
      if (/smaller/u.test(asked)) {
        changes.fontSize = Math.max(18, Number(props.fontSize ?? 28) - 6);
      }
      if (quoted !== undefined) changes.content = quoted;
      if (centre) changes.align = "center";
      break;
    }
    case "text": {
      if (/short|concise|trim/u.test(asked)) {
        changes.content = pick(SHORTER, attempt);
      } else if (/friend|warm/u.test(asked)) {
        changes.content = pick(FRIENDLIER, attempt);
      }
      if (quoted !== undefined) changes.content = `<p>${quoted}</p>`;
      if (/bigger|larger/u.test(asked)) {
        changes.fontSize = Number(props.fontSize ?? 16) + 2;
      }
      if (centre) changes.align = "center";
      break;
    }
    case "button": {
      if (/teal|green/u.test(asked)) changes.backgroundColor = TEAL;
      if (/violet|purple/u.test(asked)) changes.backgroundColor = "#6d28d9";
      if (quoted !== undefined) changes.label = quoted;
      if (/full/u.test(asked)) changes.fullWidth = true;
      if (/round|pill/u.test(asked)) changes.borderRadius = 24;
      if (centre) changes.align = "center";
      break;
    }
    case "image": {
      if (/round/u.test(asked)) changes.borderRadius = 12;
      if (/smaller/u.test(asked)) changes.width = 320;
      if (centre) changes.align = "center";
      break;
    }
    default: {
      break;
    }
  }
  return changes;
}

function blocksOfType(document: EmailDocument, type: string): Block[] {
  const found: Block[] = [];
  const visit = (block: Block): void => {
    if (block.type === type) found.push(block);
    for (const child of block.children ?? []) visit(child);
  };
  visit(document.root);
  return found;
}

export function countOf(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
