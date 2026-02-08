import { Injectable } from "@nestjs/common";
import {
  CriterionAttempt,
  CriterionGrade,
  JudgeIssue,
  SupportScoreBreakdown,
} from "../types/criterion-evidence.types";

@Injectable()
export class CriterionRetryManagerService {
  computeSupportScore(
    grade: CriterionGrade,
    issues: JudgeIssue[] = [],
  ): SupportScoreBreakdown {
    const evidenceCount = grade.evidence.length;
    const avgRelevance =
      evidenceCount > 0
        ? grade.evidence.reduce((sum, item) => sum + item.relevanceScore, 0) /
          evidenceCount
        : 0;
    const contradictionCount = grade.evidence.filter(
      (item) => item.contradiction,
    ).length;

    const judgePenalty = this.computeJudgePenalty(issues);

    const evidenceScore = Math.min(evidenceCount, 6) / 6;
    const relevanceScore = avgRelevance;
    const contradictionPenalty = contradictionCount * 0.15;

    const supportScore = Math.max(
      0,
      evidenceScore * 0.45 +
        relevanceScore * 0.45 -
        contradictionPenalty -
        judgePenalty,
    );

    return {
      evidenceCount,
      avgRelevance,
      contradictionCount,
      judgePenalty,
      supportScore,
    };
  }

  selectBestAttempt(attempts: CriterionAttempt[]): CriterionAttempt {
    if (attempts.length === 0) {
      throw new Error("No attempts provided for selection");
    }

    return [...attempts].sort(
      (a, b) => b.support.supportScore - a.support.supportScore,
    )[0];
  }

  attachAttempt(
    attempts: CriterionAttempt[],
    grade: CriterionGrade,
    issues: JudgeIssue[],
  ): CriterionAttempt[] {
    const support = this.computeSupportScore(grade, issues);
    return [
      ...attempts,
      {
        attempt: grade.attempt,
        grade,
        support,
        judgeIssues: issues,
      },
    ];
  }

  private computeJudgePenalty(issues: JudgeIssue[]): number {
    if (issues.length === 0) return 0;

    let totalPenalty = 0;
    for (const issue of issues) {
      switch (issue.severity) {
        case "high": {
          totalPenalty += 0.25;
          break;
        }
        case "medium": {
          totalPenalty += 0.15;
          break;
        }
        default: {
          totalPenalty += 0.05;
          break;
        }
      }
    }
    return totalPenalty;
  }
}
