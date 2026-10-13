import type { ParseFragment } from "./types";

// An inert fragment container preserves content after stray closing tags.
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
