import { extractAssignmentId } from "@/lib/strings";
import type { GradingData } from "@/config/types";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";
import { withUpdatedAt } from "./middlewares";

type GradingDataActions = {
  setGraded: (graded: boolean) => void;
  setNumAttempts: (numAttempts: number) => void;
  setPassingGrade: (passingGrade: number) => void;
  setTimeEstimateMinutes: (timeEstimateMinutes: number) => void;
  setAllotedTimeMinutes: (allotedTimeMinutes: number) => void;
  setDisplayOrder: (displayOrder: "DEFINED" | "RANDOM") => void;
  toggleStrictTimeLimit: () => void;
  setUpdatedAt: (updatedAt: number) => void;
  setAssignmentConfigStore: (state: Partial<GradingData>) => void;
  setStrictTimeLimit: (strictTimeLimit: boolean) => void;
};

export const useAssignmentConfig = createWithEqualityFn<
  GradingData & GradingDataActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        graded: undefined,
        setGraded: (graded) => set({ graded }),
        numAttempts: -1,
        setNumAttempts: (numAttempts) => set({ numAttempts }),
        passingGrade: 60,
        setPassingGrade: (passingGrade) => set({ passingGrade }),
        timeEstimateMinutes: undefined,
        setTimeEstimateMinutes: (timeEstimateMinutes) =>
          set({ timeEstimateMinutes }),
        allotedTimeMinutes: undefined,
        setAllotedTimeMinutes: (allotedTimeMinutes) =>
          set({ allotedTimeMinutes }),
        displayOrder: "DEFINED",
        setDisplayOrder: (displayOrder) => set({ displayOrder }),
        strictTimeLimit: false,
        toggleStrictTimeLimit: () =>
          set((state) => ({ strictTimeLimit: !state.strictTimeLimit })),
        setStrictTimeLimit: (strictTimeLimit) => set({ strictTimeLimit }),
        updatedAt: undefined,
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
        setAssignmentConfigStore: (state) =>
          set((prevState) => ({ ...prevState, ...state })),
      })),
    ),
    {
      name: getAssignmentConfigName(),
      storage: createJSONStorage(() => localStorage),
      partialize(state) {
        // store everything that is not a function
        return Object.fromEntries(
          Object.entries(state).filter(
            ([_, value]) => typeof value !== "function",
          ),
        );
      },
    },
  ),
);
function getAssignmentConfigName() {
  if (typeof window !== "undefined") {
    return `assignment-${extractAssignmentId(window.location.pathname)}-config`;
  }
  return "assignment-config";
}
