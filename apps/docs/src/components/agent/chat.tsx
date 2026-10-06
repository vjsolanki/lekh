/**
 * The conversation, in the editor's Agent panel. On an email with no Blocks,
 * the prompt that writes the first draft is its first message. Every ask
 * carries the Block it is about as a chip, and every answer with a Suggestion
 * says where it stands and links to it on the Canvas, where it is decided.
 * What the agent said is never rewritten: once its Suggestion is decided, a
 * receipt under it says how.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Suggestion } from "lekh-editor";
import { useEditorState } from "lekh-editor/canvas";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowUturnLeftIcon,
  ArrowUpIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  CheckIcon,
  StopIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/editor/icons";
import { Quiet } from "@/components/editor/parts";
import { cn } from "@/lib/utils";

import { countOf, quickAsks } from "./agent";
import { DEFAULT_PROMPT, FIRST_EMAIL } from "./first-email";
import { EditList, DiagnosticLine, StatusChip, Working } from "./parts";
import {
  FIRST_EMAIL_ASK,
  rejectedPrompt,
  selectableTouch,
  usePhase,
  useSession,
  useSuggestion,
  type Ask,
  type FirstEmail,
  type Session,
} from "./session";
import { namesOf, workingLine } from "./working-line";

export function Chat({ session }: { readonly session: Session }): ReactNode {
  const first = useSession(session, (state) => state.first);
  const asks = useSession(session, (state) => state.asks);
  // Once the email has no Blocks, the first email no longer describes it.
  const empty = usePhase(session) === "empty";
  const end = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, the way every chat does.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [asks, first]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {first ? (
            <FirstEmailExchange session={session} first={first} />
          ) : (
            <Welcome session={session} />
          )}
          {asks.map((ask) => (
            <Exchange key={ask.id} session={session} ask={ask} />
          ))}
          {/* The record stays, and an email with no Blocks starts again. */}
          {first && empty ? <Welcome session={session} /> : null}
          <div ref={end} />
        </div>
      </ScrollArea>

      <Composer session={session} />
    </div>
  );
}

function Welcome({ session }: { readonly session: Session }): ReactNode {
  const empty = usePhase(session) === "empty";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed p-3 text-[0.75rem] text-muted-foreground">
      <span className="flex items-center justify-between gap-2 font-medium text-foreground">
        {empty ? "Start with a sentence." : "Ask about the email."}
        <Quiet>Demo · scripted replies</Quiet>
      </span>
      {empty
        ? "Say who it’s for and what it should do. You’ll see the draft before anything changes. Then select a block to ask about just that part."
        : "Select a block to ask about just that part, or press Ask on its toolbar. You’ll see each answer on the email before anything changes."}
    </div>
  );
}

function YourMessage({
  children,
  scope,
}: {
  readonly children: ReactNode;
  readonly scope?: ReactNode;
}): ReactNode {
  return (
    <div className="card-in flex flex-col items-end gap-1 self-end">
      {scope}
      <div className="max-w-[17rem] rounded-xl rounded-br-sm border bg-card px-3 py-2 text-card-foreground">
        {children}
      </div>
    </div>
  );
}

function AgentMessage({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="card-in flex max-w-full gap-2">
      <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-wash text-primary">
        <ChatBubbleOvalLeftEllipsisIcon className="size-3" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-ink-2">
        {children}
      </div>
    </div>
  );
}

