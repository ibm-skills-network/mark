import { Injectable, Inject } from "@nestjs/common";
import { QuestionType } from "@prisma/client";

import {
  PROMPT_PROCESSOR,
  MODERATION_SERVICE,
  TEXT_GRADING_SERVICE,
  FILE_GRADING_SERVICE,
  IMAGE_GRADING_SERVICE,
  URL_GRADING_SERVICE,
  PRESENTATION_GRADING_SERVICE,
  VIDEO_PRESENTATION_GRADING_SERVICE,
  QUESTION_GENERATION_SERVICE,
  RUBRIC_SERVICE,
  TRANSLATION_SERVICE,
} from "./llm.constants";

import { QuestionsToGenerate } from "../assignment/dto/post.assignment.request.dto";
import {
  QuestionDto,
  ScoringDto,
  Choice,
  VariantDto,
  RubricDto,
} from "../assignment/dto/update.questions.request.dto";
import { LearnerLiveRecordingFeedback } from "../assignment/attempt/dto/assignment-attempt/types";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { IModerationService } from "./core/interfaces/moderation.interface";
import { IPromptProcessor } from "./core/interfaces/prompt-processor.interface";
import { ITextGradingService } from "./features/grading/interfaces/text-grading.interface";
import { IQuestionGenerationService } from "./features/question-generation/interfaces/question-generation.interface";
import { IRubricService } from "./features/rubric/interfaces/rubric.interface";
import { ITranslationService } from "./features/translation/interfaces/translation.interface";
import { FileUploadQuestionEvaluateModel } from "./model/file.based.question.evaluate.model";
import { FileBasedQuestionResponseModel } from "./model/file.based.question.response.model";
import { ImageBasedQuestionEvaluateModel } from "./model/image.based.evalutate.model";
import { ImageBasedQuestionResponseModel } from "./model/image.based.response.model";
import { PresentationQuestionEvaluateModel } from "./model/presentation.question.evaluate.model";
import { PresentationQuestionResponseModel } from "./model/presentation.question.response.model";
import { TextBasedQuestionEvaluateModel } from "./model/text.based.question.evaluate.model";
import { TextBasedQuestionResponseModel } from "./model/text.based.question.response.model";
import { UrlBasedQuestionEvaluateModel } from "./model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "./model/url.based.question.response.model";
import { VideoPresentationQuestionEvaluateModel } from "./model/video-presentation.question.evaluate.model";
import { VideoPresentationQuestionResponseModel } from "./model/video-presentation.question.response.model";
import { Logger } from "winston";
import { IFileGradingService } from "./features/grading/interfaces/file-grading.interface";
import { IImageGradingService } from "./features/grading/interfaces/image-grading.interface";
import { IPresentationGradingService } from "./features/grading/interfaces/presentation-grading.interface";
import { IUrlGradingService } from "./features/grading/interfaces/url-grading.interface";
import { IVideoPresentationGradingService } from "./features/grading/interfaces/video-grading.interface";
import { AssignmentTypeEnum } from "./features/question-generation/services/question-generation.service";

/**
 * LLM Facade Service
 *
 * This service acts as a facade for all LLM-related functionality,
 * providing a simplified API that orchestrates the underlying specialized services.
 * It maintains backward compatibility with the original monolithic design
 * while leveraging the new modular architecture.
 */
