import { describe, expect, it, vi } from "vitest";

import { Canvas, EditorProvider } from "../../canvas";
import { createEditor, type EmailDocument } from "../../index";
import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../../blocks";
import { mount, whenRendered } from "../../testing/browser";

/**
 * The html Block in the Canvas, which is same-origin and unsandboxed.
 *
 * The cleaner's own tests show what it writes. This shows the claim that
 * matters in a browser: what reaches the Canvas cannot run, and a `<style>`
 * an Author wrote cannot restyle the Blocks round it (ADR-0028).
 */

function mountCanvas(html: string): HTMLElement {
  const document: EmailDocument = {
    root: {
      id: "root",
      type: REACT_EMAIL_ROOT_TYPE,
      props: {},
      children: [
        { id: "title", type: "heading", props: { content: "Theirs" } },
        { id: "snippet", type: "html", props: { html } },
      ],
    },
  };
  const editor = createEditor({
    definitions: createReactEmailPreset(),
    document,
  });
  return mount(
    <EditorProvider editor={editor}>
      <Canvas width={600} mobileWidth={375} />
    </EditorProvider>,
    { hostStyle: "position:absolute; top:0; left:0; height:600px;" },
  );
}

describe("the html Block in the Canvas", () => {
  it("never runs an onerror from stored markup", async () => {
    Reflect.set(window, "lekhRan", false);
    const host = mountCanvas(
      '<img id="bad" src="https://invalid.invalid/x.png" ' +
        'onerror="window.top.lekhRan = true">',
    );
    const { frameDocument } = await whenRendered(host);
    const image = await vi.waitFor(() => {
      const found = frameDocument.querySelector<HTMLImageElement>("#bad");
      if (found?.complete !== true)
        throw new Error("The image has not failed yet.");
      return found;
    });
    // One more turn, so an error handler would have had its chance.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(image.hasAttribute("onerror")).toBe(false);
    expect(Reflect.get(window, "lekhRan")).toBe(false);
  });

  it("keeps a <style> to its own Block", async () => {
    // A property the heading does not set inline, so only the scope can be
    // what keeps it off.
    const host = mountCanvas(
      '<style>h1{font-style:italic}</style><h1 id="mine">Mine</h1>',
    );
    const { frameDocument } = await whenRendered(host);
    const { view, mine, theirs } = await vi.waitFor(() => {
      const found = {
        view: frameDocument.defaultView,
        mine: frameDocument.querySelector("#mine"),
        theirs: frameDocument.querySelector('[data-block-id="title"] h1'),
      };
      if (!found.view || !found.mine || !found.theirs) {
        throw new Error("Nothing to compare yet.");
      }
      return { view: found.view, mine: found.mine, theirs: found.theirs };
    });

    expect(view.getComputedStyle(mine).fontStyle).toBe("italic");
    expect(view.getComputedStyle(theirs).fontStyle).toBe("normal");
  });
});
