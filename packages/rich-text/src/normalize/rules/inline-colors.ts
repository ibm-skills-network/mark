import type { Rule } from "../types";

interface Declaration {
  property: string;
  value: string;
}

const COLOR_PROPERTIES = new Set(["color", "background-color"]);

/**
 * Values that say "no colour" and only exist because the content was pasted
 * from a word processor. Carrying them forward would paint every such run with
 * a literal colour the editor then has to round-trip.
 */
const MEANINGLESS_COLORS = new Set([
  "",
  "windowtext",
  "transparent",
  "inherit",
  "initial",
  "unset",
  "revert",
  "currentcolor",
  "auto",
]);

/**
 * The `style` attribute is read as text rather than through `element.style`.
 *
 * The CSS object model silently discards values it considers invalid, and which
 * values those are differs between a browser and a Node DOM implementation — so
 * reading through it would make this rule behave one way in the editor and
 * another way in the backfill, which is precisely what a shared rule exists to
 * prevent.
 */
function parseStyle(text: string): Declaration[] {
  return text
    .split(";")
    .map((part) => {
      const separator = part.indexOf(":");
      if (separator === -1) {
        return null;
      }
      return {
        property: part.slice(0, separator).trim().toLowerCase(),
        value: part.slice(separator + 1).trim(),
      };
    })
    .filter(
      (entry): entry is Declaration => entry !== null && entry.property !== "",
    );
}

function formatStyle(declarations: Declaration[]): string {
  return declarations
    .map(({ property, value }) => `${property}: ${value}`)
    .join("; ");
}

function writeStyle(element: Element, declarations: Declaration[]): void {
  if (declarations.length === 0) {
    element.removeAttribute("style");
    return;
  }
  element.setAttribute("style", formatStyle(declarations));
}

/**
 * Normalises inline text colour so the editor can actually read it.
 *
 * Two things happen here. Meaningless colours are dropped, and any colour
 * sitting on an element other than a `<span>` is moved onto a `<span>` wrapping
 * that element's contents.
 *
 * The move matters more than it looks. The editor's text-style mark only
 * matches `<span>`, so a colour written onto `<strong>` — which is how a word
 * processor paste arrives — is discarded outright on load, losing the colour
 * from thousands of stored fields. Teaching the mark to match `<strong>` is not
 * an option: a schema picks one rule per element, so it would shadow bold and
 * lose the emphasis instead.
 *
 * Scrubbing runs before hoisting so a colour that is about to be deleted never
 * gets a wrapper element built for it.
 */
export const normalizeInlineColors: Rule = {
  name: "inline-colors",
  apply(root, context) {
    const document_ = root.ownerDocument;
    const styled = Array.from(root.querySelectorAll("[style]"));

    // Pass 1 — drop colours that carry no meaning, then any element left with
    // nothing to say.
    for (const element of styled) {
      const declarations = parseStyle(element.getAttribute("style") ?? "");
      const kept = declarations.filter(
        (declaration) =>
          !(
            COLOR_PROPERTIES.has(declaration.property) &&
            MEANINGLESS_COLORS.has(declaration.value.toLowerCase())
          ),
      );

      if (kept.length !== declarations.length) {
        writeStyle(element, kept);
        context.changes += 1;
      }

      if (
        element.tagName.toLowerCase() === "span" &&
        element.attributes.length === 0
      ) {
        element.replaceWith(...Array.from(element.childNodes));
        context.changes += 1;
      }
    }

    // Pass 2 — move surviving colours onto a span the editor will recognise.
    for (const element of Array.from(root.querySelectorAll("[style]"))) {
      if (element.tagName.toLowerCase() === "span") {
        continue;
      }

      const declarations = parseStyle(element.getAttribute("style") ?? "");
      const colors = declarations.filter((declaration) =>
        COLOR_PROPERTIES.has(declaration.property),
      );
      if (colors.length === 0 || element.childNodes.length === 0) {
        continue;
      }

      const carrier = document_.createElement("span");
      carrier.setAttribute("style", formatStyle(colors));
      carrier.append(...Array.from(element.childNodes));
      element.append(carrier);

      writeStyle(
        element,
        declarations.filter(
          (declaration) => !COLOR_PROPERTIES.has(declaration.property),
        ),
      );
      context.changes += 1;
    }
  },
};
