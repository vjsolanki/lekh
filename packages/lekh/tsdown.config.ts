import { defineConfig } from "tsdown";

export default defineConfig({
  // Four entry points: the pure base, and one for each thing that needs a
  // browser or an install the base does not (ADR-0045). The Canvas and the
  // Text Engine need a browser and carry a client-only directive; the Blocks
  // need react.email, and the Text Engine needs Tiptap. The
  // `lekh/test-imports` rule in .oxlintrc.json keeps its own copy of this list.
  entry: ["src/index.ts", "src/canvas.tsx", "src/blocks.tsx", "src/tiptap.tsx"],
  format: ["esm"],
  dts: true,
  // Isomorphic: no Node or browser globals baked into the output.
  platform: "neutral",
  target: "es2023",
  sourcemap: true,
  clean: true,
});
