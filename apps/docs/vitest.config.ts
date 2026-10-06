import { defineConfig } from "vitest/config";

// Plain Vitest, not Astro's Vite config: the tests here cover the modules a
// page imports, never a page. `lekh` resolves to its build, so build it first.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
