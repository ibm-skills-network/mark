import { extractAssignmentId } from "@/lib/strings";
import type { GradingData } from "@/config/types";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";
import { withUpdatedAt } from "./middlewares";

type AppActions = {
  DEBUG_MODE: boolean;
  SET_DEBUG_MODE: (debugMode: boolean) => void;
};

export const useAppConfig = createWithEqualityFn<AppActions>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        DEBUG_MODE: false,
        SET_DEBUG_MODE: (debugMode: boolean) => set({ DEBUG_MODE: debugMode }),
      })),
    ),
    {
      name: "appConfig", // Use a static name
      storage:
        typeof window !== "undefined"
          ? createJSONStorage(() => localStorage)
          : undefined,
      partialize(state) {
        return Object.fromEntries(
          Object.entries(state).filter(
            ([_, value]) => typeof value !== "function",
          ),
        );
      },
    },
  ),
);
