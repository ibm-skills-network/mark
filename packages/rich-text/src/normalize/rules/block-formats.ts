import type { Rule } from "../types";

export const normalizeBlockFormats: Rule = {
  name: "block-formats",
  apply(root, context) {
    for (const element of root.querySelectorAll("[class]")) {
      let changed = false;
      for (const name of Array.from(element.classList)) {
        const alignment = /^ql-align-(left|center|right|justify)$/.exec(name);
        if (alignment) {
          (element as HTMLElement).style.setProperty(
            "text-align",
            alignment[1]!,
          );
        } else if (name === "ql-direction-rtl") {
          element.setAttribute("dir", "rtl");
        } else {
          continue;
        }
        element.classList.remove(name);
        changed = true;
      }
      if (changed) {
        if (element.getAttribute("class") === "")
          element.removeAttribute("class");
        context.changes += 1;
      }
    }
  },
};
