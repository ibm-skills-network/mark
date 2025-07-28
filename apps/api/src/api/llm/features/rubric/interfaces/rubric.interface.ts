import {
  QuestionDto,
  ScoringDto,
  Choice,
  RubricDto,
} from "../../../../assignment/dto/update.questions.request.dto";

export interface IRubricService {
  /**
   * Create a marking rubric for a question
   */
  createMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
    rubricIndex?: number,
  ): Promise<ScoringDto>;

  /**
   * Expand an existing marking rubric with additional criteria
   */
  expandMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<ScoringDto>;

  /**
   * Create answer choices for a choice-based question
   */
  createChoices(question: QuestionDto, assignmentId: number): Promise<Choice[]>;

  /**
   * Check if a rubric is complete
   */
  isRubricComplete(rubric: RubricDto): boolean;
}
