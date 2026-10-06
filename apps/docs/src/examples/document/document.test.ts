import {
  type Block,
  createEditor,
  type EmailDocument,
  renderDocument,
  toHtml,
} from "lekh";
import { createReactEmailPreset } from "lekh/blocks";
import { describe, expect, it } from "vitest";

import unstampedHeading from "./unstamped-heading.json";
import welcome from "./welcome.json";

// The JSON on the Document reference page. Each claim the page makes about it
// is checked here, so the page cannot go on saying it after it stops being true.

const definitions = createReactEmailPreset();

const inEmail = (block: Block): EmailDocument => ({
  root: {
    id: "root",
    type: "email",
    version: 0,
    props: {},
    children: [block],
  },
});

describe("the example Document", () => {
  const document = welcome as EmailDocument;

  it("loads unchanged, because every Block is stamped with today's version", () => {
    const editor = createEditor({ definitions, document });

    expect(editor.getDocument()).toEqual(document);
  });

  it("has nothing wrong with it", () => {
    const editor = createEditor({ definitions, document });

    expect(editor.getDiagnostics()).toEqual([]);
  });

  it("renders to HTML", () => {
    const html = toHtml(renderDocument(document, { definitions }));

    expect(html).toContain("Open your dashboard");
  });
});

describe("a heading with no version", () => {
  it("gets the old default color stored on it, and stops following the email's", () => {
    const editor = createEditor({
      definitions,
      document: inEmail(unstampedHeading),
    });

    expect(editor.getBlock("title")).toMatchObject({
      version: 3,
      props: { color: "#111111" },
    });
  });

  it("keeps following the email's text color once it is stamped", () => {
    const editor = createEditor({
      definitions,
      document: inEmail({ ...(unstampedHeading as Block), version: 3 }),
    });

    expect(editor.getBlock("title")?.props).not.toHaveProperty("color");
  });
});
