import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface RichTextCounts {
  characters: number;
  words: number;
}

export interface RichTextLimitsOptions {
  maxWords?: number | null;
  maxCharacters?: number | null;
  onCount?: (counts: RichTextCounts) => void;
  getLimits?: () => Pick<RichTextLimitsOptions, "maxWords" | "maxCharacters">;
}

export function countRichText(doc: ProseMirrorNode): RichTextCounts {
  const text = doc
    .textBetween(0, doc.content.size, "\n", (node) =>
      node.type.name === "hardBreak" ? "\n" : "",
    )
    .trim();
  return {
    characters: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

const richTextLimitsKey = new PluginKey("richTextLimits");

export const RichTextLimits = Extension.create<RichTextLimitsOptions>({
  name: "richTextLimits",

  addOptions() {
    return {
      maxWords: null,
      maxCharacters: null,
      onCount: undefined,
      getLimits: undefined,
    };
  },

  addProseMirrorPlugins() {
    const { onCount } = this.options;

    return [
      new Plugin({
        key: richTextLimitsKey,

        filterTransaction: (transaction, state) => {
          // Silent external loads bypass limits; edits still enforce them.
          if (!transaction.docChanged || transaction.getMeta("preventUpdate")) {
            return true;
          }

          const next = countRichText(transaction.doc);
          const previous = countRichText(state.doc);
          const { maxWords, maxCharacters } =
            this.options.getLimits?.() ?? this.options;

          if (
            maxCharacters &&
            maxCharacters > 0 &&
            next.characters > maxCharacters &&
            next.characters > previous.characters
          ) {
            return false;
          }

          if (
            maxWords &&
            maxWords > 0 &&
            next.words > maxWords &&
            next.words > previous.words
          ) {
            return false;
          }

          return true;
        },

        view: () => ({
          update: (view, previousState) => {
            if (!onCount || previousState.doc.eq(view.state.doc)) {
              return;
            }
            onCount(countRichText(view.state.doc));
          },
        }),
      }),
    ];
  },
});
