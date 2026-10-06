// @ts-check
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  // The live address. Canonical links, the sitemap and the llms.txt files are
  // built from it.
  site: "https://lekh.x23lab.com",
  // Old links. The agent example plugs into the editor, and lekh/preset is now
  // lekh-editor/blocks.
  redirects: {
    "/agent/": "/editor/",
    "/reference/preset/": "/reference/blocks/",
  },
  // Tailwind is here for two pages. Only `src/styles/editor.css` imports it, and
  // only `/` and `/editor/` import that — Astro bundles CSS per page, so
  // Starlight's own stylesheets never meet Tailwind's preflight.
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { "@": new URL("./src", import.meta.url).pathname },
    },
  },
  integrations: [
    starlight({
      title: "lekh",
      description:
        "A headless engine for building a drag-and-drop email editor into your own product. It handles the data model, drag and drop, undo and HTML that survives Outlook, and draws none of your interface.",
      // The site's own look. See `src/styles/docs.css` for what it is and why.
      customCss: ["./src/styles/docs.css"],
      // `/llms.txt`, `/llms-full.txt` and `/llms-small.txt`, for coding agents.
      // The details say the one thing an agent cannot guess: "agent" on this
      // site means an AI that edits emails, not the one writing your code.
      plugins: [
        starlightLlmsTxt({
          details: [
            "lekh draws no UI. Every panel, button and outline is code you write; a missing piece draws nothing rather than a default.",
            "",
            '"Agent" in these docs means an AI that edits emails inside the editor, not one writing code against lekh. To build an editor, start with [Build your first editor](https://lekh.x23lab.com/getting-started/).',
          ].join("\n"),
          promote: ["getting-started", "core-ideas"],
          exclude: ["404"],
        }),
      ],
      // Three of Starlight's parts are replaced rather than restyled, because
      // each needed different markup: the page head gained an eyebrow naming
      // the section, the hero lost its image slot entirely, and the banner
      // says the same pre-release notice on every page rather than waiting to
      // be set in frontmatter.
      components: {
        Banner: "./src/components/starlight/Banner.astro",
        Hero: "./src/components/starlight/Hero.astro",
        PageTitle: "./src/components/starlight/PageTitle.astro",
      },
      // Vitesse is the only pair of themes in the set drawn on warm neutrals
      // rather than blue-greys, so a code block sits on these grounds instead
      // of on top of them.
      expressiveCode: {
        themes: ["vitesse-dark", "vitesse-light"],
        styleOverrides: {
          borderRadius: "0.3125rem",
          borderColor: "var(--sl-color-hairline-light)",
          codeFontFamily: "var(--sl-font-mono)",
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.65",
          // Both themes ship their own ground, and they disagree about which
          // way it goes: Vitesse's dark is below the page, its light is above
          // it. Naming the rail for both makes a code block sunk into the sheet
          // in either theme, which is the one thing that has to stay true.
          codeBackground: "var(--sl-color-bg-sidebar)",
          frames: {
            frameBoxShadowCssValue: "none",
            editorActiveTabBackground: "var(--sl-color-bg-sidebar)",
            editorTabBarBackground: "transparent",
            editorTabBarBorderBottomColor: "var(--sl-color-hairline-light)",
            terminalBackground: "var(--sl-color-bg-sidebar)",
            terminalTitlebarBackground: "transparent",
            terminalTitlebarBorderBottomColor: "var(--sl-color-hairline-light)",
          },
        },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/vjsolanki/lekh",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            // The front page is `src/pages/index.astro`, outside Starlight,
            // so it is a link rather than a slug.
            { label: "Introduction", link: "/" },
            { label: "Build your first editor", slug: "getting-started" },
            { label: "Core ideas", slug: "core-ideas" },
          ],
        },
        // The five groups below are the guides, ordered by the build rather
        // than by module. Starlight's previous/next links follow this list, so
        // the sequence is the reader's route through the job: the panels they
        // draw, then what goes in an email, then the rules it has to meet, then
        // getting it out of the door, and last an agent on top.
        {
          label: "Build the editor",
          items: [
            {
              label: "Give the canvas a height",
              slug: "guides/canvas-scrolling",
            },
            { label: "Build a palette", slug: "guides/palette" },
            { label: "Build an inspector", slug: "guides/inspector" },
            { label: "Draw the chrome", slug: "guides/chrome" },
            {
              label: "Add your own control types",
              slug: "guides/custom-controls",
            },
            {
              label: "Make a drag one undo step",
              slug: "guides/dragging",
            },
            {
              label: "Add keyboard shortcuts",
              slug: "guides/keyboard-shortcuts",
            },
            {
              label: "Subscribe to changes efficiently",
              slug: "guides/subscribing",
            },
          ],
        },
        {
          label: "Write your Blocks",
          items: [
            { label: "Write your own Block", slug: "guides/custom-blocks" },
            { label: "Control what can go where", slug: "guides/nesting" },
            { label: "Type your Blocks properly", slug: "guides/typing" },
            {
              label: "Let people type formatted text",
              slug: "guides/rich-text",
            },
            { label: "Handle images and uploads", slug: "guides/images" },
            { label: "Make emails work on phones", slug: "guides/responsive" },
          ],
        },
        {
          label: "Keep emails valid",
          items: [
            {
              label: "Add unsubscribe and a postal address",
              slug: "guides/compliance",
            },
            {
              label: "Build a compliance footer of your own",
              slug: "guides/custom-compliance",
            },
            {
              label: "Show problems and offer fixes",
              slug: "guides/diagnostics",
            },
            {
              label: "Write your own checks",
              slug: "guides/custom-validators",
            },
          ],
        },
        {
          label: "Save and send",
          items: [
            { label: "Save and load a document", slug: "guides/save-and-load" },
            {
              label: "Render an email on a server",
              slug: "guides/server-rendering",
            },
            {
              label: "Change a block after emails exist",
              slug: "guides/migrations",
            },
          ],
        },
        {
          label: "Add an agent",
          items: [
            {
              label: "Add an agent to your editor",
              slug: "guides/add-an-agent",
            },
            {
              label: "Let Claude Code and Codex edit your emails",
              slug: "guides/agent-over-mcp",
            },
            {
              label: "Show your editor inside Claude and ChatGPT",
              slug: "guides/agent-as-mcp-app",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "lekh-editor", slug: "reference/lekh" },
            { label: "The Document", slug: "reference/document" },
            { label: "Render", slug: "reference/render" },
            { label: "Validators", slug: "reference/validators" },
            { label: "Agent tools", slug: "reference/agent" },
            { label: "lekh-editor/canvas", slug: "reference/canvas" },
            { label: "lekh-editor/blocks", slug: "reference/blocks" },
            { label: "Compliance Blocks", slug: "reference/compliance" },
            { label: "lekh-editor/tiptap", slug: "reference/tiptap" },
          ],
        },
        {
          label: "Why it works this way",
          items: [
            { label: "Headless by design", slug: "why/headless" },
            { label: "The op log and undo", slug: "why/op-log" },
            {
              label: "Forgiving editor, strict render",
              slug: "why/forgiving-editor",
            },
          ],
        },
        {
          label: "The example",
          items: [
            { label: "Open the editor", link: "/editor/" },
            { label: "How it is assembled", slug: "example" },
            { label: "The palette", slug: "example/palette" },
            { label: "The inspector", slug: "example/inspector" },
            { label: "The canvas chrome", slug: "example/chrome" },
            { label: "The outline", slug: "example/outline" },
            { label: "The image gallery", slug: "example/gallery" },
            { label: "The agent chat", slug: "example/agent" },
          ],
        },
        { label: "Glossary", slug: "glossary" },
      ],
    }),
    react(),
  ],
});
