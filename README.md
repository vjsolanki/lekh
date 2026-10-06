# lekh

**Build a drag-and-drop email editor into your product.**

![Gzipped size of lekh](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fvjsolanki%2F5d00f9ab6617974fe2b6a95b643ce5b7%2Fraw%2Flekh.json)
![Gzipped size of lekh/canvas](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fvjsolanki%2F5d00f9ab6617974fe2b6a95b643ce5b7%2Fraw%2Flekh-canvas.json)

lekh handles the hard parts: the data model, dragging and dropping, undo, and
turning it all into HTML that survives Outlook. It draws none of your
interface. No panels, no buttons, no styling. That part is yours.

📖 **[Documentation](https://github.com/vjsolanki/lekh)** · run `pnpm docs:dev`
to read it locally.

## Is this for you?

**Yes, if** you are putting an email builder inside your own product and it
needs to look like your product.

**Probably not, if** you want a finished editor you can drop in and style. This
is the engine, not the dashboard.

## Install

```sh
npm install lekh
```

`react` and `react-dom` are peer dependencies (`^18.3.0 || ^19.0.0`).
`@react-email/components` and the three Tiptap packages are optional. You need
them only if you import the built-in Blocks or the shipped text engine.

Node 22.12 or newer when rendering server-side.

## What it looks like

```tsx
import { createEditor, defineBlock, renderDocument, toHtml } from "lekh";
import { Canvas, EditorProvider } from "lekh/canvas";

const heading = defineBlock<{ text: string; size: number }>({
  type: "heading",
  label: "Heading",
  schema: {
    text: { kind: "text", label: "Text", defaultValue: "Your headline" },
    size: { kind: "number", label: "Size", defaultValue: 28 },
  },
  render: ({ props }) => <h1 style={{ fontSize: props.size }}>{props.text}</h1>,
});

const editor = createEditor({
  definitions: [email, heading],
  rootType: "email",
});

// Put it on screen.
<EditorProvider editor={editor}>
  <Canvas height="100vh" />
</EditorProvider>;

// Send it.
const html = toHtml(
  renderDocument(editor.getDocument(), editor.getRenderOptions()),
);
```

The full walkthrough is **Build your first editor** in the docs: nine steps to
a working editor.

## Entry points

| Import        | What it is                                               | Why it is separate              |
| ------------- | -------------------------------------------------------- | ------------------------------- |
| `lekh`        | The editor, the render path, Validators and agent tools  | The base. Pure, runs anywhere   |
| `lekh/canvas` | The canvas, palette hooks, commands, keymap              | Needs a browser                 |
| `lekh/blocks` | The built-in Blocks, plus unsubscribe and postal address | Needs `@react-email/components` |
| `lekh/tiptap` | The shipped text engine                                  | Needs Tiptap                    |

`lekh` carries no client-only directive, so a Server Component can render a
stored email from it. It has no side effects, so your bundler leaves the editor
out when you import only the render path. Only `lekh/canvas` and `lekh/tiptap`
need a browser.

## Status

Not published to npm yet, and the API can still change. Every entry point's
exports are pinned by a snapshot test, so a change to the public surface is
never silent — the reference pages list everything each entry point carries.

## Repository layout

A pnpm workspace.

| Path             | What it is                           |
| ---------------- | ------------------------------------ |
| `packages/lekh/` | The published library                |
| `apps/docs/`     | Astro + Starlight documentation site |

## Development

Requires Node >= 22.12 and pnpm 10 (via corepack).

```sh
pnpm install
pnpm --filter lekh exec playwright install chromium

pnpm docs:dev      # the documentation site
pnpm test          # vitest: a node project and a browser one
pnpm typecheck     # tsc --noEmit
pnpm lint          # oxlint, syntax-only — fast
pnpm lint:types    # oxlint --type-aware — slower, runs in CI
pnpm build         # tsdown
pnpm format        # prettier --write .
```

Commits run Prettier and oxlint over staged files via husky + lint-staged.

Tests are split into two vitest projects. Everything that runs without a DOM is
in `node`. The `browser` project holds only what needs a real layout engine:
iframe rendering, coordinate translation and pointer dragging. It needs Chromium
installed once, as above.

Documentation examples live in `apps/docs/src/examples/` and are compiled by
`pnpm typecheck`, so a broken example fails the build rather than misleading a
reader. `packages/lekh/src/public-api.test.ts` pins each entry point's exports;
when it fails, update the matching Reference page before accepting the snapshot.

The package is not published yet. `private: true` blocks an accidental
`npm publish`. Remove that flag and add a release flow when it is ready to ship.

## License

MIT
