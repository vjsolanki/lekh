import { useEditor } from "lekh-editor/canvas";

import { useEditorValue } from "./subscribe-selector";

/** Everything currently wrong, with a fix button where there is one. */
export function ProblemsPanel() {
  const editor = useEditor();
  const diagnostics = useEditorValue(editor, (it) => it.getDiagnostics());

  const errors = diagnostics.filter((it) => it.severity === "error");
  const warnings = diagnostics.filter((it) => it.severity === "warning");

  return (
    <div>
      {errors.length > 0 && (
        <p>
          This email cannot be sent until {errors.length} problems are fixed.
        </p>
      )}

      <ul>
        {[...errors, ...warnings].map((diagnostic) => (
          <li key={`${diagnostic.code}:${diagnostic.blockId ?? "email"}`}>
            <span>{wordItYourself(diagnostic.code) ?? diagnostic.message}</span>

            {diagnostic.blockId !== undefined && (
              <button
                type="button"
                onClick={() => {
                  editor.select(diagnostic.blockId);
                }}
              >
                Show me
              </button>
            )}

            {diagnostic.repair !== undefined && (
              <button
                type="button"
                onClick={() => {
                  // Returns false for a repair the library cannot carry out.
                  editor.applyRepair(diagnostic.repair!);
                }}
              >
                Fix it
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Codes are stable, so say it in your own words. */
declare function wordItYourself(code: string): string | undefined;
