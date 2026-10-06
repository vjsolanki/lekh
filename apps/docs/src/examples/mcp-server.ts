import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  agentTools,
  createEditor,
  type EmailDocument,
  renderPreview,
} from "lekh-editor";
import {
  createReactEmailPreset,
  REACT_EMAIL_ROOT_TYPE,
} from "lekh-editor/blocks";

/** Where your users edit emails in their browser. */
const EDITOR_URL = "https://app.example.com/emails";

const definitions = createReactEmailPreset();

// Your auth goes here. Claude Code starts this process with the token the
// person gave it, so every call below runs as them.
const user = await signIn(process.env.YOUR_APP_TOKEN);

// No one is watching an editor here, so each Suggestion is accepted at once.
// It still goes through every check, and a refused one stores nothing.
const toolOptions = { autoAccept: true };

// The tool list is the same for every email, so read it off an empty editor.
const lekhTools = agentTools(
  createEditor({ definitions, rootType: REACT_EMAIL_ROOT_TYPE }),
  toolOptions,
).definitions;

// Your own tools, beside lekh's. lekh's tools work on the open email.
const ownTools = [
  {
    name: "list_emails",
    description: "List the emails you can edit, with their ids.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "open_email",
    description:
      "Open an email by its id. The other tools work on the open email.",
    inputSchema: {
      type: "object",
      properties: { email_id: { type: "string" } },
      required: ["email_id"],
    },
  },
] as const;

let openId: string | undefined;

// `registerTool` wants Zod schemas. The agent tools give plain JSON Schema, so
// answer the two tool requests on the underlying server instead.
const { server } = new McpServer(
  { name: "your-emails", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

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
    return reply({ opened: id, link: editorLink(id) });
  }
  if (openId === undefined) {
    return failed("Open an email first, with open_email.");
  }

  // Load fresh on every call, so edits made in the browser since are kept.
  const document = await loadEmail(user, openId);
  if (!document) return failed(`The email ${openId} is gone.`);
  const editor = createEditor({ definitions, document });
  let changed = false;
  editor.onOp(() => {
    changed = true;
  });

  if (name === "render_preview") {
    return preview(renderPreview(editor), openId);
  }

  const result = agentTools(editor, toolOptions).call(name, input);
  if (changed) await saveEmail(user, openId, editor.getDocument());
  return reply(result.content, result.isError);
});

await server.connect(new StdioServerTransport());

function editorLink(id: string): string {
  return `${EDITOR_URL}/${id}`;
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

/**
 * A terminal shows text, so the plain text comes first, with a link to the
 * real editor. The HTML rides along for clients that can show it.
 */
function preview(
  email: { html: string; text: string },
  id: string,
): CallToolResult {
  return {
    content: [
      { type: "text", text: email.text },
      { type: "text", text: `Open it in the editor: ${editorLink(id)}` },
      {
        type: "resource",
        resource: {
          uri: `${editorLink(id)}/preview.html`,
          mimeType: "text/html",
          text: email.html,
        },
      },
    ],
  };
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
declare function saveEmail(
  user: User,
  id: string,
  document: EmailDocument,
): Promise<void>;
