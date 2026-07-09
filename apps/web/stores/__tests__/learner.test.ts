import type { Assignment } from "@/config/types";
import { useAssignmentDetails, useLearnerOverviewStore } from "../learner";

const makeDetails = (id: number, name: string) =>
  ({ id, name }) as Assignment;

describe("useLearnerOverviewStore.setAssignmentId", () => {
  beforeEach(() => {
    localStorage.clear();
    useAssignmentDetails.setState({ assignmentDetails: null, grade: null });
  });

  it("clears details held for a different assignment", () => {
    useAssignmentDetails.setState({
      assignmentDetails: makeDetails(3, "Old Assignment"),
      grade: 90,
    });

    useLearnerOverviewStore.getState().setAssignmentId(5);

    expect(useAssignmentDetails.getState().assignmentDetails).toBeNull();
    expect(useAssignmentDetails.getState().grade).toBeNull();
  });

  it("keeps details that match the assignment", () => {
    useAssignmentDetails.setState({
      assignmentDetails: makeDetails(5, "Current Assignment"),
      grade: 80,
    });

    useLearnerOverviewStore.getState().setAssignmentId(5);

    expect(useAssignmentDetails.getState().assignmentDetails?.name).toBe(
      "Current Assignment",
    );
    expect(useAssignmentDetails.getState().grade).toBe(80);
  });
});
