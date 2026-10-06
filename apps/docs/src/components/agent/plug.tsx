/**
 * The agent, as the part the example editor takes.
 *
 * The editor works without it. Plugged in, it adds a chat as a tab beside the
 * Inspector, an Ask button on the selected Block's toolbar, a prompt in the
 * middle of an empty email, and every open Suggestion drawn on the Canvas.
 * The editor keeps its own top bar, undo, palette, Layers and status bar.
 *
 * Every change the agent makes arrives as a Suggestion. It waits while your
 * users work elsewhere, and is accepted whole as one undo step or rejected
 * leaving nothing. The agent is scripted, so the page needs no model and no
 * key, but it reads and suggests through the same agent tools from `lekh` a model
 * would.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Editor } from "lekh";

import EmailEditor, { type AgentPart } from "@/components/editor/EmailEditor";
import {
  isModKey,
  isTyping,
  useKeyAnywhere,
} from "@/components/editor/shortcuts";

import { Chat } from "./chat";
import { AgentChromeContext, type AgentChrome } from "./parts";
import { createSession, frontOf, phaseOf, type Session } from "./session";
import { agentSlots, AskButton } from "./slots";
import { StartPrompt } from "./start";
// oxlint-disable-next-line import/no-unassigned-import
import "./agent.css";

/** The editor with the agent plugged in. This is what `/editor/` shows. */
export default function EditorWithAgent(): ReactNode {
  return <EmailEditor agent={createAgent} />;
}

/** One agent for one editor. */
export function createAgent(editor: Editor): AgentPart {
  const session = createSession(editor);
  return {
    label: "Agent",
    slots: agentSlots,
    Provider: ({ children }) => (
      <AgentProvider session={session}>{children}</AgentProvider>
    ),
    Panel: () => <Chat session={session} />,
    BlockAction: AskButton,
    Start: () => <StartPrompt session={session} />,
    ask(text, blockId) {
      // As the chat's own box does: an empty email gets a first draft, and
      // nothing is asked while that draft is still open.
      const phase = phaseOf(session);
      if (phase === "writing") return;
      if (phase === "empty") session.write(text);
      else session.ask(text, blockId);
    },
    onReply: session.onReply,
    dispose: session.dispose,
  };
}

/** What the chat and the Slots share: the session, and the open Ask prompt. */
function AgentProvider({
  session,
  children,
}: {
  readonly session: Session;
  readonly children: ReactNode;
}): ReactNode {
  const [composing, setComposing] = useState<string | undefined>(undefined);
  const { editor } = session;

  // The Ask prompt belongs to one Block. Selecting another closes it.
  useEffect(
    () =>
      editor.subscribe(() => {
        setComposing((open) =>
          open !== undefined && open !== editor.getSelection()
            ? undefined
            : open,
        );
      }),
    [editor],
  );

  // ⌘↵ accepts and ⌘⌫ rejects the Suggestion in front, read from the
  // selection (ADR-0042). With none in front, they do nothing. Esc is never
  // one of them: it steps out, and backing out never throws an idea away.
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const accepting = isModKey(event, "enter");
      if (!accepting && !isModKey(event, "backspace")) return;
      // In a field or a Block's words, ⌘⌫ deletes the line. It stays there.
      if (isTyping(event.target)) return;
      const front = frontOf(editor);
      if (!front) return;
      event.preventDefault();
      if (accepting) front.accept();
      else front.reject();
    },
    [editor],
  );
  useKeyAnywhere(onKey);

  const chrome = useMemo<AgentChrome>(
    () => ({ session, composing, compose: setComposing }),
    [session, composing],
  );

  return (
    <AgentChromeContext.Provider value={chrome}>
      {children}
    </AgentChromeContext.Provider>
  );
}
