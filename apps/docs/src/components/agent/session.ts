/**
 * One chat with the agent: what your users asked, what the agent said, and
 * which Suggestion each answer left on the Canvas.
 *
 * The editor holds the Suggestions themselves: whether each one is still
 * streaming, open or stale, and what accepting it writes. This file holds
 * only what lekh leaves to you: the conversation. Each Suggestion carries its
 * ask's id in `meta`, so the accept and reject events find their way back.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  type Action,
  agentTools,
  type Editor,
  type EmailReading,
  type Suggestion,
  type SuggestionTouch,
} from "lekh-editor";
import { useEditor, useEditorState } from "lekh-editor/canvas";

import { countOf, plan } from "./agent";
import { FIRST_EMAIL } from "./first-email";
import { canUndoAccept } from "./receipt";

/** One tool call the agent made, as the chat shows it. */
export interface ToolCall {
  readonly name: string;
  readonly said: string;
}

/** One ask, and the answer to it. */
export interface Ask {
  readonly id: string;
  readonly text: string;
  /** The Block it is about. None for the whole email. */
  readonly about: AskedAbout | undefined;
  readonly attempt: number;
  readonly working: boolean;
  readonly reply?: string;
  readonly calls: readonly ToolCall[];
  readonly suggestionId?: string;
  /** Once its Suggestion has been accepted or rejected. */
  readonly outcome?: "accepted" | "rejected";
  /** How many Edits accepting it took. */
  readonly edits?: number;
}

/** The Block an ask is about, as it read when asked. It may go. */
export interface AskedAbout {
  readonly id: string;
  readonly label: string;
  readonly type: string;
}

/** The first email, from the prompt to the Suggestion it streams into. */
export interface FirstEmail {
  readonly prompt: string;
  readonly suggestionId: string;
  /** How many sections have landed so far. */
  readonly written: number;
  /** Your users stopped it before the agent had written it all. */
  readonly stopped?: true;
  readonly outcome?: "accepted" | "rejected";
  /** How many Edits accepting it took. */
  readonly edits?: number;
}

export interface SessionState {
  readonly first: FirstEmail | undefined;
  readonly asks: readonly Ask[];
  /**
   * The ask whose accept is still the newest undo step, so its receipt can
   * offer Undo. The first email's is `first-email`.
   */
  readonly undoable: string | undefined;
}

/** What a Suggestion's `meta` holds: the ask it answers. */
interface SuggestionMeta {
  readonly ask: string;
}

export const FIRST_EMAIL_ASK = "first-email";

/** How long the scripted agent pretends to think. */
const THINK_MS = 900;
/** The gap between sections of the first email landing. */
const WRITE_MS = 380;

export interface Session {
  readonly editor: Editor;
  readonly getState: () => SessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Hear the agent answer: a reply to an ask, or the first draft finished.
   * Gives back a way to stop.
   */
  readonly onReply: (listener: () => void) => () => void;
  /** Stream the first email from a prompt. */
  readonly write: (prompt: string) => void;
  /**
   * Stop the first email where it is. What has arrived stays, as a finished
   * Suggestion your users can still accept or reject. With nothing arrived
   * yet, it is rejected.
   */
  readonly stop: () => void;
  /** Ask about one Block, or the whole email. Gives back the ask's id. */
  readonly ask: (text: string, blockId: string | undefined) => string;
  /** Reject the ask's Suggestion, and ask again for another take. */
  readonly retry: (id: string) => void;
  /** Undo the ask's accept, while it is still the newest step. */
  readonly undo: (id: string) => void;
  /** The ask a Suggestion answers. */
  readonly askOf: (suggestion: Suggestion) => Ask | undefined;
  readonly labelOf: (blockId: string) => string;
  readonly dispose: () => void;
}

