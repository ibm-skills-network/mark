import type { StateCreator, StoreApi } from "zustand";

/**
 * Middleware to update updatedAt field in a store
 */
export const withUpdatedAt =
  <T extends object>(config: StateCreator<T>): StateCreator<T> =>
  (set, get, api: StoreApi<T>) =>
    config(
      (args) => {
        // if (args instanceof Object && !args?.pageState) {
        set(args);
        set({ updatedAt: Date.now() } as unknown as Partial<T>);
        // }
      },
      get,
      api,
    );
