---
title: Headless by design
description: "Why the library draws none of your interface."
---

The library gives you a data model, editing mechanics and a path to HTML. It
gives you no panels, no buttons and no styling.

That is the central trade, so it is worth being clear about what you get and
what it costs.

## What "headless" means here

The canvas is the one thing it puts on screen, and even that draws no chrome.
No selection outline, no drop indicator, no toolbar. Those are components you
supply.

One slot has a default: `dragPreview`, the thing under your pointer while a
Block is being moved. It renders in your document, so your stylesheet reaches
it, and passing your own component replaces it entirely. It exists because a
drag with nothing under the pointer looks broken.

Everything else arrives as data:

- The palette is a list of `{ type, label }`.
- The inspector is a list of control descriptions.
- Problems are a list of Diagnostics.
- Image uploads are a request you answer.

You render all of it.

## Why not ship the panels

An email builder sits inside a product that already has a design system, a
layout, a permission model and opinions about everything. A shipped inspector
would be wrong on all four counts, and the usual escape hatches do not help
much.

**Theming props** cover the cases the author imagined and none of yours. The
first thing anybody needs is the one nobody anticipated.

**Slot overrides** turn into a second component API. You have to learn it on
top of the real one, and it has gaps of its own.

**Forking** works right up to the first upgrade.

All three routes end with you writing the panel anyway, except now you are
fighting something first. Describing the panel as data and letting you render
it skips the fight.

## What it costs you

Real work, and it is worth saying plainly.

Following the [tutorial](/getting-started/) gets you a working editor in about
150 lines. A polished one takes a few days rather than a few hours: icons,
grouping, keyboard-accessible controls, empty states, a decent image picker.

If what you want is a finished editor to drop in and restyle, this is the wrong
library. That is a real product, and a different one.

## What it buys you

**Your editor looks like your product**, because you drew it. No theme fighting,
no `!important`, no wrapper divs to undo somebody else's layout.

**A prop kind the library has never heard of works exactly as well as a
built-in one.** Control kinds are open strings, so the day you need a
product-picker control you write it and move on.

**You choose your rendering target.** The core imports nothing from
react.email. If you target MJML or your own components, none of it reaches you.

**The send path stays small.** The editor and the render path are separate
imports, so no editor code ends up in it.

**Your framework is your business.** The core is plain TypeScript with no DOM
and no `node:` builtins, so it runs in Node, in browsers and on edge runtimes.
Only the canvas needs React.

## Where the line is drawn

The library owns what is expensive to get right and identical everywhere:

- The email's data model and how it is stored.
- What a change is, and what undo means.
- Where a drag can land, given your nesting rules.
- What is wrong with an email, and what would fix it.
- Turning all of it into HTML that survives Outlook.

You own what is cheap to write and different everywhere: how it all looks.

That line is why the interface parts of the library are descriptions instead of
components. A Control Descriptor carries a kind, a value and a setter, and no
markup at all. Rendering it is entirely your decision.

## Where the frame draws the line

The canvas renders inside an isolated frame. An email has to be styled the way
a mail client will style it, and your application's CSS must not leak in and
make a broken email look fine.

The rule that falls out of it: **you style what is outside the frame, the email
styles what is inside**. Every slot you draw, including both drag slots,
renders in your document, so your stylesheet reaches all of it.

The cost lands in one place. A Block being dragged cannot be _previewed_ as
itself out here, because its appearance lives in the email's stylesheet in
there. Drag a 200-word text Block and the preview is a Block-sized outline, not
the paragraph. If you want the fidelity, the Block's real markup is still yours
to render. You would be rebuilding it from the Block's props, though, not
borrowing it from the frame.

So the canvas draws the email, and you draw everything on top of it.