/** A Block, named, as a chip. Clicking it goes to the Block. */
function ScopeChip({
  session,
  blockId,
  label,
  onRemove,
}: {
  readonly session: Session;
  readonly blockId: string;
  readonly label: string;
  readonly onRemove?: () => void;
}): ReactNode {
  const block = useEditorState((editor) => editor.getBlock(blockId));
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-wash pr-0.5 pl-1.5 text-[0.75rem] text-ink-mark">
      <button
        type="button"
        className="flex min-h-7 items-center gap-1"
        onClick={() => {
          if (!block) return;
          session.editor.select(blockId);
          session.editor.reveal(blockId);
        }}
      >
        <Icon name={block?.type ?? "block"} className="size-3" />
        {block ? label : `${label} (deleted)`}
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label="Talk about the whole email"
          className="grid size-7 place-items-center rounded-sm hover:bg-primary/15"
          onClick={onRemove}
        >
          <XMarkIcon className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/** The tool calls the agent made, the way a model's would read. */
function Calls({ ask }: { readonly ask: Ask }): ReactNode {
  if (ask.calls.length === 0) return null;
  return (
    <ol className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-[0.75rem] text-muted-foreground">
      {ask.calls.map((call) => (
        <li key={call.name}>
          → {call.name} · {call.said}
        </li>
      ))}
    </ol>
  );
}

function FirstEmailExchange({
  session,
  first,
}: {
  readonly session: Session;
  readonly first: FirstEmail;
}): ReactNode {
  const suggestion = useSuggestion(session.editor, first.suggestionId);
  const status = suggestion?.status ?? first.outcome;

  return (
    <>
      <YourMessage>{first.prompt}</YourMessage>
      <AgentMessage>
        {/* Mounted before the line, so a screen reader hears it each time it
            changes, the first time included. */}
        <div aria-live="polite" className="empty:hidden">
          {status === "streaming" ? (
            <span className="flex items-center justify-between gap-2">
              <Working
                label={workingLine(
                  suggestion?.edits ?? [],
                  namesOf(session.editor),
                )}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  session.stop();
                }}
              >
                <StopIcon className="size-3.5" aria-hidden="true" />
                Stop
              </Button>
            </span>
          ) : null}
        </div>
        {status === "streaming" ? null : first.stopped &&
          first.written === 0 ? (
          <p className="m-0">Stopped before I wrote anything.</p>
        ) : first.stopped ? (
          <p className="m-0">
            Stopped. Here’s what I wrote so far. Have a look on the email.
          </p>
        ) : (
          <p className="m-0">Here’s a first draft. Have a look on the email.</p>
        )}
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-[0.75rem] text-ink-2">
          {FIRST_EMAIL.slice(0, first.written).map((section) => (
            <li
              key={section.label}
              className="card-in flex items-center gap-1.5"
            >
              <CheckIcon className="size-3 text-ok" aria-hidden="true" />
              {section.label}
            </li>
          ))}
        </ol>
        {suggestion ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-2">
            <span className="flex items-center justify-between">
              <Quiet className="flex items-center gap-1">
                {suggestion.status === "open" ? (
                  <>
                    <Icon name="draft" className="size-3" />
                    Draft ready ·{" "}
                  </>
                ) : null}
                {countOf(suggestion.edits.length, "change")}
              </Quiet>
              <StatusChip status={suggestion.status} />
            </span>
            <DiagnosticLine suggestion={suggestion} />
            <ShowOnCanvas session={session} suggestion={suggestion} />
          </div>
        ) : first.outcome ? (
          <Receipt
            session={session}
            id={FIRST_EMAIL_ASK}
            outcome={first.outcome}
            edits={first.edits}
          />
        ) : null}
      </AgentMessage>
    </>
  );
}

function Exchange({
  session,
  ask,
}: {
  readonly session: Session;
  readonly ask: Ask;
}): ReactNode {
  return (
    <>
      <YourMessage
        scope={
          ask.about === undefined ? (
            <Quiet className="rounded-md bg-secondary px-1.5 py-0.5">
              Whole email
            </Quiet>
          ) : (
            <ScopeChip
              session={session}
              blockId={ask.about.id}
              label={ask.about.label}
            />
          )
        }
      >
        {ask.text}
      </YourMessage>
      <AgentMessage>
        {ask.working ? (
          <Working
            label={
              ask.about === undefined
                ? "Reading the email"
                : `Reading the ${ask.about.label.toLowerCase()}`
            }
          />
        ) : (
          <>
            <Calls ask={ask} />
            <p className="m-0">{ask.reply}</p>
          </>
        )}
        <SuggestionCard session={session} ask={ask} />
      </AgentMessage>
    </>
  );
}

/**
 * The Suggestion an ask left: where it stands, what it changes, and a link to
 * it on the Canvas. It is decided there, on its DecisionBar or with the keys,
 * never here, so there is one place to decide and one Suggestion it means.
 */
function SuggestionCard({
  session,
  ask,
}: {
  readonly session: Session;
  readonly ask: Ask;
}): ReactNode {
  const suggestion = useSuggestion(session.editor, ask.suggestionId);
  const status = suggestion?.status ?? ask.outcome;
  if (status === undefined) return null;

  if (!suggestion) {
    if (status !== "accepted" && status !== "rejected") return null;
    return (
      <Receipt
        session={session}
        id={ask.id}
        outcome={status}
        edits={ask.edits}
      />
    );
  }

  const stale = suggestion.status === "stale";
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-2",
        stale ? "opacity-75" : "border-primary/40",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <Quiet>
          {stale ? "The email changed under it" : "Showing on the email"}
        </Quiet>
        <StatusChip status={suggestion.status} />
      </span>
      <EditList editor={session.editor} edits={suggestion.edits} />
      <DiagnosticLine suggestion={suggestion} />
      <div className="flex items-center gap-1.5">
        <ShowOnCanvas session={session} suggestion={suggestion} />
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          title="Try again"
          aria-label="Try again"
          onClick={() => {
            session.retry(ask.id);
          }}
        >
          <ArrowPathIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * How a Suggestion was decided, under the message that made it. Undo shows
 * only while its accept is the newest step, so it never undoes anything else.
 */
function Receipt({
  session,
  id,
  outcome,
  edits,
}: {
  readonly session: Session;
  readonly id: string;
  readonly outcome: "accepted" | "rejected";
  readonly edits: number | undefined;
}): ReactNode {
  const undoable = useSession(session, (state) => state.undoable === id);
  const accepted = outcome === "accepted";
  return (
    <p className="card-in m-0 flex min-h-7 items-center gap-1.5 text-[0.75rem] text-muted-foreground">
      {accepted ? (
        <CheckIcon className="size-3 text-ok" aria-hidden="true" />
      ) : (
        <XMarkIcon className="size-3" aria-hidden="true" />
      )}
      {accepted
        ? edits === undefined
          ? "Accepted"
          : `Accepted ${countOf(edits, "change")}`
        : "Rejected"}
      {undoable ? (
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            session.undo(id);
          }}
        >
          <ArrowUturnLeftIcon className="size-3.5" aria-hidden="true" />
          Undo
        </Button>
      ) : null}
    </p>
  );
}

