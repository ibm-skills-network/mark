import { ImageDescriptionService } from "./image-description.service";

describe("ImageDescriptionService notebook observations", () => {
  const logger = {
    child: jest.fn().mockReturnThis(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const block = {
    blockId: "plot",
    type: "image" as const,
    text: "",
    page: 1,
    imageData: "data:image/png;base64,AA==",
  };

  it("describes notebook pixels without exposing the question or rubric", async () => {
    const promptProcessor = {
      processPromptWithImage: jest
        .fn()
        .mockResolvedValue("Empty axes with no plotted data."),
    };
    const service = new ImageDescriptionService(
      promptProcessor as any,
      logger as any,
    );
    await service.describeImagesForGrading(
      [block],
      "required growing revenue",
      "required pie chart",
      1,
      { observeOnly: true },
    );
    const [prompt, , , , , options] =
      promptProcessor.processPromptWithImage.mock.calls[0];
    const text = await prompt.format({});
    expect(text).not.toContain("required growing revenue");
    expect(text).not.toContain("required pie chart");
    expect(text).toContain("no data is plotted");
    expect(options.imageDetail).toBe("high");
  });

  it("preserves the existing document description prompt and image detail", async () => {
    const promptProcessor = {
      processPromptWithImage: jest
        .fn()
        .mockResolvedValue("A bar chart of monthly revenue."),
    };
    const service = new ImageDescriptionService(
      promptProcessor as any,
      logger as any,
    );
    await service.describeImagesForGrading(
      [block],
      "monthly revenue",
      "analyse sales",
      1,
    );
    const [prompt, , , , , options] =
      promptProcessor.processPromptWithImage.mock.calls[0];
    const text = await prompt.format({});
    expect(text).toContain("monthly revenue");
    expect(text).toContain("analyse sales");
    expect(options.imageDetail).toBe("low");
  });

  it("marks failed notebook visual checks as unknown rather than visible charts", async () => {
    const promptProcessor = {
      processPromptWithImage: jest
        .fn()
        .mockRejectedValue(new Error("invalid image")),
    };
    const service = new ImageDescriptionService(
      promptProcessor as any,
      logger as any,
    );
    const result = await service.describeImagesForGrading(
      [block],
      "chart",
      "plot",
      1,
      { observeOnly: true },
    );
    expect(result.get("plot")).toContain("not inspected");
    expect(result.get("plot")).toContain("correctness are unknown");
  });
});
