---
title: Forgiving editor, strict render
description: "Why editing lets things break and sending does not."
---

The same email is treated with opposite policies depending on where it is.

**While somebody is editing, never block and never destroy.**

**When it is rendered to HTML, refuse.**

The two policies look inconsistent, but the cost of being wrong is opposite in
each place.

## Why editing forgives

Somebody halfway through building an email is in an invalid state most of the
time. They deleted a section to rebuild it. They cleared a field to retype it.
An editor that fought them at each step would be unusable.

So two things hold while editing.

**A Block you have no Definition for is kept exactly as it was**, props,
children and id, byte for byte. It is surfaced through a slot so you can mark
it. Loading and saving an email can never quietly delete content nobody
understood. That matters most in the case you cannot see: somebody opens an
email made with a newer version of your Blocks, saves it, and hands back
something intact.

**A required Block refuses a direct delete, but deleting what holds it does
not.** A Block marked `deletable: false` cannot be removed on its own, so your
chrome can offer a padlock where the bin would be.

Deleting a Section that contains one still works. Refusing would make
redesigning a footer impossible, so the email becomes invalid instead and says
so, through a Diagnostic carrying a one-click fix.

## Why sending refuses

`renderDocument` throws on a Block it cannot draw and on any error-severity
problem.

A send job that stops is better than fifty thousand people receiving an email
with a hole in it, or one with no way to opt out. A stopped job is an alert at
9am. The alternative is a regulatory problem and a lot of unsubscribes.

## Why the checks are inside the render call

They could have been a separate `validate()` you call first. They are not, on
purpose.

Rendering is the **single exit** from the library. It is the only place a
promise about the finished email can actually be kept.

An opt-in check is one forgotten line away from a non-compliant campaign, and
that forgotten line would live in your codebase, not this one. Putting the
check where it cannot be skipped moves the guarantee to where it can be made.

There is an explicit opt-out, `validate: false`, for previews. Previewing a
half-finished email is a real need. It is one flag, on one call, and it is
obvious in a diff.

## Warnings never block

Errors stop rendering. Warnings never do, whatever they are about.

That split protects the checks themselves. The contrast check is a heuristic,
and a heuristic that can stop a send will eventually stop the wrong one. After
that happens twice, somebody turns off all the checks.

The same reasoning is why severity can only be raised, never lowered. If an
error could be softened to a warning, the refusal would have a back door, and a
back door is what somebody reaches for at 5pm on a Friday.

If you do not want a rule, do not switch it on. That is a decision made once,
visibly, in your configuration.

## Repairs are data

A Diagnostic often carries a Repair, and a Repair _describes_ a change instead
of performing one.

That is what lets validation run in both places. The render path describes
repairs and carries out none of them. It has no business changing an email it
was asked to send. Only an editor performs one, through `applyRepair`.

The two never disagree about what is wrong, because it is the same code
producing the same descriptions. They differ only in what they are allowed to
do about it.

A repair is one undoable step, so somebody who clicks "Fix it" and changes
their mind presses ⌘Z once.

## What follows from this

**Required-ness is per Block Definition, not built in.** An editor for
transactional email never composes the compliance Preset, and nothing about
opt-out links exists for it.

**Restoring a required Block scrolls to it.** A compliance repair must never
happen off-screen, or somebody clicks "Fix it", sees nothing move, and clicks
again.

**Every required Block must be placeable at the root**, since that is where a
restore puts it. This is checked when the editor is constructed, so a wiring
mistake shows up in development rather than in front of somebody with an
unsendable email.

## What this means for you

Render the Diagnostics. The library finds problems and describes them. If you
never draw them, nobody ever sees one, and the first anybody hears of it is
`renderDocument` throwing.

Read [Show problems and offer fixes](/guides/diagnostics/).
