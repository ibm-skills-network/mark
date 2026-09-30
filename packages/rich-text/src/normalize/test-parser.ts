import { JSDOM } from "jsdom";

import type { ParseFragment } from "./types";

/**
 * Fragment parser for environments with no `DOMParser`.
 *
 * Tests deliberately drive the injected-parser path, because that is the path
 * every Node caller takes — this suite and `scripts/validate-rows.js`. The
 * browser default is covered from the web app's own suite, which runs in a DOM.
 * Parses the same way as the browser default, as a fragment inside a `<div>`.
 */
export const jsdomParseFragment: ParseFragment = (html) => {
  const root = new JSDOM().window.document.createElement("div");
  root.innerHTML = html;
  return root;
};
