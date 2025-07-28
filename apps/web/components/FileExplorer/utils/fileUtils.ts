// Modified fileUtils.ts
import { FileObject } from "@/stores/fileStore";

// Format file size for display (e.g. 1.2 MB)
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};
// Get the file extension from a filename
export const getFileExtension = (fileName: string): string => {
  return fileName.split(".").pop()?.toLowerCase() || "";
};

// Check if a file is previewable
export const isFilePreviewable = (fileName: string): boolean => {
  const extension = getFileExtension(fileName);
  const previewableExtensions = [
    // Images
    "jpg",
    "jpeg",
    "png",
    "gif",
    "svg",
    // Documents
    "pdf",
    "txt",
    "md",
    "csv",
    // Code
    "js",
    "jsx",
    "ts",
    "tsx",
    "html",
    "css",
    "json",
    "py",
    "java",
  ];

  return previewableExtensions.includes(extension);
};

// Build a folder structure from flat file array
export interface FolderStructure {
  name: string;
  path: string;
  files: FileObject[];
  folders: FolderStructure[];
  expanded?: boolean;
  isEmpty?: boolean; // Flag for empty folders
}

// Modified to include empty folders
export const buildFolderStructure = (
  files: FileObject[],
  expandedFolders: string[] = ["/"],
  emptyFolders: string[] = [], // New parameter for empty folders
): FolderStructure => {
  const root: FolderStructure = {
    name: "Root",
    path: "/",
    files: [],
    folders: [],
    expanded: expandedFolders.includes("/"),
  };

  const folderMap: { [fullPath: string]: FolderStructure } = { "/": root };

  // Helper function to ensure folder exists
  const ensureFolderPath = (folderPath: string) => {
    const parts = folderPath.split("/").filter(Boolean);
    let currentPath = "";
    let parentFolder = root;

    parts.forEach((part) => {
      currentPath += "/" + part;

      if (!folderMap[currentPath]) {
        const newFolder: FolderStructure = {
          name: part,
          path: currentPath,
          files: [],
          folders: [],
          expanded: expandedFolders.includes(currentPath),
        };
        folderMap[currentPath] = newFolder;
        parentFolder.folders.push(newFolder);
      }

      parentFolder = folderMap[currentPath];
    });

    return folderMap[folderPath];
  };

  // Add files to their respective folders
  files.forEach((file) => {
    const folderPath = file.path || "/";
    const targetFolder = ensureFolderPath(folderPath);
    targetFolder.files.push(file);
  });

  // Add empty folders
  emptyFolders.forEach((folderPath) => {
    const targetFolder = ensureFolderPath(folderPath);
    targetFolder.isEmpty = true;
  });

  return root;
};

// Find a folder by path in folder structure
export const findFolderByPath = (
  path: string,
  folderStructure: FolderStructure,
): FolderStructure | null => {
  if (folderStructure.path === path) {
    return folderStructure;
  }

  for (const subFolder of folderStructure.folders) {
    const found = findFolderByPath(path, subFolder);
    if (found) return found;
  }

  return null;
};

// Generate breadcrumbs from a path
export interface Breadcrumb {
  name: string;
  path: string;
}

export const getBreadcrumbs = (path: string): Breadcrumb[] => {
  const parts = path.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [{ name: "Root", path: "/" }];
  let currentPath = "";

  parts.forEach((part) => {
    currentPath += "/" + part;
    crumbs.push({ name: part, path: currentPath });
  });

  return crumbs;
};
