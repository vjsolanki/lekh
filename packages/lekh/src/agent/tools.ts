import { describeBlocks } from "../core/document/agent-schema";
import type { JSONSchema } from "../core/document/definition";
import type { Block, EmailDocument } from "../core/document/document";
import { findBlock, findLocation } from "../core/document/tree";
import type { Editor } from "../core/editor/editor";
import { renderDocument } from "../core/render/render-document";
import { toHtml } from "../to-html";
import {
  DESCRIBE_BLOCKS_DESCRIPTION,
  RENDER_PREVIEW_DESCRIPTION,
  readEmailDescription,
  suggestDescription,
} from "./descriptions";
import { plainTextOf } from "./plain-text";

/** One tool as every model SDK and MCP server takes it. */
export interface AgentToolDefinition {
  readonly name: AgentToolName;
  /** What the model is told the tool does, and lekh's rules for it. */
  readonly description: string;
  /** The tool's input, as a JSON Schema object. */
  readonly inputSchema: JSONSchema & { readonly type: "object" };
}

export type AgentToolName =
  "read_email" | "describe_blocks" | "suggest" | "render_preview";

/**
 * What a tool call gave back. `content` is plain data, safe through
 * `JSON.stringify`, to hand back to the model.
 *
 * `isError` when the call could not run at all: a tool that does not exist,
 * input of the wrong shape, or an email that would not render. A refused
 * Suggestion is not an error. It says why, Edit by Edit, for the model to fix.
 */
export interface AgentToolResult {
  readonly isError: boolean;
  readonly content: object;
}

export interface AgentToolsOptions {
  /**
   * The id of the Block the Author is asking about. `read_email` gives it
   * first, and the descriptions name it. Edits may still touch any Block: the
   * Author sees all of them before anything lands.
   */
  readonly focus?: string;
  /**
   * Accept each Suggestion as soon as it is made, for a job with no Author
   * watching. A refused one is still refused, and nothing is stored.
   */
  readonly autoAccept?: boolean;
  /** Stored on every Suggestion `suggest` makes, to tie it to your thread. */
  readonly meta?: unknown;
}

export interface AgentTools {
  /** The four tools, to hand to a model SDK or an MCP server. */
  readonly definitions: readonly AgentToolDefinition[];
  /** Run one tool call against the editor, with the input the model gave. */
  call(name: string, input: unknown): AgentToolResult;
}

/** What `read_email` gives: the Document, and the focused Block first. */
export interface EmailReading {
  /** The focused Block, and the id of the Block it sits in. */
  readonly focus?: Block & { readonly parentId?: string };
  readonly document: EmailDocument;
}

/** What `render_preview` gives. */
export interface EmailPreview {
  readonly html: string;
  readonly text: string;
}

/**
 * The Document as an Agent reads it: as stored, so every id in it can be
 * named in an Edit. The focused Block comes first, when it is there.
 */
export function readEmail(
  editor: Editor,
  options: Pick<AgentToolsOptions, "focus"> = {},
): EmailReading {
  const document = editor.getDocument();
  const { focus } = options;
  const block =
    focus === undefined ? undefined : findBlock(document.root, focus);
  if (!block) return { document };
  const parentId = findLocation(document.root, block.id)?.parent.id;
  return {
    focus: { ...(parentId === undefined ? {} : { parentId }), ...block },
    document,
  };
}

/**
 * The email as the Author sees it, open Suggestions included, as HTML and
 * plain text. Not validated: a draft may still have errors to fix.
 */
export function renderPreview(editor: Editor): EmailPreview {
  const html = toHtml(
    renderDocument(editor.getDocumentWithSuggestions(), {
      ...editor.getRenderOptions(),
      validate: false,
    }),
  );
  return { html, text: plainTextOf(html) };
}

const EMPTY_INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const PLACE: Readonly<Record<string, JSONSchema>> = {
  after: { type: "string", description: "Put it just after this sibling." },
  before: { type: "string", description: "Put it just before this sibling." },
  parent: {
    type: "string",
    description:
      "The Block it goes in. Alone, it goes last. With a sibling, the " +
      "sibling's parent.",
  },
};

const BLOCK_ID: JSONSchema = {
  type: "string",
  description: "The id of a Block, from read_email.",
};

