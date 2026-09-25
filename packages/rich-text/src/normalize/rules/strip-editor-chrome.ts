import type { Rule } from "../types";

/**
 * Removes editor furniture that Quill serialised into the stored content.
 *
 * `<span class="ql-ui">` is the empty element Quill's stylesheet turns into a
 * list bullet; `<select class="ql-ui">` is the entire language dropdown from a
 * code block, options and all, written into the document. Neither is content.
 * `.ql-cursor` is a collaborator caret marker, which carries zero-width
 * characters that would otherwise survive as text.
 */
export const stripEditorChrome: Rule = {
  name: "strip-editor-chrome",
  apply(root, context) {
    for (const node of root.querySelectorAll(".ql-ui, .ql-cursor")) {
      node.remove();
      context.changes += 1;
    }
  },
};
