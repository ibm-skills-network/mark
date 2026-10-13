import type { Rule } from "../types";

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
