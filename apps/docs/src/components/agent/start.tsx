/**
 * The prompt in the middle of an empty email. Type a sentence, or tap a
 * starter, and the first draft streams onto the Canvas as one Suggestion.
 *
 * Shown only while the email has no Blocks and no draft is on its way.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/editor/icons";

import { STARTERS } from "./first-email";
import { rejectedPrompt, usePhase, useSession, type Session } from "./session";

export function StartPrompt({
  session,
}: {
  readonly session: Session;
}): ReactNode {
  const [text, setText] = useState("");
  const empty = usePhase(session) === "empty";
  const rejected = useSession(session, rejectedPrompt);
  useEffect(() => {
    if (empty && rejected !== undefined) setText(rejected);
  }, [empty, rejected]);
  if (!empty) return null;

  const send = (value: string): void => {
    if (!value.trim()) return;
    session.write(value.trim());
    setText("");
  };

  return (
    <div className="pop-in flex w-full flex-col gap-3 rounded-xl border bg-popover p-4 text-[0.8125rem] text-popover-foreground shadow-[0_0_0_1px_rgb(0_0_0/4%),0_16px_40px_-12px_rgb(0_0_0/40%)] [--origin:center]">
      <div className="flex flex-col gap-1 text-center">
        <span className="flex items-center justify-center gap-1.5 font-semibold">
          <Icon name="suggestion" className="text-primary" />
          Start with a sentence
        </span>
        <span className="text-[0.75rem] text-muted-foreground">
          Say who it’s for and what it should do. You’ll see the draft before
          anything changes.
        </span>
      </div>
      <div className="flex items-end gap-2 rounded-lg border bg-background p-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--wash)]">
        <textarea
          value={text}
          rows={2}
          aria-label="Describe the email"
          placeholder="Describe the email"
          className="min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(text);
            }
          }}
        />
        <Button
          size="icon-sm"
          aria-label="Write it"
          disabled={!text.trim()}
          onClick={() => {
            send(text);
          }}
        >
          <ArrowUpIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {STARTERS.map((starter) => (
          <button
            key={starter.label}
            type="button"
            title={starter.prompt}
            className="min-h-7 rounded-full border border-dashed px-2.5 text-[0.75rem] text-ink-2 transition-colors hover:border-primary hover:text-ink-mark"
            onClick={() => {
              send(starter.prompt);
            }}
          >
            {starter.label}
          </button>
        ))}
      </div>
    </div>
  );
}
