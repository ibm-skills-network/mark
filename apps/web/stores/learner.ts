import type { Question } from "@/config/types";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type LearnerState = {
  activeAssignmentID?: number;
};

export type LearnerActions = {
  setActiveAssignmentID: (id: number) => void;
};

export const useLearnerStore = createWithEqualityFn<
  LearnerState & LearnerActions
>(
  (set) => ({
    activeAssignmentID: undefined,
    setActiveAssignmentID: (id) => set({ activeAssignmentID: id }),
  }),
  shallow
);
