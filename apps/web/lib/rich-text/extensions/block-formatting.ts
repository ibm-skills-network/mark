import { Extension, type RawCommands } from "@tiptap/core";

const BLOCK_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockIndent: {
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
    };
  }
}

export const BlockFormatting = Extension.create({
  name: "blockFormatting",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (element) => {
              const value = element.getAttribute("dir")?.toLowerCase();
              return value === "ltr" || value === "rtl" ? value : null;
            },
            renderHTML: (attrs) =>
              attrs.dir ? { dir: attrs.dir as string } : {},
          },
          indent: {
            default: 0,
            parseHTML: (element) => {
              const level = Number(element.getAttribute("data-indent"));
              return Number.isSafeInteger(level) && level > 0 ? level : 0;
            },
            renderHTML: (attrs) =>
              attrs.indent > 0
                ? {
                    "data-indent": String(attrs.indent),
                    style: `padding-inline-start: ${Number(attrs.indent) * 3}em`,
                  }
                : {},
          },
        },
      },
      {
        types: ["orderedList"],
        attributes: {
          type: {
            default: null,
            parseHTML: (element) => {
              const type = element.getAttribute("type");
              return type && ["1", "a", "i", "A", "I"].includes(type)
                ? type
                : null;
            },
            renderHTML: (attrs) =>
              attrs.type ? { type: attrs.type as string } : {},
          },
        },
      },
      {
        types: ["listItem"],
        attributes: {
          checked: {
            default: null,
            parseHTML: (element) => {
              const checked = element.getAttribute("data-checked");
              return checked === "true"
                ? true
                : checked === "false"
                  ? false
                  : null;
            },
            renderHTML: (attrs) =>
              typeof attrs.checked === "boolean"
                ? { "data-checked": String(attrs.checked) }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    const changeIndent =
      (delta: number): RawCommands["increaseIndent"] =>
      () =>
      ({ state, tr, dispatch }) => {
        let changed = false;
        state.doc.nodesBetween(
          state.selection.from,
          state.selection.to,
          (node, position) => {
            if (!BLOCK_TYPES.includes(node.type.name)) return;
            const indent = Math.max(
              0,
              Math.min(8, Number(node.attrs.indent ?? 0) + delta),
            );
            if (indent !== node.attrs.indent) {
              changed = true;
              if (dispatch)
                tr.setNodeMarkup(position, undefined, {
                  ...node.attrs,
                  indent,
                });
            }
            // Indent the owning block once, not its child paragraphs too.
            return false;
          },
        );
        return changed;
      };
    return {
      increaseIndent: changeIndent(1),
      decreaseIndent: changeIndent(-1),
    };
  },
});
