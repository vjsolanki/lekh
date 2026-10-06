import { useCallback, useEffect, type ReactNode } from "react";
import type { ControlDescriptor, Editor, Suggestion } from "lekh";
import { useEditorState } from "lekh/canvas";
import { CheckIcon, EyeIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";

import { Icon } from "./icons";
import { display, isTyping, useKeyAnywhere } from "./shortcuts";

/** The key held to see the email without the Suggestion: `⌥`, or `Alt`. */
const HOLD_KEY = display("Alt").replace(/\+$/u, "");

/**
 * The Suggestion in front: the first at the selected Block, when it is open
 * (ADR-0042). None with nothing selected. The same one ⌘↵ acts on and the
 * descriptors' `suggested` is read from.
 */
function useFrontSuggestion(): Suggestion | undefined {
  return useEditorState((editor) => {
    const selected = editor.getSelection();
    if (selected === undefined) return undefined;
    const first = editor.getSuggestionsAt(selected).at(0);
    return first?.status === "open" ? first : undefined;
  });
}

/** The keys that press a focused button. */
const isPressKey = (key: string): boolean => key === " " || key === "Enter";

/**
 * The Suggestion in front, at the top of the Inspector: why it is proposed,
 * Accept, with how many changes it takes, and a way to see the email
 * without it.
 *
 * Holding the button, or ⌥ anywhere, hands its id to `onHold`, and letting go
 * hands back nothing. The editor passes that to the Canvas as `showOriginal`.
 * Nothing is stored. A ⌥ pressed as part of a chord, while typing or mid-drag
 * is left alone: there it means something else.
 */
export function SuggestionCard({
  editor,
  onHold,
}: {
  readonly editor: Editor;
  readonly onHold: (suggestionId: string | undefined) => void;
}): ReactNode {
  const suggestion = useFrontSuggestion();
  const id = suggestion?.id;

  // Let go when it leaves the front, so nothing stays held back.
  useEffect(() => {
    if (id === undefined) return undefined;
    return () => {
      onHold(undefined);
    };
  }, [id, onHold]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (id === undefined) return;
      if (event.key !== "Alt") {
        // A chord, not a hold.
        if (event.altKey) onHold(undefined);
        return;
      }
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        isTyping(event.target) ||
        editor.getPendingChange() !== undefined
      ) {
        return;
      }
      onHold(id);
    },
    [editor, id, onHold],
  );
  const letGo = useCallback(() => {
    onHold(undefined);
  }, [onHold]);
  const onKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Alt") onHold(undefined);
    },
    [onHold],
  );
  useKeyAnywhere(onKeyDown);
  useKeyAnywhere(onKeyUp, "keyup");
  // A window left with ⌥ down never hears it come up.
  useEffect(() => {
    globalThis.addEventListener("blur", letGo);
    return () => {
      globalThis.removeEventListener("blur", letGo);
    };
  }, [letGo]);

  if (!suggestion) return null;
  const hold = (): void => {
    onHold(suggestion.id);
  };

  return (
    <section
      aria-label="Suggestion"
      className="border-b border-rule-soft bg-wash/60 px-3.5 pt-2.5 pb-3"
    >
      <p className="m-0 flex items-start gap-1.5 text-[0.8125rem]/[1.45] text-foreground">
        <Icon name="suggestion" className="mt-0.5 size-3.5 text-primary" />
        <span>{suggestion.note ?? "Suggested change"}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          onClick={() => {
            suggestion.accept();
          }}
        >
          <CheckIcon className="size-3.5" aria-hidden="true" />
          Accept {suggestion.edits.length}{" "}
          {suggestion.edits.length === 1 ? "change" : "changes"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            suggestion.reject();
          }}
        >
          Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto select-none"
          title={`Hold, or hold ${HOLD_KEY}, to see the email without it`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            hold();
          }}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          onLostPointerCapture={letGo}
          onKeyDown={(event) => {
            if (isPressKey(event.key) && !event.repeat) {
              event.preventDefault();
              hold();
            }
          }}
          onKeyUp={(event) => {
            if (isPressKey(event.key)) letGo();
          }}
          onBlur={letGo}
        >
          <EyeIcon className="size-3.5" aria-hidden="true" />
          Original
          <kbd className="font-sans text-muted-foreground">{HOLD_KEY}</kbd>
        </Button>
      </div>
    </section>
  );
}

/**
 * A value as it reads in a suggested line: short, and never
 * `[object Object]`. Rich text loses its markup, and an image names its file
 * rather than its whole URL.
 */
function shortValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  const text =
    typeof value === "string"
      ? value.replaceAll(/<[^>]*>/gu, "").trim()
      : typeof value === "object" && "src" in value
        ? `image ${String(value.src).split("/").at(-1) ?? ""}`.trim()
        : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * One line per field a Suggestion would change: the stored value struck through,
 * the new one in the mark colour. Read off `suggested`, so it shows only on
 * the Stage the Suggestion changes. With `labelled`, each line names its
 * field, for a Box whose sides share one control.
 */
export function SuggestedValues({
  controls,
  labelled = false,
}: {
  readonly controls: readonly ControlDescriptor[];
  readonly labelled?: boolean;
}): ReactNode {
  const changed = controls.filter((control) => control.suggested);
  if (changed.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {changed.map((control) => (
        <p
          key={control.name}
          className="m-0 flex flex-wrap items-baseline gap-x-1.5 pl-0.5 text-[0.75rem]/[1.45]"
        >
          <Icon name="suggestion" className="size-3 self-center text-primary" />
          <span className="sr-only">Suggested</span>
          {labelled ? (
            <span className="text-muted-foreground">{control.label}</span>
          ) : null}
          <s className="text-muted-foreground">{shortValue(control.value)}</s>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="font-medium text-ink-mark">
            {shortValue(control.suggested?.value)}
          </span>
        </p>
      ))}
    </div>
  );
}
