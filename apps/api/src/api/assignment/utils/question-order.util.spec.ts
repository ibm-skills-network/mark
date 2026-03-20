import {
  applyQuestionOrder,
  normalizeQuestionOrder,
  sanitizeQuestionOrder,
} from "./question-order.util";

describe("question-order.util", () => {
  describe("sanitizeQuestionOrder", () => {
    it("filters out non-finite ids", () => {
      expect(
        sanitizeQuestionOrder([3, Number.NaN, Number.POSITIVE_INFINITY, 1]),
      ).toEqual([3, 1]);
    });

    it("falls back to an empty array for missing order", () => {
      expect(sanitizeQuestionOrder()).toEqual([]);
      expect(sanitizeQuestionOrder(null)).toEqual([]);
    });
  });

  describe("normalizeQuestionOrder", () => {
    it("preserves explicit ordering and appends missing ids", () => {
      expect(normalizeQuestionOrder([10, 20, 30], [20, 10])).toEqual([
        20, 10, 30,
      ]);
    });

    it("drops invalid and duplicate ids while keeping the remaining ids stable", () => {
      expect(normalizeQuestionOrder([1, 2, 3], [99, 2, 2, 1])).toEqual([
        2, 1, 3,
      ]);
    });
  });

  describe("applyQuestionOrder", () => {
    it("reorders matching items and appends newly added items to the end", () => {
      const questions = [
        { id: 1, label: "Question 1" },
        { id: 2, label: "Question 2" },
        { id: 3, label: "Question 3" },
      ];

      expect(
        applyQuestionOrder(questions, [2, 1]).map((question) => question.id),
      ).toEqual([2, 1, 3]);
    });

    it("falls back to the current item order when no order is provided", () => {
      const questions = [{ id: 7 }, { id: 8 }];

      expect(
        applyQuestionOrder(questions).map((question) => question.id),
      ).toEqual([7, 8]);
    });
  });
});
