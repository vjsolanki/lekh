import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import type { EmailDocument } from "../core/document/document";
import type { Editor } from "../core/editor/editor";
import type { Suggestion } from "../core/editor/suggestion";
import { useEditor } from "./context";
import { drawnDocument, type DrawnInput } from "./suggestions";

/**
 * Read one thing from the surrounding {@link EditorProvider}'s editor, and
 * re-render when that thing changes.
 *
 * The whole subscription: no effect to write, no counter to bump, nothing to
 * remember to call beside the read. A component asks for what it needs and is
 * woken for that alone (ADR-0011).
 *
 * ```tsx
 * const stage = useEditorState((editor) => editor.getStage());
 * const canUndo = useEditorState((editor) => editor.canUndo());
 * ```
 *
 * **Select the narrowest thing you need.** Every getter on `Editor` answers
 * with the same value until that value moves, so a toolbar reading `canUndo`
 * holds still through an Author typing. Selecting the Document instead re-renders
 * on every keystroke — a Block's text lives on the Block (ADR-0009), so the root
 * is a new object each time it changes, and no subscription primitive avoids
 * that.
 *
 * Woken by hover as well, so `editor.getHovered()` can be read here too.
 * Hover only moves when the pointer crosses into another Block, and every other
 * getter answers the same value, so the rest hold still. Woken by Suggestions
 * too, which move `getControls()` and `getSuggestionsAt()` and announce
 * nothing else.
 *
 * **`select` must not build the value it returns.** Composing two getters into
 * a fresh object or array hands back a new reference on every call, which React
 * reads as a change that never settles. Call the hook twice instead.
 */
export function useEditorState<TValue>(
  select: (editor: Editor) => TValue,
): TValue {
  const editor = useEditor();

  // An arrow, not the method unbound: `subscribe` has to keep its identity
  // between renders or React tears the subscription down and rebuilds it on
  // each one, and it is the editor that decides what `this` is.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const leaveChanges = editor.subscribe(onChange);
      const leaveHover = editor.subscribeToHover(onChange);
      const leaveSuggestions = editor.subscribeToSuggestions(onChange);
      return () => {
        leaveChanges();
        leaveHover();
        leaveSuggestions();
      };
    },
    [editor],
  );

  const read = (): TValue => select(editor);

  // The same read on the server. The editor is an ordinary object that exists
  // wherever it was made, so a prerender answers from it rather than being
  // told there is nothing to answer with.
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The Document as the Canvas draws it: with the open Suggestions and the
 * Pending Change applied, and the Blocks a Suggestion removes still in it
 * (ADR-0032, ADR-0035).
 *
 * Given `without`, that Suggestion is left out, as though it had never come:
 * the Author holding a button to see the email without it.
 *
 * Woken by pending and Suggestion listeners as well as change listeners,
 * because a drag or a Suggestion moves what is shown and announces nothing
 * else. Internal: a Consumer's own preview pane subscribes to what it needs
 * itself.
 */
export function useShownDocument(without?: string): EmailDocument {
  const editor = useEditor();
  const drawn = useRef<{
    readonly input: DrawnInput;
    /** The open Suggestions, before `without` was taken out. */
    readonly open: readonly Suggestion[];
    readonly without: string | undefined;
    readonly document: EmailDocument;
  }>(undefined);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubscribers = [
        editor.subscribe(onChange),
        editor.subscribeToPendingChange(onChange),
        editor.subscribeToSuggestions(onChange),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [editor],
  );

  const read = (): EmailDocument => {
    const open = editor.getSuggestions();
    const suggestions = withoutOne(open, without);
    if (suggestions.length === 0) return editor.getDocumentWithPendingChange();
    const stored = editor.getDocument();
    const withSuggestions = editor.getDocumentWithSuggestions({ without });
    const pending = editor.getPendingChange();
    // Built once per change of what it is built from, so React sees the same
    // object until then.
    const last = drawn.current;
    if (
      last?.input.stored === stored &&
      last.input.withSuggestions === withSuggestions &&
      last.open === open &&
      last.without === without &&
      last.input.pending === pending
    ) {
      return last.document;
    }
    const input: DrawnInput = { stored, withSuggestions, suggestions, pending };
    const document = drawnDocument(input);
    drawn.current = { input, open, without, document };
    return document;
  };
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The open Suggestions, stale ones too, oldest first. Given `without`, that
 * one is left out.
 */
export function useSuggestions(without?: string): readonly Suggestion[] {
  const editor = useEditor();
  const subscribe = useCallback(
    (onChange: () => void) => editor.subscribeToSuggestions(onChange),
    [editor],
  );
  const read = (): readonly Suggestion[] => editor.getSuggestions();
  const open = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => withoutOne(open, without), [open, without]);
}

/** The Suggestions with one left out. The same array when it is not there. */
function withoutOne(
  suggestions: readonly Suggestion[],
  without: string | undefined,
): readonly Suggestion[] {
  return without !== undefined &&
    suggestions.some((suggestion) => suggestion.id === without)
    ? suggestions.filter((suggestion) => suggestion.id !== without)
    : suggestions;
}
