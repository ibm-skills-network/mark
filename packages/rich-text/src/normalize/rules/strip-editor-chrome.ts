import type { Rule } from "../types";

export const stripEditorChrome: Rule = {
  name: "strip-editor-chrome",
  apply(root, context) {
    for (const node of root.querySelectorAll(".ql-ui, .ql-cursor")) {
      node.remove();
      context.changes += 1;
    }
  },
};
