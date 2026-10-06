import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Which theme the Consumer asked for, which is not the same as which one shows.
 *
 * `system` defers to the operating system and keeps deferring — the editor
 * follows a machine that switches at sunset without being reopened.
 */
export type Appearance = "light" | "dark" | "system";

/**
 * Where the choice is kept.
 *
 * The editor's own key, deliberately not Starlight's: this page is a full-screen
 * application rather than a documentation page, and somebody reading the docs in
 * light may well want the editor dark. The same string appears in the inline
 * script in `editor.astro`, which applies the choice before first paint.
 */
const STORAGE_KEY = "lekh-editor-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isAppearance(value: unknown): value is Appearance {
  return value === "light" || value === "dark" || value === "system";
}

/** What was stored, or the operating system's answer if nothing was. */
function storedAppearance(): Appearance {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isAppearance(stored) ? stored : "system";
  } catch {
    // Storage can be denied outright — a private window, a locked-down browser.
    // A theme is not worth failing to start over.
    return "system";
  }
}

/**
 * Put the resolved theme on the root element, where the `dark:` variant reads it.
 *
 * A class rather than the media query, because a toggle has to be able to say
 * "light" on a machine set to dark and be believed.
 */
function applyAppearance(appearance: Appearance): void {
  // `?? false` matters: a missing matchMedia would hand `toggle` an undefined
  // second argument, which flips the class instead of clearing it.
  const dark =
    appearance === "dark" ||
    (appearance === "system" &&
      (globalThis.matchMedia?.(DARK_QUERY).matches ?? false));
  document.documentElement.classList.toggle("dark", dark);
}

const OPTIONS: readonly {
  readonly value: Appearance;
  readonly label: string;
  readonly Glyph: typeof SunIcon;
}[] = [
  { value: "light", label: "Light", Glyph: SunIcon },
  { value: "dark", label: "Dark", Glyph: MoonIcon },
  { value: "system", label: "System", Glyph: ComputerDesktopIcon },
];

/**
 * The stored choice, and a way to change it.
 *
 * Call it somewhere that stays mounted, not inside a menu: while the choice is
 * `system`, this is what follows the machine.
 */
export function useAppearance(): readonly [Appearance, (next: string) => void] {
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance);

  const choose = useCallback((next: string) => {
    if (!isAppearance(next)) return;
    setAppearance(next);
    applyAppearance(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // Same as reading it: not worth failing over.
    }
  }, []);

  // Only while deferring. A machine that switches at sunset moves the editor
  // with it, and a Consumer who has picked a side is left alone.
  useEffect(() => {
    if (appearance !== "system") return undefined;
    const media = globalThis.matchMedia?.(DARK_QUERY);
    if (!media) return undefined;

    const follow = (): void => {
      applyAppearance("system");
    };
    media.addEventListener("change", follow);
    return () => {
      media.removeEventListener("change", follow);
    };
  }, [appearance]);

  return [appearance, choose];
}

/**
 * Light, dark and system, as items for a menu someone else owns.
 *
 * The email in the Canvas stays on white paper throughout. Only the editor
 * around it changes, which is the honest thing to show: the Document holds an
 * email's own colours, and they are not a preference of the person editing it.
 */
export function ThemeItems({
  appearance,
  onChoose,
}: {
  readonly appearance: Appearance;
  readonly onChoose: (next: string) => void;
}): ReactNode {
  return (
    <DropdownMenuRadioGroup value={appearance} onValueChange={onChoose}>
      {OPTIONS.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          <option.Glyph className="size-4" />
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** The same choice behind a button of its own, for a page with no menu. */
export function ThemeToggle(): ReactNode {
  const [appearance, choose] = useAppearance();
  const current = OPTIONS.find((option) => option.value === appearance);
  const Glyph = current?.Glyph ?? ComputerDesktopIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-ink-2"
          aria-label={`Theme: ${current?.label ?? "System"}`}
          title={`Theme: ${current?.label ?? "System"}`}
        >
          <Glyph />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <ThemeItems appearance={appearance} onChoose={choose} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
