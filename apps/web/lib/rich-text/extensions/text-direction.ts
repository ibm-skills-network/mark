import { Extension } from "@tiptap/core";

const DIRECTIONS = new Set(["ltr", "rtl"]);

/**
 * Right-to-left support, as a `dir` attribute on block nodes.
 *
 * The editor core already ships `setTextDirection`/`unsetTextDirection`; they
 * write to a `dir` attribute, so all that is needed is for the block nodes to
 * carry one. Nothing in stored content uses it today — the previous editor
 * wrote a `ql-direction-rtl` class and no row has one — but the toolbar offered
 * the control, so it stays available.
 */
export const TextDirection = Extension.create({
  name: "textDirection",

  addOptions() {
    return {
      types: ["paragraph", "heading", "blockquote", "listItem"] as string[],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          dir: {
            default: null,
            parseHTML: (element) => {
              const value = element.getAttribute("dir")?.toLowerCase();
              return value && DIRECTIONS.has(value) ? value : null;
            },
            renderHTML: (attributes) =>
              attributes.dir ? { dir: attributes.dir as string } : {},
          },
        },
      },
    ];
  },
});
