import { ResponseType } from "@prisma/client";
import { GradingThresholdService } from "./grading-threshold.service";

describe("GradingThresholdService", () => {
  let service: GradingThresholdService;

  beforeEach(() => {
    service = new GradingThresholdService();
  });

  describe("shouldUseJudgeLLM", () => {
    it("should recommend JudgeLLM for substantial responses", () => {
      const result = service.shouldUseJudgeLLM({
        responseText:
          "This is a comprehensive essay response that analyzes the topic in depth. It contains multiple paragraphs with well-structured arguments, supporting evidence, and demonstrates critical thinking skills.",
        questionText:
          "Analyze the impact of artificial intelligence on modern society.",
        responseType: ResponseType.ESSAY,
      });

      expect(result.shouldUseJudgeLLM).toBe(true);
      expect(result.reason).toContain("Substantial response");
    });

    it("should skip JudgeLLM for very short responses", () => {
      const result = service.shouldUseJudgeLLM({
        responseText: "Yes",
        questionText: "Do you agree?",
        responseType: ResponseType.OTHER,
      });

      expect(result.shouldUseJudgeLLM).toBe(false);
      expect(result.reason).toContain("Very short response");
    });

    it("should skip JudgeLLM for image responses (multimedia)", () => {
      const result = service.shouldUseJudgeLLM({
        responseText: "Brief description of uploaded image",
        questionText: "Upload an image showing your project results",
        responseType: ResponseType.IMAGES,
      });

      expect(result.shouldUseJudgeLLM).toBe(false);
      expect(result.reason).toContain(
        "IMAGES submission - text analysis not needed",
      );
    });

    it("should use JudgeLLM for substantial code responses", () => {
      const codeResponse = `
function calculateFibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}
console.log(calculateFibonacci(10));
      `.trim();

      const result = service.shouldUseJudgeLLM({
        responseText: codeResponse,
        questionText:
          "Implement an efficient algorithm to calculate the nth Fibonacci number.",
        responseType: ResponseType.CODE,
      });

      expect(result.shouldUseJudgeLLM).toBe(true);
      expect(result.reason).toContain("Substantial response");
    });

    it("should skip JudgeLLM for video/audio responses", () => {
      const videoResult = service.shouldUseJudgeLLM({
        responseText: "Short description",
        questionText: "Upload a video explaining the concept",
        responseType: ResponseType.VIDEO,
      });

      const audioResult = service.shouldUseJudgeLLM({
        responseText: "Audio transcript",
        questionText: "Record an audio explanation",
        responseType: ResponseType.AUDIO,
      });

      expect(videoResult.shouldUseJudgeLLM).toBe(false);
      expect(audioResult.shouldUseJudgeLLM).toBe(false);
      expect(videoResult.reason).toContain(
        "VIDEO submission - text analysis not needed",
      );
      expect(audioResult.reason).toContain(
        "AUDIO submission - text analysis not needed",
      );
    });

    it("should skip JudgeLLM for responses with very few words", () => {
      const result = service.shouldUseJudgeLLM({
        responseText: "I think the answer is correct and makes sense overall.",
        questionText: "What do you think?",
        responseType: ResponseType.OTHER,
      });

      expect(result.shouldUseJudgeLLM).toBe(false);
      expect(result.reason).toContain("Brief response");
    });
  });
});
