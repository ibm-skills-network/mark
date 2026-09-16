import { mergeAttributes, Node } from "@tiptap/core";

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
 * wrapper of its own. Which hosts are permitted is not decided here — the
 * sanitizer runs first and enforces an allowlist, and duplicating that policy
 * in a second place is how the two drift apart.
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
          return src ? { src } : false;
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
      }),
    ];
  },

  addCommands() {
    return {
      setVideo:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
});
