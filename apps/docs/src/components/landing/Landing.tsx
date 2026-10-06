/**
 * The front page. See `pages/index.astro`.
 *
 *   hero      the whole editor, drawn: your chrome, your Block, your inspector
 *   features  one picture and one line per thing lekh does
 *   end       where to start
 */
import type { ComponentType, ReactNode } from "react";

import {
  BlockArt,
  ChatAppArt,
  ChecksArt,
  HeroArt,
  SlotsArt,
  SuggestArt,
  UndoArt,
} from "./art";
import { Foot, Nav, Start } from "./page";

const FEATURES: readonly {
  readonly art: ComponentType;
  readonly title: string;
  readonly line: string;
}[] = [
  {
    art: SuggestArt,
    title: "AI edits, people approve",
    line: "Your users ask the AI for a change. They see it on the email and decide to keep it or not.",
  },
  {
    art: ChatAppArt,
    title: "Works in Claude and ChatGPT",
    line: "Your users can edit their emails by chatting with Claude or ChatGPT. You set up a small server for it.",
  },
  {
    art: ChecksArt,
    title: "Catches mistakes",
    line: "Text that’s hard to read gets a warning and a fix. An email with no unsubscribe link can’t be sent.",
  },
  {
    art: SlotsArt,
    title: "Looks like your app",
    line: "You design the outline, the toolbars and the drop line. lekh puts them in the right place.",
  },
  {
    art: BlockArt,
    title: "Add your own blocks",
    line: "Make a block like a promo code in a few lines. Your users can drag it in and change its settings.",
  },
  {
    art: UndoArt,
    title: "Undo and redo",
    line: "Any change can be undone, even one the AI made.",
  },
];

export default function Landing(): ReactNode {
  return (
    <div className="pg">
      <Nav />

      <header className="hero">
        <h1>Build your own email editor in React.</h1>
        <div className="hero-side">
          <p className="pg-sub">
            lekh does the hard parts: drag and drop, undo, AI edits, and checks
            before an email goes out. You decide how it looks.
          </p>
          <Start />
          <p className="credit">
            Emails are built with <a href="https://react.email">react-email</a>,
            so they look right in Gmail, Outlook and Apple Mail.
          </p>
        </div>
      </header>

      <figure className="hero-stage">
        <HeroArt />
        <figcaption className="hint">
          You build every panel you see here. lekh runs the email in the middle.{" "}
          <a href="/editor/">Try the full example</a>.
        </figcaption>
      </figure>

      <section className="sec" aria-labelledby="features-title">
        <h2 id="features-title">What you get.</h2>
        <ul className="feats">
          {FEATURES.map(({ art: Pic, title, line }) => (
            <li key={title}>
              <Pic />
              <p className="feats-title">{title}</p>
              <p>{line}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="end" aria-label="Get started">
        <h2>Build your first editor.</h2>
        <p>
          A step-by-step guide takes you from <code>npm install</code> to an
          editor that saves and sends.
        </p>
        <Start />
      </section>

      <Foot />
    </div>
  );
}
