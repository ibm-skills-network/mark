export interface QuestionAnswerContext {
  question: string;
  answer: string;
}

export interface BaseQuestionEvaluateModel {
  readonly previousQuestionsAnswersContext: QuestionAnswerContext[];
  readonly assignmentInstrctions: string;
  /**
   * Hashed learner id for OpenAI safety attribution. Set by the attempt
   * flow after construction; optional because authoring/preview paths
   * have no learner.
   */
  safetyIdentifier?: string;
}
