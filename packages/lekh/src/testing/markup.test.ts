import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { createReactEmailPreset, REACT_EMAIL_ROOT_TYPE } from "../blocks";
import {
  markupOf,
  markupOfNode,
  outlookMarkup,
  parseMarkup,
  styleOf,
  stylesheetOf,
} from "./markup";
import { block, documentOf } from "./tree";

describe("the markup readers", () => {
  it("find elements by selector in markup the test Blocks render", () => {
    const html = markupOf(
      documentOf(
        block("email", { backgroundColor: "#eeeeee" }, [
          block("text", { content: "One" }),
          block("text", { content: "Two" }),
        ]),
      ),
    );
    const markup = parseMarkup(html);

    expect(markup.all("p").map((p) => p.textContent)).toEqual(["One", "Two"]);
    expect(styleOf(markup.one("body"))).toEqual({
      "background-color": "#eeeeee",
    });
  });

  it("render a bare node, or several, with no Document around them", () => {
    expect(markupOfNode(createElement("p", null, "One"))).toBe("<p>One</p>");
    expect(markupOfNode(["a", createElement("br", { key: "b" }), "c"])).toBe(
      "a<br/>c",
    );
  });

  it("read the stylesheet out of rendered markup, or nothing when there is none", () => {
    expect(stylesheetOf("<style>.a{color:red}</style><p>One</p>")).toBe(
      ".a{color:red}",
    );
    expect(stylesheetOf("<p>One</p>")).toBe("");
  });

  it("refuse a selector that matches nothing, or more than one, where one is asked for", () => {
    const markup = parseMarkup("<p>One</p><p>Two</p>");

    expect(() => markup.one("table")).toThrow(/No element matches "table"/u);
    expect(() => markup.one("p")).toThrow(/2 elements match "p"/u);
  });

  it("read a whole document as readily as a fragment", () => {
    const markup = parseMarkup(
      '<!DOCTYPE html><html lang="en"><head><title>Hi</title></head><body><p>One</p></body></html>',
    );

    expect(markup.one("html").getAttribute("lang")).toBe("en");
    expect(markup.one("title").textContent).toBe("Hi");
    expect(markup.all("p")).toHaveLength(1);
  });

  it("read a style as a map, whatever the order and spacing", () => {
    const one = parseMarkup(
      '<td style="padding:0 12px;color:#333333;font-family:Arial, sans-serif">x</td>',
    ).one("td");
    const other = parseMarkup(
      '<td style=" font-family : Arial,  sans-serif ; COLOR:#333333;  padding: 0   12px ; ">x</td>',
    ).one("td");

    expect(styleOf(one)).toEqual(styleOf(other));
    expect(styleOf(one)).toEqual({
      padding: "0 12px",
      color: "#333333",
      "font-family": "Arial, sans-serif",
    });
  });

  it("read a semicolon inside a quoted or bracketed value as part of it", () => {
    const element = parseMarkup(
      `<div style="background-image:url('a;b.png');font-family:&quot;Semi;Colon&quot;, serif">x</div>`,
    ).one("div");

    expect(styleOf(element)).toEqual({
      "background-image": "url('a;b.png')",
      "font-family": '"Semi;Colon", serif',
    });
  });

  it("read no style as an empty map", () => {
    expect(styleOf(parseMarkup("<p>x</p>").one("p"))).toEqual({});
  });
});

describe("the Outlook reader", () => {
  it("reads only what sits inside the sections Outlook alone reads", () => {
    const html =
      "<div>" +
      '<!--[if mso]><table role="presentation"><tr><td style="padding-right:12px"><![endif]-->' +
      '<a href="https://x.com">X</a>' +
      '<!--[if mso]></td><td style="padding-right:0"><![endif]-->' +
      '<a href="https://y.com">Y</a>' +
      "<!--[if mso]></td></tr></table><![endif]-->" +
      '<!--[if !mso]><!--><p class="others">Not for Outlook</p><!--<![endif]-->' +
      "</div>";

    const outlook = outlookMarkup(html);

    // The halves join up, so the table Outlook draws reads as one.
    expect(outlook.all("td").map((td) => styleOf(td))).toEqual([
      { "padding-right": "12px" },
      { "padding-right": "0" },
    ]);
    expect(outlook.all("a")).toEqual([]);
    expect(outlook.all(".others")).toEqual([]);
    // And the markup every other client reads has none of it.
    expect(parseMarkup(html).all("td")).toEqual([]);
  });

  it("reads the Preset's Outlook-only markup by selector", () => {
    const html = markupOf(
      documentOf(
        block(REACT_EMAIL_ROOT_TYPE, {}, [
          block(
            "section",
            {
              contentBackgroundImage: {
                src: "https://cdn.example.com/sky.jpg",
                width: 1200,
                height: 800,
              },
            },
            [block("text", { content: "Over the sky" })],
          ),
        ]),
      ),
      { definitions: createReactEmailPreset() },
    );

    const outlook = outlookMarkup(html);

    expect(outlook.all("o\\:OfficeDocumentSettings")).toHaveLength(1);
    const fill = outlook.one("v\\:rect v\\:fill");
    expect(fill.getAttribute("src")).toBe("https://cdn.example.com/sky.jpg");
    // What sits between the halves is every client's, so not Outlook's alone.
    expect(outlook.one("v\\:textbox").textContent).toBe("");
  });

  it("reads nothing from markup with no Outlook sections", () => {
    expect(outlookMarkup("<p>Plain</p>").all("*")).toEqual(
      outlookMarkup("").all("*"),
    );
  });
});
