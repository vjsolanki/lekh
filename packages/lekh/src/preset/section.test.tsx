import { describe, expect, it } from "vitest";

import { containerTable, markup, placed, schemaOf } from "../testing/preset";

// #70: a section's border. Every default matches how it looked before.
describe("the section's border", () => {
  it("draws no section border at width zero", () => {
    const html = markup(placed("section", { borderColor: "#ff0000" }));

    expect(html).not.toContain("#ff0000");
    expect(containerTable(html)).not.toHaveProperty("border");
  });

  it("offers the section's border in the Content group, not Overridable", () => {
    const schema = schemaOf("section");
    for (const name of [
      "borderWidth",
      "borderStyle",
      "borderColor",
      "borderRadius",
    ]) {
      expect(schema?.[name]).toMatchObject({ group: "Content" });
      expect(schema?.[name]).not.toHaveProperty("mobile");
    }
    expect(schema?.["borderWidth"]).toMatchObject({ defaultValue: 0 });
    expect(schema?.["borderRadius"]).toMatchObject({ defaultValue: 0 });
  });
});
