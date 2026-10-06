---
title: Glossary
description: "Every term this documentation uses, in one place."
---

Capitalised words in these docs are things with an exact meaning. Here they all
are.

## The email itself

**Document**
The JSON tree that is the email. The HTML and the canvas preview are both
produced from it. It is what you save.

**Block**
One node in a Document: a heading, an image, a row of columns. Your own Blocks
work exactly like the built-in ones; there is no second category.

**Block Definition**
The code behind one type of Block: what may be edited, how it draws, what it
may contain, and how older saved versions are brought forward. Blocks are data
and Definitions are code.

**Schema**
The part of a Block Definition listing which props somebody may edit, and what
each one defaults to.

**Preset**
A set of Block Definitions shipped together as a starting point, such as the
built-in blocks or the compliance pair.

**Required Block**
A Block Definition that every email must contain at least one of, such as an
unsubscribe link.

**Asset**
A picture that is ready to use: where it lives, plus its real width and height.
The size is part of it because mail clients need both in the markup.

**Image Request**
The library asking you for an Asset. It says why it is asking and hands over any
files involved. Nothing enters the Document until you answer.

## Editing

**Op**
One small record of one change. The only way a Document is ever modified, and
what makes undo and patch-saving possible.

**Command**
A named action somebody can invoke, such as undo, delete or duplicate, usually
bound to a key. A Command decides which Ops to apply. One that is refused
applies none.

**Canvas**
The surface the email is rendered on for editing. It draws inside an isolated
frame, so what you see matches what a mail client will show.

**Chrome**
The things drawn over the canvas that are not part of the email: selection
outlines, drop indicators, toolbars, upload placeholders. You draw all of it.

**Inspector**
Where somebody edits the selected Block's props. The library describes the
contents; you render them.

**Control Descriptor**
The description of one editable prop: its kind, its current value, and how to
change it. It carries no markup.

**Drop Target**
Where a drag would land right now: a parent Block and a position inside it,
after the nesting rules have been applied.

**Placement**
Where a Block will land and what will fill it. Decided from what somebody did
instead of from coordinates, so it survives a slow upload.

**Text Engine**
The thing responsible for rich text inside a Block, including its own selection
and formatting. It is pluggable: one ships, built on Tiptap, and you can supply
your own.

**History**
The single record of what somebody did, and the only thing undo and redo read.
It holds actions instead of Ops, so one thing they did is one step back.

## Phones

**Stage**
Which form factor is being edited: desktop or mobile. It lives on the editor, so
the canvas and the inspector can never disagree about which is showing.

**Mobile Override**
A value that applies only on the mobile Stage. Stored separately from the
desktop value and falling back to it, so changing desktop still moves mobile.

**Overridable**
A prop that is allowed a Mobile Override, because its Schema says how the value
becomes CSS on a phone. Props that do not say never appear on the mobile Stage.

## Checks

**Diagnostic**
Something found wrong with a Document: a missing unsubscribe link, an unknown
Block, an empty label. It carries a severity, and a Repair when there is one.

**Severity**
Either `warning` or `error`. Warnings surface and nothing more. Errors stop the
email being rendered.

**Repair**
The change that would put a Diagnostic right, described as data instead of
performed. Only an editor carries one out.

**Validator**
A function that looks at a Document and returns Diagnostics. The library ships
two optional ones, minimum font size and minimum contrast, and you can add your
own.
