import { describe, expect, it } from "vitest";

import { block, documentOf, onMobile } from "./tree";

describe("the tree builder", () => {
  it("writes a Document as a literal, naming each Block by its type and a counter", () => {
    const document = documentOf(
      block("email", { backgroundColor: "#eeeeee" }, [
        block("text", { content: "One" }),
        block("section", {}, [block("text", { content: "Two" })]),
      ]),
    );

    expect(document).toEqual({
      root: {
        id: "email-1",
        type: "email",
        props: { backgroundColor: "#eeeeee" },
        children: [
          { id: "text-1", type: "text", props: { content: "One" } },
          {
            id: "section-1",
            type: "section",
            props: {},
            children: [
              { id: "text-2", type: "text", props: { content: "Two" } },
            ],
          },
        ],
      },
    });
  });

  it("takes an id prop as the Block's id, and keeps it out of the props", () => {
    const document = documentOf(
      block("email", { id: "root" }, [
        block("text", { id: "hello", content: "Hi" }),
        block("text"),
      ]),
    );

    expect(document.root.id).toBe("root");
    expect(document.root.children?.[0]).toEqual({
      id: "hello",
      type: "text",
      props: { content: "Hi" },
    });
    // A named Block takes no number from the counter.
    expect(document.root.children?.[1]?.id).toBe("text-1");
  });

  it("starts the counters again for every Document", () => {
    const first = documentOf(block("email", {}, [block("text")]));
    const second = documentOf(block("email", {}, [block("text")]));

    expect(second).toEqual(first);
  });

  it("gives a container with no children an empty list, and a leaf none", () => {
    const document = documentOf(block("email", {}, []));
    expect(document.root.children).toEqual([]);
    expect(documentOf(block("email")).root).not.toHaveProperty("children");
  });

  it("stores a Mobile Override against a Block", () => {
    const document = documentOf(
      block("email", {}, [
        onMobile(block("text", { fontSize: 16 }), { fontSize: 14 }),
        block("text"),
      ]),
    );

    const [overridden, plain] = document.root.children ?? [];
    expect(overridden).toEqual({
      id: "text-1",
      type: "text",
      props: { fontSize: 16 },
      mobile: { fontSize: 14 },
    });
    expect(plain).not.toHaveProperty("mobile");
  });

  it("builds a Document no editor would, on purpose", () => {
    // An unknown type, a duplicate id, and Widths that total 90: the builder
    // checks nothing, so Diagnostic and Repair tests start from what they need.
    const document = documentOf(
      block("email", {}, [
        block("mystery", { id: "same" }),
        block("text", { id: "same" }),
        block("grid", {}, [
          block("cell", { share: 40 }),
          block("cell", { share: 50 }),
        ]),
      ]),
    );

    const [mystery, text, grid] = document.root.children ?? [];
    expect(mystery?.type).toBe("mystery");
    expect(text?.id).toBe(mystery?.id);
    expect(grid?.children?.map((cell) => cell.props["share"])).toEqual([
      40, 50,
    ]);
  });
});
