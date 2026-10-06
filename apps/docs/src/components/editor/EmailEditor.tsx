import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useDeferredValue,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  type Block,
  clipCheck,
  type ClipCheck,
  createEditor,
  type Editor,
  type EmailDocument,
  renderDocument,
  type Stage,
  toHtml,
  type ToHtmlOptions,
} from "lekh-editor";
import {
  Canvas,
  EditorProvider,
  useCommands,
  useEditor,
  useEditorState,
  type CanvasSlots,
} from "lekh-editor/canvas";
import { createTiptapTextEngine } from "lekh-editor/tiptap";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { BlockAction, CanvasZoom, SLOTS } from "./chrome";
import { CommandPalette, type AskAgent } from "./command-palette";
import { DarkMenu, DarkStrip, type DarkView } from "./dark-preview";
import { createImageGallery } from "./gallery";
import { useFocusRing } from "./focus-ring";
import { Icon } from "./icons";
import { Inspector } from "./inspector";
import {
  collapseOrRestore,
  dismissOnEmail,
  flipToInspector,
  initialPanels,
  settle,
  showTab,
  isRightTab,
  toggle,
  type LeftView,
  type Panels,
  type PanelTarget,
  type RightTab,
  type SizeBounds,
} from "./layout";
import { Outline } from "./outline";
import { Palette } from "./palette";
import { useActionMotion } from "./motion";
import { Grip, useRememberedSize, useRoom } from "./panels";
import { Meta, PanelTitle, Quiet } from "./parts";
import { focusField } from "./field-diagnostics";
import {
  DEFINITIONS,
  REACT_EMAIL_ROOT_TYPE,
  STARTING_DOCUMENT,
  VALIDATORS,
} from "./sample";
import {
  display,
  isModKey,
  isTyping,
  Shortcuts,
  useKeyAnywhere,
  withKeys,
} from "./shortcuts";
import { ThemeItems, useAppearance } from "./theme";
// oxlint-disable-next-line import/no-unassigned-import
import "@/styles/editor.css";

/**
 * How wide the frame is, which is not how wide the email is.
 *
 * The frame is the window the email is being read in. Every container in the
 * Preset paints across the whole of it and holds its content to the email's own
 * width — the root's `contentWidth` — so the desktop Stage has to be wider than
 * the email or there is no band to see.
 */
const DESKTOP_WIDTH = 960;
const MOBILE_WIDTH = 375;

/**
 * The gutter the Canvas's own scrollbar runs in.
 *
 * A `height` on the Canvas puts the scroller inside the sheet's box, so the bar
 * comes out of `width` rather than out of the room around it. This column is
 * exactly the email's width — that width is what the crop marks bracket and
 * what the measure above them claims — so there is nothing for the bar to take.
 * Give it exactly `width` and the email overflows sideways by precisely one
 * scrollbar: a second, near-full-width bar that scrolls fifteen pixels.
 *
 * Fifteen is what Chrome, Safari and Firefox all draw. Where scrollbars overlay
 * the content instead, this is fifteen pixels of paper beside the email rather
 * than a bar. Most Canvases never need any of this — a pane with room to spare
 * absorbs the bar and nothing happens. This one has no room by design.
 */
const SCROLLBAR = 15;

/**
 * How the email is drawn: shrunk to fit the room, or at its true size.
 *
 * The Canvas takes a number. What "fit" means is this example's call, so the
 * room is measured here and the number worked out here (ADR-0039).
 */
type ZoomMode = "fit" | "actual";

/** A chrome button that is on or off. shadcn has no variant for pressed. */
const TOGGLE =
  "aria-pressed:bg-wash aria-pressed:text-primary aria-pressed:hover:bg-wash";

/**
 * An agent, as an optional part of the editor.
 *
 * The editor runs without one. Given one, it draws the agent's panel as a tab
 * beside the Inspector, lets it wrap the Canvas's Slots, adds its action to
 * the Block toolbar, and puts its provider around everything, so the panel and
 * the Slots share state. The editor keeps the one top bar, the one undo and
 * the one status bar.
 */
export interface AgentPart {
  /** What the panel's tab and its top-bar button are called. */
  readonly label: string;
  /** The editor's Slots in, the Slots the Canvas draws out. */
  readonly slots: (slots: CanvasSlots) => CanvasSlots;
  readonly Provider: ComponentType<{ readonly children: ReactNode }>;
  readonly Panel: ComponentType;
  /** Drawn on the selected Block's toolbar, before the editor's own buttons. */
  readonly BlockAction: ComponentType<{ readonly block: Block }>;
  /** Drawn over the middle of the email while it has no Blocks. */
  readonly Start: ComponentType;
  /**
   * Ask about one Block, or the whole email with none. The ⌘K palette sends
   * what it can't match to a Command here.
   */
  readonly ask: AskAgent;
  /**
   * Hear the agent say something new, for the badge on its tab when that tab
   * is not showing. Gives back a way to stop.
   */
  readonly onReply: (listener: () => void) => () => void;
  /** Called once, when the editor goes. */
  readonly dispose: () => void;
}

/**
 * A whole email editor, assembled from the library's parts.
 *
 * Everything visible is this file's or its neighbours': the chrome, the
 * palette, the Inspector, every outline and toolbar drawn over the Canvas, and
 * the dialog that answers the image hook. `lekh-editor` supplies the Document, the
 * editing mechanics, the drag geometry and the path to markup — and draws no
 * pixels of its own.
 *
 * `agent` plugs one in. It is given the editor once, when it is built.
 */
