import { ExtendedFileContent, readFile } from "@/app/Helpers/fileReader";
import { FileObject, useFileStore } from "@/stores/fileStore";
import axios from "axios";
import { useState, useCallback, useEffect } from "react";

interface UseFileExplorerProps {
  uploadType: "author" | "learner" | "debug";
  context?: {
    assignmentId?: number;
    questionId?: number;
    reportId?: number;
    [key: string]: unknown;
  };
  initialPath?: string;
  autoRefreshInterval?: number;
}

interface FileResponse {
  presignedUrl?: string;
  newKey?: string;
}

interface UseFileExplorerReturn {
  currentPath: string;
  isLoading: boolean;
  error: string | null;
  breadcrumbs: { name: string; path: string }[];

  navigateToFolder: (path: string) => void;
  refreshFiles: () => Promise<void>;
  createFolder: (folderName: string) => Promise<boolean>;
  deleteFile: (file: FileObject) => Promise<boolean>;
  downloadFile: (file: FileObject) => Promise<void>;
  moveFile: (file: FileObject, targetPath: string) => Promise<boolean>;

  getFileContent: (file: FileObject) => Promise<ExtendedFileContent>;

  search: (term: string) => FileObject[];
  filterByType: (fileType: string) => FileObject[];

  getFilesInCurrentFolder: () => FileObject[];
  getFoldersInCurrentFolder: () => string[];
}