/**
 * Selects a Block the Suggestion touches, which brings it to the front with
 * its DecisionBar, and scrolls the Canvas to it. One that only adds Blocks has
 * nothing to select: it already has its bar, so the Canvas only scrolls.
 */
function ShowOnCanvas({
  session,
  suggestion,
}: {
  readonly session: Session;
  readonly suggestion: Suggestion;
}): ReactNode {
  const { editor } = session;
  const first = suggestion.touches.at(0);
  if (!first) return null;
  return (
    <button
      type="button"
      className="flex min-h-7 items-center gap-1 self-start text-[0.75rem] font-medium text-ink-mark hover:underline"
      onClick={() => {
        const blockId = selectableTouch(editor, suggestion);
        if (blockId !== undefined) editor.select(blockId);
        editor.reveal(blockId ?? first.blockId);
      }}
    >
      Show on the email
      <ArrowRightIcon className="size-3" aria-hidden="true" />
    </button>
  );
}

function Composer({ session }: { readonly session: Session }): ReactNode {
  const phase = usePhase(session);
  const offered = useSession(session, rejectedPrompt) ?? DEFAULT_PROMPT;
  const selected = useEditorState((editor) => editor.getSelection());
  const block = useEditorState((editor) =>
    selected === undefined ? undefined : editor.getBlock(selected),
  );
  const [text, setText] = useState(phase === "empty" ? DEFAULT_PROMPT : "");
  const [whole, setWhole] = useState(false);

  // A new selection is a new scope, even after the chip was dismissed.
  useEffect(() => {
    setWhole(false);
  }, [selected]);

  const blank = phase === "empty";
  const ready = phase === "ready";
  // The first email's Blocks are not stored until it is accepted, so there is
  // nothing to ask about until then.
  const waiting = phase === "writing";
  const scoped = ready && block && !whole ? block : undefined;

  // An email with no Blocks offers a prompt, and one with Blocks has no use
  // for it. A rejected draft's own comes back instead of the default.
  useEffect(() => {
    if (ready) setText("");
    if (blank) setText(offered);
  }, [ready, blank, offered]);

  const send = (value: string): void => {
    if (!value.trim() || waiting) return;
    if (blank) session.write(value);
    else session.ask(value, scoped?.id);
    setText("");
  };

  return (
    <div className="flex flex-none flex-col gap-2 border-t border-rule-soft p-3">
      {ready ? (
        <div className="flex flex-wrap gap-1">
          {quickAsks(scoped?.type).map((quick) => (
            <button
              key={quick}
              type="button"
              className="min-h-7 rounded-full border border-dashed px-2.5 text-[0.75rem] text-ink-2 transition-colors hover:border-primary hover:text-ink-mark"
              onClick={() => {
                send(quick);
              }}
            >
              {quick}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 rounded-xl border bg-background p-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--wash)]">
        <div className="flex items-center gap-1">
          {scoped ? (
            <ScopeChip
              session={session}
              blockId={scoped.id}
              label={session.labelOf(scoped.id)}
              onRemove={() => {
                setWhole(true);
              }}
            />
          ) : (
            <Quiet className="rounded-md bg-secondary px-1.5 py-0.5">
              {ready ? "Whole email" : "New email"}
            </Quiet>
          )}
        </div>
        <textarea
          value={text}
          rows={blank ? 4 : 2}
          aria-label="Message the agent"
          placeholder={
            waiting
              ? "Accept or reject the draft first"
              : scoped
                ? `What should change in this ${session.labelOf(scoped.id).toLowerCase()}?`
                : ready
                  ? "Ask about the email, or select a block"
                  : "Describe the email"
          }
          disabled={waiting}
          className="w-full resize-none bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground"
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
        <div className="flex items-center justify-between">
          <Quiet>↵ to send · ⇧↵ new line</Quiet>
          <Button
            size="icon-sm"
            aria-label="Send"
            disabled={!text.trim() || waiting}
            onClick={() => {
              send(text);
            }}
          >
            <ArrowUpIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
