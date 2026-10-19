import type { Rule } from "../types";

export const normalizeTables: Rule = {
  name: "tables",
  apply(root, context) {
    for (const cell of root.querySelectorAll("[data-row]")) {
      cell.removeAttribute("data-row");
      context.changes += 1;
    }
  },
};