export function useFileExplorer({
  uploadType,
  context = {},
  initialPath = "/",
  autoRefreshInterval = 0,
}: UseFileExplorerProps): UseFileExplorerReturn {
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<
    { name: string; path: string }[]
  >([]);

  const { files, setFiles, lastFetchTime, setLastFetchTime } = useFileStore();

  const updateBreadcrumbs = useCallback((path: string) => {
    const parts = path.split("/").filter(Boolean);
    const crumbs = [{ name: "Root", path: "/" }];
    let currentPathSegment = "";
    parts.forEach((part) => {
      currentPathSegment += "/" + part;
      crumbs.push({ name: part, path: currentPathSegment });
    });
    setBreadcrumbs(crumbs);
  }, []);

  const navigateToFolder = useCallback(
    (path: string) => {
      setCurrentPath(path);
      updateBreadcrumbs(path);
    },
    [updateBreadcrumbs],
  );

  const fetchFiles = useCallback(async () => {
    const now = Date.now();
    if (lastFetchTime && now - lastFetchTime < 300000) {
      setIsLoading(false);
      updateBreadcrumbs(currentPath);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append("uploadType", uploadType);

      if (context.assignmentId)
        params.append("assignmentId", context.assignmentId.toString());
      if (context.questionId)
        params.append("questionId", context.questionId.toString());
      if (context.reportId)
        params.append("reportId", context.reportId.toString());

      const response = await axios.get<FileObject[]>(
        `/api/files/list?${params.toString()}`,
      );

      let filesData: FileObject[] = Array.isArray(response.data)
        ? response.data
        : [];

      filesData = filesData.map((file: FileObject) => ({
        ...file,
        path:
          file.path ||
          (file.cosKey
            ? `/${file.cosKey.split("/").slice(0, -1).join("/")}`
            : "/"),
      }));

      setFiles(filesData);
      setLastFetchTime(now);
      updateBreadcrumbs(currentPath);
    } catch (err) {
      console.error("Error fetching files:", err);
      setError("Failed to load files. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [
    uploadType,
    context,
    currentPath,
    lastFetchTime,
    setFiles,
    setLastFetchTime,
    updateBreadcrumbs,
  ]);

  const refreshFiles = useCallback(async () => {
    await fetchFiles();
  }, [fetchFiles]);

  const createFolder = useCallback(
    async (folderName: string): Promise<boolean> => {
      if (!folderName || folderName.trim() === "") {
        return false;
      }

      try {
        await axios.post("/api/files/createFolder", {
          name: folderName,
          path: currentPath,
          uploadType,
          context,
        });

        await fetchFiles();
        return true;
      } catch (err) {
        console.error("Error creating folder:", err);
        setError("Failed to create folder. Please try again.");
        return false;
      }
    },
    [currentPath, uploadType, context, fetchFiles],
  );

  const deleteFile = useCallback(
    async (file: FileObject): Promise<boolean> => {
      if (
        !window.confirm(`Are you sure you want to delete "${file.fileName}"?`)
      ) {
        return false;
      }

      try {
        await axios.delete(
          `/api/files/delete?fileId=${file.id}&uploadType=${
            uploadType
          }&key=${encodeURIComponent(file.cosKey)}`,
        );

        setFiles(files.filter((f: FileObject) => f.id !== file.id));

        return true;
      } catch (err) {
        console.error("Error deleting file:", err);
        setError("Failed to delete file. Please try again.");
        return false;
      }
    },
    [files, uploadType, setFiles],
  );

  const downloadFile = useCallback(
    async (file: FileObject): Promise<void> => {
      try {
        const response = await axios.get<FileResponse>(
          `/api/files/getFileUrl?fileId=${file.id}&uploadType=${
            uploadType
          }&key=${encodeURIComponent(file.cosKey)}`,
          { withCredentials: true },
        );

        if (response.data.presignedUrl) {
          window.open(response.data.presignedUrl, "_blank");
        } else {
          throw new Error("Failed to get download URL");
        }
      } catch (err) {
        console.error("Error downloading file:", err);
        setError("Failed to download file. Please try again.");
      }
    },
    [uploadType],
  );

  const moveFile = useCallback(
    async (file: FileObject, targetPath: string): Promise<boolean> => {
      try {
        const response = await axios.put<FileResponse>("/api/files/move", {
          fileId: file.id,
          uploadType,
          sourceKey: file.cosKey,
          targetPath,
          bucket: file.cosBucket,
        });

        const newFiles = files.map((f: FileObject) => {
          if (f.id === file.id) {
            const fileName = f.fileName;
            const newCosKey =
              targetPath === "/"
                ? fileName
                : `${targetPath.substring(1)}/${fileName}`;

            return {
              ...f,
              path: targetPath,
              cosKey: response.data.newKey || newCosKey,
            };
          }
          return f;
        });

        setFiles(newFiles);
        return true;
      } catch (err) {
        console.error("Error moving file:", err);
        setError("Failed to move file. Please try again.");
        return false;
      }
    },
    [files, uploadType, setFiles],
  );

  const getFileContent = useCallback(
    async (file: FileObject): Promise<ExtendedFileContent> => {
      const urlResponse = await axios.get<FileResponse>(
        `/api/files/getFileUrl?fileId=${file.id}&uploadType=${
          uploadType
        }&key=${encodeURIComponent(file.cosKey)}`,
        { withCredentials: true },
      );

      const presignedUrl = urlResponse.data.presignedUrl;
      if (!presignedUrl) {
        throw new Error(
          `Presigned URL not available for file: ${file.fileName}`,
        );
      }

      const fileResponse = await fetch(presignedUrl);
      const blob = await fileResponse.blob();
      const fileObj = new File([blob], file.fileName, {
        type: file.contentType || file.fileType,
      });

      const questionId = context.questionId || 0;
      const fileContent: ExtendedFileContent = await readFile(
        fileObj,
        questionId,
      );
      fileContent.blob = blob;
      fileContent.url = URL.createObjectURL(blob);

      return fileContent;
    },
    [uploadType, context],
  );

  const search = useCallback(
    (term: string): FileObject[] => {
      if (!term.trim()) return [];

      const searchTermLower = term.toLowerCase();
      return files.filter((file: FileObject) => {
        const fileNameMatch = file.fileName
          .toLowerCase()
          .includes(searchTermLower);
        const pathMatch =
          file.path && file.path.toLowerCase().includes(searchTermLower);
        return fileNameMatch || pathMatch;
      });
    },
    [files],
  );

  const filterByType = useCallback(
    (fileType: string): FileObject[] => {
      if (!fileType) return files;

      return files.filter((file: FileObject) => {
        const fileNameParts = file.fileName.split(".");
        const extension =
          fileNameParts.length > 1 ? fileNameParts.pop()?.toLowerCase() : "";
        return fileType === extension;
      });
    },
    [files],
  );

  const getFilesInCurrentFolder = useCallback((): FileObject[] => {
    return files.filter((file: FileObject) => file.path === currentPath);
  }, [files, currentPath]);

  const getFoldersInCurrentFolder = useCallback((): string[] => {
    const subFolders = new Set<string>();

    files.forEach((file: FileObject) => {
      if (
        file.path &&
        file.path.startsWith(currentPath) &&
        file.path !== currentPath
      ) {
        const relativePath = file.path.slice(currentPath.length);
        const pathParts = relativePath.split("/");
        const nextSegment = pathParts.length > 1 ? pathParts[1] : "";

        if (nextSegment) {
          const fullSubfolderPath = `${currentPath}${
            currentPath.endsWith("/") ? "" : "/"
          }${nextSegment}`;
          subFolders.add(fullSubfolderPath);
        }
      }
    });

    return Array.from(subFolders);
  }, [files, currentPath]);

  useEffect(() => {
    void fetchFiles();

    if (autoRefreshInterval > 0) {
      const intervalId = setInterval(() => {
        void fetchFiles();
      }, autoRefreshInterval);

      return () => clearInterval(intervalId);
    }
  }, [fetchFiles, autoRefreshInterval]);

  return {
    currentPath,
    isLoading,
    error,
    breadcrumbs,

    navigateToFolder,
    refreshFiles,
    createFolder,
    deleteFile,
    downloadFile,
    moveFile,

    getFileContent,

    search,
    filterByType,

    getFilesInCurrentFolder,
    getFoldersInCurrentFolder,
  };
}
