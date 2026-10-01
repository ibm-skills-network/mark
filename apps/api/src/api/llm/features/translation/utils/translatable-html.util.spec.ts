import {
  prepareHtmlForTranslation,
  restoreTranslatedHtml,
} from "./translatable-html.util";

describe("prepareHtmlForTranslation", () => {
  it("keeps the block and inline tags authored content is written in", () => {
    const source =
      "<p>First paragraph.</p><p>Second paragraph.</p>" +
      '<ol><li data-list="bullet">one</li><li data-list="bullet">two</li></ol>' +
      "<strong>bold</strong><em>italic</em><code>inline</code><pre>block</pre>";

    const { preparedText, hasMarkup } = prepareHtmlForTranslation(source);

    for (const tag of [
      "<p>",
      "<ol>",
      "<li",
      "<strong>",
      "<em>",
      "<code>",
      "<pre>",
    ]) {
      expect(preparedText).toContain(tag);
    }
    expect(preparedText).toContain('data-list="bullet"');
    expect(hasMarkup).toBe(true);
  });

  it("keeps link targets so a translated question still links somewhere", () => {
    const { preparedText } = prepareHtmlForTranslation(
      '<p>See <a href="https://example.com/docs">the docs</a>.</p>',
    );

    expect(preparedText).toContain('href="https://example.com/docs"');
    expect(preparedText).toContain("the docs");
  });

  it("replaces images with placeholders so their payload never reaches the model", () => {
    const source =
      '<p>Look:</p><img src="data:image/png;base64,AAAABBBB" alt="chart">';

    const { preparedText, placeholders } = prepareHtmlForTranslation(source);

    expect(preparedText).toContain("[[IMAGE_0]]");
    expect(preparedText).not.toContain("base64");
    expect(placeholders).toHaveLength(1);
    expect(
      restoreTranslatedHtml("<p>Mira:</p>[[IMAGE_0]]", placeholders),
    ).toContain('src="data:image/png;base64,AAAABBBB"');
  });

  it("removes active content from the text handed to the model", () => {
    const { preparedText } = prepareHtmlForTranslation(
      '<p onclick="steal()">hello</p><script>alert(1)</script>' +
        '<a href="javascript:alert(2)">link</a>',
    );

    expect(preparedText).toContain("hello");
    expect(preparedText).not.toMatch(/<script/i);
    expect(preparedText).not.toMatch(/onclick/i);
    expect(preparedText).not.toMatch(/javascript:/i);
  });

  it("reports plain text as having no markup", () => {
    const { preparedText, hasMarkup } = prepareHtmlForTranslation(
      "Which value is returned?",
    );

    expect(preparedText).toBe("Which value is returned?");
    expect(hasMarkup).toBe(false);
  });

  it("does not eat text after a bare less-than sign", () => {
    const { preparedText } = prepareHtmlForTranslation(
      "<p>Select every row where price < 500 holds.</p>",
    );

    expect(preparedText).toContain("500 holds.");
  });
});

describe("restoreTranslatedHtml", () => {
  it("keeps the markup the model returned", () => {
    const restored = restoreTranslatedHtml(
      '<p>Párrafo uno.</p><ol><li data-list="bullet">uno</li></ol>',
      [],
    );

    expect(restored).toContain("<p>");
    expect(restored).toContain("<li");
    expect(restored).toContain('data-list="bullet"');
  });

  it("strips active content the model may have invented", () => {
    const restored = restoreTranslatedHtml(
      '<p>Hola</p><script>alert(1)</script><img src="x" onerror="alert(2)">',
      [],
    );

    expect(restored).toContain("Hola");
    expect(restored).not.toMatch(/<script/i);
    expect(restored).not.toMatch(/onerror/i);
  });

  it("returns an empty string for empty output", () => {
    expect(restoreTranslatedHtml("", [])).toBe("");
  });
});
