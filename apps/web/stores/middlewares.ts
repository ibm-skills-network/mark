import type { StateCreator, StoreApi } from "zustand";

/**
 * Middleware to update the updatedAt field in a store
 */
export const withUpdatedAt =
  <T extends object & { pageState?: "loading" | "success" | "error" }>(
    config: StateCreator<T>,
  ): StateCreator<T> =>
  (set, get, api: StoreApi<T>) =>
    config(
      (partial, replace) => {
        if (
          typeof partial === "function" ||
          partial?.pageState ||
          get().pageState === "loading"
        ) {
          // revert to the default behavior if it satisfies the above conditions
          return set(partial, replace);
        }
        // Update the `updatedAt` field every time state is updated
        set(
          (_state) => ({
            ...partial,
            updatedAt: new Date().getTime(),
          }),
          replace,
        );
      },
      get,
      api,
    );
