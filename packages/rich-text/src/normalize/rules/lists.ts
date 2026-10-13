import type { Rule } from "../types";

type ListType = "bullet" | "ordered";

interface FlatItem {
  type: ListType;
  level: number;
  item: Element;
}

const INDENT_PATTERN = /^ql-indent-(\d+)$/;

// Quill encoded list kind on each item inside an <ol>.
function itemType(item: Element, fallback: ListType) {
  const declared = item.getAttribute("data-list");
  if (declared === "ordered") return "ordered";
  if (declared === "bullet") return "bullet";
  if (declared === "checked" || declared === "unchecked") {
    item.setAttribute("data-checked", String(declared === "checked"));
    return "bullet";
  }
  return fallback;
}

function itemLevel(item: Element): number {
  for (const name of Array.from(item.classList)) {
    const match = INDENT_PATTERN.exec(name);
    if (match) {
      return Number.parseInt(match[1] as string, 10);
    }
  }
  return 0;
}

function cleanItem(item: Element): void {
  item.removeAttribute("data-list");
  for (const name of Array.from(item.classList)) {
    if (INDENT_PATTERN.test(name)) {
      item.classList.remove(name);
    }
  }
  if (item.getAttribute("class") === "") {
    item.removeAttribute("class");
  }
}

function createList(
  document_: Document,
  type: ListType,
  level: number,
  start: number,
): Element {
  const list = document_.createElement(type === "bullet" ? "ul" : "ol");
  if (type === "ordered") {
    if (start > 1) list.setAttribute("start", String(start));
    if (level > 0) list.setAttribute("type", ["1", "a", "i"][level % 3]!);
  }
  return list;
}

function buildLists(document_: Document, items: FlatItem[]): Element[] {
  const roots: Element[] = [];
  const stack: { list: Element; type: ListType; level: number }[] = [];
  const counters = new Map<number, number>();

  for (const entry of items) {
    const level = entry.level;
    // Continue numbering across bullet runs; reset deeper levels.
    for (const depth of counters.keys()) {
      if (depth > level) counters.delete(depth);
    }
    const start = (counters.get(level) ?? 0) + 1;
    if (entry.type === "ordered") counters.set(level, start);

    while (stack.length > 0 && stack[stack.length - 1]!.level > level) {
      stack.pop();
    }

    const top = stack[stack.length - 1];

    if (!top || top.level < level) {
      const list = createList(document_, entry.type, level, start);
      if (!top) {
        roots.push(list);
      } else {
        const host = top.list.lastElementChild;
        if (host) {
          host.append(list);
        } else {
          roots.push(list);
        }
      }
      stack.push({ list, type: entry.type, level });
    } else if (top.type !== entry.type) {
      const list = createList(document_, entry.type, level, start);
      if (top.list.parentNode) {
        top.list.after(list);
      } else {
        // Detached root lists need to join the output explicitly.
        roots.push(list);
      }
      stack.pop();
      stack.push({ list, type: entry.type, level });
    }

    cleanItem(entry.item);
    // Preserve indentation levels that have no parent item.
    const parentLevel =
      stack.length > 1 ? stack[stack.length - 2]!.level + 1 : 0;
    const extraIndent = Math.max(0, level - parentLevel);
    if (extraIndent > 0) {
      entry.item.setAttribute("data-indent", String(extraIndent));
      (entry.item as HTMLElement).style.setProperty(
        "padding-inline-start",
        `${extraIndent * 3}em`,
      );
    }
    stack[stack.length - 1]!.list.append(entry.item);
  }

  return roots;
}

export const normalizeLists: Rule = {
  name: "lists",
  apply(root, context) {
    const document_ = root.ownerDocument;

    for (const list of Array.from(root.querySelectorAll("ol, ul"))) {
      const items = Array.from(list.children).filter(
        (child) => child.tagName.toLowerCase() === "li",
      );

      const needsWork = items.some(
        (item) => item.hasAttribute("data-list") || itemLevel(item) > 0,
      );
      if (!needsWork) {
        continue;
      }

      const fallback: ListType =
        list.tagName.toLowerCase() === "ul" ? "bullet" : "ordered";

      const flat: FlatItem[] = items.map((item) => ({
        type: itemType(item, fallback),
        level: itemLevel(item),
        item,
      }));

      const rebuilt = buildLists(document_, flat);
      list.replaceWith(...rebuilt);
      context.changes += 1;
    }
  },
};
