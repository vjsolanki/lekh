/**
 * Small pieces the chat and the Canvas both draw: what a Suggestion changes,
 * which state it is in, and the agent at work.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { Edit, Editor, Suggestion } from "lekh";

import { cn } from "@/lib/utils";

import type { Session } from "./session";

/** What the Slots need from the page. */
export interface AgentChrome {
  readonly session: Session;
  /** The Block whose comment box is open. */
  readonly composing: string | undefined;
  readonly compose: (blockId: string | undefined) => void;
}

export const AgentChromeContext = createContext<AgentChrome | undefined>(
  undefined,
);

export function useAgentChrome(): AgentChrome {
  const chrome = useContext(AgentChromeContext);
  if (!chrome) throw new Error("The agent's Slots need its provider.");
  return chrome;
}

/** How each status of a Suggestion reads as a chip. */
const STATUS: Record<
  Suggestion["status"],
  { label: string; className: string }
> = {
  streaming: { label: "Writing", className: "bg-warn-wash text-warn" },
  open: { label: "Suggestion", className: "bg-wash text-ink-mark" },
  stale: {
    label: "Out of date",
    className: "bg-error-wash text-destructive",
  },
  accepted: { label: "Accepted", className: "bg-secondary text-ok" },
  rejected: {
    label: "Rejected",
    className: "bg-secondary text-muted-foreground",
  },
};

export function StatusChip({
  status,
}: {
  readonly status: Suggestion["status"];
}): ReactNode {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-px text-[0.75rem] font-medium whitespace-nowrap",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

/** "Agent working", with three dots that breathe. */
export function Working({ label }: { readonly label: string }): ReactNode {
  return (
    <span className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
      <span className="flex gap-0.5" aria-hidden="true">
        <i className="agent-dot" />
        <i className="agent-dot [animation-delay:120ms]" />
        <i className="agent-dot [animation-delay:240ms]" />
      </span>
      {label}
    </span>
  );
}

/** A value, short enough for one line of a before and after. */
function shortValue(value: unknown): string {
  if (value === undefined) return "default";
  const text =
    typeof value === "string"
      ? value.replaceAll(/<[^>]+>/gu, "").replaceAll("&amp;", "&")
      : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 118)}…` : text;
}

/**
 * What a Suggestion changes, Edit by Edit, as before and after.
 *
 * "Before" is read from the stored Document, which a Suggestion never
 * touches until it is accepted.
 */
export function EditList({
  editor,
  edits,
}: {
  readonly editor: Editor;
  readonly edits: readonly Edit[];
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted px-2 py-1.5 text-[0.75rem]/[1.5]">
      {edits.map((edit, index) => (
        // An Edit has no id of its own, and the list never reorders.
        // oxlint-disable-next-line react/no-array-index-key
        <EditLine key={index} editor={editor} edit={edit} />
      ))}
    </div>
  );
}

function EditLine({
  editor,
  edit,
}: {
  readonly editor: Editor;
  readonly edit: Edit;
}): ReactNode {
  const name = (id: string): string => {
    const block = editor.getBlock(id);
    if (!block) return id;
    return (
      editor.getDefinition(block.type)?.label ?? block.type
    ).toLowerCase();
  };

  switch (edit.kind) {
    case "set-prop": {
      const before = editor.getBlock(edit.blockId)?.props?.[edit.prop];
      return (
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground">
            {name(edit.blockId)} · {edit.prop}
          </span>
          <span className="font-mono break-words text-destructive line-through decoration-1">
            {shortValue(before)}
          </span>
          <span className="font-mono break-words text-ok">
            {shortValue(edit.value)}
          </span>
        </div>
      );
    }
    case "insert": {
      const place = edit.after ?? edit.before ?? edit.parent;
      const where =
        edit.after === undefined
          ? edit.before === undefined
            ? "in"
            : "before"
          : "after";
      return (
        <span className="text-ok">
          + {edit.type}
          {place === undefined ? "" : ` ${where} ${name(place)}`}
        </span>
      );
    }
    case "remove": {
      return <span className="text-destructive">− {name(edit.blockId)}</span>;
    }
    case "move": {
      return <span className="text-ink-2">↕ move {name(edit.blockId)}</span>;
    }
    default: {
      return null;
    }
  }
}

/** The first Diagnostic the email would have once a Suggestion is accepted. */
export function DiagnosticLine({
  suggestion,
}: {
  readonly suggestion: Suggestion;
}): ReactNode {
  const first = suggestion.diagnostics.at(0);
  if (first === undefined) return null;
  const more = suggestion.diagnostics.length - 1;
  return (
    <p className="m-0 text-[0.75rem] text-warn">
      {first.message}
      {more > 0 ? ` And ${String(more)} more.` : ""}
    </p>
  );
}
