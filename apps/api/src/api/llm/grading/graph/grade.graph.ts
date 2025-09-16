import { SimpleGradingGraph } from "./simple-graph";
import {
  GradingGraphState,
  shouldRunJudgeA,
  shouldRunJudgeB,
  shouldRunTiebreak,
} from "./state";

type NodeFunction = (state: GradingGraphState) => Promise<GradingGraphState>;

export class GradingGraph {
  private graph: SimpleGradingGraph;

  constructor(
    private gradeNode: NodeFunction,
    private validateNode: NodeFunction,
    private judgeANode: NodeFunction,
    private evidenceNode: NodeFunction,
    private compareNode: NodeFunction,
    private decisionNode: NodeFunction,
  ) {
    this.graph = new SimpleGradingGraph();
    this.buildGraph();
  }

  private buildGraph() {
    this.graph
      .addNode("grade", this.gradeNode)
      .addNode("validate", this.validateNode)
      .addNode("judgeA", this.judgeANode)
      .addNode("evidence", this.evidenceNode)
      .addNode("compare", this.compareNode)
      .addNode("decision", this.decisionNode);

    this.graph.setEntryPoint("grade");

    this.graph.addEdge("grade", "validate");

    this.graph.addConditionalEdges(
      "validate",
      this.shouldContinueFromValidate,
      {
        evidence: "evidence",
        retry_grade: "grade",
        error: "END",
      },
    );

    this.graph.addConditionalEdges("evidence", this.shouldRunJudges, {
      judgeA: "judgeA",
      decision: "decision",
    });

    this.graph.addConditionalEdges("judgeA", this.shouldRunJudgeBConditional, {
      judgeB: "judgeB",
      compare: "compare",
    });

    this.graph.addEdge("judgeB", "compare");

    this.graph.addConditionalEdges(
      "compare",
      this.shouldRunTiebreakConditional,
      {
        tiebreak: "tiebreak",
        decision: "decision",
      },
    );

    this.graph.addEdge("tiebreak", "decision");
    this.graph.addEdge("decision", "END");
  }

  private shouldContinueFromValidate = (state: GradingGraphState): string => {
    if (!state.shouldContinue) {
      return "error";
    }

    if (!state.graderResult?.isValid && state.retry_count < 2) {
      return "retry_grade";
    }

    return "evidence";
  };

  private shouldRunJudges = (state: GradingGraphState): string => {
    if (shouldRunJudgeA(state)) {
      return "judgeA";
    }

    return "decision";
  };

  private shouldRunJudgeBConditional = (state: GradingGraphState): string => {
    if (shouldRunJudgeB(state)) {
      return "judgeB";
    }

    return "compare";
  };

  private shouldRunTiebreakConditional = (state: GradingGraphState): string => {
    if (shouldRunTiebreak(state)) {
      return "tiebreak";
    }

    return "decision";
  };

  compile() {
    return this.graph.compile();
  }
}
