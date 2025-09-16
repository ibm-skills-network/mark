import { withUpdatedAt } from "./middlewares";
import type { GradingData } from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";

type AppActions = {
  DEBUG_MODE: boolean;
  tips: boolean;
  persistTips: boolean;
  setTips: (tips: boolean) => void;
  SET_DEBUG_MODE: (debugMode: boolean) => void;
  setTipsVersion: (newVersion: string) => void;
  setPersistTips: (persistTips: boolean) => void;
};
export const useAppConfig = createWithEqualityFn<
  AppActions & { tipsVersion: string }
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        DEBUG_MODE: false,
        tips: true,
        tipsVersion: "v1.0",
        persistTips: false,
        setPersistTips: (persistTips: boolean) => set({ persistTips }),
        setTips: (tips: boolean) => set({ tips }),
        SET_DEBUG_MODE: (debugMode: boolean) => set({ DEBUG_MODE: debugMode }),
        setTipsVersion: (newVersion: string) => {
          const { tipsVersion, persistTips } = get();
          if (tipsVersion !== newVersion) {
            set({
              tips: true,
              persistTips: false,
              tipsVersion: newVersion,
            });
          }
        },
      })),
    ),
    {
      name: "appConfig",
      storage:
        typeof window !== "undefined"
          ? createJSONStorage(() => localStorage)
          : undefined,
      partialize(state) {
        const { DEBUG_MODE, tips, tipsVersion, persistTips } = state;

        if (persistTips) {
          return { DEBUG_MODE, tips, tipsVersion, persistTips };
        }
        return { DEBUG_MODE, tips: true, tipsVersion, persistTips };
      },
    },
  ),
);
