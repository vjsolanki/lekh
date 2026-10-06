import { App } from "@modelcontextprotocol/ext-apps";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  createEditor,
  type Editor,
  type EmailDocument,
  type SuggestionJSON,
} from "lekh-editor";
import {
  Canvas,
  EditorProvider,
  useEditorState,
  type BlockChromeProps,
} from "lekh-editor/canvas";
import { createReactEmailPreset } from "lekh-editor/blocks";
import {
  createTiptapTextEngine,
  type TiptapTextEngine,
} from "lekh-editor/tiptap";

// The Slot from "Add an agent to your editor": an outline, Accept and Reject.
import { SuggestionMark } from "./suggestion-slot";

/**
 * The Canvas, inside the chat. Bundle this file into one HTML file, which
 * mcp-app-server.ts hands to the chat as its MCP App.
 *
 * The chat shows it under each open_email and suggest call. It loads the open
 * email and its Suggestions from your server, and saves back what your users
 * change.
 */
const app = new App({ name: "Email editor", version: "1.0.0" });
const definitions = createReactEmailPreset();

interface StoredEmail {
  readonly document: EmailDocument;
  readonly suggestions: readonly SuggestionJSON[];
}

interface OpenEmail {
  readonly id: number;
  readonly editor: Editor;
  readonly text: TiptapTextEngine;
  /** A change is waiting to be saved. */
  readonly saving: () => boolean;
  /** Stop saving. Called when a newer copy replaces this one. */
  readonly close: () => void;
}

/** Run one of the server's tools, and read its JSON answer. */
async function callServer(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await app.callServerTool({ name, arguments: args });
  const first = result.content[0];
  if (result.isError === true || first?.type !== "text") {
    throw new Error(`${name} failed`);
  }
  return JSON.parse(first.text);
}

async function loadEmail(): Promise<StoredEmail> {
  const loaded = await callServer("load_email");
  if (!isStoredEmail(loaded)) throw new Error("load_email gave no email");
  return loaded;
}

function isStoredEmail(value: unknown): value is StoredEmail {
  return (
    typeof value === "object" &&
    value !== null &&
    "document" in value &&
    "suggestions" in value
  );
}

let opened = 0;

/** Open the email with its Suggestions, and save every change back. */
function openEmail({ document, suggestions }: StoredEmail): OpenEmail {
  const text = createTiptapTextEngine();
  const editor = createEditor({ definitions, document, textEngine: text });
  for (const json of suggestions) editor.suggest(json.edits, json);

  // The keys of Suggestions accepted or rejected here, for the server to drop.
  const settled: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void callServer("save_email", {
        document: editor.getDocument(),
        settled,
      });
    }, 300);
  };

  const stopOps = editor.onOp(save);
  const stopSuggestions = editor.subscribeToSuggestions((event) => {
    if (event.kind !== "accept" && event.kind !== "reject") return;
    const key = keyOf(event.suggestion.meta);
    if (key !== undefined) settled.push(key);
    save();
  });

  return {
    id: ++opened,
    editor,
    text,
    saving: () => timer !== undefined,
    close: () => {
      stopOps();
      stopSuggestions();
    },
  };
}

/** The key mcp-app-server.ts put in each Suggestion's `meta`. */
function keyOf(meta: unknown): string | undefined {
  return typeof meta === "object" &&
    meta !== null &&
    "key" in meta &&
    typeof meta.key === "string"
    ? meta.key
    : undefined;
}

/** What the server holds, to tell whether another frame changed it. */
function fingerprint(
  document: EmailDocument,
  keys: readonly (string | undefined)[],
): string {
  return JSON.stringify([
    document,
    keys
      .filter((key) => key !== undefined)
      .toSorted((a, b) => a.localeCompare(b)),
  ]);
}

function shownNow({ editor }: OpenEmail): string {
  return fingerprint(
    editor.getDocument(),
    editor.getSuggestions().map((suggestion) => keyOf(suggestion.meta)),
  );
}

function EmailInChat(): ReactNode {
  const [email, setEmail] = useState<OpenEmail | undefined>(undefined);

  // Wait for the call this frame sits under, then load the open email.
  useEffect(() => {
    app.addEventListener("toolresult", () => {
      void loadEmail().then(openEmail).then(setEmail);
    });
    void app.connect();
  }, []);

  if (email === undefined) return <p>Opening the email…</p>;

  // Each ask makes a new frame further down the chat. When your users come
  // back to this one, it takes what changed since. Never over a change of
  // its own that is still waiting to be saved.
  const refresh = async () => {
    if (email.saving()) return;
    const stored = await loadEmail();
    const keys = stored.suggestions.map((json) => keyOf(json.meta));
    if (email.saving()) return;
    if (fingerprint(stored.document, keys) !== shownNow(email)) {
      email.close();
      setEmail(openEmail(stored));
    }
  };

  return (
    <EditorProvider
      key={email.id}
      editor={email.editor}
      editableText={email.text.EditableText}
    >
      <div
        onPointerEnter={() => {
          void refresh();
        }}
      >
        <Canvas
          title="Email"
          height="70vh"
          slots={{ selection: Selected, suggestion: SuggestionMark }}
        />
        <AskBox />
      </div>
    </EditorProvider>
  );
}

/**
 * Ask about the selected Block. The server hands its id to your agent's tools
 * as `focus`, so read_email gives that Block first.
 */
function AskBox(): ReactNode {
  const selected = useEditorState((editor) => editor.getSelection());
  const [ask, setAsk] = useState("");
  if (selected === undefined) return <p>Click a Block to ask about it.</p>;

  const send = async () => {
    await callServer("focus_block", { block_id: selected });
    // Read with the ask, so your agent knows which Block "this" is.
    await app.updateModelContext({
      content: [
        {
          type: "text",
          text: `The next ask is about Block ${selected}. read_email gives it first.`,
        },
      ],
    });
    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: ask }],
    });
    setAsk("");
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <input
        value={ask}
        placeholder="Ask about this Block"
        onChange={(event) => {
          setAsk(event.target.value);
        }}
      />
      <button type="submit" disabled={ask.trim() === ""}>
        Ask
      </button>
    </form>
  );
}

function Selected({ rect }: BlockChromeProps): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        outline: "2px solid rebeccapurple",
        pointerEvents: "none",
      }}
    />
  );
}

const root = document.querySelector("#root");
if (root) createRoot(root).render(<EmailInChat />);
