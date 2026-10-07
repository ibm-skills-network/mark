import { stripImagesFromLearnerHtml } from "./learner-text-images.util";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("stripImagesFromLearnerHtml", () => {
  it("leaves an answer without images untouched", () => {
    const html = "<p>The output was <strong>42</strong> &amp; done</p>";
    expect(stripImagesFromLearnerHtml(html)).toEqual({
      html,
      removedCount: 0,
    });
  });

  it("removes a pasted inline image and keeps the surrounding text", () => {
    const result = stripImagesFromLearnerHtml(
      `<p>Here is my output:</p><p><img src="${PNG}"></p><p>It printed 42.</p>`,
    );

    expect(result.removedCount).toBe(1);
    expect(result.html).not.toMatch(/<img/i);
    expect(result.html).not.toMatch(/data:image/i);
    expect(result.html).toContain("Here is my output:");
    expect(result.html).toContain("It printed 42.");
  });

  it("removes every image, including remote ones and odd casing", () => {
    const result = stripImagesFromLearnerHtml(
      `<p><IMG SRC="https://example.com/a.png"><img alt="x>y" src="${PNG}"/>text</p>`,
    );

    expect(result.removedCount).toBe(2);
    expect(result.html).not.toMatch(/<img/i);
    expect(result.html).not.toMatch(/data:image/i);
    expect(result.html).toContain("text");
  });

  it("removes data:image URIs smuggled outside an <img> tag", () => {
    const result = stripImagesFromLearnerHtml(
      `<p><a href="${PNG}">link</a> and raw ${PNG} text</p>`,
    );

    expect(result.removedCount).toBe(2);
    expect(result.html).not.toMatch(/data:image/i);
    expect(result.html).toContain("link");
    expect(result.html).toContain("text");
  });

  it("reports an image-only answer as empty", () => {
    const result = stripImagesFromLearnerHtml(`<p><img src="${PNG}"></p>`);

    expect(result.removedCount).toBe(1);
    expect(result.html).toBe("");
  });

  it("handles non-string input defensively", () => {
    expect(stripImagesFromLearnerHtml(undefined as unknown as string)).toEqual({
      html: "",
      removedCount: 0,
    });
  });
});
