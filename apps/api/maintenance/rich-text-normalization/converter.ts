import createDOMPurify, { type WindowLike } from "dompurify";
import { JSDOM, VirtualConsole } from "jsdom";
import { createRichTextSanitizer, normalizeQuillHtml } from "rich-text";
import { mapJsonStrings, transformEnvelope } from "./json-codec";
import type { Conversion, Model, Snapshot } from "./types";

function hasLegacy(root: Element): boolean {
  return [...root.querySelectorAll("[class], li[data-list]")].some(
    (element) =>
      Object.hasOwn((element as HTMLElement).dataset, "list") ||
      [...element.classList].some((name) => name.startsWith("ql-")),
  );
}

function textProjection(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const chrome of copy.querySelectorAll(".ql-ui, .ql-cursor")) {
    if (chrome.textContent?.trim()) throw new Error("editor-chrome-has-text");
    chrome.remove();
  }
  for (const container of copy.querySelectorAll(".ql-code-block-container")) {
    const lines = [...container.querySelectorAll(".ql-code-block")].map(
      (line) => line.textContent ?? "",
    );
    container.replaceWith(copy.ownerDocument.createTextNode(lines.join("\n")));
  }
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      const parent = (node.parentNode as Element)?.tagName;
      if (
        !/^\s*$/.test(text) ||
        !["DIV", "OL", "UL", "TABLE", "TBODY", "TR"].includes(parent)
      )
        parts.push(text);
    } else for (const child of node.childNodes) walk(child);
  };
  walk(copy);
  return parts.join("");
}

function structure(root: Element): string {
  const walk = (node: Node): unknown =>
    node.nodeType === 3
      ? node.textContent
      : [
          (node as Element).tagName,
          [...((node as Element).attributes ?? [])]
            .filter(
              (attribute) =>
                (node as Element).tagName !== "IFRAME" ||
                !["sandbox", "referrerpolicy"].includes(attribute.name),
            )
            .map((attribute) => [attribute.name, attribute.value])
            .sort(),
          [...node.childNodes].map((node) => walk(node)),
        ];
  return JSON.stringify([...root.childNodes].map((node) => walk(node)));
}

export function convert(
  model: Model,
  snapshot: Snapshot,
  origin: string,
): Conversion {
  const before = snapshot.values;
  const after = { ...before };
  const rules = new Set<string>();
  const window = new JSDOM("", {
    url: origin,
    virtualConsole: new VirtualConsole(),
  }).window;
  const parse = (html: string) => {
    const root = window.document.createElement("div");
    root.innerHTML = html;
    return root;
  };
  const purify = createDOMPurify(window as unknown as WindowLike);
  const sanitize = createRichTextSanitizer(purify, () => origin);
  const html = (input: string): string => {
    const root = parse(input);
    if (!hasLegacy(root)) return input;
    const result = normalizeQuillHtml(input, { parse });
    if (result.warnings.length > 0) throw new Error("normalization-warning");
    const normalized = parse(result.html);
    if (hasLegacy(normalized)) throw new Error("unresolved-legacy-markup");
    if (textProjection(root) !== textProjection(normalized))
      throw new Error("text-or-whitespace-loss");
    const output = sanitize(result.html);
    if (structure(normalized) !== structure(parse(output)))
      throw new Error("sanitizer-changes-content");
    const repeated = normalizeQuillHtml(output, { parse });
    if (
      repeated.html !== output ||
      repeated.changes !== 0 ||
      repeated.warnings.length > 0
    )
      throw new Error("not-idempotent");
    for (const rule of result.rulesFired) rules.add(rule);
    return output;
  };
  try {
    const inventory = (value: string, json: boolean, depth = 0): void => {
      if (hasLegacy(parse(value))) throw new Error("unclassified-extra-html");
      if (!json || !/ql-|data-list|\\u|&#/.test(value)) return;
      if (depth > 5) throw new Error("unclassified-extra-envelope");
      try {
        mapJsonStrings(value, (leaf) => {
          inventory(leaf, /^["[{]/.test(leaf.trim()), depth + 1);
          return leaf;
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("unclassified-extra")
        )
          throw error;
      }
    };
    for (const [field, value] of Object.entries(snapshot.extra ?? {})) {
      if (value !== null)
        inventory(value, model.auditJsonFields?.includes(field) ?? false);
    }
    for (const field of model.fields) {
      const value = before[field];
      if (value === null || value === "") continue;
      if (typeof value !== "string") throw new Error("invalid-field-type");
      if (model.name === "QuestionResponse") {
        const context: unknown = snapshot.context
          ? JSON.parse(snapshot.context)
          : null;
        const types = (context as { types?: string[] } | null)?.types;
        if (types?.length && types.every((type) => type !== "TEXT")) continue;
        const replacement = transformEnvelope(value, html, "html");
        if (
          replacement !== value &&
          (types?.length !== 1 || types[0] !== "TEXT")
        )
          throw new Error("ambiguous-response-context");
        after[field] = replacement;
      } else if (model.jsonFields?.includes(field))
        after[field] = transformEnvelope(value, html, "draft");
      else after[field] = html(value);
    }
    return {
      state: Object.keys(before).some((field) => before[field] !== after[field])
        ? "pending"
        : "unchanged",
      before,
      after,
      rules: [...rules],
    };
  } catch (error) {
    const reason =
      error instanceof Error && /^[a-z]+(?:-[a-z]+){1,8}$/.test(error.message)
        ? error.message
        : "invalid-document";
    return {
      state: "quarantined",
      before,
      after: before,
      reason,
      rules: [...rules],
    };
  } finally {
    window.close();
  }
}
