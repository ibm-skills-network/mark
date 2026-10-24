import { QuestionType } from "@prisma/client";
import { GradingFactoryService } from "../grading-factory.service";

describe("GradingFactoryService", () => {
  const textStrategy = { name: "text" };
  const fileStrategy = { name: "file" };
  const urlStrategy = { name: "url" };
  const choiceStrategy = { name: "choice" };
  const trueFalseStrategy = { name: "trueFalse" };
  const imageStrategy = { name: "image" };

  const factory = new GradingFactoryService(
    textStrategy as never,
    fileStrategy as never,
    urlStrategy as never,
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

  it("has no strategy of its own for media response types", () => {
    // Media questions are refused before grading; nothing routes them to a
    // dedicated grader any more.
    expect(
      factory.getStrategy(
        QuestionType.UPLOAD,
        "LIVE_RECORDING",
        files("frame.png"),
      ),
    ).toBe(imageStrategy);
    expect(
      factory.getStrategy(QuestionType.UPLOAD, "PRESENTATION", files("a.pdf")),
    ).toBe(fileStrategy);
  });

  it("ignores files for non-upload question types", () => {
    expect(
      factory.getStrategy(QuestionType.TEXT, undefined, files("shot.png")),
    ).toBe(textStrategy);
  });
});
