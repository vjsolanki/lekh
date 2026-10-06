import { describe, expect, it, vi } from "vitest";

import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../../blocks";
import { renderDocument, toHtml } from "../../index";
import { mount } from "../../testing/browser";

/**
 * Line heights as a browser lays them out.
 *
 * The markup tests check the declaration. This checks the claim behind the
 * text Block's default: `150%` on a paragraph sized `1em` of a 16px cell is
 * the 24px react.email's `Text` used to fix.
 */

async function laidOut(
  type: string,
  props: Record<string, unknown>,
): Promise<HTMLElement> {
  const html = toHtml(
    renderDocument(
      {
        root: {
          id: "root",
          type: REACT_EMAIL_ROOT_TYPE,
          props: {},
          children: [
            { id: "copy", type, props: { content: "Words", ...props } },
          ],
        },
      },
      { definitions: createReactEmailPreset() },
    ),
    { doctype: false },
  );
  const host = mount(<div dangerouslySetInnerHTML={{ __html: html }} />);
  return vi.waitFor(() => {
    const text = host.querySelector<HTMLElement>("h1, p");
    if (!text) throw new Error("No heading or paragraph was rendered.");
    return text;
  });
}

describe("line height in a browser", () => {
  it("lays a default 16px text Block out at 24px, as before", async () => {
    const text = await laidOut("text", {});
    expect(getComputedStyle(text).lineHeight).toBe("24px");
  });

  it("scales with the font size", async () => {
    const text = await laidOut("text", { fontSize: 32 });
    expect(getComputedStyle(text).lineHeight).toBe("48px");
    const heading = await laidOut("heading", { fontSize: 40 });
    expect(getComputedStyle(heading).lineHeight).toBe("48px");
  });
});
