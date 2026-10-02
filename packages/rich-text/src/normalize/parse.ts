import type { ParseFragment } from "./types";

/**
 * Fragment parser backed by the browser's own `DOMParser`.
 *
 * The input is parsed as a fragment inside a container `<div>`, which gives
 * every rule one root to walk. It is assigned through `innerHTML` rather than
 * spliced into a document string, so a stray `</div>` in the content cannot
 * close the container and drop everything after it. The owning document comes
 * from `DOMParser`, so it is inert: nothing parsed into it runs or loads.
 */
export const browserParseFragment: ParseFragment = (html) => {
  const document_ = new DOMParser().parseFromString("", "text/html");
  const root = document_.createElement("div");
  root.innerHTML = html;
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
      "(see jsdomParseFragment in normalize/test-parser.ts, or the parser " +
      "built in scripts/validate-rows.js).",
  );
}
