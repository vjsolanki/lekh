---
title: The op log and undo
description: "Why every change is a small, serialisable record."
---

The editor holds the email. Every change to it becomes one small record called
an Op, and Ops are the only way it ever moves.

Two separate decisions sit behind that.

## Why the library holds the email

The obvious React design is a controlled component: you hold the email in
state, pass it down, get a new one back on every change.

For a tree this size that is a bad trade. It means building a new email object
on every keystroke, and re-rendering your whole application while somebody
types. You would then still have to work out what actually changed in order to
save it.

So the library holds it, and tells you when something changed:

```ts
editor.subscribe(() => {
  // Read what this part of your interface shows.
});
```

You read what you need, when you need it. A font-size nudge does not re-render
your palette.

## Why changes are recorded as data

Undo would work without an op log — you could snapshot the tree, or reverse
mutations directly. That is not the reason.

The reason is that a change written down **as data** can be sent somewhere.

- **Save patches**, not whole emails. One changed prop is a tiny write whether
  the email has five Blocks or five hundred.
- **Sync between tabs**, by replaying what arrived.
- **Keep an audit trail**, because you have the actual list of what happened.
- **Add collaboration**, if you ever need to.

None of those are possible if a change is only a mutation that already
happened.

There is also a plain engineering reason. The mutation path is the widest seam
in the library: every drag, every inspector edit, every paste and every
migration goes through it. Adding an op log once dozens of call sites existed
would have meant rewriting all of them.

## The five Ops

`set-prop`, `insert`, `remove`, `move`, and a marker for a text edit.

Each carries what it replaced, so applying the reverse undoes it. That is all
undo is.

The text marker is the odd one. Formatted text lives on the Block and is
managed by the Text Engine, so it is not carried in the op log. The marker
records _that_ text changed, and undoing it asks the engine to step back.

## Undo steps in actions, not Ops

One thing somebody did is one step back, however many Ops it took.

Dropping an image is an insert, a selection change and a request leaving the
list. Clicking "Fix it" on a problem might set three props. Either way, ⌘Z
once.

This is why history holds actions instead of Ops. An undo stack that made
somebody press ⌘Z three times to take back one drag would be measuring the
wrong thing.

There is a subtler case. Sometimes a text edit's engine history has gone,
because the Block scrolled out of the canvas and its editable text went with it. That
edit cannot be undone, so undo steps over the entry instead of spending the
keystroke on nothing, and `canUndo()` reports what undo would really find.

## What the library does not do

**It ships no collaboration and takes no CRDT dependency.** It only declines to
make one impossible.

What it does provide:

- Ops carry an `origin`, so you can filter out your own echoes.
- `applyExternalOps` never touches the local undo stack. Nobody should be able
  to undo a colleague's edit.
- Undo leaves a colleague's later edit alone. If they changed or removed what
  your step touched, that part is skipped, and redo will not bring it back. A
  step with nothing left is stepped over.
- Selection is reconciled when a remote change removes the selected Block.
- Conflicts resolve last-write-wins in arrival order. That is the documented
  contract, not an accident.

If you build collaboration on this, note that you have **two** synchronisation
problems. The second is formatted text, which lives in the Text Engine. That
half is the engine's business, not the op log's.

## The order things happen in

For one action:

1. Ops are applied, in order.
2. Op subscribers run, one per Op.
3. Everything settles — selection reconciled, checks invalidated.
4. Change subscribers run, once.
5. Reveal subscribers run, if a Block should be scrolled to.

Two things follow. Your patch is written before anything reacts to the state it
produced, and by the time a change subscriber runs, everything the editor
reports has settled. `canUndo()` inside a listener already accounts for the
action that woke it.

Read [Subscribe to changes efficiently](/guides/subscribing/).
