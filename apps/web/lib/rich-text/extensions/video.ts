import { mergeAttributes, Node } from "@tiptap/core";

import { EMBED_SANDBOX, isAllowedEmbedSource } from "@/lib/sanitize-html";

export interface VideoOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: { src: string }) => ReturnType;
    };
  }
}

/**
 * A video embed, stored as an `<iframe>`.
 *
 * Stored content already holds bare `<iframe>` elements, because that is what
 * the previous editor wrote, so this parses the plain element rather than a
 * wrapper of its own. Stored content reaches the editor through the sanitizer,
 * but pasted HTML and the toolbar's `setVideo` do not, so the node enforces the
 * sanitizer's host allowlist and sandbox itself. Both come from
 * `sanitize-html.ts`, so there is still one policy.
 *
 * It is an atom: the frame has no editable content, and without this the editor
 * would let the caret inside it.
 */
export const Video = Node.create<VideoOptions>({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      height: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "iframe[src]",
        getAttrs: (element) => {
          const src = element.getAttribute("src");
          return isAllowedEmbedSource(src) ? { src } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "iframe",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        frameborder: "0",
        allowfullscreen: "true",
        sandbox: EMBED_SANDBOX,
        referrerpolicy: "no-referrer",
      }),
    ];
  },

  addCommands() {
    return {
      setVideo:
        (options) =>
        ({ commands }) =>
          isAllowedEmbedSource(options.src) &&
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
});
