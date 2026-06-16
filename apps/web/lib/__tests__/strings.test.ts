import { extractAssignmentId } from "../strings";

describe("extractAssignmentId", () => {
  it.each([
    ["/author/123", "123"],
    ["/author/456/questions", "456"],
    ["/author/123/questions/7/edit", "123"],
    ["/learner/789", "789"],
    ["/learner/42/questions", "42"],
    ["/learner/1/successPage/999", "1"],
  ])("extracts id from %s", (url, expected) => {
    expect(extractAssignmentId(url)).toBe(expected);
  });

  it.each([
    ["/admin/123"],
    ["/other/path"],
    [""],
    ["/author"],
    ["/learner/"],
    ["/authorisation/123"],
  ])("returns null for %s", (url) => {
    expect(extractAssignmentId(url)).toBeNull();
  });
});
