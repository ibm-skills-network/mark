/**
 * @jest-environment node
 */

import { isYourLearningHost } from "@/lib/portal";

describe("isYourLearningHost", () => {
  it.each(["courses.yl.skillsnetwork.site", "COURSES.YL.SKILLSNETWORK.SITE"])(
    "matches the yourLearning host %s",
    (host) => {
      expect(isYourLearningHost(host)).toBe(true);
    },
  );

  it.each([
    undefined,
    "",
    "courses.cognitiveclass.ai",
    "www.coursera.org",
    "yl.skillsnetwork.site.evil.example",
    "notyl.skillsnetwork.site",
  ])("does not match %s", (host) => {
    expect(isYourLearningHost(host)).toBe(false);
  });
});
