import type { Rule } from "../types";

/**
 * Strips the bookkeeping attributes the old table add-on wrote onto cells.
 *
 * The add-on's stylesheet was never imported, so these tables already render
 * unstyled; the attributes carry no meaning the editor can use. Malformed rows
 * are deliberately left alone — some stored tables have their whole header row
 * collapsed into a single cell, and reconstructing the intended columns would
 * be authoring content rather than migrating it.
 */
export const normalizeTables: Rule = {
  name: "tables",
  apply(root, context) {
    for (const cell of root.querySelectorAll("[data-row]")) {
      cell.removeAttribute("data-row");
      context.changes += 1;
    }
  },
};
