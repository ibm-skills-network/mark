import type { Rule } from "../types";

export const normalizeCodeBlocks: Rule = {
  name: "code-blocks",
  apply(root, context) {
    const document_ = root.ownerDocument;

    for (const container of Array.from(
      root.querySelectorAll(".ql-code-block-container"),
    )) {
      const lines = Array.from(container.querySelectorAll(".ql-code-block"));
      const language = lines
        .map((line) => line.getAttribute("data-language"))
        .find((value) => value && value !== "plain");

      const pre = document_.createElement("pre");
      for (const attribute of ["style", "dir", "data-indent"]) {
        const value = container.getAttribute(attribute);
        if (value !== null) pre.setAttribute(attribute, value);
      }
      const code = document_.createElement("code");
      if (language) {
        code.className = `language-${language}`;
      }

      // Discard syntax-highlighter markup while retaining source text.
      code.textContent = lines.map((line) => line.textContent ?? "").join("\n");

      pre.append(code);
      container.replaceWith(pre);
      context.changes += 1;
    }

    for (const legacy of Array.from(root.querySelectorAll("pre.ql-syntax"))) {
      const code = document_.createElement("code");
      code.textContent = legacy.textContent ?? "";

      const pre = document_.createElement("pre");
      for (const attribute of ["style", "dir", "data-indent"]) {
        const value = legacy.getAttribute(attribute);
        if (value !== null) pre.setAttribute(attribute, value);
      }
      pre.append(code);
      legacy.replaceWith(pre);
      context.changes += 1;
    }
  },
};
