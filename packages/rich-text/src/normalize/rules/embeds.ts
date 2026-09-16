import type { Rule } from "../types";

/**
 * Normalises Quill's video embed to a plain `<iframe>` the editor can parse.
 *
 * Only the marker class is dropped — the frame itself, and which hosts are
 * permitted, are decided by the sanitizer, which runs before this and already
 * enforces an allowlist. Re-checking the host here would put that policy in two
 * places and let them drift.
 */
export const normalizeEmbeds: Rule = {
  name: "embeds",
  apply(root, context) {
    for (const frame of root.querySelectorAll("iframe.ql-video")) {
      frame.classList.remove("ql-video");
      if (frame.getAttribute("class") === "") {
        frame.removeAttribute("class");
      }
      context.changes += 1;
    }
  },
};
