import type { Rule, RuleContext } from "../types";

type ListType = "bullet" | "ordered";

interface FlatItem {
  type: ListType;
  level: number;
  item: Element;
}

const INDENT_PATTERN = /^ql-indent-(\d+)$/;

/** Quill wrote every list as `<ol>` and put the real kind on each item. */
function itemType(item: Element, fallback: ListType, context: RuleContext) {
  const declared = item.getAttribute("data-list");
  if (declared === "ordered") return "ordered";
  if (declared === "bullet") return "bullet";
  if (declared === "checked" || declared === "unchecked") {
    // A checklist needs a task-list extension in the editor before it can be
    // represented. Degrading it to a bullet silently would drop the ticks, so
    // say so and let the caller decide.
    context.warnings.push(
      `checklist item ("data-list=${declared}") converted to a bullet; ticked state is not preserved`,
    );
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

/** Strips the markers this rule consumes, leaving the item's content intact. */
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

function createList(document_: Document, type: ListType): Element {
  return document_.createElement(type === "bullet" ? "ul" : "ol");
}

/**
 * Rebuilds a flat run of items, whose nesting is encoded as an indent level,
 * into genuinely nested lists.
 */
function buildLists(
  document_: Document,
  items: FlatItem[],
  context: RuleContext,
): Element[] {
  const roots: Element[] = [];
  const stack: { list: Element; type: ListType; level: number }[] = [];

  for (const entry of items) {
    // An indent deeper than one step past the previous item has no parent to
    // hang from; clamping keeps the content rather than inventing levels.
    const deepest = stack.length === 0 ? 0 : stack[stack.length - 1]!.level + 1;
    const level = Math.min(entry.level, deepest);

    while (stack.length > 0 && stack[stack.length - 1]!.level > level) {
      stack.pop();
    }

    const top = stack[stack.length - 1];

    if (!top || top.level < level) {
      const list = createList(document_, entry.type);
      if (!top) {
        roots.push(list);
      } else {
        // A nested list belongs inside the item it hangs from, after that
        // item's own content.
        const host = top.list.lastElementChild;
        if (host) {
          host.append(list);
        } else {
          roots.push(list);
        }
      }
      stack.push({ list, type: entry.type, level });
    } else if (top.type !== entry.type) {
      // Same depth, different kind: Quill can mix both in one `<ol>`, so the
      // run splits into sibling lists rather than one list of mixed items.
      const list = createList(document_, entry.type);
      if (top.list.parentNode) {
        top.list.after(list);
      } else {
        // A list at the outermost level is still detached while it is being
        // built, so it has no parent to insert a sibling into — it has to join
        // the roots directly or the whole run after the switch is dropped.
        roots.push(list);
      }
      stack.pop();
      stack.push({ list, type: entry.type, level });
    }

    cleanItem(entry.item);
    stack[stack.length - 1]!.list.append(entry.item);
  }

  return roots;
}

/**
 * Converts Quill's list markup into ordinary nested `<ul>`/`<ol>`.
 *
 * Quill stored every list as `<ol>`, marking each item with `data-list` to say
 * whether it should draw as a bullet or a number, and encoding nesting as a
 * `ql-indent-N` class rather than as an actual nested list. Read literally by
 * any other editor, a bulleted list comes back numbered and indentation
 * disappears.
 *
 * A list with no `data-list` on any item is already in the target shape and is
 * left untouched, which is what makes this rule safe to run repeatedly.
 */
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
        type: itemType(item, fallback, context),
        level: itemLevel(item),
        item,
      }));

      const rebuilt = buildLists(document_, flat, context);
      list.replaceWith(...rebuilt);
      context.changes += 1;
    }
  },
};
