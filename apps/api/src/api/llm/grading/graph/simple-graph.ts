import { GradingGraphState } from "./state";

type NodeFunction = (state: GradingGraphState) => Promise<GradingGraphState>;
type ConditionalFunction = (state: GradingGraphState) => string;

interface GraphEdge {
  from: string;
  to: string | ConditionalFunction;
  conditions?: Record<string, string>;
}

export class SimpleGradingGraph {
  private nodes = new Map<string, NodeFunction>();
  private edges: GraphEdge[] = [];
  private entryPoint = "";

  addNode(name: string, nodeFunction: NodeFunction): this {
    this.nodes.set(name, nodeFunction);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.push({ from, to });
    return this;
  }

  addConditionalEdges(
    from: string,
    condition: ConditionalFunction,
    routes: Record<string, string>,
  ): this {
    this.edges.push({ from, to: condition, conditions: routes });
    return this;
  }

  setEntryPoint(nodeName: string): this {
    this.entryPoint = nodeName;
    return this;
  }

  compile(): {
    invoke: (state: GradingGraphState) => Promise<GradingGraphState>;
  } {
    return {
      invoke: async (
        initialState: GradingGraphState,
      ): Promise<GradingGraphState> => {
        let currentState = initialState;
        let currentNode = this.entryPoint;
        const visitedNodes = new Set<string>();
        const maxIterations = 20;
        let iteration = 0;

        while (
          currentNode &&
          currentNode !== "END" &&
          iteration < maxIterations
        ) {
          iteration++;

          const nodeFunction = this.nodes.get(currentNode);
          if (!nodeFunction) {
            throw new Error(`Node '${currentNode}' not found`);
          }

          const nodeKey = `${currentNode}_${iteration}`;
          if (visitedNodes.has(nodeKey)) {
            break;
          }
          visitedNodes.add(nodeKey);

          try {
            currentState = await nodeFunction(currentState);

            if (!currentState.shouldContinue) {
              break;
            }
          } catch (error) {
            currentState = {
              ...currentState,
              errors: [
                ...currentState.errors,
                `Node ${currentNode} failed: ${String(error)}`,
              ],
              shouldContinue: false,
            };
            break;
          }

          currentNode = this.getNextNode(currentNode, currentState);
        }

        return currentState;
      },
    };
  }

  private getNextNode(currentNode: string, state: GradingGraphState): string {
    const edge = this.edges.find((edgeItem) => edgeItem.from === currentNode);
    if (!edge) {
      return "END";
    }

    if (typeof edge.to === "string") {
      return edge.to;
    }

    if (typeof edge.to === "function" && edge.conditions) {
      const condition = edge.to(state);
      return edge.conditions[condition] ?? "END";
    }

    return "END";
  }
}