export default function EmailEditor({
  agent: createAgent,
}: {
  readonly agent?: (editor: Editor) => AgentPart;
}): ReactNode {
  // Built once. The editor holds the Document — and the Stage, so the Canvas
  // and the Inspector cannot disagree about which one is showing. React state
  // holds only what is genuinely this component's: which panes are open.
  const [example] = useState(() => createExample(createAgent));
  const room = useRoom();
  const [panels, setPanels] = useState(() => initialPanels(room));
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  // The dark preview under the email. A way of looking, so nothing is stored.
  const [dark, setDark] = useState<DarkView>("off");
  // The Suggestion an Author is holding back to see the email without it.
  // View only: the Canvas draws without it, and nothing is stored.
  const [held, setHeld] = useState<string>();
  // What fitting would draw the email at, as the well last measured its room.
  const [fit, setFit] = useState(1);
  const zoom = zoomMode === "fit" ? fit : 1;
  const [rightWidth, setRightWidth] = useRememberedSize(
    "lekh.example.right",
    RIGHT_WIDTH,
  );

  // A window made smaller can leave two panels floating. One gives way.
  useEffect(() => {
    setPanels((current) => settle(current, room));
  }, [room]);

  const press = (target: PanelTarget): void => {
    setPanels((current) => toggle(current, target, room));
  };

  const onZoomKey = useCallback((event: KeyboardEvent) => {
    if (!isModKey(event, "0")) return;
    // The browser's own ⌘0 would reset the page's zoom instead.
    event.preventDefault();
    setZoomMode("actual");
  }, []);
  useKeyAnywhere(onZoomKey);

  const onCollapseKey = useCallback(
    (event: KeyboardEvent) => {
      if (!isCollapseKey(event)) return;
      event.preventDefault();
      setPanels((current) => collapseOrRestore(current, room));
    },
    [room],
  );
  useKeyAnywhere(onCollapseKey);

  const { editor, engine, gallery, agent } = example;
  const slots = useMemo(() => agent?.slots(SLOTS) ?? SLOTS, [agent]);
  const AgentProvider = agent?.Provider ?? Fragment;

  useEffect(
    () => () => {
      agent?.dispose();
    },
    [agent],
  );

  // Selecting a Block a Suggestion touches shows the Inspector, where the
  // Suggestion shows in the fields it would change.
  useEffect(() => {
    let selected = editor.getSelection();
    return editor.subscribe(() => {
      const next = editor.getSelection();
      if (next === selected) return;
      selected = next;
      // A stale one has nothing left to review.
      const touched =
        next !== undefined &&
        editor
          .getSuggestionsAt(next)
          .some((suggestion) => suggestion.status !== "stale");
      if (touched) {
        setPanels(flipToInspector);
      }
    });
  }, [editor]);

  const unread = useUnread(agent, panels.right === "agent");

  const leftFloats = room.left === "floating" && panels.left !== undefined;
  const onEmail = useCallback(() => {
    setPanels((current) => dismissOnEmail(current, room));
  }, [room]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background text-foreground">
      <TooltipProvider delayDuration={400}>
        {/* One provider around both the palette and the Canvas: a drag starts in
            one and finishes in the other. */}
        <EditorProvider editor={editor} editableText={engine.EditableText}>
          <AgentProvider>
            <TopBar
              editor={editor}
              zoom={{ value: zoom, mode: zoomMode, onMode: setZoomMode }}
              dark={dark}
              onDark={setDark}
              inspector={panels.right === "inspector"}
              onInspector={() => {
                press("inspector");
              }}
              agent={
                agent === undefined
                  ? undefined
                  : {
                      label: agent.label,
                      open: panels.right === "agent",
                      unread,
                      onOpen: () => {
                        press("agent");
                      },
                    }
              }
            />

            <div className="relative flex min-h-0 min-w-0">
              <ActivityRail panels={panels} onPress={press} />

              {panels.left === undefined ? null : (
                <SidePanel
                  // Each view keeps its own width, read when it opens.
                  key={panels.left === "build" ? "build" : "source"}
                  editor={editor}
                  view={panels.left}
                  sections={panels.sections}
                  floating={room.left === "floating"}
                  onClose={() => {
                    setPanels((current) => ({ ...current, left: undefined }));
                  }}
                />
              )}

              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <BlockAction value={agent?.BlockAction}>
                  <CanvasStage
                    slots={slots}
                    zoom={zoom}
                    showOriginal={held}
                    onFit={setFit}
                    {...(agent === undefined ? {} : { Start: agent.Start })}
                    {...(leftFloats ? { onPress: onEmail } : {})}
                  />
                </BlockAction>
                {dark === "off" ? null : (
                  <DarkBench
                    editor={editor}
                    view={dark}
                    onClose={() => {
                      setDark("off");
                    }}
                  />
                )}
              </main>

              {panels.right === undefined ? null : (
                <RightColumn
                  label={
                    agent === undefined
                      ? "Inspector"
                      : `Inspector and ${agent.label}`
                  }
                  floating={room.right === "floating"}
                  width={rightWidth}
                  onWidth={setRightWidth}
                >
                  {agent === undefined ? (
                    <Inspector editor={editor} onHold={setHeld} />
                  ) : (
                    <RightTabs
                      tab={panels.right}
                      agent={agent}
                      unread={unread}
                      onTab={(tab) => {
                        setPanels((current) => showTab(current, tab, room));
                      }}
                    >
                      <Inspector editor={editor} onHold={setHeld} />
                    </RightTabs>
                  )}
                </RightColumn>
              )}
            </div>

            <StatusBar
              editor={editor}
              onShowInspector={() => {
                // A check lands on its field, so the field has to be showing.
                setPanels((current) => showTab(current, "inspector", room));
              }}
            />
            <CommandPalette
              {...(agent === undefined
                ? {}
                : {
                    onAsk: ((text, blockId) => {
                      // The answer lands in the chat, so it has to be showing.
                      setPanels((current) => showTab(current, "agent", room));
                      agent.ask(text, blockId);
                    }) satisfies AskAgent,
                  })}
            />
            <gallery.Dialog />
          </AgentProvider>
        </EditorProvider>
      </TooltipProvider>
    </div>
  );
}

/**
 * Whether the agent said something the Author has not seen: it spoke while its
 * tab was not showing. Showing the tab reads it.
 */
function useUnread(agent: AgentPart | undefined, showing: boolean): boolean {
  const [unread, setUnread] = useState(false);
  const seen = useRef(showing);

  useEffect(() => {
    seen.current = showing;
    if (showing) setUnread(false);
  }, [showing]);

  useEffect(
    () =>
      agent?.onReply(() => {
        if (!seen.current) setUnread(true);
      }),
    [agent],
  );

  return unread && !showing;
}

