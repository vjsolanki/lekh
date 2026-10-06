import { useState } from "react";
import { createEditor } from "lekh";
import { Canvas, EditorProvider } from "lekh/canvas";
import { createTiptapTextEngine } from "lekh/tiptap";

import { slots } from "./chrome";
import { definitions, rootType } from "./definitions";
import { resolveImage } from "./images";
import { Inspector } from "./inspector";
import { Palette } from "./palette";

export function EmailEditor() {
  // Created once. A new editor every render would throw the email away.
  const [{ editor, text }] = useState(() => {
    // One object, two halves. History goes to the editor, which knows nothing
    // about React. The editable surface goes to the provider.
    const engine = createTiptapTextEngine();
    return {
      editor: createEditor({
        definitions,
        rootType,
        textEngine: engine,
        resolveImage,
      }),
      text: engine,
    };
  });

  return (
    <EditorProvider editor={editor} editableText={text.EditableText}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px 1fr 260px",
          height: "100vh",
        }}
      >
        <Palette />
        {/*
          A height, so the Canvas provides its own scroller. The Slots are the
          Chrome drawn over the email — leave them out and the editor still
          works, but nothing on screen says so.
        */}
        <Canvas title="Email" height="50vh" slots={slots} />
        <Inspector />
      </div>
    </EditorProvider>
  );
}
