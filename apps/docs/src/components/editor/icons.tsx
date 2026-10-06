import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowDownIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowsRightLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowTurnDownRightIcon,
  ArrowUpIcon,
  ArrowUpTrayIcon,
  ArrowUpLeftIcon,
  ArrowsUpDownIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Bars3BottomLeftIcon,
  Bars2Icon,
  Bars4Icon,
  Bars3BottomRightIcon,
  Bars3Icon,
  CheckIcon,
  ChevronRightIcon,
  CodeBracketIcon,
  CodeBracketSquareIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  CubeIcon,
  CursorArrowRaysIcon,
  DocumentTextIcon,
  DevicePhoneMobileIcon,
  EllipsisHorizontalIcon,
  EnvelopeIcon,
  EyeIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  H1Icon,
  InformationCircleIcon,
  LightBulbIcon,
  LinkIcon,
  LinkSlashIcon,
  ListBulletIcon,
  LockClosedIcon,
  MapPinIcon,
  MinusIcon,
  MoonIcon,
  PhotoIcon,
  PlusIcon,
  RectangleGroupIcon,
  RectangleStackIcon,
  ShareIcon,
  SparklesIcon,
  Square2StackIcon,
  Squares2X2Icon,
  TrashIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { cn } from "@/lib/utils";

/**
 * The example's glyph set — Heroicons, named for what they mean here.
 *
 * One indirection rather than importing the components at each call site,
 * because half of these are looked up by a Block's `type`, which is an open
 * string: a Consumer's own Block will not be in this table, and falls back to
 * a plain cube rather than a hole.
 */
type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

const GLYPHS: Readonly<Record<string, Glyph>> = {
  // Block types, keyed by the `type` a Block Definition declares.
  email: EnvelopeIcon,
  section: RectangleStackIcon,
  columns: ViewColumnsIcon,
  column: RectangleGroupIcon,
  heading: H1Icon,
  text: Bars3BottomLeftIcon,
  image: PhotoIcon,
  button: CursorArrowRaysIcon,
  divider: MinusIcon,
  spacer: ArrowsUpDownIcon,
  html: CodeBracketIcon,
  "icon-row": ShareIcon,
  nav: Bars4Icon,
  unsubscribe: ArrowRightStartOnRectangleIcon,
  "postal-address": MapPinIcon,

  // Interface.
  blocks: Squares2X2Icon,
  outline: ListBulletIcon,
  inspector: AdjustmentsHorizontalIcon,
  undo: ArrowUturnLeftIcon,
  redo: ArrowUturnRightIcon,
  desktop: ComputerDesktopIcon,
  mobile: DevicePhoneMobileIcon,
  // The two source panels, drawn unlike each other so neither is opened for
  // the other.
  markup: DocumentTextIcon,
  braces: CodeBracketSquareIcon,
  // A draft the Agent finished. Every other suggestion is a light bulb.
  draft: DocumentTextIcon,
  suggestion: LightBulbIcon,
  command: CommandLineIcon,
  copy: Square2StackIcon,
  duplicate: Square2StackIcon,
  check: CheckIcon,
  close: XMarkIcon,
  disclosure: ChevronRightIcon,
  lock: LockClosedIcon,
  plus: PlusIcon,
  warning: ExclamationTriangleIcon,
  error: ExclamationCircleIcon,
  info: InformationCircleIcon,
  trash: TrashIcon,
  up: ArrowUpIcon,
  parent: ArrowUpLeftIcon,
  down: ArrowDownIcon,
  swap: ArrowsRightLeftIcon,
  "move-to": ArrowTurnDownRightIcon,
  grip: Bars2Icon,
  link: LinkIcon,
  unlink: LinkSlashIcon,
  external: ArrowTopRightOnSquareIcon,
  preview: EyeIcon,
  dark: MoonIcon,
  export: ArrowDownTrayIcon,
  upload: ArrowUpTrayIcon,
  more: EllipsisHorizontalIcon,
  // The Agent's mark, on its tab and on Ask only, so it keeps one meaning.
  agent: SparklesIcon,

  // Alignment, which Heroicons has no centred bar for — the middle option is
  // the one whose bars run full width.
  left: Bars3BottomLeftIcon,
  center: Bars3Icon,
  right: Bars3BottomRightIcon,

  block: CubeIcon,
};

/** One glyph, sized and coloured by whatever it sits inside. */
export function Icon({
  name,
  className,
}: {
  readonly name: string;
  readonly className?: string;
}): ReactNode {
  const Glyph = GLYPHS[name] ?? CubeIcon;
  return (
    <Glyph
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}
