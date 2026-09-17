import { JSDOM } from "jsdom";

import type { ParseFragment } from "./types";

const CONTAINER_ID = "rich-text-normalize-root";

/**
 * Fragment parser for environments with no `DOMParser`.
 *
 * Tests deliberately drive the injected-parser path, because that is the path
 * every Node caller takes — this suite and `scripts/validate-rows.js`. The
 * browser default is covered from the web app's own suite, which runs in a DOM.
 */
export const jsdomParseFragment: ParseFragment = (html) => {
  const dom = new JSDOM(`<div id="${CONTAINER_ID}">${html}</div>`);
  const root = dom.window.document.getElementById(CONTAINER_ID);
  if (!root) {
    throw new Error("fragment container missing after parse");
  }
  return root;
};
