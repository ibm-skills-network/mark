import { Injectable } from "@nestjs/common";
import {
  GradingJudgeInput,
  GradingJudgeResult,
  IGradingJudgeService,
} from "../interfaces/grading-judge.interface";

@Injectable()
export class NoopGradingJudgeService implements IGradingJudgeService {
  async validateGrading(
    _input: GradingJudgeInput,
  ): Promise<GradingJudgeResult> {
    return {
      approved: true,
      feedback: "Judge disabled - auto-approved",
    };
  }
}