@Injectable()
export class LlmFacadeService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(TEXT_GRADING_SERVICE)
    private readonly textGradingService: ITextGradingService,
    @Inject(FILE_GRADING_SERVICE)
    private readonly fileGradingService: IFileGradingService,
    @Inject(IMAGE_GRADING_SERVICE)
    private readonly imageGradingService: IImageGradingService,
    @Inject(URL_GRADING_SERVICE)
    private readonly urlGradingService: IUrlGradingService,
    @Inject(PRESENTATION_GRADING_SERVICE)
    private readonly presentationGradingService: IPresentationGradingService,
    @Inject(VIDEO_PRESENTATION_GRADING_SERVICE)
    private readonly videoPresentationGradingService: IVideoPresentationGradingService,
    @Inject(QUESTION_GENERATION_SERVICE)
    private readonly questionGenerationService: IQuestionGenerationService,
    @Inject(RUBRIC_SERVICE) private readonly rubricService: IRubricService,
    @Inject(TRANSLATION_SERVICE)
    private readonly translationService: ITranslationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: LlmFacadeService.name });
  }

  /**
   * Validate content using moderation service
   */
  async applyGuardRails(content: string): Promise<boolean> {
    return this.moderationService.validateContent(content);
  }

  /**
   * Sanitize content to remove potentially harmful elements
   */
  sanitizeContent(content: string): string {
    return this.moderationService.sanitizeContent(content);
  }

  /**
   * Moderate content and get detailed results
   */
  async moderateContent(
    content: string,
  ): Promise<{ flagged: boolean; details: string }> {
    return this.moderationService.moderateContent(content);
  }

  /**
   * Generate contextual relationships between questions for grading
   */
  async generateQuestionGradingContext(
    questions: { id: number; questionText: string }[],
    assignmentId: number,
  ): Promise<Record<number, number[]>> {
    return this.questionGenerationService.generateQuestionGradingContext(
      questions,
      assignmentId,
    );
  }

  /**
   * Grade a text-based question response
   */
  async gradeTextBasedQuestion(
    model: TextBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<TextBasedQuestionResponseModel> {
    return this.textGradingService.gradeTextBasedQuestion(
      model,
      assignmentId,
      language,
    );
  }

  /**
   * Grade a file-based question response
   */
  async gradeFileBasedQuestion(
    model: FileUploadQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<FileBasedQuestionResponseModel> {
    return this.fileGradingService.gradeFileBasedQuestion(
      model,
      assignmentId,
      language,
    );
  }

  /**
   * Grade an image-based question response
   */
  async gradeImageBasedQuestion(
    model: ImageBasedQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<ImageBasedQuestionResponseModel> {
    return this.imageGradingService.gradeImageBasedQuestion(
      model,
      assignmentId,
    );
  }

  /**
   * Grade a URL-based question response
   */
  async gradeUrlBasedQuestion(
    model: UrlBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<UrlBasedQuestionResponseModel> {
    return this.urlGradingService.gradeUrlBasedQuestion(
      model,
      assignmentId,
      language,
    );
  }

  /**
   * Grade a presentation question response
   */
  async gradePresentationQuestion(
    model: PresentationQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<PresentationQuestionResponseModel> {
    return this.presentationGradingService.gradePresentationQuestion(
      model,
      assignmentId,
    );
  }

  /**
   * Grade a video presentation question response
   */
  async gradeVideoPresentationQuestion(
    model: VideoPresentationQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<VideoPresentationQuestionResponseModel> {
    return this.videoPresentationGradingService.gradeVideoPresentationQuestion(
      model,
      assignmentId,
    );
  }

  /**
   * Process content and/or learning objectives to generate assignment questions
   */
  async processMergedContent(
    assignmentId: number,
    assignmentType: AssignmentTypeEnum,
    questionsToGenerate: QuestionsToGenerate,
    content?: string,
    learningObjectives?: string,
  ): Promise<
    {
      question: string;
      totalPoints: number;
      type: QuestionType;
      scoring: {
        type: string;
        rubrics?: RubricDto[];
      };
      choices?: {
        choice: string;
        isCorrect: boolean;
        points: number;
        feedback: string;
      }[];
    }[]
  > {
    return this.questionGenerationService.generateAssignmentQuestions(
      assignmentId,
      assignmentType,
      questionsToGenerate,
      content,
      learningObjectives,
    );
  }

  /**
   * Generate variations of a question
   */
  async generateQuestionRewordings(
    questionText: string,
    variationCount: number,
    questionType: QuestionType,
    assignmentId: number,
    choices?: Choice[],
    variants?: VariantDto[],
  ): Promise<
    {
      id: number;
      variantContent: string;
      choices: Choice[];
    }[]
  > {
    return this.questionGenerationService.generateQuestionRewordings(
      questionText,
      variationCount,
      questionType,
      assignmentId,
      choices,
      variants,
    );
  }

  /**
   * Create a marking rubric for a question
   */
  async createMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
    rubricIndex?: number,
  ): Promise<ScoringDto> {
    return this.rubricService.createMarkingRubric(
      question,
      assignmentId,
      rubricIndex,
    );
  }

  /**
   * Expand an existing marking rubric
   */
  async expandMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<ScoringDto> {
    return this.rubricService.expandMarkingRubric(question, assignmentId);
  }

  /**
   * Create answer choices for a choice-based question
   */
  async createChoices(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<Choice[]> {
    return this.rubricService.createChoices(question, assignmentId);
  }

  /**
   * Detect the language of text
   */

  async getLanguageCode(text: string): Promise<string> {
    return this.translationService.getLanguageCode(text);
  }

  /**
   * Translate a question to a target language
   */
  async generateQuestionTranslation(
    assignmentId: number,
    questionText: string,
    targetLanguage: string,
  ): Promise<string> {
    return this.translationService.generateQuestionTranslation(
      assignmentId,
      questionText,
      targetLanguage,
    );
  }

  /**
   * Translate choices to a target language
   */
  async generateChoicesTranslation(
    choices: Choice[],
    assignmentId: number,
    targetLanguage: string,
  ): Promise<Choice[]> {
    return this.translationService.generateChoicesTranslation(
      choices,
      assignmentId,
      targetLanguage,
    );
  }

  /**
   * Translate arbitrary text to a target language
   */
  async translateText(
    text: string,
    targetLanguage: string,
    assignmentId: number,
  ): Promise<string> {
    return this.translationService.translateText(
      text,
      targetLanguage,
      assignmentId,
    );
  }

  /**
   * Generate feedback for a live recording
   */
  async getLiveRecordingFeedback(
    liveRecordingData: LearnerLiveRecordingFeedback,
    assignmentId: number,
  ): Promise<string> {
    return this.presentationGradingService.getLiveRecordingFeedback(
      liveRecordingData,
      assignmentId,
    );
  }
}
