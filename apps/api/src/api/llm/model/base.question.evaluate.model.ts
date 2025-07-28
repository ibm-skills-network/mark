export interface QuestionAnswerContext {
  question: string;
  answer: string;
}

export interface BaseQuestionEvaluateModel {
  readonly previousQuestionsAnswersContext: QuestionAnswerContext[];
  readonly assignmentInstrctions: string;
}
