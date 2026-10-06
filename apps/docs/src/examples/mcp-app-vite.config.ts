import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Build mcp-app-canvas.tsx into dist/canvas.html: one file, every script and
 * style inside it. The chat loads nothing else.
 */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    rolldownOptions: { input: "canvas.html" },
  },
});
