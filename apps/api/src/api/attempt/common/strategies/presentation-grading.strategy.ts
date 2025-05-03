/* eslint-disable @typescript-eslint/require-await */
import { Injectable, BadRequestException } from "@nestjs/common";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PresentationQuestionEvaluateModel } from "src/api/llm/model/presentation.question.evaluate.model";
import { VideoPresentationQuestionEvaluateModel } from "src/api/llm/model/video-presentation.question.evaluate.model";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import {
  LearnerPresentationResponse,
  SlideMetadata,
} from "../interfaces/attempt.interface";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class PresentationGradingStrategy extends AbstractGradingStrategy<LearnerPresentationResponse> {
  constructor(
    private readonly llmFacadeService: LlmFacadeService,
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService: GradingAuditService,
  ) {
    super(localizationService, gradingAuditService);
  }

  /**
   * Route to the appropriate handler based on response type
   */
  async handleResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: LearnerPresentationResponse;
  }> {
    if (question.responseType === "LIVE_RECORDING") {
      return this.handleLiveRecording(question, requestDto, context);
    } else if (question.responseType === "PRESENTATION") {
      return this.handlePresentation(question, requestDto, context);
    } else {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "unsupportedPresentationType",
          context.language,
          { type: question.responseType },
        ),
      );
    }
  }

  /**
   * Validate that the request contains a valid presentation response
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    if (!requestDto.learnerPresentationResponse) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "expectedPresentationResponse",
          requestDto.language,
        ),
      );
    }

    // // Validate specific to response type
    // if (question.responseType === 'LIVE_RECORDING') {
    //   if (!this.validateLiveRecordingResponse(requestDto.learnerPresentationResponse)) {
    //     throw new BadRequestException(
    //       this.localizationService.getLocalizedString(
    //         "invalidLiveRecordingResponse",
    //         requestDto.language
    //       )
    //     );
    //   }
    // } else if (question.responseType === 'PRESENTATION' && !this.validatePresentationResponse(requestDto.learnerPresentationResponse)) {
    //     throw new BadRequestException(
    //       this.localizationService.getLocalizedString(
    //         "invalidPresentationResponse",
    //         requestDto.language
    //       )
    //     );
    //   }

    return true;
  }

  /**
   * Extract the presentation response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<LearnerPresentationResponse> {
    return requestDto.learnerPresentationResponse;
  }

  /**
   * Grade a presentation response
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: LearnerPresentationResponse,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    if (question.responseType === "LIVE_RECORDING") {
      return this.gradeLiveRecording(question, learnerResponse, context);
    } else if (question.responseType === "PRESENTATION") {
      return this.gradePresentation(question, learnerResponse, context);
    } else {
      throw new BadRequestException(
        `Unsupported presentation response type: ${question.responseType}`,
      );
    }
  }

  /**
   * Handle live recording presentation
   */
  private async handleLiveRecording(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: LearnerPresentationResponse;
  }> {
    // Validate the response
    await this.validateResponse(question, requestDto);

    // Extract the learner response
    const learnerResponse = await this.extractLearnerResponse(requestDto);

    // Grade the response
    const responseDto = await this.gradeLiveRecording(
      question,
      learnerResponse,
      context,
    );

    return { responseDto, learnerResponse };
  }

  /**
   * Handle video presentation
   */
  private async handlePresentation(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: LearnerPresentationResponse;
  }> {
    // Validate the response
    await this.validateResponse(question, requestDto);

    // Extract the learner response
    const learnerResponse = await this.extractLearnerResponse(requestDto);

    // Grade the response
    const responseDto = await this.gradePresentation(
      question,
      learnerResponse,
      context,
    );

    return { responseDto, learnerResponse };
  }

  /**
   * Grade a live recording presentation
   */
  private async gradeLiveRecording(
    question: QuestionDto,
    learnerResponse: LearnerPresentationResponse,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    // Create evaluation model for the LLM
    const presentationQuestionEvaluateModel =
      new PresentationQuestionEvaluateModel(
        question.question,
        context.questionAnswerContext,
        context.assignmentInstructions,
        learnerResponse,
        question.totalPoints,
        question.scoring?.type ?? "",
        question.scoring,
        question.type,
        question.responseType ?? "OTHER",
      );

    // Use LLM to grade the response
    const gradingModel = await this.llmFacadeService.gradePresentationQuestion(
      presentationQuestionEvaluateModel,
      context.assignmentId,
    );

    // Create and populate response DTO
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    // Add presentation-specific metadata
    if (learnerResponse && Array.isArray(learnerResponse)) {
      responseDto.metadata = {
        ...responseDto.metadata,
        presentationType: "LIVE_RECORDING",
        slideCount: learnerResponse.length,
        recordingDuration: this.calculateTotalDuration(learnerResponse),
      };
    }

    return responseDto;
  }

  /**
   * Grade a video presentation
   */
  private async gradePresentation(
    question: QuestionDto,
    learnerResponse: LearnerPresentationResponse,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    // Create evaluation model for the LLM
    const videoPresentationQuestionEvaluateModel =
      new VideoPresentationQuestionEvaluateModel(
        question.question,
        context.questionAnswerContext,
        context.assignmentInstructions,
        learnerResponse,
        question.totalPoints,
        question.scoring?.type ?? "",
        question.scoring,
        question.type,
        question.responseType ?? "OTHER",
        question.videoPresentationConfig,
      );

    // Use LLM to grade the response
    const gradingModel =
      await this.llmFacadeService.gradeVideoPresentationQuestion(
        videoPresentationQuestionEvaluateModel,
        context.assignmentId,
      );

    // Create and populate response DTO
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    // Add presentation-specific metadata
    if (learnerResponse && Array.isArray(learnerResponse)) {
      responseDto.metadata = {
        ...responseDto.metadata,
        presentationType: "VIDEO_PRESENTATION",
        slidesWithVideo: learnerResponse.filter(
          (slide: SlideMetadata) => slide.videoUrl,
        ).length,
        slidesWithAudio: learnerResponse.filter(
          (slide: SlideMetadata) => slide.audioUrl,
        ).length,
        totalSlides: learnerResponse.length,
      };
    }

    return responseDto;
  }

  /**
   * Validate a live recording response
   */
  private validateLiveRecordingResponse(
    response: LearnerPresentationResponse,
  ): boolean {
    if (!response) {
      return false;
    }
  }

  /**
   * Validate a presentation response
   */
  private validatePresentationResponse(
    response: LearnerPresentationResponse,
  ): boolean {
    if (!response) {
      console.log("Invalid presentation response HEREEEEEEE");
      return false;
    }
  }

  /**
   * Calculate the total duration of a presentation
   */
  private calculateTotalDuration(slides: SlideMetadata[]): number {
    if (!slides || !Array.isArray(slides)) {
      return 0;
    }

    return slides.reduce((total, slide) => {
      return total + (slide.duration || 0);
    }, 0);
  }
}
