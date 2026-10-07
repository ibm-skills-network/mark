import * as cheerio from "cheerio";

/**
 * Learner text answers are graded on their text only, so an image pasted into
 * one is never seen by the grader. Stored inline as a base64 data URI it can
 * also be close to a megabyte. The editor blocks images, but the request body
 * is client-controlled, so the server removes them as well.
 */

// Matches the URI scheme plus its payload so the whole blob goes, not just the
// prefix. The payload class covers base64 and percent-encoded data.
const DATA_IMAGE_URI_PATTERN =
  /data:image\/[\w+.-]+(?:;[\w+.=-]+)*,[\w%+./=-]*/gi;

export interface StrippedLearnerHtml {
  html: string;
  removedCount: number;
}

export function stripImagesFromLearnerHtml(html: string): StrippedLearnerHtml {
  if (typeof html !== "string" || html.length === 0) {
    return { html: "", removedCount: 0 };
  }

  const mayContainImage = /<img\b/i.test(html) || /data:image\//i.test(html);
  if (!mayContainImage) {
    return { html, removedCount: 0 };
  }

  const $ = cheerio.load(html, null, false);
  const images = $("img");
  let removedCount = images.length;
  images.remove();

  let result = $.html().replaceAll(DATA_IMAGE_URI_PATTERN, () => {
    removedCount += 1;
    return "";
  });

  if (removedCount === 0) {
    return { html, removedCount: 0 };
  }

  // An answer that was only an image would otherwise be left as empty
  // paragraphs and sent to the grader as though the learner wrote something.
  if (cheerio.load(result, null, false).root().text().trim() === "") {
    result = "";
  }

  return { html: result, removedCount };
}