/** ⇧\, with nothing else held, and not while typing. */
function isCollapseKey(event: KeyboardEvent): boolean {
  if (event.isComposing || isTyping(event.target)) return false;
  return (
    event.code === "Backslash" &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

/* ---------------------------------------------------------------- top bar */

/**
 * What this email is called.
 *
 * Your product's name for an email, kept wherever it keeps its emails. Not
 * Document data, and neither is the subject line (ADR-0038).
 */
const EMAIL_NAME = "Release notes";

/**
 * Three groups, read left to right: the email and its history, what is being
 * looked at, and what to do with it next.
 *
 * Only what this example really does. No Save and no Send test: there is
 * nothing behind either, and a reader would copy the button.
 */
function TopBar({
  editor,
  zoom,
  dark,
  onDark,
  inspector,
  onInspector,
  agent,
}: {
  readonly editor: Editor;
  readonly zoom: ZoomControlProps;
  readonly dark: DarkView;
  readonly onDark: (view: DarkView) => void;
  readonly inspector: boolean;
  readonly onInspector: () => void;
  /** The agent's panel toggle, when one is plugged in. */
  readonly agent:
    | {
        readonly label: string;
        readonly open: boolean;
        /** The agent said something while its tab was not showing. */
        readonly unread: boolean;
        readonly onOpen: () => void;
      }
    | undefined;
}): ReactNode {
  return (
    <header className="flex items-center gap-2 border-b bg-background px-3 py-2">
      <a
        className="grid size-7 flex-none place-items-center rounded-md bg-foreground text-background"
        href="/"
        aria-label="lekh home"
      >
        <Icon name="email" className="size-4" />
      </a>
      <span className="truncate font-semibold tracking-[-0.01em]">
        {EMAIL_NAME}
      </span>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <History />

      <span className="flex-1" />
      <Stages editor={editor} />
      <ZoomControl {...zoom} />
      <DarkMenu value={dark} onValue={onDark} />
      <span className="flex-1" />

      <div className="flex items-center gap-1">
        {agent === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            className={cn(TOGGLE, "relative")}
            aria-pressed={agent.open}
            title={agent.unread ? `${agent.label}, new reply` : agent.label}
            onClick={agent.onOpen}
          >
            <Icon name="agent" />
            Ask
            {agent.unread ? <ActivityDot className="top-1 right-1" /> : null}
          </Button>
        )}
        <IconAction
          icon="inspector"
          label="Inspector"
          pressed={inspector}
          onClick={onInspector}
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            preview(editor);
          }}
        >
          <Icon name="preview" />
          <span className="max-md:hidden">Preview</span>
        </Button>
        <ExportMenu editor={editor} />
        <MoreMenu />
      </div>
    </header>
  );
}

/**
 * The email as it would be sent, in a tab of its own.
 *
 * A blob rather than a page of this site, so nothing of the editor's — its
 * styles, its scripts — reaches what is shown.
 */
function preview(editor: Editor): void {
  window.open(blobUrl(sentMarkupOf(editor), "text/html"), "_blank", "noopener");
}

/** Save a file, the way a browser saves a link with `download` on it. */
function download(name: string, type: string, text: string): void {
  const link = document.createElement("a");
  link.href = blobUrl(text, type);
  link.download = name;
  link.click();
}

/** A URL for some text, let go of once whatever opened it has read it. */
function blobUrl(text: string, type: string): string {
  const url = URL.createObjectURL(new Blob([text], { type }));
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, BLOB_LIFETIME_MS);
  return url;
}

const BLOB_LIFETIME_MS = 60_000;

/**
 * The email, taken away: the HTML to send, or the Document to keep.
 *
 * A product would more likely save the Document for you. This one has nowhere
 * to save it, so it hands you the file.
 */
function ExportMenu({ editor }: { readonly editor: Editor }): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Icon name="export" />
          <span className="max-md:hidden">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          onSelect={() => {
            download("email.html", "text/html", sentMarkupOf(editor));
          }}
        >
          <Icon name="markup" />
          HTML
          <DropdownMenuShortcut>To send</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            download(
              "email.json",
              "application/json",
              JSON.stringify(editor.getDocument(), null, 2),
            );
          }}
        >
          <Icon name="braces" />
          JSON
          <DropdownMenuShortcut>To keep</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What is used too rarely to earn a button of its own. */
