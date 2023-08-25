import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type AuthorState = {
  activeAssignmentID?: number;
};

export type AuthorActions = {
  setActiveAssignmentID: (id: number) => void;
};

export const useAuthorStore = createWithEqualityFn<AuthorState & AuthorActions>(
  (set) => ({
    activeAssignmentID: undefined,
    setActiveAssignmentID: (id) => set({ activeAssignmentID: id }),
  }),
  shallow
);
