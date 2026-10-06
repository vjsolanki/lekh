import { cloneElement, createElement, Fragment, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ValidationSetup } from "../validate/diagnostic";
import type { EmailDocument } from "../document/document";
import { DocumentValidationError, UnknownBlockError } from "../document/errors";
import { migrateDocument } from "../document/migrate";
import { createRegistry } from "../document/registry";
import { renderTree } from "./render-tree";
import { MOBILE_ONLY_HIDING } from "../layout/responsive";
import {
  collectDiagnostics,
  findUnregistered,
  hasErrors,
} from "../validate/validate";

export interface RenderDocumentOptions extends ValidationSetup {
  /**
   * Validate before rendering, throwing on any error-severity Diagnostic.
   * Defaults to `true`: rendering is the single exit from the library, so it
   * is the only place a compliance guarantee can be made (ADR-0006). Turn it
   * off to preview a Document that is still being worked on.
   */
  readonly validate?: boolean;
}

/**
 * Turn a Document into a React element, and stop.
 *
 * Stringification is the Consumer's — the library depends on no HTML
 * formatter and no HTML-to-text converter. This entry point is isomorphic and
 * carries no client-only directive, so a Server Component can call it.
 */
export function renderDocument(
  document: EmailDocument,
  options: RenderDocumentOptions,
): ReactElement {
  const registry = createRegistry(options.definitions);
  const migrated = migrateDocument(document, registry);

  // Checked ahead of validation so that an unregistered Block always reports
  // as itself, whether or not the Consumer opted out of validation — and
  // through the same scan the Diagnostics are made from, so a refusal and a
  // finding can never disagree about which Blocks are unregistered.
  const unknown = findUnregistered(migrated.root, registry)[0];
  // A send job that fails loudly beats fifty thousand recipients receiving an
  // email with a hole in it.
  if (unknown) throw new UnknownBlockError(unknown);

  if (options.validate !== false) {
    const diagnostics = collectDiagnostics(migrated, {
      registry,
      validators: options.validators,
      severities: options.severities,
    });
    if (hasErrors(diagnostics)) throw new DocumentValidationError(diagnostics);
  }

  // The strict half of ADR-0006. Unreachable while the scan above stands, and
  // kept because the recursion must not be able to render an email with a hole
  // in it whatever a caller checked first.
  const rendered = renderTree(migrated.root, {
    lookup: (type) => registry.get(type),
    unregistered: (block) => {
      throw new UnknownBlockError(block);
    },
    mobileOnly: forMail,
    outlook: forOutlook,
  });

  // A root Definition may render nothing at all, which is an empty email rather
  // than an error.
  return isValidElement(rendered) ? rendered : createElement(Fragment, null);
}

/**
 * A mobile-only Block as a mail client gets it (ADR-0025).
 *
 * The markup goes inside an `<!--[if !mso]>` comment, which is the only thing
 * that keeps Outlook on the desktop from showing it however deeply its tables
 * nest. A comment cannot be a React child, so the markup is a string here.
 * It has to be done here rather than after `render`, because the stringifier
 * is the Consumer's.
 */
function forMail(element: ReactElement, className: string): ReactElement {
  const markup = withoutConditionals(staticMarkup(element));
  return createElement("div", {
    className,
    style: MOBILE_ONLY_HIDING,
    // oxlint-disable-next-line react/no-danger
    dangerouslySetInnerHTML: {
      __html: `<!--[if !mso]><!-->${markup}<!--<![endif]-->`,
    },
  });
}

/**
 * An element whose contents sit between two halves only Outlook reads.
 *
 * A comment cannot be a React child, so the contents become a string, and the
 * element takes it as its inner HTML. Nothing else goes between the halves
 * but what `between` puts between the children: whatever the Definition put
 * in the element is exactly what Outlook finds inside its VML.
 */
function forOutlook(
  element: ReactElement<{ readonly children?: ReactNode }>,
  open: string,
  close: string,
  between: readonly string[] = [],
): ReactElement {
  // Each child on its own when there is markup between them, so it can go in
  // the gaps. A child that renders nothing still has its place.
  const inner =
    between.length === 0
      ? staticMarkup(createElement(Fragment, null, element.props.children))
      : listOf(element.props.children)
          .map(
            (child, at) =>
              (at === 0 ? "" : outlookOnly(between[at - 1] ?? "")) +
              staticMarkup(createElement(Fragment, null, child)),
          )
          .join("");
  return cloneElement(element, {
    children: undefined,
    // oxlint-disable-next-line react/no-danger
    dangerouslySetInnerHTML: {
      __html: outlookOnly(open) + inner + outlookOnly(close),
    },
  } as Record<string, unknown>);
}

/** An element's children as a list, a child that renders nothing included. */
function listOf(children: ReactNode): readonly ReactNode[] {
  return Array.isArray(children) ? children : [children];
}

/** Raw markup inside the comment only Outlook reads, or nothing for none. */
function outlookOnly(markup: string): string {
  return markup === "" ? "" : `<!--[if mso]>${markup}<![endif]-->`;
}

/** Markup rendered on its own, for a string inside the email. */
function staticMarkup(element: ReactElement): string {
  // React 19 preloads every image in a tree rendered on its own, and with no
  // `<head>` to hoist the `<link>`s into, they lead the string. The email
  // rendered round this one puts its own in its head; these would sit in the
  // body, so they go.
  return renderToStaticMarkup(element).replace(
    /^(?:<link rel="preload"[^>]*\/>)+/u,
    "",
  );
}

/**
 * Markup with every conditional comment taken out.
 *
 * Conditional comments do not nest. Outlook ends a hidden region at the first
 * `<![endif]` it meets, so one inside the wrapper would show the rest of the
 * Block to the client the wrapper hides it from. react.email's `Button` writes
 * its own, and a mobile-only Block inside another brings the inner wrapper's.
 *
 * Taking them out changes nothing anywhere else. Outlook never reads this
 * markup, and every other client already reads both kinds as nothing: an
 * Outlook-only block as a comment, and the markers round a revealed one as
 * comments round content it shows.
 */
function withoutConditionals(markup: string): string {
  return markup
    .replaceAll(/<!--\[if [^\]]*\]><!-->|<!--<!\[endif\]-->/gu, "")
    .replaceAll(/<!--\[if [^\]]*\]>[\s\S]*?<!\[endif\]-->/gu, "");
}