function MoreMenu(): ReactNode {
  // Here and not in the menu, which unmounts when it shuts: while the choice
  // is "system", this is what follows the machine.
  const [appearance, choose] = useAppearance();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More">
              <Icon name="more" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <ThemeItems appearance={appearance} onChoose={choose} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An icon-only button, which is a button that has to say what it is. */
function IconAction({
  icon,
  label,
  pressed,
  disabled = false,
  onClick,
}: {
  readonly icon: string;
  readonly label: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={TOGGLE}
          {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const STAGES: readonly {
  readonly label: string;
  readonly stage: Stage;
}[] = [
  { label: "Desktop", stage: "desktop" },
  { label: "Mobile", stage: "mobile" },
];

/**
 * The Stage toggle — this application's two buttons, not the library's.
 *
 * Switching Stage narrows the Canvas's frame, so the email's own media queries
 * fire: the mobile view is the rendering a phone would get rather than a
 * simulation of one. It also changes what the Inspector describes, down to the
 * handful of props a Mobile Override is allowed on.
 */
function Stages({ editor }: { readonly editor: Editor }): ReactNode {
  const stage = useEditorState((current) => current.getStage());

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={stage}
      onValueChange={(next) => {
        // Radix clears on a second press of the pressed item. There is always
        // a Stage, so that is a no-op rather than a clear.
        if (next === "desktop" || next === "mobile") editor.setStage(next);
      }}
    >
      {STAGES.map((option) => (
        <ToggleGroupItem
          key={option.stage}
          value={option.stage}
          className="gap-1.5 data-[state=on]:bg-wash data-[state=on]:text-ink-mark"
        >
          <Icon name={option.stage} />
          <span className="max-sm:hidden">{option.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

interface ZoomControlProps {
  /** The zoom the Canvas is drawn at. */
  readonly value: number;
  readonly mode: ZoomMode;
  readonly onMode: (mode: ZoomMode) => void;
}

/**
 * The zoom, as a percentage that switches between fitting and 100%.
 *
 * At 100% the email is the size it is sent at, which can be wider than the
 * room: the well scrolls sideways then, on purpose.
 */
function ZoomControl({ value, mode, onMode }: ZoomControlProps): ReactNode {
  const fitting = mode === "fit";
  const label = fitting ? `Show at 100% (${display("Mod+0")})` : "Zoom to fit";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-14 font-mono tabular-nums"
          aria-label={`Zoom ${String(Math.round(value * 100))}%. ${label}`}
          onClick={() => {
            onMode(fitting ? "actual" : "fit");
          }}
        >
          {Math.round(value * 100)}%
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Undo and redo, driven by the same commands the keystrokes resolve to. */
function History(): ReactNode {
  // Two booleans, so this holds still through everything that does not flip
  // one — which is almost everything an Author does.
  const commands = useCommands();
  const canUndo = useEditorState(() => commands.can.undo());
  const canRedo = useEditorState(() => commands.can.redo());

  return (
    <div className="flex items-center gap-0.5">
      <IconAction
        icon="undo"
        label={withKeys("Undo", "undo")}
        disabled={!canUndo}
        onClick={commands.undo}
      />
      <IconAction
        icon="redo"
        label={withKeys("Redo", "redo")}
        disabled={!canRedo}
        onClick={commands.redo}
      />
    </div>
  );
}

/* ---------------------------------------------------------- activity rail */

type RailTarget = "add" | "layers" | "markup" | "document";

const RAIL: readonly {
  readonly target: RailTarget;
  readonly label: string;
  readonly icon: string;
}[] = [
  { target: "add", label: "Add", icon: "blocks" },
  { target: "layers", label: "Layers", icon: "outline" },
  { target: "markup", label: "HTML", icon: "markup" },
  { target: "document", label: "JSON", icon: "braces" },
];

/**
 * The left panel's buttons, as one column of icons.
 *
 * What an Author builds with sits at the top. The two source views are for
 * whoever wires the editor up, so they sit at the bottom, out of the way.
 * Pressing an open one closes it.
 */
function ActivityRail({
  panels,
  onPress,
}: {
  readonly panels: Panels;
  readonly onPress: (target: PanelTarget) => void;
}): ReactNode {
  const pressed = (target: RailTarget): boolean =>
    target === "add" || target === "layers"
      ? panels.left === "build" && panels.sections[target]
      : panels.left === target;

  const button = (entry: (typeof RAIL)[number]): ReactNode => (
    <Tooltip key={entry.target}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(TOGGLE, "relative size-8")}
          aria-pressed={pressed(entry.target)}
          aria-label={entry.label}
          onClick={() => {
            onPress(entry.target);
          }}
        >
          {/* The spine says which panel is open even when the tint is hard
              to read against a neighbouring surface. */}
          {pressed(entry.target) ? (
            <span className="absolute inset-y-1 -left-[5px] w-[2px] rounded-full bg-primary" />
          ) : null}
          <Icon name={entry.icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{entry.label}</TooltipContent>
    </Tooltip>
  );

  return (
    <nav
      aria-label="Panels"
      className="z-30 flex w-11 flex-none flex-col items-center gap-1 border-r bg-background py-2"
    >
      {RAIL.slice(0, 2).map((entry) => button(entry))}
      <span className="flex-1" />
      {RAIL.slice(2).map((entry) => button(entry))}
    </nav>
  );
}

/* -------------------------------------------------------------- side panel */

/**
 * How wide the left panel can be. The building tools and a page of markup
 * want very different room, so each keeps its own width.
 */
const BUILD_WIDTH: SizeBounds = { min: 260, max: 440, fallback: 272, step: 8 };
const SOURCE_WIDTH: SizeBounds = {
  min: 280,
  max: 880,
  fallback: 520,
  step: 8,
};
/** How much of the building panel Add takes, when Layers shares it. */
const SPLIT: SizeBounds = { min: 0.2, max: 0.8, fallback: 0.5, step: 0.05 };
/** The right column, Inspector or agent. */
const RIGHT_WIDTH: SizeBounds = { min: 260, max: 440, fallback: 320, step: 8 };

/** The line under each part of the left panel. */
const HINTS: Readonly<Record<"add" | "layers" | SourceView, string>> = {
  add: "Drag one onto the email, or click to add it after the selection.",
  layers: "Every block in the email. Click one to select it.",
  markup: "The email’s HTML, as it would be sent.",
  document: "The email as JSON. This is what you save.",
};

/**
 * The left panel: Add over Layers, or one of the source views.
 *
 * On a smaller window it floats over the email instead of taking room from
 * it, and a click on the email puts it away.
 */
function SidePanel({
  editor,
  view,
  sections,
  floating,
  onClose,
}: {
  readonly editor: Editor;
  readonly view: LeftView;
  readonly sections: Panels["sections"];
  readonly floating: boolean;
  readonly onClose: () => void;
}): ReactNode {
  const source = view === "build" ? undefined : view;
  const bounds = source === undefined ? BUILD_WIDTH : SOURCE_WIDTH;
  const [width, setWidth] = useRememberedSize(
    source === undefined ? "lekh.example.left" : "lekh.example.source",
    bounds,
  );

  return (
    <aside
      aria-label={source === undefined ? "Add and Layers" : SOURCES[source]}
      className={cn(
        "rail-in-left relative flex min-h-0 flex-none flex-col border-r bg-rail",
        // Floating, it hangs off the rail over the email. The rail stays
        // above it, so its buttons can still close it.
        floating && "absolute inset-y-0 left-11 z-20 shadow-2xl",
      )}
      style={{ width }}
    >
      {source === undefined ? (
        <BuildPanel editor={editor} sections={sections} onClose={onClose} />
      ) : (
        <>
          <PanelHeader title={SOURCES[source]} onClose={onClose}>
            <SourceActions editor={editor} view={source} />
          </PanelHeader>
          <PanelLine>{HINTS[source]}</PanelLine>
          <Source editor={editor} view={source} />
        </>
      )}

      <Grip
        label="Resize the left panel"
        edge="right"
        size={width}
        bounds={bounds}
        onSize={setWidth}
      />
    </aside>
  );
}

/**
 * Add stacked over Layers, so the tree stays in view while a Block is dragged
 * out of the palette. The split between them drags, and is remembered.
 */
function BuildPanel({
  editor,
  sections,
  onClose,
}: {
  readonly editor: Editor;
  readonly sections: Panels["sections"];
  readonly onClose: () => void;
}): ReactNode {
  const [split, setSplit] = useRememberedSize("lekh.example.split", SPLIT);
  const panel = useRef<HTMLDivElement>(null);
  const both = sections.add && sections.layers;

  return (
    <div ref={panel} className="flex min-h-0 flex-1 flex-col">
      {sections.add ? (
        <section
          aria-label="Add"
          className="relative flex min-h-0 flex-col"
          style={{ flex: `${String(both ? split : 1)} 1 0` }}
        >
          <PanelHeader title="Add" onClose={onClose} />
          <PanelLine>{HINTS.add}</PanelLine>
          <Palette rootType={REACT_EMAIL_ROOT_TYPE} />
          {both ? (
            <Grip
              label="Resize Add and Layers"
              edge="bottom"
              size={split}
              bounds={SPLIT}
              onSize={setSplit}
              scale={() => 1 / Math.max(panel.current?.clientHeight ?? 1, 1)}
            />
          ) : null}
        </section>
      ) : null}
      {sections.layers ? (
        <section
          aria-label="Layers"
          className={cn("flex min-h-0 flex-col", both && "border-t")}
          style={{ flex: `${String(both ? 1 - split : 1)} 1 0` }}
        >
          {/* The close button goes on whichever header is at the top. */}
          <PanelHeader title="Layers" {...(both ? {} : { onClose })} />
          <PanelLine>{HINTS.layers}</PanelLine>
          <Outline editor={editor} />
        </section>
      ) : null}
    </div>
  );
}

/** A panel's name, its own actions, and a way to close it. */
function PanelHeader({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose?: () => void;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <header className="flex min-h-11 flex-none items-center gap-2 border-b border-rule-soft px-3 py-1.5">
      <PanelTitle className="mb-0 flex-1">{title}</PanelTitle>
      {children}
      {onClose === undefined ? null : (
        <IconAction icon="close" label="Close the panel" onClick={onClose} />
      )}
    </header>
  );
}

/** The sentence under a panel's header. */
function PanelLine({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <p className="m-0 flex-none border-b border-rule-soft px-3 py-2 text-[0.75rem]/[1.5] text-muted-foreground">
      {children}
    </p>
  );
}

/** A green dot on a tab or button: there is something new behind it. */
function ActivityDot({
  className,
}: {
  readonly className?: string;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute size-2 rounded-full bg-primary ring-2 ring-background",
        className,
      )}
    />
  );
}

/**
 * The Inspector and the agent, as two tabs in the one right column.
 *
 * Both stay mounted while the column is open, so a half-typed ask and the
 * Inspector's open folds survive a switch. The agent's tab carries a dot when
 * it has said something since it was last showing.
 */
function RightTabs({
  tab,
  agent,
  unread,
  onTab,
  children,
}: {
  readonly tab: RightTab;
  readonly agent: AgentPart;
  readonly unread: boolean;
  readonly onTab: (tab: RightTab) => void;
  /** The Inspector. */
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isRightTab(value)) onTab(value);
      }}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="h-11 w-full flex-none justify-start rounded-none border-b border-rule-soft px-2"
      >
        <TabsTrigger
          value="inspector"
          className="flex-none px-2.5 text-[0.8125rem]"
        >
          <Icon name="inspector" className="size-3.5" />
          Inspector
        </TabsTrigger>
        <TabsTrigger
          value="agent"
          className="flex-none px-2.5 text-[0.8125rem]"
        >
          <Icon name="agent" className="size-3.5" />
          {agent.label}
          {unread ? (
            <>
              <ActivityDot className="top-1 right-0.5" />
              <span className="sr-only">, new reply</span>
            </>
          ) : null}
        </TabsTrigger>
      </TabsList>
      {/* Both mounted. Radix unmounts the hidden one unless forced. */}
      <TabsContent
        value="inspector"
        forceMount
        className="flex min-h-0 flex-col data-[state=inactive]:hidden"
      >
        {children}
      </TabsContent>
      <TabsContent
        value="agent"
        forceMount
        className="flex min-h-0 flex-col data-[state=inactive]:hidden"
      >
        <agent.Panel />
      </TabsContent>
    </Tabs>
  );
}

/**
 * The Inspector, or its tabs with the agent's, in a column on the right that
 * is resized from its leading edge.
 */
function RightColumn({
  label,
  floating,
  width,
  onWidth,
  children,
}: {
  readonly label: string;
  readonly floating: boolean;
  readonly width: number;
  readonly onWidth: (width: number) => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <aside
      aria-label={label}
      className={cn(
        "rail-in-right relative flex min-h-0 flex-none flex-col border-l bg-rail",
        floating && "absolute inset-y-0 right-0 z-20 shadow-2xl",
      )}
      style={{ width }}
    >
      {children}
      <Grip
        label={`Resize the ${label}`}
        edge="left"
        size={width}
        bounds={RIGHT_WIDTH}
        onSize={onWidth}
      />
    </aside>
  );
}

/* ------------------------------------------------------------ source views */

type SourceView = Exclude<LeftView, "build">;

const SOURCES: Readonly<Record<SourceView, string>> = {
  markup: "HTML",
  document: "JSON",
};

/**
 * What the Document is, and what it becomes.
 *
 * Both are derived on demand rather than kept in state: the Document is the
 * only thing that is stored, and everything else — markup, the Canvas — is a
 * reading of it.
 */
function sourceOf(
  editor: Editor,
  emailDocument: EmailDocument,
  view: SourceView,
): string {
  return view === "markup"
    ? markupOf(editor, emailDocument, { doctype: false })
    : JSON.stringify(emailDocument, null, 2);
}

/**
 * The email as text, rebuilt when the email changes and not before.
 *
 * The one selection that cannot hold still: this panel prints the whole
 * Document, and a Block's text lives on the Block (ADR-0009), so the root is a
 * new object on every keystroke. Selecting it and memoising on it at least
 * keeps the rendering to once per change rather than once per render.
 */
function useSource(editor: Editor, view: SourceView): string {
  const emailDocument = useEditorState((current) => current.getDocument());
  return useMemo(
    () => sourceOf(editor, emailDocument, view),
    [editor, emailDocument, view],
  );
}

function Source({
  editor,
  view,
}: {
  readonly editor: Editor;
  readonly view: SourceView;
}): ReactNode {
  const source = useSource(editor, view);

  return (
    <ScrollArea className="min-h-0 flex-1 bg-muted">
      {/* The markup comes out as one line — react-dom does not pretty-print —
          so it wraps rather than running off into a horizontal scrollbar. */}
      <pre className="m-0 px-3 py-2.5 font-mono text-[0.6875rem]/[1.7] break-words whitespace-pre-wrap text-ink-2 selection:bg-wash selection:text-ink-mark [tab-size:2]">
        <code>{source}</code>
      </pre>
    </ScrollArea>
  );
}

/** How big it came out, and a way to take it away. */
function SourceActions({
  editor,
  view,
}: {
  readonly editor: Editor;
  readonly view: SourceView;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const text = useSource(editor, view);

  return (
    <>
      <Meta className="rounded-sm bg-secondary px-1.5 py-0.5">
        {sizeOf(text)}
      </Meta>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void copyToClipboard(text, setCopied);
        }}
      >
        <Icon
          name={copied ? "check" : "copy"}
          className={cn("size-3.5", copied && "text-ok")}
        />
        {copied ? "Copied" : "Copy"}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ stage */

/**
 * The email, squared up inside crop marks, at the width the Stage says.
 *
 * The measure is this example's: the Canvas is handed a width and reports
 * nothing, so a product that wants to show the number shows the number it
 * passed.
 *
 * The room is measured here too, and reported as the zoom that fits the email
 * into it. Never above 100%: an email with room to spare is shown at its size.
 *
 * `onPress` hears a press anywhere on the bench, the email included, for a
 * panel floating over it to get out of the way.
 *
 * `Start` is drawn in the middle of the email while it has no Blocks.
 */
function CanvasStage({
  slots,
  zoom,
  showOriginal,
  onFit,
  Start,
  onPress,
}: {
  readonly slots: CanvasSlots;
  readonly zoom: number;
  /** A Suggestion held back, so the email is drawn without it. */
  readonly showOriginal: string | undefined;
  readonly onFit: (fit: number) => void;
  readonly Start?: ComponentType;
  readonly onPress?: () => void;
}): ReactNode {
  const stage = useEditorState((current) => current.getStage());
  const empty = useEditorState(
    (current) => (current.getDocument().root.children ?? []).length === 0,
  );
  const width = stage === "mobile" ? MOBILE_WIDTH : DESKTOP_WIDTH;
  const sheet = useRef<HTMLDivElement>(null);
  const well = useRef<HTMLDivElement>(null);
  useActionMotion(useEditor(), sheet);
  useFocusRing(sheet);
  usePressIn(well, onPress);

  useEffect(() => {
    const element = well.current;
    if (!element) return undefined;
    // The content box: the room inside the well's padding.
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const room = entry.contentRect.width - SCROLLBAR;
      onFit(Math.max(0.1, Math.min(1, room / width)));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [width, onFit]);

  return (
    // The Canvas is the height of the well and scrolls itself, so the Stage
    // reads as a window onto the email: the measure and the crop marks stay put
    // while the email moves under them.
    //
    // That leaves the well only the sideways job. Fitted, the email is drawn
    // smaller but still laid out at the Stage's width, so it stays the width
    // it claims. At 100% it can be wider than the room, and is scrolled to
    // then. `safe` centring keeps the leading edge reachable once it overflows.
    <div
      ref={well}
      className="bench-well flex min-h-0 min-w-0 flex-1 justify-center-safe overflow-x-auto overflow-y-hidden px-8 pt-4 pb-8 max-sm:px-4 max-sm:pt-3 max-sm:pb-4"
    >
      <div
        className="flex min-h-0 flex-none flex-col transition-[width] duration-[var(--duration-panel)] ease-[var(--ease)]"
        style={{ width: width * zoom + SCROLLBAR }}
      >
        {stage === "mobile" ? (
          // Loud on purpose. Every change on this Stage is phone-only, and an
          // Author who forgets that breaks desktop without seeing it.
          <p className="m-0 flex flex-none items-center justify-center gap-1.5 pb-4 text-[0.75rem] font-medium text-ink-mark">
            <Icon name="mobile" className="size-3.5 flex-none" />
            <span>
              Mobile ·{" "}
              <span className="font-mono tabular-nums">{width} px</span> ·
              {showOriginal === undefined
                ? " changes here are phone-only"
                : " without the suggestion"}
            </span>
          </p>
        ) : (
          <p className="m-0 flex-none pb-2 text-center text-[0.75rem] text-ink-2">
            <span className="font-mono tabular-nums">{width} px</span> · Desktop
            {showOriginal === undefined ? null : (
              <span className="text-ink-mark"> · without the suggestion</span>
            )}
          </p>
        )}
        {/* The crop marks bracket the window onto the email — the sheet and the
            gutter its scrollbar runs in — rather than the email itself, which
            carries on past the bottom of both. The paper is this box rather
            than the Canvas, so the gutter is paper too and the trim, the
            shadow and the marks all agree on where the sheet ends.

            On mobile a frame takes their place. An outline, so it draws
            outside the sheet and moves nothing the zoom worked out. */}
        <div
          ref={sheet}
          className={cn(
            "canvas-sheet relative flex min-h-0 flex-1 flex-col",
            stage === "mobile" &&
              "rounded-[3px] outline-2 outline-offset-[6px] outline-primary",
          )}
        >
          {stage === "mobile" ? null : <CropMarks />}
          {Start !== undefined && empty ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
              <div className="pointer-events-auto w-full max-w-[26rem]">
                <Start />
              </div>
            </div>
          ) : null}
          <CanvasZoom value={zoom}>
            <Canvas
              width={DESKTOP_WIDTH}
              mobileWidth={MOBILE_WIDTH}
              slots={slots}
              zoom={zoom}
              {...(showOriginal === undefined ? {} : { showOriginal })}
              height="100%"
              title="The email being edited"
            />
          </CanvasZoom>
        </div>
      </div>
    </div>
  );
}

/**
 * Hear a press on an element, the email inside it included.
 *
 * A press inside the Canvas's frame never reaches this page, so the frame's
 * own document is listened to as well. It is same-origin. It is found again
 * whenever the frame loads, since a new frame is a new document.
 */
function usePressIn(
  ref: { readonly current: HTMLElement | null },
  onPress: (() => void) | undefined,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || onPress === undefined) return undefined;
    const frame = element.querySelector("iframe");
    let inside: Document | undefined;
    const hear = (): void => {
      inside?.removeEventListener("pointerdown", onPress);
      inside = frame?.contentDocument ?? undefined;
      inside?.addEventListener("pointerdown", onPress);
    };
    hear();
    element.addEventListener("pointerdown", onPress);
    frame?.addEventListener("load", hear);
    return () => {
      element.removeEventListener("pointerdown", onPress);
      frame?.removeEventListener("load", hear);
      inside?.removeEventListener("pointerdown", onPress);
    };
  }, [ref, onPress]);
}

/** Where the frame begins and ends, marked the way a trim is. */
function CropMarks(): ReactNode {
  return (
    <span aria-hidden="true">
      <span className="crop-mark -top-2 -left-2 border-t border-l" />
      <span className="crop-mark -top-2 -right-2 border-t border-r" />
      <span className="crop-mark -bottom-2 -left-2 border-b border-l" />
      <span className="crop-mark -right-2 -bottom-2 border-r border-b" />
    </span>
  );
}

/**
 * The email as it would be sent, trailing behind typing.
 *
 * Rendering the whole email takes a moment, so it waits for a pause rather
 * than holding a keystroke up. `undefined` while the Document can't be
 * rendered. The Diagnostics say why.
 */
function useSentHtml(editor: Editor): string | undefined {
  const emailDocument = useDeferredValue(
    useEditorState((current) => current.getDocument()),
  );
  return useMemo(
    () => sentHtmlOf(editor, emailDocument),
    [editor, emailDocument],
  );
}

/**
 * The size meter and the dark preview both read the sent HTML. A Document
 * never changes once made, so each one is rendered once for both.
 */
const SENT_HTML = new WeakMap<EmailDocument, string | undefined>();

function sentHtmlOf(
  editor: Editor,
  emailDocument: EmailDocument,
): string | undefined {
  if (SENT_HTML.has(emailDocument)) return SENT_HTML.get(emailDocument);
  let html: string | undefined;
  try {
    html = htmlOf(editor, emailDocument, SENT);
  } catch {
    html = undefined;
  }
  SENT_HTML.set(emailDocument, html);
  return html;
}

/**
 * The dark preview strip, at the width of the Stage being edited, so a phone's
 * layout is darkened as a phone would show it.
 */
function DarkBench({
  editor,
  view,
  onClose,
}: {
  readonly editor: Editor;
  readonly view: Exclude<DarkView, "off">;
  readonly onClose: () => void;
}): ReactNode {
  const html = useSentHtml(editor);
  const stage = useEditorState((current) => current.getStage());
  return (
    <DarkStrip
      html={html}
      width={stage === "mobile" ? MOBILE_WIDTH : DESKTOP_WIDTH}
      view={view}
      onClose={onClose}
    />
  );
}

/* ------------------------------------------------------------- status bar */

/**
 * What the library has to say about the Document, and how big the email has
 * got.
 *
 * Warnings never block a render; an error does. A Diagnostic can carry its own
 * repair, and the button below runs it when it does.
 *
 * Clicking a check goes to it: it selects the Block, shows the Inspector on the
 * Stage the Diagnostic is about, and focuses the field it names.
 */
function StatusBar({
  editor,
  onShowInspector,
}: {
  readonly editor: Editor;
  readonly onShowInspector: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  // Set while a check is taking focus to its field, so the popover closing
  // does not hand focus back to its button.
  const jumping = useRef(false);

  // This moves with the Document, so this bar answers to it and nothing else —
  // the selection travelling does not repaint the counts.
  const diagnostics = useEditorState((current) => current.getDiagnostics());

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.length - errors;
  const severity = errors > 0 ? "error" : warnings > 0 ? "warning" : "ok";

  return (
    <footer className="flex items-center gap-2 border-t bg-background px-2.5 py-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "gap-1.5 rounded-full px-2",
              severity === "error" && "bg-error-wash text-destructive",
              severity === "warning" && "bg-warn-wash text-warn",
              severity === "ok" &&
                "bg-secondary text-ok disabled:opacity-100 disabled:hover:bg-secondary",
              open && "ring-1 ring-current",
            )}
            disabled={diagnostics.length === 0}
          >
            <Icon
              name={severity === "ok" ? "check" : severity}
              className="size-3.5"
            />
            {diagnostics.length === 0
              ? "No Diagnostics"
              : [
                  errors > 0
                    ? `${String(errors)} error${errors === 1 ? "" : "s"}`
                    : "",
                  warnings > 0
                    ? `${String(warnings)} warning${warnings === 1 ? "" : "s"}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Button>
        </PopoverTrigger>
        {/* A Document can carry more Diagnostics than the window is tall, and
            this opens upwards off the status bar — so it is capped at the room
            Radix says it has and scrolls inside that. */}
        <PopoverContent
          align="start"
          side="top"
          collisionPadding={8}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,calc(100vw-2rem))] flex-col gap-px overflow-y-auto overscroll-contain p-1"
          onCloseAutoFocus={(event) => {
            if (!jumping.current) return;
            jumping.current = false;
            event.preventDefault();
          }}
        >
          {/* Going to a finding and repairing it are two gestures, not one. A
              row that did both would recolour an Author's text the moment they
              clicked it to see what it was talking about. */}
          {diagnostics.map(
            ({
              code,
              message,
              severity: level,
              blockId,
              prop,
              stage,
              repair,
            }) => (
              <div
                key={`${code}:${blockId ?? "email"}:${prop ?? ""}:${stage ?? ""}`}
                className="group flex items-start gap-2 rounded-md hover:bg-secondary"
              >
                <button
                  type="button"
                  className="flex flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    if (blockId !== undefined) {
                      // The root is never selected. With nothing selected,
                      // the Inspector shows the email's own settings.
                      const root = editor.getDocument().root.id;
                      editor.select(blockId === root ? undefined : blockId);
                      editor.reveal(blockId);
                    }
                    if (blockId !== undefined && prop !== undefined) {
                      // No Stage means the desktop value is at fault.
                      editor.setStage(stage ?? "desktop");
                      onShowInspector();
                      jumping.current = true;
                      focusField(blockId, prop);
                    }
                    setOpen(false);
                  }}
                >
                  <span
                    className={cn(
                      "grid size-5 flex-none place-items-center rounded-sm",
                      level === "error"
                        ? "bg-error-wash text-destructive"
                        : "bg-warn-wash text-warn",
                    )}
                  >
                    <Icon
                      name={level === "error" ? "error" : "warning"}
                      className="size-3.5"
                    />
                  </span>
                  <span className="flex flex-col gap-px">
                    {message}
                    <Quiet>
                      {code}
                      {stage === "mobile" ? " · mobile only" : ""}
                    </Quiet>
                  </span>
                </button>
                {repair ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="my-0.5 mr-1 h-7 flex-none px-2 text-xs"
                    onClick={() => {
                      // A Consumer's own kinds would be switched on here first,
                      // leaving the library as the default branch. This example
                      // has none, so every Repair goes straight through.
                      if (blockId !== undefined) editor.reveal(blockId);
                      editor.applyRepair(repair);
                    }}
                  >
                    Fix
                  </Button>
                ) : undefined}
              </div>
            ),
          )}
        </PopoverContent>
      </Popover>

      <span className="flex-1" />

      <ClipMeter editor={editor} />
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <Shortcuts className={TOGGLE} />
    </footer>
  );
}

/**
 * The email's size against Gmail's clip, amber once it is close.
 *
 * Measured on the HTML this editor renders. A send pipeline that adds tracking
 * or a footer adds bytes, so your product would measure what it really sends.
 */
function ClipMeter({ editor }: { readonly editor: Editor }): ReactNode {
  const html = useSentHtml(editor);
  const check = useMemo(
    () => (html === undefined ? undefined : clipCheck(html)),
    [html],
  );
  if (check === undefined) return null;

  const { bytes, limit, risk } = check;
  const look = CLIP_LOOKS[risk];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[0.75rem] tabular-nums text-ink-2",
            look.className,
          )}
        >
          {look.icon === undefined ? null : (
            <Icon name={look.icon} className="size-3.5" />
          )}
          {kilobytes(bytes)} of {kilobytes(limit)} KB
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{look.says}</TooltipContent>
    </Tooltip>
  );
}

const CLIP_LOOKS: Readonly<
  Record<
    ClipCheck["risk"],
    {
      readonly says: string;
      readonly className: string;
      readonly icon: string | undefined;
    }
  >
> = {
  ok: { says: "Well under Gmail's clip.", className: "", icon: undefined },
  near: {
    says: "Close to Gmail's clip. Past it, Gmail hides the rest behind a link.",
    className: "bg-warn-wash text-warn",
    icon: "warning",
  },
  clipped: {
    says: "Gmail will clip this email, and hide the rest behind a link.",
    className: "bg-error-wash text-destructive",
    icon: "error",
  },
};

/* ------------------------------------------------------------------ parts */

function kilobytes(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

/** How long the Copy button stays acknowledged for. */
const COPIED_MS = 1600;

async function copyToClipboard(
  text: string,
  mark: (copied: boolean) => void,
): Promise<void> {
  await navigator.clipboard.writeText(text);
  mark(true);
  setTimeout(() => {
    mark(false);
  }, COPIED_MS);
}

/**
 * The email as HTML. Throws when the Document can't be rendered.
 *
 * `doctype` is what is sent. The Markup panel leaves it off: it is one more
 * line to scroll past.
 */
function htmlOf(
  editor: Editor,
  emailDocument: EmailDocument,
  options: ToHtmlOptions,
): string {
  return toHtml(
    renderDocument(emailDocument, {
      // The Definitions and Validators the editor itself is using, so the two
      // can never disagree about what is valid.
      ...editor.getRenderOptions(),
      // A Document still being worked on is allowed to be incomplete; a send
      // job would leave this alone and let the render refuse.
      validate: false,
    }),
    options,
  );
}

/** The HTML, or what went wrong, for anywhere that shows text. */
function markupOf(
  editor: Editor,
  emailDocument: EmailDocument,
  options: ToHtmlOptions,
): string {
  try {
    return htmlOf(editor, emailDocument, options);
  } catch {
    // A render error is written for whoever wired the editor up. Whoever is
    // building the email is told what to do instead.
    return "Couldn’t build this email’s HTML. Undo the last change and try again.";
  }
}

/** What Preview opens and Export saves: the email as it would be sent. */
function sentMarkupOf(editor: Editor): string {
  return markupOf(editor, editor.getDocument(), SENT);
}

const SENT: ToHtmlOptions = { doctype: true };

function sizeOf(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024
    ? `${String(bytes)} B`
    : `${(bytes / 1024).toFixed(1)} kB`;
}

function createExample(createAgent?: (editor: Editor) => AgentPart): {
  readonly editor: Editor;
  readonly engine: ReturnType<typeof createTiptapTextEngine>;
  readonly gallery: ReturnType<typeof createImageGallery>;
  readonly agent: AgentPart | undefined;
} {
  const gallery = createImageGallery();
  // Two halves of one object: history goes to the editor, the editable text
  // goes to the provider.
  const engine = createTiptapTextEngine();

  const editor = createEditor({
    definitions: DEFINITIONS,
    rootType: REACT_EMAIL_ROOT_TYPE,
    document: STARTING_DOCUMENT,
    validators: VALIDATORS,
    textEngine: engine,
    // The one hook every image route goes through.
    resolveImage: gallery.resolveImage,
  });

  return { editor, engine, gallery, agent: createAgent?.(editor) };
}
