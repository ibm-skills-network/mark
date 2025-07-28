// stores/fileStore.ts
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { getFileExtension } from "../components/FileExplorer/utils/fileUtils";

export interface FileObject {
  id: string;
  fileName: string;
  fileType: string;
  cosKey: string;
  cosBucket: string;
  fileSize?: number;
  createdAt: string;
  path: string;
  contentType?: string;
  selected?: boolean;
  [key: string]: unknown;
}

export type SortField = "name" | "type" | "size" | "date";
export type SortDirection = "asc" | "desc";
export type ViewMode = "list" | "grid" | "details";

export interface FileStoreState {
  // State
  files: FileObject[];
  selectedFiles: FileObject[];
  expandedFolders: string[];
  sortField: SortField;
  sortDirection: SortDirection;
  searchTerm: string;
  viewMode: ViewMode;
  lastFetchTime: number | null;
  isLoading: boolean;
  error: string | null;
  recentPaths: string[];

  // Actions - Files
  setFiles: (files: FileObject[]) => void;
  addFile: (file: FileObject) => void;
  updateFile: (file: FileObject) => void;
  removeFile: (fileId: string) => void;
  moveFile: (fileId: string, targetPath: string) => void;
  selectFile: (file: FileObject) => void;
  deselectFile: (file: FileObject) => void;
  toggleFileSelection: (file: FileObject) => void;
  clearSelectedFiles: () => void;

  // Actions - Sorting & Filtering
  sortFiles: (field: SortField, direction: SortDirection) => void;
  toggleSortDirection: () => void;
  setSearchTerm: (term: string) => void;
  setViewMode: (mode: ViewMode) => void;

  // Actions - Folders
  toggleFolderExpanded: (path: string) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  addRecentPath: (path: string) => void;

  // Actions - Loading state
  setIsLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  // Utility functions
  setLastFetchTime: (time: number) => void;
  getFilesByFolder: (folderPath: string) => FileObject[];
  getFilesByType: (fileType: string) => FileObject[];
  searchFiles: (term: string) => FileObject[];
}

// Helper function to sort files
const sortFileList = (
  files: FileObject[],
  field: SortField,
  direction: SortDirection,
): FileObject[] => {
  return [...files].sort((a, b) => {
    let comparison = 0;

    switch (field) {
      case "name": {
        comparison = a.fileName.localeCompare(b.fileName);
        break;
      }
      case "type": {
        const typeA = getFileExtension(a.fileName);
        const typeB = getFileExtension(b.fileName);
        comparison = typeA.localeCompare(typeB);
        break;
      }
      case "size": {
        comparison = (a.fileSize || 0) - (b.fileSize || 0);
        break;
      }
      case "date": {
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      }
    }

    return direction === "asc" ? comparison : -comparison;
  });
};

