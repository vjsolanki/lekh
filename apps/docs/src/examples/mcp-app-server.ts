import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  agentTools,
  createEditor,
  type Editor,
  type EmailDocument,
  renderPreview,
  type SuggestionJSON,
} from "lekh-editor";
import {
  createReactEmailPreset,
  REACT_EMAIL_ROOT_TYPE,
} from "lekh-editor/blocks";

/** The Canvas, bundled into one HTML file. See mcp-app-canvas.tsx. */
const CANVAS_URI = "ui://your-emails/canvas.html";
const CANVAS_HTML = new URL("dist/canvas.html", import.meta.url);

const definitions = createReactEmailPreset();
const user = await signIn(process.env.YOUR_APP_TOKEN);

// The Canvas shows under these two calls, in the chat.
const showsCanvas = { ui: { resourceUri: CANVAS_URI } };
// Only the Canvas calls these. Your agent never sees them.
const canvasOnly = { ui: { resourceUri: CANVAS_URI, visibility: ["app"] } };

const lekhTools = agentTools(
  createEditor({ definitions, rootType: REACT_EMAIL_ROOT_TYPE }),
).definitions.map((tool) =>
  tool.name === "suggest" ? { ...tool, _meta: showsCanvas } : tool,
);

const ownTools = [
  {
    name: "list_emails",
    description: "List the emails you can edit, with their ids.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "open_email",
    description:
      "Open an email by its id, and show it in the chat. The other tools work on the open email.",
    inputSchema: {
      type: "object",
      properties: { email_id: { type: "string" } },
      required: ["email_id"],
    },
    _meta: showsCanvas,
  },
  {
    name: "load_email",
    description: "The open email and its open Suggestions.",
    inputSchema: { type: "object", properties: {} },
    _meta: canvasOnly,
  },
  {
    name: "focus_block",
    description: "The Block the next ask is about.",
    inputSchema: {
      type: "object",
      properties: { block_id: { type: "string" } },
      required: ["block_id"],
    },
    _meta: canvasOnly,
  },
  {
    name: "save_email",
    description:
      "Save the email after an edit on the Canvas, and drop the Suggestions accepted or rejected there.",
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "object" },
        settled: { type: "array", items: { type: "string" } },
      },
      required: ["document", "settled"],
    },
    _meta: canvasOnly,
  },
] as const;

let openId: string | undefined;
let focus: string | undefined;

const { server } = new McpServer(
  { name: "your-emails", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListResourcesRequestSchema, () => ({
  resources: [
    { uri: CANVAS_URI, name: "Email editor", mimeType: RESOURCE_MIME_TYPE },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async () => ({
  contents: [
    {
      uri: CANVAS_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(CANVAS_HTML, "utf8"),
      // Where your users' images and fonts live. The chat blocks the rest.
      _meta: {
        ui: { csp: { resourceDomains: ["https://images.example.com"] } },
      },
    },
  ],
}));

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [...ownTools, ...lekhTools],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: input = {} } = request.params;

  if (name === "list_emails") {
    return reply(await listEmails(user));
  }
  if (name === "open_email") {
    const id = input.email_id;
    if (typeof id !== "string" || !(await loadEmail(user, id))) {
      return failed(`No email you can edit has the id ${String(id)}.`);
    }
    openId = id;
    focus = undefined;
    return reply({ opened: id });
  }
  if (openId === undefined) {
    return failed("Open an email first, with open_email.");
  }

  const document = await loadEmail(user, openId);
  if (!document) return failed(`The email ${openId} is gone.`);
  const suggestions = await loadSuggestions(user, openId);

  if (name === "load_email") {
    return reply({ document, suggestions });
  }
  if (name === "focus_block") {
    focus = typeof input.block_id === "string" ? input.block_id : undefined;
    return reply({ focus });
  }
  if (name === "save_email") {
    // Check it as your API checks a save from your editor in the browser.
    if (!isEmailDocument(input.document)) return failed("Not an email.");
    const settled = new Set(Array.isArray(input.settled) ? input.settled : []);
    await saveEmail(user, openId, input.document);
    // Read again: your agent may have suggested something meanwhile.
    const latest = await loadSuggestions(user, openId);
    await saveSuggestions(
      user,
      openId,
      latest.filter((json) => !settled.has(keyOf(json))),
    );
    return reply({ saved: true });
  }

  // Your agent's tools. Open the email with its Suggestions, so render_preview
  // draws them, and a new one is checked against them.
  const editor = createEditor({ definitions, document });
  for (const json of suggestions) editor.suggest(json.edits, json);

  if (name === "render_preview") {
    return reply(renderPreview(editor));
  }

  // No autoAccept: your users accept or reject on the Canvas. The key in
  // `meta` names the Suggestion across saves, where its id does not last.
  const result = agentTools(editor, {
    focus,
    meta: { key: randomUUID() },
  }).call(name, input);
  if (name === "suggest") {
    await saveSuggestions(user, openId, suggestionsOf(editor));
    // The ask is answered. The next one may not be about this Block.
    focus = undefined;
  }
  return reply(result.content, result.isError);
});

await server.connect(new StdioServerTransport());

function suggestionsOf(editor: Editor): SuggestionJSON[] {
  return editor.getSuggestions().map((suggestion) => suggestion.toJSON());
}

function keyOf({ meta }: SuggestionJSON): string | undefined {
  return typeof meta === "object" &&
    meta !== null &&
    "key" in meta &&
    typeof meta.key === "string"
    ? meta.key
    : undefined;
}

function reply(content: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(content) }],
    isError,
  };
}

function failed(error: string): CallToolResult {
  return reply({ error }, true);
}

// Your own code, from here down.
interface User {
  readonly id: string;
}
declare function signIn(token: string | undefined): Promise<User>;
declare function listEmails(
  user: User,
): Promise<readonly { id: string; name: string }[]>;
declare function loadEmail(
  user: User,
  id: string,
): Promise<EmailDocument | undefined>;
declare function isEmailDocument(value: unknown): value is EmailDocument;
declare function saveEmail(
  user: User,
  id: string,
  document: EmailDocument,
): Promise<void>;
declare function loadSuggestions(
  user: User,
  id: string,
): Promise<SuggestionJSON[]>;
declare function saveSuggestions(
  user: User,
  id: string,
  suggestions: readonly SuggestionJSON[],
): Promise<void>;
