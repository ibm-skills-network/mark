import { Extension } from "@tiptap/core";

const DIRECTIONS = new Set(["ltr", "rtl"]);

/**
 * Right-to-left support, as a `dir` attribute on block nodes.
 *
 * The editor core already ships `setTextDirection`/`unsetTextDirection` as
 * commands; they write to a `dir` attribute, so all that is needed is for the
 * block nodes to carry one. Nothing in stored content uses it today — the
 * previous editor wrote a `ql-direction-rtl` class and no row has one — but the
 * toolbar offered the control, so it stays available.
 *
 * Named for what it contributes rather than the feature, because core ships an
 * extension called `textDirection` too. Sharing that name warns on every editor
 * construction — the two do not actually conflict, since core's adds no
 * attributes unless given a `direction` option, but a standing warning that
 * says "this can lead to issues" is not worth keeping.
 */
export const TextDirection = Extension.create({
  name: "textDirectionAttributes",

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