/** A chat about the email in an editor the page already made. */
export function createSession(editor: Editor): Session {
  let state: SessionState = { first: undefined, asks: [], undoable: undefined };
  const listeners = new Set<() => void>();
  const repliesHeard = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let counter = 0;

  const set = (next: Partial<SessionState>): void => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const later = (ms: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  const patch = (id: string, change: Partial<Ask>): void => {
    set({
      asks: state.asks.map((ask) =>
        ask.id === id ? { ...ask, ...change } : ask,
      ),
    });
  };
  const announceReply = (): void => {
    for (const listener of repliesHeard) listener();
  };
  /** The agent has finished answering. */
  const replied = (id: string, change: Partial<Ask>): void => {
    patch(id, { ...change, working: false });
    announceReply();
  };
  const find = (id: string): Ask | undefined =>
    state.asks.find((ask) => ask.id === id);

  const labelOf = (blockId: string): string => {
    const block = editor.getBlock(blockId);
    if (!block) return "Deleted block";
    return editor.getDefinition(block.type)?.label ?? block.type;
  };

  // Every Action since the newest accept, to tell when its Undo stops
  // applying.
  let acceptedAt: Action | undefined;
  let after: Action[] = [];

  // Accept and reject happen on the Canvas, in the chat, or from the keyboard.
  // Wherever it was, the event says so, and carries the ask in `meta`.
  const unsubscribe = editor.subscribeToSuggestions((event) => {
    const ask = askIdOf(event.suggestion);
    // The first email is finished by the agent, or by Stop on the Canvas or
    // in the chat. Either way, the agent has answered.
    if (event.kind === "finish" && ask === FIRST_EMAIL_ASK && state.first) {
      if (state.first.written < FIRST_EMAIL.length) {
        set({ first: { ...state.first, stopped: true } });
      }
      announceReply();
      return;
    }
    if (event.kind !== "accept" && event.kind !== "reject") return;
    if (ask === undefined) return;
    const decided =
      event.kind === "accept"
        ? {
            outcome: "accepted" as const,
            edits: event.suggestion.edits.length,
          }
        : { outcome: "rejected" as const };
    if (event.kind === "accept") {
      // The accept is the newest step now. Its Action was announced before
      // this event, so what follows it is what decides Undo.
      acceptedAt = editor.getLastAction();
      after = [];
      set({ undoable: ask });
    }
    // The first email's record stays. Rejecting it left the email as it
    // started, with nothing to undo.
    if (ask === FIRST_EMAIL_ASK) {
      if (state.first) set({ first: { ...state.first, ...decided } });
      return;
    }
    patch(ask, decided);
  });

  const unwatch = editor.subscribe(() => {
    if (state.undoable === undefined) return;
    const action = editor.getLastAction();
    if (!action || action === acceptedAt || after.includes(action)) return;
    after = [...after, action];
    if (!canUndoAccept(after)) set({ undoable: undefined });
  });

  /** One turn of the agent: read the email, then suggest. */
  const think = (id: string): void => {
    const asked = find(id);
    if (!asked) return;
    // A new set of tools for each ask. `focus` is the Block it is about, and
    // `meta` ties the Suggestion back to this ask.
    const tools = agentTools(editor, {
      ...(asked.about === undefined ? {} : { focus: asked.about.id }),
      meta: { ask: id } satisfies SuggestionMeta,
    });

    later(THINK_MS, () => {
      const current = find(id);
      if (current?.working !== true) return;

      const reading = tools.call("read_email", {}).content;
      if (!isReading(reading)) return;
      const calls: ToolCall[] = [{ name: "read_email", said: "read" }];

      if (asked.about !== undefined && !reading.focus) {
        replied(id, {
          calls,
          reply: "That block is gone, so there is nothing to change.",
        });
        return;
      }

      const decided = plan(reading, current.text, current.attempt);
      if (!decided.edits) {
        replied(id, { calls, reply: decided.reply });
        return;
      }

      const result = tools.call("suggest", {
        edits: decided.edits,
        note: decided.note,
      });
      const answer = result.content;
      if (!isSuggestAnswer(answer)) return;
      if (answer.status === "refused") {
        calls.push({ name: "suggest", said: "refused" });
        replied(id, {
          calls,
          reply: answer.reasons.map((reason) => reason.message).join(" "),
        });
        return;
      }
      calls.push({
        name: "suggest",
        said: countOf(decided.edits.length, "change"),
      });
      replied(id, {
        calls,
        reply: decided.reply,
        suggestionId: answer.suggestion,
      });
    });
  };

  return {
    editor,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    onReply(listener) {
      repliesHeard.add(listener);
      return () => {
        repliesHeard.delete(listener);
      };
    },

    write(prompt) {
      // A streaming Suggestion starts empty, and grows as the agent writes.
      // Your users can reject it at any time, but accept it only once it is
      // finished.
      const suggestion = editor.suggest([], {
        streaming: true,
        note: "First draft",
        meta: { ask: FIRST_EMAIL_ASK } satisfies SuggestionMeta,
      });
      if (suggestion.status === "refused") return;
      // Earlier asks stay: a Suggestion one left may still be open.
      set({ first: { prompt, suggestionId: suggestion.id, written: 0 } });

      FIRST_EMAIL.forEach((section, index) => {
        later(500 + index * WRITE_MS, () => {
          const grown = suggestion.extend(section.edits);
          // Stopped, rejected, or gone stale: stop writing.
          if (typeof grown === "string") return;
          if (state.first) {
            set({ first: { ...state.first, written: index + 1 } });
          }
          if (index === FIRST_EMAIL.length - 1) suggestion.finish();
        });
      });
    },

    stop() {
      const id = state.first?.suggestionId;
      const suggestion = editor
        .getSuggestions()
        .find((shown) => shown.id === id);
      // Said here as well as on finish, since with nothing arrived it is
      // rejected rather than finished.
      if (state.first && suggestion?.status === "streaming") {
        set({ first: { ...state.first, stopped: true } });
      }
      // Stopped before anything arrived, there is nothing to accept.
      if (suggestion?.edits.length === 0) suggestion.reject();
      else suggestion?.finish();
    },

    ask(text, blockId) {
      counter += 1;
      const id = `ask-${String(counter)}`;
      const block =
        blockId === undefined ? undefined : editor.getBlock(blockId);
      set({
        asks: [
          ...state.asks,
          {
            id,
            text: text.trim(),
            about: block && {
              id: block.id,
              label: labelOf(block.id),
              type: block.type,
            },
            attempt: 0,
            working: true,
            calls: [],
          },
        ],
      });
      think(id);
      return id;
    },

    retry(id) {
      const asked = find(id);
      if (!asked) return;
      // Rejecting first leaves nothing to undo, then the agent tries again.
      const shown = asked.suggestionId;
      editor
        .getSuggestions()
        .find((suggestion) => suggestion.id === shown)
        ?.reject();
      patch(id, {
        attempt: asked.attempt + 1,
        working: true,
        reply: undefined,
        calls: [],
        suggestionId: undefined,
        outcome: undefined,
        edits: undefined,
      });
      think(id);
    },

    undo(id) {
      // An open Pending Change would be committed and undone first, as the
      // newer step, so the accept would stay.
      if (state.undoable !== id || editor.getPendingChange()) return;
      set({ undoable: undefined });
      editor.undo();
    },

    askOf(suggestion) {
      const id = askIdOf(suggestion);
      return id === undefined ? undefined : find(id);
    },

    labelOf,

    dispose() {
      unsubscribe();
      unwatch();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
      repliesHeard.clear();
    },
  };
}

/** What the `suggest` tool gives back, as far as this chat reads it. */
type SuggestAnswer =
  | {
      readonly status: "refused";
      readonly reasons: readonly { readonly message: string }[];
    }
  | {
      readonly status: "open" | "accepted" | "stale";
      readonly suggestion: string;
    };

// What a tool gives back is plain data, as a model would get it. These read
// it back as the shape the tool's documentation names.
function isReading(content: object): content is EmailReading {
  return "document" in content;
}

function isSuggestAnswer(content: object): content is SuggestAnswer {
  return "status" in content;
}

function askIdOf(suggestion: Suggestion): string | undefined {
  const meta: unknown = suggestion.meta;
  if (typeof meta !== "object" || meta === null || !("ask" in meta)) {
    return undefined;
  }
  return typeof meta.ask === "string" ? meta.ask : undefined;
}

/**
 * Where the chat is. An email with no Blocks is `empty`, and the composer
 * writes a first email. While that Suggestion is open it is `writing`, and
 * asks wait: its Blocks are not stored until it is accepted. Otherwise
 * `ready`.
 */
export type Phase = "empty" | "writing" | "ready";

/** The phase as it is now, read once. */
export function phaseOf(session: Session): Phase {
  const { first } = session.getState();
  if (first !== undefined && first.outcome === undefined) return "writing";
  const empty = (session.editor.getDocument().root.children ?? []).length === 0;
  return empty ? "empty" : "ready";
}

export function usePhase(session: Session): Phase {
  // Subscribed to both things the phase reads, then read the one way.
  useSession(session, (state) => state.first);
  useEditorState(
    (editor) => (editor.getDocument().root.children ?? []).length === 0,
  );
  return phaseOf(session);
}

/**
 * The prompt of a first email that was rejected. It comes back in the box, to
 * change and send again.
 */
export function rejectedPrompt(state: SessionState): string | undefined {
  return state.first?.outcome === "rejected" ? state.first.prompt : undefined;
}

/** Read from the session, re-rendering when what was read changes. */
export function useSession<T>(
  session: Session,
  select: (state: SessionState) => T,
): T {
  return useSyncExternalStore(session.subscribe, () =>
    select(session.getState()),
  );
}

/** The editor's open Suggestions, stale ones too, oldest first. */
export function useSuggestions(editor: Editor): readonly Suggestion[] {
  const subscribe = useCallback(
    (onChange: () => void) => editor.subscribeToSuggestions(onChange),
    [editor],
  );
  return useSyncExternalStore(subscribe, () => editor.getSuggestions());
}

/**
 * The open Suggestions touching the selected Block, front first, as lekh
 * orders them (ADR-0042). None with nothing selected.
 */
export function useSuggestionsAtSelection(): readonly Suggestion[] {
  const editor = useEditor();
  // Two subscriptions: the selection moves with the editor's changes, and the
  // open Suggestions with their own events.
  useSuggestions(editor);
  const selected = useEditorState((current) => current.getSelection());
  return selected === undefined ? [] : editor.getSuggestionsAt(selected);
}

/**
 * The Suggestion in front: the newest open, finished one touching the
 * selected Block. ⌘↵ and ⌘⌫ act on it. None with nothing selected, and none
 * when the first one there is stale or still arriving.
 */
export function frontOf(editor: Editor): Suggestion | undefined {
  const selected = editor.getSelection();
  if (selected === undefined) return undefined;
  const first = editor.getSuggestionsAt(selected).at(0);
  return first?.status === "open" ? first : undefined;
}

/**
 * Whether selecting this Block a Suggestion touches brings it to the front.
 * Not for a Block it adds, which is not stored until it is accepted, and not
 * for a structural one, since selecting that lands on its parent, which the
 * Suggestion does not touch.
 */
export function isSelectableTouch(
  editor: Editor,
  touch: Pick<SuggestionTouch, "blockId" | "change">,
): boolean {
  return (
    touch.change !== "insert" &&
    editor.getSelectable(touch.blockId) === touch.blockId
  );
}

/**
 * The first Block a Suggestion touches that selecting brings it to the front.
 * None for one that only adds Blocks, like the first draft, which can never
 * come to the front.
 */
export function selectableTouch(
  editor: Editor,
  suggestion: Suggestion,
): string | undefined {
  return suggestion.touches.find((touch) => isSelectableTouch(editor, touch))
    ?.blockId;
}

/** One open Suggestion by id. None once it is accepted or rejected. */
export function useSuggestion(
  editor: Editor,
  id: string | undefined,
): Suggestion | undefined {
  return useSuggestions(editor).find((suggestion) => suggestion.id === id);
}
