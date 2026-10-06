import { useEditor, usePalette, usePaletteDrag } from "lekh-editor/canvas";

/** Your own grouping. The library offers a flat list and no opinion. */
const GROUPS: Record<string, readonly string[]> = {
  Layout: ["section", "columns"],
  Content: ["heading", "text", "image", "button", "divider"],
  Footer: ["unsubscribe", "postal-address"],
};

function PaletteButton({ type, label }: { type: string; label: string }) {
  const editor = useEditor();
  const { dragHandleProps, isDragging } = usePaletteDrag(type);

  return (
    <button
      type="button"
      {...dragHandleProps}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      // Clicking adds it too. Dragging is not the only way in.
      onClick={() => {
        const outcome = editor.place({ reason: "insert", type });
        if (outcome.status === "refused") {
          // Nothing would accept it. Say so rather than failing silently.
        }
      }}
    >
      {label}
    </button>
  );
}

export function Palette() {
  const entries = usePalette();
  const labels = new Map(entries.map((entry) => [entry.type, entry.label]));

  return (
    <div>
      {Object.entries(GROUPS).map(([group, types]) => {
        // Only offer what this editor actually composed in.
        const available = types.filter((type) => labels.has(type));
        if (available.length === 0) return null;

        return (
          <section key={group}>
            <h2>{group}</h2>
            {available.map((type) => (
              <PaletteButton key={type} type={type} label={labels.get(type)!} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
