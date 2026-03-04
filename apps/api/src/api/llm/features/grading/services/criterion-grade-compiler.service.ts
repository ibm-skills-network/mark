import { Injectable } from "@nestjs/common";
import {
  CriterionGrade,
  GradeSummary,
  GradeSummarySchema,
} from "../types/criterion-evidence.types";

@Injectable()
export class CriterionGradeCompilerService {
  compile(criteria: CriterionGrade[]): GradeSummary {
    const totalPoints = criteria.reduce(
      (sum, grade) => sum + grade.pointsAwarded,
      0,
    );
    const maxPoints = criteria.reduce((sum, grade) => sum + grade.maxPoints, 0);
    const allCitations = criteria.flatMap((grade) => grade.citations);
    const allRationales = criteria.map((grade) => grade.rationale);

    const summary: GradeSummary = {
      totalPoints,
      maxPoints,
      criteria,
      allCitations,
      allRationales,
      compiledAt: new Date().toISOString(),
    };

    GradeSummarySchema.parse(summary);

    return summary;
  }
}
