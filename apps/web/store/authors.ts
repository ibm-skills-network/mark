import { create } from "zustand";

// export const AuthorStore = create<AuthorStore>((set, get) => ({
//   authors: [],
//   authorsLoading: false,
//   authorsError: null,
//   getAuthors: async () => {
//     set({ authorsLoading: true, authorsError: null });
//     try {
//       const authors = await getAuthors();
//       set({ authors });
//     } catch (e) {
//       set({ authorsError: e.message });
//     } finally {
//       set({ authorsLoading: false });
//     }
//   },
// }));