// Create the store
export const useFileStore = create<FileStoreState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        files: [],
        selectedFiles: [],
        expandedFolders: ["/"],
        sortField: "name",
        sortDirection: "asc",
        searchTerm: "",
        viewMode: "list",
        lastFetchTime: null,
        isLoading: false,
        error: null,
        recentPaths: ["/"],

        // File actions
        setFiles: (files) =>
          set({
            files: sortFileList(files, get().sortField, get().sortDirection),
            lastFetchTime: Date.now(),
            isLoading: false,
            error: null,
          }),

        addFile: (file) =>
          set((state) => ({
            files: sortFileList(
              [...state.files, file],
              state.sortField,
              state.sortDirection,
            ),
          })),

        updateFile: (updatedFile) =>
          set((state) => ({
            files: sortFileList(
              state.files.map((file) =>
                file.id === updatedFile.id ? { ...file, ...updatedFile } : file,
              ),
              state.sortField,
              state.sortDirection,
            ),
            // Also update in selectedFiles if present
            selectedFiles: state.selectedFiles.map((file) =>
              file.id === updatedFile.id ? { ...file, ...updatedFile } : file,
            ),
          })),

        removeFile: (fileId) =>
          set((state) => ({
            files: state.files.filter((file) => file.id !== fileId),
            selectedFiles: state.selectedFiles.filter(
              (file) => file.id !== fileId,
            ),
          })),

        moveFile: (fileId, targetPath) =>
          set((state) => {
            const fileToMove = state.files.find((file) => file.id === fileId);

            if (!fileToMove) return state;

            // Calculate new cosKey based on targetPath and filename
            const fileName = fileToMove.fileName;
            const newKey =
              targetPath === "/"
                ? fileName
                : `${targetPath.substring(1)}/${fileName}`;

            // Update the file with new path and key
            const updatedFile = {
              ...fileToMove,
              path: targetPath,
              cosKey: newKey,
            };

            return {
              files: sortFileList(
                state.files.map((file) =>
                  file.id === fileId ? updatedFile : file,
                ),
                state.sortField,
                state.sortDirection,
              ),
              // Also update in selectedFiles if present
              selectedFiles: state.selectedFiles.map((file) =>
                file.id === fileId ? updatedFile : file,
              ),
            };
          }),

        selectFile: (file) =>
          set((state) => {
            // Check if file is already selected
            if (state.selectedFiles.some((f) => f.id === file.id)) {
              return state;
            }
            return { selectedFiles: [...state.selectedFiles, file] };
          }),

        deselectFile: (file) =>
          set((state) => ({
            selectedFiles: state.selectedFiles.filter((f) => f.id !== file.id),
          })),

        toggleFileSelection: (file) =>
          set((state) => {
            const isSelected = state.selectedFiles.some(
              (f) => f.id === file.id,
            );

            if (isSelected) {
              return {
                selectedFiles: state.selectedFiles.filter(
                  (f) => f.id !== file.id,
                ),
              };
            } else {
              return {
                selectedFiles: [...state.selectedFiles, file],
              };
            }
          }),

        clearSelectedFiles: () => set({ selectedFiles: [] }),

        // Sorting & filtering actions
        sortFiles: (field, direction) =>
          set((state) => ({
            sortField: field,
            sortDirection: direction,
            files: sortFileList(state.files, field, direction),
          })),

        toggleSortDirection: () =>
          set((state) => {
            const newDirection = state.sortDirection === "asc" ? "desc" : "asc";
            return {
              sortDirection: newDirection,
              files: sortFileList(state.files, state.sortField, newDirection),
            };
          }),

        setSearchTerm: (term) => set({ searchTerm: term }),

        setViewMode: (mode) => set({ viewMode: mode }),

        // Folder actions
        toggleFolderExpanded: (path) =>
          set((state) => ({
            // Toggle folder expansion state
            expandedFolders: state.expandedFolders.includes(path)
              ? state.expandedFolders.filter((p) => p !== path)
              : [...state.expandedFolders, path],
          })),

        expandFolder: (path) =>
          set((state) => ({
            expandedFolders: state.expandedFolders.includes(path)
              ? state.expandedFolders
              : [...state.expandedFolders, path],
          })),

        collapseFolder: (path) =>
          set((state) => ({
            expandedFolders: state.expandedFolders.filter((p) => p !== path),
          })),

        addRecentPath: (path) =>
          set((state) => {
            const filteredPaths = state.recentPaths.filter((p) => p !== path);
            return {
              recentPaths: [path, ...filteredPaths].slice(0, 5), // Keep max 5 recent paths
            };
          }),

        // Loading state actions
        setIsLoading: (isLoading) => set({ isLoading }),

        setError: (error) => set({ error, isLoading: false }),

        // Utility functions
        setLastFetchTime: (time) => set({ lastFetchTime: time }),

        getFilesByFolder: (folderPath) => {
          return get().files.filter((file) => file.path === folderPath);
        },

        getFilesByType: (fileType) => {
          return get().files.filter((file) => {
            const extension = getFileExtension(file.fileName);
            return extension === fileType.toLowerCase();
          });
        },

        searchFiles: (term) => {
          if (!term.trim()) return [];

          const termLower = term.toLowerCase();
          return get().files.filter(
            (file) =>
              file.fileName.toLowerCase().includes(termLower) ||
              file.path.toLowerCase().includes(termLower),
          );
        },
      }),
      {
        name: "file-storage",
        partialize: (state) => ({
          viewMode: state.viewMode,
          expandedFolders: state.expandedFolders,
          recentPaths: state.recentPaths,
        }),
      },
    ),
  ),
);
