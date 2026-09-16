import type { Rule } from "../types";

/**
 * Rebuilds Quill's code blocks as `<pre><code>`.
 *
 * Quill stored a code block as a container holding one `<div>` per line, with
 * the chosen language repeated on every line as `data-language`. The lines are
 * joined with newlines into a single `<code>`, which is how every other editor
 * — and every syntax highlighter — expects to receive them.
 *
 * `plain` is dropped rather than written as `language-plain`: it is not a real
 * highlighter language, and emitting it produces a warning at render time and a
 * meaningless attribute that would then round-trip back into storage.
 */
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
      const code = document_.createElement("code");
      if (language) {
        code.className = `language-${language}`;
      }

      // `textContent` so any markup a highlighter previously injected into the
      // line is discarded rather than becoming part of the source.
      code.textContent = lines.map((line) => line.textContent ?? "").join("\n");

      pre.append(code);
      container.replaceWith(pre);
      context.changes += 1;
    }

    // Quill 1 wrote code blocks as a single `<pre class="ql-syntax">`.
    for (const legacy of Array.from(root.querySelectorAll("pre.ql-syntax"))) {
      const code = document_.createElement("code");
      code.textContent = legacy.textContent ?? "";

      const pre = document_.createElement("pre");
      pre.append(code);
      legacy.replaceWith(pre);
      context.changes += 1;
    }
  },
};
