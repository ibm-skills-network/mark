import {
  RubricDto,
  ScoringDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { RubricScore } from "src/api/llm/model/file.based.question.response.model";

export interface GradingJudgeInput {
  question: string;
  learnerResponse: string;
  scoringCriteria: ScoringDto;
  proposedGrading: {
    points: number;
    maxPoints: number;
    feedback: string;
    rubricScores?: RubricDto[];
    analysis?: string;
    evaluation?: string;
    explanation?: string;
    guidance?: string;
  };
  assignmentId: number;
}

export interface GradingJudgeResult {
  approved: boolean;
  feedback: string;
  issues?: string[];
  corrections?: {
    points?: number;
    feedback?: string;
    rubricScores?: RubricScore[];
  };
}

export interface IGradingJudgeService {
  validateGrading(input: GradingJudgeInput): Promise<GradingJudgeResult>;
}
