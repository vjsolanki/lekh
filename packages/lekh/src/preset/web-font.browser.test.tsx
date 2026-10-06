import { describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider } from "../canvas";
import { createEditor } from "../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import { mount, whenRendered } from "../testing/browser";

/**
 * The web font on the Canvas (#137).
 *
 * The markup is covered without a DOM in `email.test.tsx`. This is the one
 * claim only a browser can check: the root's head reaches the frame (ADR-0003),
 * so the Author sizes text against the font the email asks for, not the
 * fallback.
 */
describe("the email's web font on the Canvas", () => {
  it("declares the font's faces inside the frame", async () => {
    const stack = "'Brand Sans', Arial, sans-serif";
    const editor = createEditor({
      definitions: createReactEmailPreset({
        fontFamily: stack,
        fonts: [
          {
            label: "Brand",
            stack,
            webFont: {
              faces: [
                { url: "https://cdn.example.invalid/brand-400.woff2" },
                {
                  url: "https://cdn.example.invalid/brand-700.woff2",
                  weight: 700,
                },
              ],
            },
          },
        ],
      }),
      rootType: REACT_EMAIL_ROOT_TYPE,
    });
    editor.insertBlock("text", editor.getDocument().root.id);

    const host = mount(
      <EditorProvider editor={editor}>
        <Canvas width={600} />
      </EditorProvider>,
    );
    const { frameDocument } = await whenRendered(host);

    await vi.waitFor(() => {
      const faces = [...frameDocument.fonts].filter(
        (face) => face.family.replaceAll(/["']/gu, "") === "Brand Sans",
      );
      expect(faces.map((face) => face.weight).toSorted()).toEqual([
        "400",
        "700",
      ]);
    });
  });
});
