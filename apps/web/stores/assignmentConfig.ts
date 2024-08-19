import { extractAssignmentId } from "@/lib/strings";
import type { Assignment, VerbosityLevels } from "../config/types";
import type { GradingData } from "@/config/types";
import { getAssignment } from "@/lib/talkToBackend";
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
  updatedAt: number;
  setUpdatedAt: (updatedAt: number) => void;
};

export const useAssignmentConfig = createWithEqualityFn<
  GradingData & GradingDataActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        graded: null,
        setGraded: (graded) => set({ graded }),
        numAttempts: -1,
        setNumAttempts: (numAttempts) => set({ numAttempts }),
        passingGrade: 60,
        setPassingGrade: (passingGrade) => set({ passingGrade }),
        timeEstimateMinutes: null,
        setTimeEstimateMinutes: (timeEstimateMinutes) =>
          set({ timeEstimateMinutes }),
        allotedTimeMinutes: null,
        setAllotedTimeMinutes: (allotedTimeMinutes) =>
          set({ allotedTimeMinutes }),
        displayOrder: "DEFINED",
        setDisplayOrder: (displayOrder) => set({ displayOrder }),
        strictTimeLimit: false,
        toggleStrictTimeLimit: () =>
          set((state) => ({ strictTimeLimit: !state.strictTimeLimit })),
        updatedAt: Date.now(),
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
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
