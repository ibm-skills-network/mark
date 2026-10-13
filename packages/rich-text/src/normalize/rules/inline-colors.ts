import type { Rule } from "../types";

interface Declaration {
  property: string;
  value: string;
}

const COLOR_PROPERTIES = new Set(["color", "background-color"]);

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

// Parse style text consistently across browser and Node DOM implementations.
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

// TextStyle reads spans; move colors without losing the original element.
export const normalizeInlineColors: Rule = {
  name: "inline-colors",
  apply(root, context) {
    const document_ = root.ownerDocument;
    const styled = Array.from(root.querySelectorAll("[style]"));

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
