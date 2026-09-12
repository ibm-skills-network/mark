import { withUpdatedAt } from "./middlewares";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";

/**
 * Dismissing the tips panel is remembered for the rest of the browser session.
 * Without this the panel reappeared on every page load and every new attempt,
 * which on a narrow viewport put a sheet between the learner and their answers.
 * "Don't show this again" is the stronger, cross-session preference and lives
 * in localStorage with the rest of the persisted config.
 */
const TIPS_SESSION_DISMISSAL_KEY = "appConfig.tipsDismissedForSession";

function readSessionDismissal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(TIPS_SESSION_DISMISSAL_KEY) === "true";
  } catch (error) {
    // Blocked storage (private mode, embedded webviews) must not break the
    // page; showing tips again is the safe side of this failure.
    console.warn(
      "Could not read the tips dismissal from sessionStorage",
      error,
    );
    return false;
  }
}

function writeSessionDismissal(dismissed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) {
      window.sessionStorage.setItem(TIPS_SESSION_DISMISSAL_KEY, "true");
    } else {
      window.sessionStorage.removeItem(TIPS_SESSION_DISMISSAL_KEY);
    }
  } catch (error) {
    console.warn("Could not store the tips dismissal in sessionStorage", error);
  }
}

type AppActions = {
  DEBUG_MODE: boolean;
  tips: boolean;
  persistTips: boolean;
  /** True once the learner closed tips in this browser session. */
  tipsDismissedForSession: boolean;
  setTips: (tips: boolean) => void;
  SET_DEBUG_MODE: (debugMode: boolean) => void;
  setTipsVersion: (newVersion: string) => void;
  setPersistTips: (persistTips: boolean) => void;
};

type AppConfigState = AppActions & { tipsVersion: string };

export const useAppConfig = createWithEqualityFn<AppConfigState>()(
  persist(
    devtools(
      withUpdatedAt<AppConfigState>((set, get) => ({
        DEBUG_MODE: false,
        tips: !readSessionDismissal(),
        tipsVersion: "v1.0",
        persistTips: false,
        tipsDismissedForSession: readSessionDismissal(),
        setPersistTips: (persistTips: boolean) => set({ persistTips }),
        setTips: (tips: boolean) => {
          writeSessionDismissal(!tips);
          set({ tips, tipsDismissedForSession: !tips });
        },
        SET_DEBUG_MODE: (debugMode: boolean) => set({ DEBUG_MODE: debugMode }),
        setTipsVersion: (newVersion: string) => {
          const { tipsVersion } = get();
          if (tipsVersion !== newVersion) {
            // New tips content is worth showing again, so the session
            // dismissal is retired with the old version.
            writeSessionDismissal(false);
            set({
              tips: true,
              persistTips: false,
              tipsVersion: newVersion,
              tipsDismissedForSession: false,
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
        // Without "don't show this again" tips come back in a later session,
        // so the stored copy stays enabled and the session flag does the
        // remembering.
        return { DEBUG_MODE, tips: true, tipsVersion, persistTips };
      },
      merge(persistedState, currentState) {
        const merged = {
          ...currentState,
          ...(persistedState as Partial<AppConfigState> | undefined),
        };
        // The stored copy is deliberately optimistic about tips; a dismissal
        // already made in this session outranks it.
        if (currentState.tipsDismissedForSession) {
          merged.tips = false;
          merged.tipsDismissedForSession = true;
        }
        return merged;
      },
    },
  ),
);
