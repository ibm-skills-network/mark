import type { ParseFragment } from "./types";

const CONTAINER_ID = "rich-text-normalize-root";

/**
 * Fragment parser backed by the browser's own `DOMParser`.
 *
 * The fragment is wrapped in an identifiable container because parsing a bare
 * fragment as a document moves stray content around (a `<td>` with no table,
 * for instance), and because the container gives every rule one root to walk.
 */
export const browserParseFragment: ParseFragment = (html) => {
  const document_ = new DOMParser().parseFromString(
    `<div id="${CONTAINER_ID}">${html}</div>`,
    "text/html",
  );

  const root = document_.getElementById(CONTAINER_ID);
  if (!root) {
    throw new Error("rich-text: fragment container missing after parse");
  }
  return root;
};

export function resolveParser(parse?: ParseFragment): ParseFragment {
  if (parse) {
    return parse;
  }
  if (typeof DOMParser !== "undefined") {
    return browserParseFragment;
  }
  throw new Error(
    "rich-text: no DOMParser in this environment — pass `parse` explicitly " +
      "(see createJsdomParser in the backfill script).",
  );
}
