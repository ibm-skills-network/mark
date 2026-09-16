import { Extension, getText } from "@tiptap/core";
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
}

/**
 * Counts the way the previous editor counted.
 *
 * Its `getText().trim()` put a newline between blocks and then trimmed the
 * whole string. Matching that matters: the editor's own character-count
 * extension measures differently, by roughly one character per block boundary,
 * which would push existing answers that sit just under a limit over it the
 * first time a learner opened them.
 */
export function countRichText(doc: ProseMirrorNode): RichTextCounts {
  const text = getText(doc, { blockSeparator: "\n" }).trim();
  return {
    characters: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

const richTextLimitsKey = new PluginKey("richTextLimits");

/**
 * Holds a response inside its word and character limits.
 *
 * The limit is enforced by refusing the keystroke rather than deleting after
 * the fact. The previous editor let the text land and then removed characters,
 * so a learner at the limit watched their typing disappear as they went.
 *
 * A change that does not push the count higher is always allowed, which is what
 * lets content that is *already* over a limit — saved before the limit was
 * lowered, say — still be edited down instead of being frozen or truncated on
 * open.
 */
export const RichTextLimits = Extension.create<RichTextLimitsOptions>({
  name: "richTextLimits",

  addOptions() {
    return { maxWords: null, maxCharacters: null, onCount: undefined };
  },

  addProseMirrorPlugins() {
    const { maxWords, maxCharacters, onCount } = this.options;

    return [
      new Plugin({
        key: richTextLimitsKey,

        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged) {
            return true;
          }

          const next = countRichText(transaction.doc);
          const previous = countRichText(state.doc);

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
