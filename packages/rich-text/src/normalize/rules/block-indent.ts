import type { Rule } from "../types";

const INDENT_PATTERN = /^ql-indent-(\d+)$/;

export const normalizeBlockIndent: Rule = {
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
          const level = Number(match[1]);
          element.setAttribute("data-indent", String(level));
          (element as HTMLElement).style.setProperty(
            "padding-inline-start",
            `${level * 3}em`,
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
