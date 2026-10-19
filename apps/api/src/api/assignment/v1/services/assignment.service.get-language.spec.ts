import {
  UserRole,
  type UserSession,
} from "src/auth/interfaces/user.session.interface";
import type { LearnerGetAssignmentResponseDto } from "../../dto/get.assignment.response.dto";
import { AssignmentServiceV1 } from "./assignment.service";

/**
 * The v1 assignment GET must not call the LLM on a page load. English is the
 * authored content; other languages use the stored translation row.
 */
describe("AssignmentServiceV1.get language handling", () => {
  const authored = {
    id: 2934,
    name: "Original name",
    introduction: "Original introduction",
    instructions: "Original instructions",
    gradingCriteriaOverview: "Original criteria",
  };

  const rows: Record<string, Record<string, string>> = {
    en: {
      translatedName: "Paraphrased name",
      translatedIntroduction: "Paraphrased introduction",
      translatedInstructions: "Paraphrased instructions",
      translatedGradingCriteriaOverview: "Paraphrased criteria",
    },
    ar: {
      translatedName: "اسم",
      translatedIntroduction: "مقدمة",
      translatedInstructions: "تعليمات",
      translatedGradingCriteriaOverview: "معايير",
    },
  };

  const learner = {
    role: UserRole.LEARNER,
    assignmentId: 2934,
  } as unknown as UserSession;

  const makeService = () => {
    const prisma = {
      assignmentTranslation: {
        findUnique: jest.fn(
          async (arguments_: {
            where: { assignmentId_languageCode: { languageCode: string } };
          }) =>
            rows[arguments_.where.assignmentId_languageCode.languageCode] ??
            null,
        ),
      },
    };
    const llmFacade = {
      getLanguageCode: jest.fn(() => new Promise<string>(() => {})),
    };
    const logger = { child: () => ({ info: jest.fn(), warn: jest.fn() }) };
    const service = new AssignmentServiceV1(
      prisma as never,
      llmFacade as never,
      {} as never,
      {} as never,
      logger as never,
    );
    jest
      .spyOn(service, "findOne")
      .mockImplementation(
        async () =>
          ({ ...authored }) as unknown as LearnerGetAssignmentResponseDto,
      );
    return { service, prisma, llmFacade };
  };

  it.each([undefined, "en", "en-US"])(
    "serves the authored text for lang=%p without an LLM call",
    async (lang) => {
      const { service, prisma, llmFacade } = makeService();

      const result = await service.get(2934, learner, lang);

      expect(llmFacade.getLanguageCode).not.toHaveBeenCalled();
      expect(prisma.assignmentTranslation.findUnique).not.toHaveBeenCalled();
      expect(result).toMatchObject(authored);
    },
  );

  it("applies the stored row for a non-English language without an LLM call", async () => {
    const { service, llmFacade } = makeService();

    const result = await service.get(2934, learner, "ar");

    expect(llmFacade.getLanguageCode).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      name: rows.ar.translatedName,
      introduction: rows.ar.translatedIntroduction,
      instructions: rows.ar.translatedInstructions,
      gradingCriteriaOverview: rows.ar.translatedGradingCriteriaOverview,
    });
  });
});
