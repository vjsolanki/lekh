import { useState, type ReactNode } from "react";
import type { Block, Editor } from "lekh";
import { useEditorState } from "lekh/canvas";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { Icon } from "./icons";
import { previewOf } from "./names";

/**
 * The Document, as a tree.
 *
 * Nothing here is a library concept: it is `getDocument()` walked recursively,
 * with `select`, `reveal` and `hover` on each row. It earns its place because
 * an Author working on a long email needs a way to reach a Block that is three
 * sections down.
 *
 * The guides are the difference between a readable tree and a list of
 * differently indented words. Padding alone leaves the eye to measure the
 * offsets; a rule down each level draws the containment the Document has.
 */
export function Outline({ editor }: { readonly editor: Editor }): ReactNode {
  // The tree is the Document, so this is the one panel that answers to every
  // keystroke — a Block's text is on the Block (ADR-0009), and the root is a
  // new object each time it changes.
  const root = useEditorState((current) => current.getDocument().root);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggle = (blockId: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(blockId)) next.add(blockId);
      return next;
    });
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="m-0 list-none p-0 px-2 py-2">
        <Row
          block={root}
          editor={editor}
          collapsed={collapsed}
          onToggle={toggle}
          root
        />
      </ul>
    </ScrollArea>
  );
}

function Row({
  block,
  editor,
  collapsed,
  onToggle,
  root = false,
}: {
  readonly block: Block;
  readonly editor: Editor;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (blockId: string) => void;
  readonly root?: boolean;
}): ReactNode {
  const definition = editor.getDefinition(block.type);
  // What clicking this row will actually select. A column answers with its row,
  // because a column is part of the row's shape rather than something an Author
  // places — so this panel greys it and agrees with the Canvas without knowing
  // why. The column stays listed: this is the Document as it would be stored.
  const owned = editor.getSelectable(block.id) !== block.id;
  // Its own subscription rather than the parent's: the tree answers to the
  // Document, and the selection moving does not move the Document. A row that
  // read this during a render it was not woken for would light up late.
  const selection = useEditorState((current) => current.getSelection());
  // Nothing is selected when the Inspector is describing the email itself, so
  // the root row lights up on exactly that.
  const active = root ? selection === undefined : selection === block.id;
  // Hover is the editor's, not this row's own `:hover`, so the Canvas and the
  // tree light each other: pointing at a Block in the email tints its row, and
  // pointing at a row outlines its Block. Pointing at a column lights the
  // Columns Block that owns it, as a click selects it. The root hovers nothing.
  const hovered = useEditorState(
    (current) => current.getHovered() === block.id,
  );
  const overrides = Object.keys(block.mobile ?? {}).length;
  const children = block.children ?? [];
  const shut = collapsed.has(block.id);
  const label = definition?.label ?? block.type;
  // The root is named, not quoted: its first words prop is the inbox preview
  // text, and there is only one root to tell apart anyway.
  const preview = root ? undefined : previewOf(block, editor);

  return (
    <li>
      <div
        data-active={active}
        data-hovered={hovered}
        onPointerEnter={() => {
          editor.hover(block.id);
        }}
        onPointerLeave={() => {
          editor.hover(undefined);
        }}
        className={cn(
          "group relative flex items-center rounded-sm transition-colors duration-[var(--duration-quick)]",
          "data-[hovered=true]:bg-secondary",
          "data-[active=true]:bg-wash",
          // A spine on the leading edge, so a selected row is still findable
          // when the tree is scrolled and the tint is the only other mark.
          "data-[active=true]:before:absolute data-[active=true]:before:inset-y-0.5 data-[active=true]:before:-left-px data-[active=true]:before:w-[2px] data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary",
        )}
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-expanded={!shut}
            aria-label={`${shut ? "Expand" : "Collapse"} ${label}`}
            className="grid size-7 flex-none place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => {
              onToggle(block.id);
            }}
          >
            <Icon
              name="disclosure"
              className={cn(
                "size-3 transition-transform duration-[var(--duration-land)]",
                shut ? "rotate-0" : "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="size-7 flex-none" />
        )}

        <button
          type="button"
          aria-current={active}
          title={preview === undefined ? label : `${label} — ${preview}`}
          className={cn(
            "flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-sm pr-1.5 text-left",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            "group-data-[active=true]:font-medium group-data-[active=true]:text-ink-mark",
            owned ? "text-muted-foreground" : "text-ink-2",
          )}
          onClick={() => {
            // `select` resolves a column to its row itself, so this hands over
            // the row that was clicked and lets the library decide.
            editor.select(root ? undefined : block.id);
            if (!root) editor.reveal(block.id);
          }}
        >
          <Icon
            name={block.type}
            className="size-3.5 flex-none opacity-70 group-data-[hovered=true]:opacity-100 group-data-[active=true]:opacity-100"
          />
          {/* What the Block says, where it says anything. The glyph already
              gives the type, and two headings have to be told apart. */}
          <span className="min-w-0 flex-1 truncate">{preview ?? label}</span>
          {block.props["showOn"] === "desktop" ? (
            <Badge variant="tag" title="Hidden on mobile">
              desktop
            </Badge>
          ) : block.props["showOn"] === "mobile" ? (
            <Badge variant="tag" title="Hidden on desktop">
              mobile
            </Badge>
          ) : null}
          {overrides > 0 ? (
            <Badge
              variant="accent"
              title={`${String(overrides)} ${overrides === 1 ? "setting differs" : "settings differ"} on mobile`}
            >
              mobile {overrides}
            </Badge>
          ) : null}
          {definition?.deletable === false ? (
            <span className="grid place-items-center" title="Cannot be deleted">
              <Icon name="lock" className="size-3 text-muted-foreground" />
            </span>
          ) : null}
        </button>
      </div>

      {children.length === 0 || shut ? null : (
        <ul className="m-0 mt-px ml-3.5 list-none border-l border-rule-soft p-0 pl-1">
          {children.map((child) => (
            <Row
              key={child.id}
              block={child}
              editor={editor}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
