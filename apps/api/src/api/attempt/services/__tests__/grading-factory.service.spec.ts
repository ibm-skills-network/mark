import { QuestionType } from "@prisma/client";
import { GradingFactoryService } from "../grading-factory.service";

describe("GradingFactoryService", () => {
  const textStrategy = { name: "text" };
  const fileStrategy = { name: "file" };
  const urlStrategy = { name: "url" };
  const presentationStrategy = { name: "presentation" };
  const choiceStrategy = { name: "choice" };
  const trueFalseStrategy = { name: "trueFalse" };
  const imageStrategy = { name: "image" };

  const factory = new GradingFactoryService(
    textStrategy as never,
    fileStrategy as never,
    urlStrategy as never,
    presentationStrategy as never,
    choiceStrategy as never,
    trueFalseStrategy as never,
    imageStrategy as never,
  );

  const files = (...filenames: string[]) =>
    filenames.map((filename) => ({ filename }));

  it("routes declared IMAGES questions to the image strategy", () => {
    expect(factory.getStrategy(QuestionType.UPLOAD, "IMAGES")).toBe(
      imageStrategy,
    );
  });

  it("routes an all-image submission to the image strategy on a document question", () => {
    expect(
      factory.getStrategy(QuestionType.UPLOAD, "OTHER", files("shot.png")),
    ).toBe(imageStrategy);
    expect(
      factory.getStrategy(
        QuestionType.UPLOAD,
        "REPORT",
        files("a.jpeg", "b.webp"),
      ),
    ).toBe(imageStrategy);
  });

  it("is case-insensitive about image extensions", () => {
    expect(
      factory.getStrategy(QuestionType.UPLOAD, "OTHER", files("Shot.PNG")),
    ).toBe(imageStrategy);
  });

  it("keeps mixed submissions on the file strategy", () => {
    expect(
      factory.getStrategy(
        QuestionType.UPLOAD,
        "OTHER",
        files("shot.png", "report.pdf"),
      ),
    ).toBe(fileStrategy);
  });

  it("keeps submissions with no files on the file strategy", () => {
    expect(factory.getStrategy(QuestionType.UPLOAD, "OTHER")).toBe(
      fileStrategy,
    );
    expect(factory.getStrategy(QuestionType.UPLOAD, "OTHER", [])).toBe(
      fileStrategy,
    );
  });

  it("does not treat repository files as image submissions", () => {
    expect(
      factory.getStrategy(QuestionType.UPLOAD, "OTHER", [
        { filename: "shot.png", githubUrl: "https://github.com/o/r/shot.png" },
      ]),
    ).toBe(fileStrategy);
  });

  it("keeps non-gradable image formats on the file strategy", () => {
    expect(
      factory.getStrategy(QuestionType.UPLOAD, "OTHER", files("diagram.svg")),
    ).toBe(fileStrategy);
    expect(
      factory.getStrategy(QuestionType.UPLOAD, "OTHER", files("photo.heic")),
    ).toBe(fileStrategy);
    expect(
      factory.getStrategy(QuestionType.UPLOAD, "OTHER", files("README")),
    ).toBe(fileStrategy);
  });

  it("lets media response types take precedence over file contents", () => {
    expect(
      factory.getStrategy(
        QuestionType.UPLOAD,
        "LIVE_RECORDING",
        files("frame.png"),
      ),
    ).toBe(presentationStrategy);
    expect(
      factory.getStrategy(
        QuestionType.UPLOAD,
        "PRESENTATION",
        files("frame.png"),
      ),
    ).toBe(presentationStrategy);
  });

  it("ignores files for non-upload question types", () => {
    expect(
      factory.getStrategy(QuestionType.TEXT, undefined, files("shot.png")),
    ).toBe(textStrategy);
  });
});
