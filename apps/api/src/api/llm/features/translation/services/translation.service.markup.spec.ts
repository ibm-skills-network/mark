import { PromptTemplate } from "@langchain/core/prompts";
import { TranslationService } from "./translation.service";

const QUESTION_HTML =
  "<p>Submit the file <strong>report.docx</strong> from the lab.</p>" +
  '<p>It must cover:</p><ol><li data-list="bullet">every review</li>' +
  '<li data-list="bullet">the sentiment label</li></ol>' +
  '<p>See <a href="https://example.com/lab">the lab</a>.</p>';

const makeService = (translated: string) => {
  const promptProcessor = {
    processPromptForFeature: jest
      .fn()
      .mockResolvedValue(JSON.stringify({ translatedText: translated })),
    processPrompt: jest.fn().mockResolvedValue(translated),
    processPromptWithImage: jest.fn(),
  };
  const logger = {
    child: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child.mockReturnValue(logger);

  return {
    service: new TranslationService(promptProcessor as never, logger as never),
    promptProcessor,
    logger,
  };
};

const renderedPrompt = async (
  promptProcessor: ReturnType<typeof makeService>["promptProcessor"],
): Promise<string> => {
  const prompt = promptProcessor.processPromptForFeature.mock
    .calls[0][0] as PromptTemplate;
  return prompt.format({});
};

describe("question translation keeps the authored markup", () => {
  it("sends the markup to the model instead of a flattened paragraph", async () => {
    const { service, promptProcessor } = makeService("<p>Hola</p>");

    await service.generateQuestionTranslation(1, QUESTION_HTML, "es");

    const rendered = await renderedPrompt(promptProcessor);
    expect(rendered).toContain("<p>");
    expect(rendered).toContain("<ol>");
    expect(rendered).toContain("<strong>");
    expect(rendered).toContain('href="https://example.com/lab"');
  });

  it("returns the translated markup so the stored row is not plain text", async () => {
    const translated =
      "<p>Envía el archivo <strong>report.docx</strong>.</p>" +
      '<ol><li data-list="bullet">cada reseña</li></ol>';
    const { service } = makeService(translated);

    const result = await service.generateQuestionTranslation(
      1,
      QUESTION_HTML,
      "es",
    );

    expect(result).toContain("<p>");
    expect(result).toContain("<ol>");
    expect(result).toContain('data-list="bullet"');
  });

  it("still keeps image payloads out of the prompt and puts them back", async () => {
    const withImage = `<p>Look:</p><img src="data:image/png;base64,AAAABBBB">`;
    const { service, promptProcessor } = makeService("<p>Mira:</p>[[IMAGE_0]]");

    const result = await service.generateQuestionTranslation(
      1,
      withImage,
      "es",
    );

    const rendered = await renderedPrompt(promptProcessor);
    expect(rendered).not.toContain("base64");
    expect(rendered).toContain("[[IMAGE_0]]");
    expect(result).toContain('src="data:image/png;base64,AAAABBBB"');
  });

  it("drops active content from whatever the model returns", async () => {
    const { service } = makeService("<p>Hola</p><script>alert(1)</script>");

    const result = await service.generateQuestionTranslation(
      1,
      QUESTION_HTML,
      "es",
    );

    expect(result).toContain("Hola");
    expect(result).not.toMatch(/<script/i);
  });
});
