import type { Rule } from "../types";

const INDENT_PATTERN = /^ql-indent-(\d+)$/;

/**
 * Removes indent classes from blocks that are not list items.
 *
 * Quill let an author indent a bare paragraph, not just a list item. The editor
 * replacing it only indents within a list, so there is nothing to convert this
 * into that the author could subsequently edit or reproduce — translating it to
 * a margin would mint content the editor cannot author, which is worse than not
 * having it.
 *
 * The class is dropped rather than left in place because leaving it renders
 * identically — an unknown class carries no styling once the old stylesheet is
 * gone — while keeping a marker in storage that makes the content look
 * unconverted forever. The indentation is genuinely lost, so each one is
 * reported instead of disappearing quietly.
 *
 * List items are untouched here; their indentation is real nesting and is
 * handled by the list rule.
 */
export const stripBlockIndent: Rule = {
  name: "block-indent",
  apply(root, context) {
    for (const element of Array.from(
      root.querySelectorAll("[class*=ql-indent-]"),
    )) {
      if (element.tagName.toLowerCase() === "li") {
        continue;
      }

      let removed = false;
      for (const name of Array.from(element.classList)) {
        const match = INDENT_PATTERN.exec(name);
        if (match) {
          element.classList.remove(name);
          removed = true;
          context.warnings.push(
            `<${element.tagName.toLowerCase()}> indented to level ${match[1]} lost its indentation; the editor only indents list items`,
          );
        }
      }

      if (!removed) {
        continue;
      }
      if (element.getAttribute("class") === "") {
        element.removeAttribute("class");
      }
      context.changes += 1;
    }
  },
};
