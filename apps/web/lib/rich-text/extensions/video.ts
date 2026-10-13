import { mergeAttributes, Node } from "@tiptap/core";

import { EMBED_SANDBOX, isAllowedEmbedSource } from "@/lib/sanitize-html";

export interface VideoOptions {
  HTMLAttributes: Record<string, unknown>;
}

export function videoEmbedSource(source: string): string {
  if (typeof window === "undefined") return source;
  let url: URL;
  try {
    url = new URL(source, window.location.href);
  } catch {
    return source;
  }
  if (url.protocol !== "https:") return source;
  if (url.hostname === "youtu.be") {
    return `https://www.youtube.com/embed/${encodeURIComponent(url.pathname.slice(1))}`;
  }
  if (
    ["youtube.com", "www.youtube.com"].includes(url.hostname) &&
    url.pathname === "/watch" &&
    url.searchParams.get("v")
  ) {
    return `https://www.youtube.com/embed/${encodeURIComponent(url.searchParams.get("v")!)}`;
  }
  if (
    ["vimeo.com", "www.vimeo.com"].includes(url.hostname) &&
    /^\/\d+$/.test(url.pathname)
  ) {
    return `https://player.vimeo.com/video${url.pathname}`;
  }
  return source;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: { src: string }) => ReturnType;
    };
  }
}

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
        ({ commands }) => {
          const src = videoEmbedSource(options.src);
          return (
            isAllowedEmbedSource(src) &&
            commands.insertContent({
              type: this.name,
              attrs: { src },
            })
          );
        },
    };
  },
});
