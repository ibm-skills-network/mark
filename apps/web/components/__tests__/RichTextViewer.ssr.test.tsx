/**
 * @jest-environment node
 */

import React from "react";
import { renderToString } from "react-dom/server";

import RichTextViewer from "../rich-text/RichTextViewer";

/**
 * Client components still render in the server pass, where there is no
 * `DOMParser`. Content is prepared only after mount, so the server has to
 * render an empty shell rather than throw.
 */
describe("RichTextViewer on the server", () => {
  it("renders an empty shell for non-empty content without throwing", () => {
    const html = renderToString(
      <RichTextViewer>
        {'<ol><li data-list="bullet">Alpha</li></ol>'}
      </RichTextViewer>,
    );

    expect(html).toContain("rich-text-content");
    expect(html).not.toContain("Alpha");
  });
});