/** An {@link Edit} as JSON Schema, for a tool of your own that takes them. */
export const EDIT_SCHEMA: JSONSchema = {
  anyOf: [
    {
      type: "object",
      title: "set-prop",
      properties: {
        kind: { const: "set-prop" },
        blockId: BLOCK_ID,
        prop: { type: "string" },
        value: {
          description: "The new value, the shape describe_blocks gives.",
        },
        stage: { enum: ["desktop", "mobile"] },
      },
      required: ["kind", "blockId", "prop", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      title: "insert",
      properties: {
        kind: { const: "insert" },
        type: { type: "string", description: "A type from describe_blocks." },
        id: {
          type: "string",
          description: "A new id, to name this Block in later Edits.",
        },
        ...PLACE,
        props: { type: "object" },
      },
      required: ["kind", "type"],
      additionalProperties: false,
    },
    {
      type: "object",
      title: "remove",
      properties: { kind: { const: "remove" }, blockId: BLOCK_ID },
      required: ["kind", "blockId"],
      additionalProperties: false,
    },
    {
      type: "object",
      title: "move",
      properties: { kind: { const: "move" }, blockId: BLOCK_ID, ...PLACE },
      required: ["kind", "blockId"],
      additionalProperties: false,
    },
  ],
};

const SUGGEST_INPUT = {
  type: "object",
  properties: {
    edits: { type: "array", minItems: 1, items: EDIT_SCHEMA },
    note: {
      type: "string",
      description: "A sentence for the Author on what this changes and why.",
    },
  },
  required: ["edits"],
  additionalProperties: false,
} as const;

/**
 * Ready tools for any model: their definitions, and a dispatcher that runs
 * a call against this editor (ADR-0034).
 *
 * lekh calls no model. Hand `definitions` to your model SDK or MCP server,
 * and each tool call it makes to `call`.
 */
export function agentTools(
  editor: Editor,
  options: AgentToolsOptions = {},
): AgentTools {
  const { focus, autoAccept = false, meta } = options;

  const definitions: readonly AgentToolDefinition[] = [
    {
      name: "read_email",
      description: readEmailDescription(focus),
      inputSchema: EMPTY_INPUT,
    },
    {
      name: "describe_blocks",
      description: DESCRIBE_BLOCKS_DESCRIPTION,
      inputSchema: EMPTY_INPUT,
    },
    {
      name: "suggest",
      description: suggestDescription(focus, autoAccept),
      inputSchema: SUGGEST_INPUT,
    },
    {
      name: "render_preview",
      description: RENDER_PREVIEW_DESCRIPTION,
      inputSchema: EMPTY_INPUT,
    },
  ];

  const suggest = (input: unknown): AgentToolResult => {
    const { edits, note } = isRecord(input) ? input : {};
    if (!Array.isArray(edits)) {
      return failed("`edits` must be a list of Edits.");
    }
    if (note !== undefined && typeof note !== "string") {
      return failed("`note` must be a string.");
    }
    // Each Edit is checked by the editor, which refuses a malformed one by
    // its index rather than throwing.
    const made = editor.suggest(edits, {
      ...(note === undefined ? {} : { note }),
      ...(meta === undefined ? {} : { meta }),
    });
    if (made.status === "refused") {
      return { isError: false, content: made };
    }
    // A fresh Suggestion accepts, unless storing an open Pending Change
    // first left it stale. Say so rather than claim it was stored.
    const accepted = autoAccept ? made.accept() : undefined;
    return {
      isError: false,
      content: {
        status:
          accepted === "accepted" || accepted === "stale"
            ? accepted
            : made.status,
        suggestion: made.id,
        diagnostics: made.diagnostics,
      },
    };
  };

  const run = (name: string, input: unknown): AgentToolResult => {
    switch (name) {
      case "read_email": {
        return { isError: false, content: readEmail(editor, { focus }) };
      }
      case "describe_blocks": {
        return {
          isError: false,
          content: {
            rootType: editor.getDocument().root.type,
            blocks: describeBlocks(editor.getDefinitions()),
          },
        };
      }
      case "suggest": {
        return suggest(input);
      }
      case "render_preview": {
        return { isError: false, content: renderPreview(editor) };
      }
      default: {
        return failed(
          `No tool is named "${name}". The tools are ` +
            `${definitions.map((tool) => tool.name).join(", ")}.`,
        );
      }
    }
  };

  return {
    definitions,
    call(name, input) {
      try {
        return run(name, input);
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const failed = (error: string): AgentToolResult => ({
  isError: true,
  content: { error },
});
