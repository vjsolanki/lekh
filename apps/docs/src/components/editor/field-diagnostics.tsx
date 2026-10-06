import type { ReactNode } from "react";
import type { ControlDescriptor, Diagnostic, Editor } from "lekh";
import { useEditorState } from "lekh/canvas";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon } from "./icons";
import { washField } from "./motion";

type Stage = ReturnType<Editor["getStage"]>;

/**
 * The attribute a field wears so a Diagnostic can find it: every
 * `blockId:prop` it edits, space-separated. A Box edits four.
 */
const FIELD = "data-fields";

/** How a field names one prop of one Block: `blockId:prop`. */
export function fieldKey(blockId: string, prop: string): string {
  return `${blockId}:${prop}`;
}

/** The attribute for a field, from the controls it draws. */
export function fieldOf(controls: readonly ControlDescriptor[]): {
  readonly [FIELD]: string;
} {
  return {
    [FIELD]: controls
      .map((control) => fieldKey(control.blockId, control.name))
      .join(" "),
  };
}

/**
 * Focus the field a Diagnostic names, once the Inspector has drawn it.
 *
 * Called straight after selecting the Block, so the field is usually not
 * there yet. It looks again each frame, for a few frames, then gives up.
 */
export function focusField(blockId: string, prop: string): void {
  const key = CSS.escape(fieldKey(blockId, prop));
  const wanted = `[${FIELD}~="${key}"]`;
  let frames = 0;
  const look = (): void => {
    const field = document.querySelector<HTMLElement>(wanted);
    if (!field) {
      frames += 1;
      if (frames < 20) requestAnimationFrame(look);
      return;
    }
    // An advanced field may sit in a closed fold, and a column's inside the
    // column's fold too. Opening each fires `toggle`, which the Inspector
    // keeps.
    for (
      let fold = field.closest("details");
      fold !== null;
      fold = fold.parentElement?.closest("details") ?? null
    ) {
      if (!fold.open) fold.open = true;
    }
    field.scrollIntoView({ block: "nearest" });
    // A Box is one field with four inputs, each naming the prop it writes.
    const control =
      field.querySelector<HTMLElement>(`[data-field="${key}"]`) ??
      field.querySelector<HTMLElement>(
        "input:not([type=hidden]), textarea, button, [tabindex]:not([tabindex='-1'])",
      );
    (control ?? field).focus({ preventScroll: true });
    washField(field);
  };
  requestAnimationFrame(look);
}

/**
 * Whether a Diagnostic is about what this row shows on this Stage.
 *
 * One without a Stage is about the desktop value. On mobile, a row that
 * follows desktop shows that value too, so it is this row's problem. A row
 * with its own Mobile Override is not.
 */
function isHere(
  diagnostic: Diagnostic,
  control: ControlDescriptor,
  stage: Stage,
): boolean {
  const about = diagnostic.stage ?? "desktop";
  if (about === stage) return true;
  return about === "desktop" && control.origin !== "override";
}

/**
 * The Diagnostics under a field: each one in full, with its Repair as a button,
 * and one short line for those on the other Stage that switches to it.
 *
 * A Diagnostic about mobile alone is not blamed on the desktop value. On desktop it
 * is one quiet line, "Mobile: 1 problem", and in full on the mobile row.
 */
export function FieldDiagnostics({
  controls,
  editor,
  onMobile,
}: {
  readonly controls: readonly ControlDescriptor[];
  readonly editor: Editor;
  readonly onMobile: boolean;
}): ReactNode {
  const diagnostics = useEditorState((current) => current.getDiagnostics());
  const stage: Stage = onMobile ? "mobile" : "desktop";

  const here: Diagnostic[] = [];
  const elsewhere: Diagnostic[] = [];
  for (const control of controls) {
    for (const diagnostic of diagnostics) {
      if (
        diagnostic.blockId !== control.blockId ||
        diagnostic.prop !== control.name
      ) {
        continue;
      }
      (isHere(diagnostic, control, stage) ? here : elsewhere).push(diagnostic);
    }
  }
  if (here.length === 0 && elsewhere.length === 0) return null;

  const other: Stage = onMobile ? "desktop" : "mobile";
  return (
    <div className="mt-1 flex flex-col gap-1">
      {here.map((diagnostic) => (
        <DiagnosticLine
          key={`${diagnostic.code}:${diagnostic.prop ?? ""}:${diagnostic.stage ?? ""}`}
          diagnostic={diagnostic}
          editor={editor}
        />
      ))}
      {elsewhere.length > 0 ? (
        <button
          type="button"
          title={`Switch to ${other}`}
          className="flex min-h-6 items-center gap-1 self-start rounded-sm px-1.5 text-[0.75rem] text-warn hover:bg-warn-wash focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => {
            editor.setStage(other);
          }}
        >
          <Icon name={other} className="size-3 flex-none" />
          {other === "mobile" ? "Mobile" : "Desktop"}:{" "}
          {elsewhere.length === 1
            ? "1 problem"
            : `${String(elsewhere.length)} problems`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The Diagnostics about a Block as a whole, which name no prop, at the top of
 * its Inspector.
 */
export function BlockDiagnostics({
  blockId,
  editor,
}: {
  readonly blockId: string;
  readonly editor: Editor;
}): ReactNode {
  const diagnostics = useEditorState((current) => current.getDiagnostics());
  const found = diagnostics.filter(
    (diagnostic) =>
      diagnostic.blockId === blockId && diagnostic.prop === undefined,
  );
  if (found.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-rule-soft px-3.5 py-2">
      {found.map((diagnostic) => (
        <DiagnosticLine
          key={diagnostic.code}
          diagnostic={diagnostic}
          editor={editor}
        />
      ))}
    </div>
  );
}

/** One Diagnostic in full: what is wrong, and the way to put it right. */
function DiagnosticLine({
  diagnostic,
  editor,
}: {
  readonly diagnostic: Diagnostic;
  readonly editor: Editor;
}): ReactNode {
  const { severity, message, repair } = diagnostic;
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-md px-1.5 py-1 text-[0.75rem]/[1.45]",
        severity === "error"
          ? "bg-error-wash text-destructive"
          : "bg-warn-wash text-warn",
      )}
    >
      <Icon
        name={severity === "error" ? "error" : "warning"}
        className="mt-px size-3.5 flex-none"
      />
      <span className="flex-1">{message}</span>
      {repair ? (
        <Button
          variant="ghost"
          size="xs"
          className="-my-0.5 flex-none text-current hover:bg-current/10 hover:text-current"
          onClick={() => {
            // A Consumer's own Repair kinds would be switched on first. This
            // example has none, so every Repair goes straight through.
            editor.applyRepair(repair);
          }}
        >
          Fix
        </Button>
      ) : null}
    </div>
  );
}
