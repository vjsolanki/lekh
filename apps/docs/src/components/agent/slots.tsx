/**
 * What the agent draws over the Canvas, on top of the editor's own Slots: the
 * Ask button on the selected Block's toolbar, the prompt it opens at the
 * Block, and every open Suggestion.
 *
 * Every rectangle here comes from the Canvas. Nothing reads the iframe.
 */

import {
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Block, Suggestion } from "lekh";
import {
  useEditor,
  useEditorState,
  type BlockChromeProps,
  type CanvasSlots,
  type Rect,
  type SuggestionChromeProps,
  type TouchedBlock,
} from "lekh/canvas";
import {
  ArrowPathIcon,
  ChatBubbleOvalLeftIcon,
  CheckIcon,
  SparklesIcon,
  StopIcon,
} from "@heroicons/react/24/outline";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/editor/icons";
import { display } from "@/components/editor/shortcuts";

import { countOf, quickAsks } from "./agent";
import { useAgentChrome } from "./parts";
import {
  isSelectableTouch,
  selectableTouch,
  usePhase,
  useSession,
  useSuggestions,
  useSuggestionsAtSelection,
  type Ask,
  type Session,
} from "./session";

function box(rect: Rect): CSSProperties {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/* -------------------------------------------------------------- selection */

/** Whether the agent is still answering an ask about this Block. */
function useAnswering(session: Session, blockId: string): boolean {
  return useSession(session, (state) =>
    state.asks.some((ask) => ask.working && ask.about?.id === blockId),
  );
}

/**
 * Ask, on the selected Block's toolbar. It opens a prompt at the Block, and
 * pressed again, puts it away. What is sent there lands in the chat too.
 *
 * Not offered before the email has Blocks to ask about, and greyed out while
 * the agent is still answering about this one.
 */
export function AskButton({ block }: { readonly block: Block }): ReactNode {
  const { session, composing, compose } = useAgentChrome();
  const working = useAnswering(session, block.id);
  if (usePhase(session) !== "ready") return null;
  const open = composing === block.id;

  return (
    <>
      <button
        type="button"
        className="flex h-8 items-center gap-1 rounded-[6px] px-2 text-toolbar-mark transition-colors hover:bg-white/12 aria-expanded:bg-white/12 disabled:opacity-35"
        title={
          working
            ? "The agent is answering about this block"
            : "Ask the agent about this block"
        }
        aria-expanded={open && !working}
        disabled={working}
        onClick={() => {
          compose(open ? undefined : block.id);
        }}
      >
        <SparklesIcon className="size-3.5" aria-hidden="true" />
        Ask
      </button>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
    </>
  );
}

/**
 * The editor's own selection, a sweep over the Block while the agent reads
 * it, and the prompt Ask opened.
 */
function SelectionWithAsk({
  Selection,
  ...props
}: BlockChromeProps & {
  readonly Selection: ComponentType<BlockChromeProps> | undefined;
}): ReactNode {
  const { session, composing } = useAgentChrome();
  const { block, rect } = props;
  const working = useAnswering(session, block.id);
  const ready = usePhase(session) === "ready";

  return (
    <>
      {Selection ? <Selection {...props} /> : null}
      {working ? (
        <div
          className="agent-shimmer pointer-events-none absolute rounded-[3px]"
          style={box(rect)}
        />
      ) : null}
      {ready && !working && composing === block.id ? (
        <AskPrompt block={block} rect={rect} />
      ) : null}
    </>
  );
}

const POPOVER_WIDTH = 296;

/** A small composer under the Block, with quick asks for its type. */
function AskPrompt({
  block,
  rect,
}: {
  readonly block: Block;
  readonly rect: Rect;
}): ReactNode {
  const { session, compose } = useAgentChrome();
  const [text, setText] = useState("");
  const send = (value: string): void => {
    if (!value.trim()) return;
    session.ask(value, block.id);
    compose(undefined);
  };

  return (
    <div
      className="pop-in pointer-events-auto absolute z-10 flex flex-col gap-2 rounded-xl border bg-popover p-2.5 text-[0.8125rem] text-popover-foreground shadow-[0_0_0_1px_rgb(0_0_0/4%),0_16px_40px_-12px_rgb(0_0_0/40%)]"
      style={{
        top: rect.top + rect.height + 10,
        left: Math.max(rect.left + 12, 8),
        width: POPOVER_WIDTH,
      }}
    >
      <div className="flex items-center gap-2 rounded-lg border bg-background px-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--wash)]">
        <SparklesIcon
          className="size-4 flex-none text-primary"
          aria-hidden="true"
        />
        <input
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={text}
          aria-label="Ask the agent about this block"
          placeholder={`Ask about this ${session.labelOf(block.id).toLowerCase()}…`}
          className="h-9 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") send(text);
            if (event.key === "Escape") compose(undefined);
          }}
        />
        <kbd className="keycap">↵</kbd>
      </div>
      <div className="flex flex-col">
        {quickAsks(block.type).map((quick) => (
          <button
            key={quick}
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-2 hover:bg-secondary hover:text-foreground"
            onClick={() => {
              send(quick);
            }}
          >
            <ChatBubbleOvalLeftIcon
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            {quick}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ suggestions */

/** The keys that decide the Suggestion in front, as printed. */
export const ACCEPT_KEYS = display("Mod+Enter");
export const REJECT_KEYS = display("Mod+Backspace");

/**
 * One open Suggestion: a mark on each Block it touches, and the DecisionBar
 * on the lowest of them when it is the one being decided on.
 *
 * A Block inside another touched Block is left unmarked, so a new section
 * reads as one mark rather than one per Block in it.
 *
 * The bar goes to the first Suggestion touching the selected Block, read from
 * lekh (ADR-0042), so the bar, the keys and the chat always mean the same one.
 * Clicking a mark selects its Block, which brings its Suggestion up. One that
 * only adds Blocks has nothing to select, so with nothing at the selection
 * the newest of those has the bar. Only one bar shows at a time, so bars
 * never stack over the email.
 */
function SuggestionMarks({
  suggestion,
  blocks,
}: SuggestionChromeProps): ReactNode {
  const { session } = useAgentChrome();
  const editor = useEditor();
  const ask = useSession(session, () => session.askOf(suggestion));
  const suggestions = useSuggestions(editor);
  const atSelection = useSuggestionsAtSelection();
  const selected = useEditorState((current) => current.getSelection());
  const atFront = atSelection.at(0)?.id;
  const withBar =
    atFront ??
    suggestions.findLast((each) => selectableTouch(editor, each) === undefined)
      ?.id;
  const hasBar = withBar === suggestion.id;
  // The keys act only on the Suggestion in front: first at the selection, and
  // open. So only its bar shows them.
  const keyed = atFront === suggestion.id && suggestion.status === "open";

  const inside = new Set(
    blocks.flatMap((touched) => descendants(touched.block)),
  );
  const marked = blocks.filter((touched) => !inside.has(touched.block.id));
  const lowest = marked.reduce<TouchedBlock | undefined>(
    (low, touched) =>
      !low ||
      touched.rect.top + touched.rect.height > low.rect.top + low.rect.height
        ? touched
        : low,
    undefined,
  );

  return (
    <>
      {marked.map((touched) => {
        const { id } = touched.block;
        // A Block it adds is not stored yet, and the selected one is already
        // picked: a click there belongs to the Canvas, to start typing.
        const pickable =
          id !== selected &&
          isSelectableTouch(editor, { blockId: id, change: touched.change });
        return (
          <Mark
            key={id}
            change={touched.change}
            rect={touched.rect}
            status={suggestion.status}
            hasBar={hasBar}
            onPick={
              pickable
                ? () => {
                    editor.select(id, { via: "pointer" });
                  }
                : undefined
            }
          />
        );
      })}
      {hasBar && lowest ? (
        <DecisionBar
          suggestion={suggestion}
          ask={ask}
          rect={lowest.rect}
          keyed={keyed}
        />
      ) : null}
    </>
  );
}

function descendants(block: Block): string[] {
  return (block.children ?? []).flatMap((child) => [
    child.id,
    ...descendants(child),
  ]);
}

/**
 * The dashed outline on a touched Block. Red stripes for one it removes,
 * grey for a stale one, a sweep while it is still being written.
 *
 * With `onPick`, the mark takes the click and selects its Block, rather than
 * the Canvas selecting whatever lies under the pointer inside it.
 */
function Mark({
  change,
  rect,
  status,
  hasBar,
  onPick,
}: {
  readonly change: TouchedBlock["change"];
  readonly rect: Rect;
  readonly status: Suggestion["status"];
  readonly hasBar: boolean;
  readonly onPick: (() => void) | undefined;
}): ReactNode {
  const className = cn(
    "absolute rounded-[3px] outline-2 -outline-offset-1 outline-dashed",
    status === "stale"
      ? "outline-muted-foreground/60"
      : change === "remove"
        ? "bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--destructive)_10%,transparent)_0_6px,transparent_6px_12px)] outline-destructive"
        : status === "streaming"
          ? "agent-shimmer outline-primary/60"
          : hasBar
            ? "outline-primary"
            : "outline-primary/50",
  );
  if (!onPick) {
    return (
      <div className={cn(className, "pointer-events-none")} style={box(rect)} />
    );
  }
  return (
    <button
      type="button"
      aria-label="Show this suggestion"
      title="Show this suggestion"
      className={cn(className, "pointer-events-auto cursor-pointer")}
      style={box(rect)}
      onClick={onPick}
    />
  );
}

/**
 * Accept and Reject, on the Suggestion's bottom edge. The same toolbar as the
 * Block's, on the same tokens, because it is the same kind of thing: an action
 * here. Accept wears the mark colour, as the marks do.
 *
 * The one place a Suggestion is decided: the chat only says where it stands.
 * All call the Suggestion's own methods. Accept says how many changes it
 * takes. One still arriving offers Stop, which finishes it as it stands, so
 * it can be accepted. A stale one refuses to be accepted, so it offers only to
 * go away.
 */
function DecisionBar({
  suggestion,
  ask,
  rect,
  keyed,
}: {
  readonly suggestion: Suggestion;
  readonly ask: Ask | undefined;
  readonly rect: Rect;
  /** It is the Suggestion in front, which ⌘↵ and ⌘⌫ act on. */
  readonly keyed: boolean;
}): ReactNode {
  const { session } = useAgentChrome();
  const { status } = suggestion;
  const button =
    "flex h-8 items-center gap-1 rounded-[6px] px-2.5 text-toolbar-ink transition-colors hover:bg-white/12 hover:text-toolbar-foreground";

  return (
    <div
      className="toolbar-in pointer-events-auto absolute z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-toolbar p-[3px] text-[0.75rem] text-toolbar-foreground shadow-toolbar"
      // Straddles the bottom edge on the left, clear of the Ask prompt's box.
      style={{ top: rect.top + rect.height, left: rect.left + 12 }}
    >
      <span className="flex items-center gap-1 px-1.5 text-toolbar-mark">
        <Icon name="suggestion" className="size-3.5" />
        {status === "stale"
          ? "Out of date: the email changed under it"
          : status === "streaming"
            ? "Writing…"
            : (suggestion.note ?? "Suggestion")}
      </span>
      {status === "open" ? (
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded-[6px] bg-primary px-2.5 text-primary-foreground transition-colors hover:bg-primary/90"
          title={keyed ? `Accept (${ACCEPT_KEYS})` : "Accept"}
          onClick={() => {
            suggestion.accept();
          }}
        >
          <CheckIcon className="size-3.5" aria-hidden="true" /> Accept{" "}
          {countOf(suggestion.edits.length, "change")}
        </button>
      ) : null}
      {status === "streaming" ? (
        <button
          type="button"
          className={button}
          title="Stop, and keep what has arrived"
          onClick={() => {
            suggestion.finish();
          }}
        >
          <StopIcon className="size-3.5" aria-hidden="true" /> Stop
        </button>
      ) : null}
      <button
        type="button"
        className={button}
        title={keyed ? `Reject (${REJECT_KEYS})` : undefined}
        onClick={() => {
          suggestion.reject();
        }}
      >
        {status === "stale" ? "Dismiss" : "Reject"}
      </button>
      {ask && status !== "streaming" ? (
        <button
          type="button"
          className="grid size-8 place-items-center rounded-[6px] text-toolbar-ink transition-colors hover:bg-white/12 hover:text-toolbar-foreground"
          title="Try again"
          aria-label="Try again"
          onClick={() => {
            session.retry(ask.id);
          }}
        >
          <ArrowPathIcon className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** The editor's Slots, with the agent's selection and Suggestions on top. */
export function agentSlots(slots: CanvasSlots): CanvasSlots {
  const Selection = slots.selection;
  return {
    ...slots,
    selection: (props) => <SelectionWithAsk {...props} Selection={Selection} />,
    suggestion: SuggestionMarks,
  };
}
