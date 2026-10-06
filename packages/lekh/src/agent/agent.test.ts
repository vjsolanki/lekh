import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  agentTools,
  type BlockDefinition,
  createEditor,
  describeBlocks,
  type Editor,
  plainTextOf,
  readEmail,
  renderPreview,
} from "../index";
import { definitions, newsletter } from "../testing/preset";

const editorOn = (set: readonly BlockDefinition[] = definitions): Editor =>
  createEditor({ definitions: set, document: newsletter });

/** The tool's description, failing the test when there is no such tool. */
const descriptionOf = (
  tools: ReturnType<typeof agentTools>,
  name: string,
): string => {
  const tool = tools.definitions.find((each) => each.name === name);
  if (!tool) throw new Error(`No tool is named "${name}".`);
  return tool.description;
};

describe("agentTools", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = editorOn();
  });

  it("offers four tools, each with a valid JSON Schema object input", () => {
    const tools = agentTools(editor);
    expect(tools.definitions.map((tool) => tool.name)).toEqual([
      "read_email",
      "describe_blocks",
      "suggest",
      "render_preview",
    ]);
    const ajv = new Ajv2020({ strict: false });
    for (const tool of tools.definitions) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(40);
      expect(() => ajv.compile(tool.inputSchema)).not.toThrow();
    }
  });

  it("tells the model lekh's rules", () => {
    const suggest = descriptionOf(agentTools(editor), "suggest");
    for (const rule of [
      "blockId",
      "after",
      "before",
      "parent",
      "<strong>",
      "<a href>",
      "#rrggbb",
      '"none"',
      "Asset",
    ]) {
      expect(suggest).toContain(rule);
    }
  });

  describe("read_email", () => {
    it("gives the Document with ids, types and props", () => {
      const result = agentTools(editor).call("read_email", {});
      expect(result.isError).toBe(false);
      expect(result.content).toEqual({ document: editor.getDocument() });
      expect(JSON.stringify(result.content)).toContain('"id":"cta"');
    });

    it("puts the focused Block first, and says so", () => {
      const tools = agentTools(editor, { focus: "cta" });
      expect(Object.keys(tools.call("read_email", {}).content)).toEqual([
        "focus",
        "document",
      ]);
      expect(tools.call("read_email", {}).content).toMatchObject({
        focus: {
          id: "cta",
          type: "button",
          parentId: "row",
          props: { label: "Read on", href: "https://example.com" },
        },
      });
      expect(descriptionOf(tools, "read_email")).toContain('"cta"');
      expect(descriptionOf(tools, "suggest")).toContain('"cta"');
    });

    it("is the same as the readEmail building block", () => {
      expect(
        agentTools(editor, { focus: "copy" }).call("read_email", {}),
      ).toEqual({
        isError: false,
        content: readEmail(editor, { focus: "copy" }),
      });
    });
  });

  it("describe_blocks gives each Block Definition as JSON Schema", () => {
    expect(agentTools(editor).call("describe_blocks", {})).toEqual({
      isError: false,
      content: {
        rootType: newsletter.root.type,
        blocks: describeBlocks(editor.getDefinitions()),
      },
    });
  });

  describe("suggest", () => {
    it("opens a Suggestion and gives its id and Diagnostics", () => {
      const result = agentTools(editor).call("suggest", {
        edits: [{ kind: "set-prop", blockId: "cta", prop: "label", value: "" }],
        note: "Shorter.",
      });
      const [open] = editor.getSuggestions();
      expect(open?.note).toBe("Shorter.");
      expect(result).toEqual({
        isError: false,
        content: {
          status: "open",
          suggestion: open?.id,
          diagnostics: open?.diagnostics,
        },
      });
      expect(editor.getBlock("cta")?.props["label"]).toBe("Read on");
    });

    it("still takes Edits away from the focused Block", () => {
      const result = agentTools(editor, { focus: "cta" }).call("suggest", {
        edits: [
          { kind: "set-prop", blockId: "title", prop: "content", value: "Hi" },
          { kind: "insert", type: "text", id: "ps", after: "cta" },
        ],
      });
      expect(result.content).toMatchObject({ status: "open" });
    });

    it("accepts it at once with autoAccept", () => {
      const result = agentTools(editor, { autoAccept: true }).call("suggest", {
        edits: [
          { kind: "set-prop", blockId: "title", prop: "content", value: "Hi" },
        ],
      });
      expect(result.content).toMatchObject({ status: "accepted" });
      expect(editor.getSuggestions()).toEqual([]);
      expect(editor.getBlock("title")?.props["content"]).toBe("Hi");
      expect(editor.undo()).toBe(true);
      expect(editor.getBlock("title")?.props["content"]).toBe("Hello");
    });

    it("refuses a raw image URL, with a reason per Edit", () => {
      const before = editor.getDocument();
      const result = agentTools(editor, { autoAccept: true }).call("suggest", {
        edits: [
          {
            kind: "set-prop",
            blockId: "row",
            prop: "contentBackgroundImage",
            value: "https://hotlink.example/cat.png",
          },
        ],
      });
      expect(result).toMatchObject({
        isError: false,
        content: {
          status: "refused",
          reasons: [{ index: 0, code: "wrong-shape" }],
        },
      });
      expect(editor.getSuggestions()).toEqual([]);
      expect(editor.getDocument()).toBe(before);
    });

    it("refuses a prop closed to Agents", () => {
      const closed = definitions.map((definition): BlockDefinition => {
        const content = definition.schema["content"];
        return definition.type === "heading" && content
          ? {
              ...definition,
              schema: {
                ...definition.schema,
                content: { ...content, agent: false },
              },
            }
          : definition;
      });
      const result = agentTools(editorOn(closed)).call("suggest", {
        edits: [
          { kind: "set-prop", blockId: "title", prop: "content", value: "Hi" },
        ],
      });
      expect(result.content).toMatchObject({
        status: "refused",
        reasons: [{ index: 0, code: "closed-prop" }],
      });
    });

    it("refuses a malformed Edit by its index", () => {
      const result = agentTools(editor).call("suggest", {
        edits: [{ kind: "rename", blockId: "cta" }],
      });
      expect(result.content).toMatchObject({
        status: "refused",
        reasons: [{ index: 0, code: "malformed" }],
      });
    });

    it("is an error when edits is not a list", () => {
      expect(
        agentTools(editor).call("suggest", { edits: "all of it" }),
      ).toEqual({
        isError: true,
        content: { error: "`edits` must be a list of Edits." },
      });
      expect(agentTools(editor).call("suggest", undefined).isError).toBe(true);
    });
  });

  describe("render_preview", () => {
    it("gives the email as HTML and as plain text", () => {
      const result = agentTools(editor).call("render_preview", {});
      expect(result.isError).toBe(false);
      expect(result.content).toEqual(renderPreview(editor));
      const { html, text } = renderPreview(editor);
      expect(html).toContain("Read on");
      expect(text).toBe(
        "This week in email\n\nHello\n\nSome words.\n\nRead on (https://example.com)",
      );
    });

    it("shows open Suggestions, as the Author sees them", () => {
      const tools = agentTools(editor);
      tools.call("suggest", {
        edits: [
          { kind: "set-prop", blockId: "title", prop: "content", value: "Hi" },
        ],
      });
      expect(renderPreview(editor).text).toContain("Hi\n\nSome words.");
    });
  });

  it("is an error to call a tool it does not have", () => {
    expect(agentTools(editor).call("send_email", {})).toEqual({
      isError: true,
      content: {
        error:
          'No tool is named "send_email". The tools are read_email, ' +
          "describe_blocks, suggest, render_preview.",
      },
    });
  });
});

describe("plainTextOf", () => {
  it("keeps the words, breaks lines at blocks and spells out links", () => {
    expect(
      plainTextOf(
        "<html><head><style>p{}</style></head><body><!--[if mso]>x<![endif]-->" +
          "<h1>Big &amp; bold</h1><p>One<br/>two</p>" +
          '<ul><li>a</li><li>b</li></ul><a href="https://x.example">Go</a><br>' +
          '<a data-href="#">Not a link</a><br>' +
          '<a href="https://y.example">https://y.example</a></body></html>',
      ),
    ).toBe(
      "Big & bold\n\nOne\ntwo\n\n- a\n- b\n\nGo (https://x.example)\nNot a link\nhttps://y.example",
    );
  });

  it("keeps cells side by side apart", () => {
    expect(
      plainTextOf("<table><tr><td>Left</td><td>Right</td></tr></table>"),
    ).toBe("Left\n\nRight");
  });
});
