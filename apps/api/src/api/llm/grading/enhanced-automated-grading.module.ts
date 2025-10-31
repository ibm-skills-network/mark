import { Module } from "@nestjs/common";
import { CompareNode } from "./nodes/compare.node";
import { DecisionNode } from "./nodes/decision.node";
import { EnhancedGradeNode } from "./nodes/enhanced-grade.node";
import { EnhancedValidateNode } from "./nodes/enhanced-validate.node";
import { EvidenceNode } from "./nodes/evidence.node";
import { JudgeNode } from "./nodes/judge.node";
import { TiebreakNode } from "./nodes/tiebreak.node";
import { EnhancedAutomatedGradingService } from "./services/enhanced-automated-grading.service";
import { EnhancedPolicyService } from "./services/enhanced-policy.service";
import { EvidenceService } from "./services/evidence.service";
import { MetaDeciderService } from "./services/meta-decider.service";
import { MonitoringService } from "./services/monitoring.service";

@Module({
  providers: [
    EnhancedAutomatedGradingService,

    EvidenceService,
    EnhancedPolicyService,
    MetaDeciderService,
    MonitoringService,

    EnhancedGradeNode,
    EnhancedValidateNode,
    JudgeNode,
    EvidenceNode,
    CompareNode,
    TiebreakNode,
    DecisionNode,
  ],
  exports: [
    EnhancedAutomatedGradingService,
    EvidenceService,
    EnhancedPolicyService,
    MonitoringService,
  ],
})
export class EnhancedAutomatedGradingModule {}
