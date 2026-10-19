import { JSDOM } from "jsdom";

import type { ParseFragment } from "./types";

export const jsdomParseFragment: ParseFragment = (html) => {
  const root = new JSDOM().window.document.createElement("div");
  root.innerHTML = html;
  return root;
};
