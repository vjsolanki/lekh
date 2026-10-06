/** Small page pieces: the nav, the install button and the footer. */
import { useEffect, useState, type ReactNode } from "react";
import { MoonIcon, SunIcon } from "@heroicons/react/20/solid";

const INSTALL = "npm install lekh-editor";

/**
 * Starlight's key, so the front page and the docs wear the same theme. The
 * inline script in `pages/index.astro` reads it before the first paint.
 */
const THEME_KEY = "starlight-theme";

/** Light to dark and back. Both icons render; the stylesheet shows one. */
function ThemeToggle(): ReactNode {
  return (
    <button
      type="button"
      className="pg-theme"
      aria-label="Switch between light and dark"
      onClick={() => {
        const root = document.documentElement;
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // A private window can refuse storage. The switch still holds for
          // this visit.
        }
      }}
    >
      <MoonIcon aria-hidden="true" className="pg-theme-moon" />
      <SunIcon aria-hidden="true" className="pg-theme-sun" />
    </button>
  );
}

export function Nav(): ReactNode {
  return (
    <nav className="pg-nav">
      <a href="/" className="pg-mark">
        lekh
      </a>
      <span className="pg-links">
        <a href="/getting-started/">Docs</a>
        <a href="/editor/" className="pg-hide-sm">
          Full example
        </a>
        <a href="https://github.com/vjsolanki/lekh">GitHub</a>
        <ThemeToggle />
      </span>
    </nav>
  );
}

export function Install(): ReactNode {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => {
      setCopied(false);
    }, 1600);
    return () => {
      clearTimeout(id);
    };
  }, [copied]);
  return (
    <button
      type="button"
      className="pg-install"
      onClick={() => {
        void navigator.clipboard.writeText(INSTALL).then(
          () => {
            setCopied(true);
            return undefined;
          },
          () => undefined,
        );
      }}
    >
      <code>{INSTALL}</code>
      <span data-copied={copied}>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function Start(): ReactNode {
  return (
    <div className="pg-start">
      <Install />
      <a href="/getting-started/" className="pg-link">
        Build your first editor
      </a>
    </div>
  );
}

export function Foot(): ReactNode {
  return (
    <footer className="pg-foot">
      <span>MIT licence</span>
    </footer>
  );
}
