// src/components/FileExplorer/FileExplorer.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconX,
  IconLoader2,
  IconAlertCircle,
  IconMenu2,
  IconBrandCss3,
  IconBrandHtml5,
  IconBrandJavascript,
  IconBrandPython,
  IconFile,
  IconFileCode,
  IconFileDescription,
  IconFileMusic,
  IconFileSpreadsheet,
  IconFileText,
  IconFileZip,
  IconPhoto,
  IconVideo,
} from "@tabler/icons-react";
import axios from "axios";
import {
  SortDirection,
  SortField,
  useFileStore,
  FileObject,
} from "@/stores/fileStore";
import FileUploader from "../FileUploader";
import SearchBar from "./SearchBar";
import Toolbar from "./Toolbar";
import FolderTree from "./FolderTree";
import FileList from "./FileList";
import FilePreview from "./FilePreview";
import RenameDialog from "./RenameDialog";
import SearchResults from "./SearchResults";
import SelectedFilesBar from "./SelectedFilesBar";
import { BreadcrumbNav } from "./BreadcrumbNav";

import { ExtendedFileContent } from "@/app/Helpers/fileReader";

import {
  fetchFileContent,
  createFolder,
  deleteFile,
  deleteFolder,
  downloadFile,
  moveFile,
  renameFile,
} from "./utils/fileActions";
import {
  buildFolderStructure,
  findFolderByPath,
  FolderStructure,
  getBreadcrumbs,
  getFileExtension,
} from "./utils/fileUtils";
import { toast } from "sonner";
import { EnhancedFileObject } from "@/config/types";

export const getFileIcon = (file: FileObject, size = 20) => {
  const extension = getFileExtension(file.fileName);

  switch (extension) {
    case "pdf":
      return <IconFile size={size} className="text-red-500" />;
    case "doc":
    case "docx":
    case "txt":
    case "md":
      return <IconFileText size={size} className="text-purple-500" />;
    case "xls":
    case "xlsx":
    case "csv":
      return <IconFileSpreadsheet size={size} className="text-green-500" />;
    case "zip":
    case "rar":
    case "tar":
    case "gz":
      return <IconFileZip size={size} className="text-purple-500" />;
    case "mp3":
    case "wav":
    case "ogg":
      return <IconFileMusic size={size} className="text-yellow-500" />;
    case "mp4":
    case "avi":
    case "mov":
    case "mkv":
      return <IconVideo size={size} className="text-pink-500" />;
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "svg":
      return <IconPhoto size={size} className="text-amber-500" />;
    case "js":
    case "jsx":
      return <IconBrandJavascript size={size} className="text-yellow-500" />;
    case "ts":
    case "tsx":
      return <IconFileCode size={size} className="text-purple-500" />;
    case "html":
      return <IconBrandHtml5 size={size} className="text-orange-500" />;
    case "css":
      return <IconBrandCss3 size={size} className="text-purple-500" />;
    case "py":
      return <IconBrandPython size={size} className="text-green-500" />;
    case "ppt":
    case "pptx":
      return <IconFileDescription size={size} className="text-orange-500" />;
    default:
      return <IconFile size={size} className="text-gray-500" />;
  }
};

interface FileExplorerProps {
  uploadType: "author" | "learner" | "debug";
  onClose: () => void;
  context?: {
    assignmentId?: number;
    questionId?: number;
    reportId?: number;
    groupId?: string;
    [key: string]: any;
  };
  initialPath?: string;
  onFileSelect?: (files: ExtendedFileContent[]) => void;
  onFileDelete?: (file: FileObject) => void;
  multiSelect?: boolean;
  readOnly?: boolean;
  maxSelectionCount?: number;
  confirmSelectionMode?: boolean;
}

const FileExplorer: React.FC<FileExplorerProps> = ({
  uploadType,
  context = {},
  initialPath = "/",
  onFileSelect,
  onFileDelete,
  multiSelect = false,
  readOnly = false,
  maxSelectionCount = 10,
  confirmSelectionMode = true,
  onClose,
}) => {
  const {
    files,
    setFiles,
    selectedFiles,
    selectFile,
    deselectFile,
    clearSelectedFiles,
    searchTerm,
    setSearchTerm,
    sortField,
    sortDirection,
    sortFiles,
    toggleSortDirection,
    expandedFolders,
    toggleFolderExpanded,
    updateFile,
    removeFile,
    moveFile: moveFileInStore,
  } = useFileStore();

  // Refs
  const fileExplorerRef = useRef<HTMLDivElement>(null);

  // Local component state
  const [fileStructure, setFileStructure] = useState<FolderStructure>({
    name: "Root",
    path: "/",
    files: [],
    folders: [],
    expanded: true,
  });
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);

  // Local selection state for confirmSelectionMode
  const [pendingSelection, setPendingSelection] = useState<FileObject[]>([]);

  // UI state
  const [showUploader, setShowUploader] = useState<boolean>(false);
  const [breadcrumbs, setBreadcrumbs] = useState<
    { name: string; path: string }[]
  >([{ name: "Root", path: "/" }]);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [showSidebar, setShowSidebar] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  // Preview state
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<FileObject | null>(null);
  const [previewContent, setPreviewContent] =
    useState<ExtendedFileContent | null>(null);

  // Rename state
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [renamedFile, setRenameFile] = useState<FileObject | null>(null);

  // Create folder state
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>("");

  // Drag and drop state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [draggedFile, setDraggedFile] = useState<FileObject | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Search state
  const [searchResults, setSearchResults] = useState<FileObject[]>([]);
  const [isSearchActive, setIsSearchActive] = useState<boolean>(false);

  // Error display
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768 && showSidebar) {
        setShowSidebar(false);
      }
    };

    checkIsMobile();
    window.addEventListener("resize", checkIsMobile);

    return () => {
      window.removeEventListener("resize", checkIsMobile);
    };
  }, [showSidebar]);

  const fetchFiles = useCallback(async () => {
    if (files.length > 0) {
      updateFolderStructure();
      setIsLoading(false);
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
      if (context.groupId) params.append("groupId", context.groupId.toString());
      const response = await axios.get(`/api/files/list?${params.toString()}`);

      const rawFiles = Array.isArray(response.data)
        ? (response.data as FileObject[])
        : [];

      let fetchedFiles = rawFiles.map((file) => ({
        ...file,
        path:
          file.path ||
          (file.cosKey
            ? `/${file.cosKey.split("/").slice(0, -1).join("/")}`
            : "/"),
      }));

      fetchedFiles = rawFiles.map((file) => {
        const path =
          file.path ||
          (typeof file.cosKey === "string"
            ? `/${file.cosKey.split("/").slice(0, -1).join("/")}`
            : "/");

        return {
          ...file,
          path,
        };
      });

      setFiles(fetchedFiles);

      const emptyFoldersResponse = await axios.get(
        `/api/files/emptyFolders?${params.toString()}`,
      );
      const fetchedEmptyFolders = Array.isArray(emptyFoldersResponse.data)
        ? (emptyFoldersResponse.data as string[])
        : [];

      setEmptyFolders(fetchedEmptyFolders);

      updateFolderStructure(fetchedFiles, fetchedEmptyFolders);
    } catch (err) {
      console.error("Error fetching files:", err);
      setError("Failed to load files. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [uploadType, context, files, setFiles]);

  const updateFolderStructure = useCallback(
    (filesData = files, emptyFoldersData = emptyFolders) => {
      const structure = buildFolderStructure(
        filesData,
        expandedFolders,
        emptyFoldersData,
      );
      const ensureProperExpandState = (folder: FolderStructure) => {
        const hasContent =
          (folder.folders && folder.folders.length > 0) ||
          (folder.files && folder.files.length > 0) ||
          folder.isEmpty;

        if (!hasContent) {
          folder.expanded = false;
        }
        if (folder.folders) {
          folder.folders.forEach((subFolder) =>
            ensureProperExpandState(subFolder),
          );
        }
        return folder;
      };
      const fixedStructure = ensureProperExpandState(structure);
      setFileStructure(fixedStructure);
      setBreadcrumbs(getBreadcrumbs(currentPath));
    },
    [files, emptyFolders, expandedFolders, currentPath],
  );

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (confirmSelectionMode && selectedFiles.length > 0) {
      setPendingSelection(selectedFiles);
    }
  }, [confirmSelectionMode, selectedFiles]);

  // Handle folder navigation
  const navigateToFolder = (path: string) => {
    setCurrentPath(path);
    setBreadcrumbs(getBreadcrumbs(path));
    setIsSearchActive(false);

    setRecentFolders((prev) => {
      const filtered = prev.filter((p) => p !== path);
      return [path, ...filtered].slice(0, 5); // Keep max 5 recent folders
    });

    if (isMobile && drawerOpen) {
      setDrawerOpen(false);
    }
  };

  const handleToggleFolder = (path: string) => {
    toggleFolderExpanded(path);
    updateFolderStructure();
  };

  const getCurrentFolderContents = useCallback(() => {
    if (isSearchActive) {
      return { files: searchResults, folders: [] };
    }

    const currentFolder = findFolderByPath(currentPath, fileStructure);

    if (!currentFolder) {
      return { files: [], folders: [] };
    }

    return {
      files: currentFolder.files || [],
      folders:
        currentFolder.folders.map((f) => ({ name: f.name, path: f.path })) ||
        [],
    };
  }, [currentPath, fileStructure, isSearchActive, searchResults]);

  const handleFileSelect = async (file: FileObject) => {
    try {
      if (confirmSelectionMode) {
        if (multiSelect) {
          const isSelected = pendingSelection.some((f) => f.id === file.id);

          if (isSelected) {
            setPendingSelection(
              pendingSelection.filter((f) => f.id !== file.id),
            );
          } else {
            if (pendingSelection.length >= maxSelectionCount) {
              setErrorMessage(
                `You can only select up to ${maxSelectionCount} files at once.`,
              );
              setTimeout(() => setErrorMessage(null), 3000);
              return;
            }

            setPendingSelection([...pendingSelection, file]);
          }
        } else {
          setPendingSelection([file]);
        }
      } else {
        if (multiSelect) {
          const isSelected = selectedFiles.some((f) => f.id === file.id);

          if (isSelected) {
            deselectFile(file);
          } else {
            if (selectedFiles.length >= maxSelectionCount && !isSelected) {
              setErrorMessage(
                `You can only select up to ${maxSelectionCount} files at once.`,
              );
              setTimeout(() => setErrorMessage(null), 3000);
              return;
            }
            selectFile(file);
          }

          if (onFileSelect) {
            const currentSelection = isSelected
              ? selectedFiles.filter((f) => f.id !== file.id)
              : [...selectedFiles, file];

            const selectedContents = await Promise.all(
              currentSelection.map((f) =>
                fetchFileContent(f, uploadType, context.questionId),
              ),
            );

            onFileSelect(selectedContents);
          }
        } else {
          clearSelectedFiles();
          selectFile(file);

          if (onFileSelect) {
            try {
              setIsLoading(true);
              const content = await fetchFileContent(
                file,
                uploadType,
                context.questionId,
              );
              onFileSelect([content]);
            } finally {
              setIsLoading(false);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error selecting file:", err);
      setError("Failed to select file. Please try again.");
    }
  };

  const handleConfirmSelection = async () => {
    try {
      if (pendingSelection.length === 0) {
        return;
      }

      setIsLoading(true);

      clearSelectedFiles();

      for (const file of pendingSelection) {
        selectFile(file);
      }

      if (onFileSelect) {
        const selectedContents = await Promise.all(
          pendingSelection.map((f) =>
            fetchFileContent(f, uploadType, context.questionId),
          ),
        );

        onFileSelect(selectedContents);
      }

      onClose();
    } catch (err) {
      console.error("Error confirming file selection:", err);
      setError("Failed to select files. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelSelection = () => {
    setPendingSelection([]);
  };

  const handleFilePreview = async (file: FileObject) => {
    try {
      setPreviewFile(file);
      setIsLoading(true);

      const content = await fetchFileContent(
        file,
        uploadType,
        context.questionId,
      );
      setPreviewContent(content);
      setShowPreview(true);
    } catch (err) {
      console.error("Error previewing file:", err);
      setError("Failed to preview file. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileDownload = async (file: EnhancedFileObject) => {
    try {
      await downloadFile(file, uploadType);
    } catch (err) {
      console.error("Error downloading file:", err);
      setError("Failed to download file. Please try again.");
    }
  };

  const handleFileDelete = async (file: FileObject) => {
    if (
      !window.confirm(`Are you sure you want to delete "${file.fileName}"?`)
    ) {
      return;
    }

    try {
      await deleteFile(file, uploadType);

      deselectFile(file);
      removeFile(file.id);

      if (confirmSelectionMode) {
        setPendingSelection(pendingSelection.filter((f) => f.id !== file.id));
      }

      if (previewFile && previewFile.id === file.id) {
        setShowPreview(false);
        setPreviewFile(null);
        setPreviewContent(null);
      }

      if (onFileDelete) {
        onFileDelete(file);
      }

      updateFolderStructure();

      toast.success("File deleted successfully");
    } catch (err) {
      console.error("Error deleting file:", err);
      setError("Failed to delete file. Please try again.");
    }
  };

  const handleRenameFile = (file: FileObject) => {
    setRenameFile(file);
    setIsRenaming(true);
  };

  const submitRename = async (file: FileObject, newFileName: string) => {
    try {
      const updatedFile = await renameFile(file, newFileName, uploadType);

      updateFile(updatedFile);

      if (previewFile && previewFile.id === file.id) {
        setPreviewFile(updatedFile);
      }

      if (confirmSelectionMode) {
        setPendingSelection(
          pendingSelection.map((f) => (f.id === file.id ? updatedFile : f)),
        );
      }

      updateFolderStructure();

      setIsRenaming(false);
      setRenameFile(null);

      toast.success("File renamed successfully");
    } catch (err) {
      console.error("Error renaming file:", err);
      setError("Failed to rename file. Please try again.");
    }
  };

  const handleCreateFolder = (parentPath?: string) => {
    setCurrentPath(parentPath || currentPath);
    setIsCreatingFolder(true);
  };

  const handleDeleteFolder = async (folderPath: string) => {
    try {
      await deleteFolder(folderPath, uploadType);

      const filesToRemove = files.filter(
        (file) =>
          file.path === folderPath || file.path.startsWith(`${folderPath}/`),
      );

      filesToRemove.forEach((file) => {
        removeFile(file.id);
        if (selectedFiles.some((f) => f.id === file.id)) {
          deselectFile(file);
        }

        if (confirmSelectionMode) {
          setPendingSelection(pendingSelection.filter((f) => f.id !== file.id));
        }
      });

      setEmptyFolders(
        emptyFolders.filter(
          (folder) =>
            folder !== folderPath && !folder.startsWith(`${folderPath}/`),
        ),
      );

      updateFolderStructure();

      if (
        currentPath === folderPath ||
        currentPath.startsWith(`${folderPath}/`)
      ) {
        const parentPath = folderPath.split("/").slice(0, -1).join("/") || "/";
        navigateToFolder(parentPath);
      }

      toast.success(`Folder "${folderPath}" deleted successfully`);
    } catch (err) {
      console.error("Error deleting folder:", err);
      setError("Failed to delete folder. Please try again.");
    }
  };

  const submitCreateFolder = async () => {
    if (!newFolderName || newFolderName.trim() === "") {
      setErrorMessage("Folder name cannot be empty");
      return;
    }

    try {
      await createFolder(newFolderName, currentPath, uploadType, context);

      const newFolderPath =
        currentPath === "/"
          ? `/${newFolderName}`
          : `${currentPath}/${newFolderName}`;

      setEmptyFolders([...emptyFolders, newFolderPath]);

      updateFolderStructure(files, [...emptyFolders, newFolderPath]);

      setNewFolderName("");
      setIsCreatingFolder(false);

      toast.success(`Folder "${newFolderName}" created successfully`);
    } catch (err) {
      console.error("Error creating folder:", err);
      setError("Failed to create folder. Please try again.");
    }
  };

  const handleSearch = (term: string) => {
    setSearchTerm(term);

    if (!term.trim()) {
      setIsSearchActive(false);
      setSearchResults([]);
      return;
    }

    setIsSearchActive(true);

    const termLower = term.toLowerCase();
    const results = files.filter((file) =>
      file.fileName.toLowerCase().includes(termLower),
    );

    setSearchResults(results);
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      const newDirection = sortDirection === "asc" ? "desc" : "asc";
      sortFiles(field, newDirection);
    } else {
      sortFiles(field, "asc");
    }
  };

  const handleFileDragStart = (file: FileObject) => {
    setIsDragging(true);
    setDraggedFile(file);
  };

  const handleFileDragEnd = () => {
    setIsDragging(false);
    setDraggedFile(null);
    setDropTarget(null);
  };

  const handleFolderDragOver = (e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(folderPath);
  };

  const handleFolderDragLeave = () => {
    setDropTarget(null);
  };

  const handleFolderDrop = async (
    e: React.DragEvent,
    targetFolderPath: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDropTarget(null);

    if (!draggedFile) return;

    if (draggedFile.path === targetFolderPath) return;

    try {
      const updatedFile = await moveFile(
        draggedFile,
        targetFolderPath,
        uploadType,
      );

      moveFileInStore(updatedFile.id, targetFolderPath);

      if (
        confirmSelectionMode &&
        pendingSelection.some((f) => f.id === updatedFile.id)
      ) {
        setPendingSelection(
          pendingSelection.map((f) =>
            f.id === updatedFile.id ? { ...f, path: targetFolderPath } : f,
          ),
        );
      }

      updateFolderStructure();

      toast.success("File moved successfully");
    } catch (err) {
      console.error("Error moving file:", err);
      setError("Failed to move file. Please try again.");
    } finally {
      setDraggedFile(null);
    }
  };

  const handleUploadComplete = () => {
    setFiles([]);
    void fetchFiles();
    setShowUploader(false);
  };

  const handlePreviewNext = () => {
    if (!previewFile) return;

    const { files: currentFiles } = getCurrentFolderContents();
    const currentIndex = currentFiles.findIndex(
      (file) => file.id === previewFile.id,
    );

    if (currentIndex === -1 || currentFiles.length <= 1) return;

    const nextIndex = (currentIndex + 1) % currentFiles.length;
    void handleFilePreview(currentFiles[nextIndex]);
  };

  const handlePreviewPrevious = () => {
    if (!previewFile) return;

    const { files: currentFiles } = getCurrentFolderContents();
    const currentIndex = currentFiles.findIndex(
      (file) => file.id === previewFile.id,
    );

    if (currentIndex === -1 || currentFiles.length <= 1) return;

    const prevIndex =
      (currentIndex - 1 + currentFiles.length) % currentFiles.length;
    void handleFilePreview(currentFiles[prevIndex]);
  };

  const handleSortDirectionChange = (direction: SortDirection) => {
    sortFiles(sortField, direction);
  };

  useEffect(() => {
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showPreview) {
          setShowPreview(false);
          setPreviewFile(null);
          setPreviewContent(null);
        } else if (isRenaming) {
          setIsRenaming(false);
          setRenameFile(null);
        } else if (isCreatingFolder) {
          setIsCreatingFolder(false);
          setNewFolderName("");
        } else if (drawerOpen) {
          setDrawerOpen(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleEscapeKey);

    return () => {
      window.removeEventListener("keydown", handleEscapeKey);
    };
  }, [showPreview, isRenaming, isCreatingFolder, drawerOpen, onClose]);

  useEffect(() => {
    if (confirmSelectionMode) {
      setPendingSelection(selectedFiles);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        fileExplorerRef.current &&
        !fileExplorerRef.current.contains(e.target as Node) &&
        !showPreview &&
        !isRenaming &&
        !isCreatingFolder
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose, showPreview, isRenaming, isCreatingFolder]);

  const { files: currentFiles, folders: currentFolders } =
    getCurrentFolderContents();

  const showConfirmationBar =
    confirmSelectionMode && pendingSelection.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 overflow-y-auto py-4">
      <div
        ref={fileExplorerRef}
        className="bg-white p-3 md:p-6 rounded-lg shadow-xl w-full max-w-7xl h-[90vh] overflow-hidden"
      >
        {/* Main error message display */}
        {errorMessage && (
          <div className="absolute top-4 right-4 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-md flex items-center justify-between">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-2">
              <IconX size={18} />
            </button>
          </div>
        )}

        {/* Header */}
        <div className="modal-header flex justify-between items-center mb-4">
          <div className="flex items-center">
            {isMobile && (
              <button
                onClick={() => setDrawerOpen(!drawerOpen)}
                className="mr-2 p-1 rounded-md hover:bg-gray-100"
                aria-label="Toggle menu"
              >
                <IconMenu2 size={24} />
              </button>
            )}
            <h2 className="text-xl font-semibold text-gray-800">
              File Explorer
            </h2>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 focus:outline-none rounded-full hover:bg-gray-100"
              aria-label="Close"
            >
              <IconX size={24} />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="file-explorer bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden h-[calc(100%_-_70px)] flex flex-col">
          {/* Explorer Header */}
          <div className="explorer-header p-3 md:p-4 border-b border-gray-200">
            {/* Navigation and breadcrumbs toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <BreadcrumbNav
                breadcrumbs={breadcrumbs}
                onNavigate={navigateToFolder}
              />

              <Toolbar
                viewMode={viewMode}
                setViewMode={setViewMode}
                onRefresh={fetchFiles}
                onCreateFolder={!readOnly ? handleCreateFolder : undefined}
                onToggleUploader={
                  !readOnly ? () => setShowUploader(!showUploader) : undefined
                }
                onToggleSidebar={() => setShowSidebar(!showSidebar)}
                showSidebar={showSidebar}
                readOnly={readOnly}
              />
            </div>

            {/* Search bar */}
            <SearchBar searchTerm={searchTerm} onSearch={handleSearch} />
          </div>

          {/* Explorer Content Area */}
          <div className="explorer-content flex flex-grow overflow-hidden">
            {/* Mobile Drawer for Folders */}
            <AnimatePresence>
              {isMobile && drawerOpen && (
                <motion.div
                  className="fixed inset-0 z-50 bg-black bg-opacity-50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setDrawerOpen(false)}
                >
                  <motion.div
                    className="absolute top-0 left-0 h-full w-4/5 max-w-xs bg-white overflow-y-auto"
                    initial={{ x: "-100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "-100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                      <h3 className="font-medium">Folders</h3>
                      <button onClick={() => setDrawerOpen(false)}>
                        <IconX size={20} />
                      </button>
                    </div>
                    <div className="p-2">
                      <FolderTree
                        folderStructure={fileStructure}
                        currentPath={currentPath}
                        onFolderClick={(path) => {
                          navigateToFolder(path);
                          setDrawerOpen(false);
                        }}
                        onFileClick={(file) => {
                          void handleFileSelect(file);
                          setDrawerOpen(false);
                        }}
                        onToggleFolder={handleToggleFolder}
                        onCreateFolder={
                          !readOnly
                            ? (path) => {
                                handleCreateFolder(path);
                                setDrawerOpen(false);
                              }
                            : undefined
                        }
                        onDeleteFolder={
                          !readOnly ? handleDeleteFolder : undefined
                        }
                        onUploadToFolder={
                          !readOnly
                            ? (path) => {
                                navigateToFolder(path);
                                setShowUploader(true);
                                setDrawerOpen(false);
                              }
                            : undefined
                        }
                        readOnly={readOnly}
                        dropTarget={dropTarget}
                      />

                      {/* Recent Folders */}
                      {recentFolders.length > 1 && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <h4 className="text-sm font-medium text-gray-500 mb-2">
                            Recent Folders
                          </h4>
                          <ul className="space-y-1">
                            {recentFolders.slice(1).map((path) => (
                              <li key={path}>
                                <button
                                  className="text-sm text-purple-600 hover:underline truncate w-full text-left"
                                  onClick={() => {
                                    navigateToFolder(path);
                                    setDrawerOpen(false);
                                  }}
                                >
                                  {path === "/"
                                    ? "Root"
                                    : path.split("/").pop()}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Sidebar with folder tree (desktop only) */}
            <AnimatePresence>
              {showSidebar && !isMobile && (
                <motion.div
                  className="explorer-sidebar border-r border-gray-200 p-3 overflow-y-auto hidden md:block"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: "260px", opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3 className="text-sm font-medium text-gray-500 mb-2">
                    Folders
                  </h3>
                  <FolderTree
                    folderStructure={fileStructure}
                    currentPath={currentPath}
                    onFolderClick={navigateToFolder}
                    onFileClick={handleFileSelect}
                    onToggleFolder={handleToggleFolder}
                    onCreateFolder={!readOnly ? handleCreateFolder : undefined}
                    onDeleteFolder={!readOnly ? handleDeleteFolder : undefined}
                    onDragStart={!readOnly ? handleFileDragStart : undefined}
                    onDragEnd={handleFileDragEnd}
                    onFolderDragOver={
                      !readOnly ? handleFolderDragOver : undefined
                    }
                    onFolderDragLeave={handleFolderDragLeave}
                    onFolderDrop={!readOnly ? handleFolderDrop : undefined}
                    onUploadToFolder={
                      !readOnly
                        ? (path) => {
                            navigateToFolder(path);
                            setShowUploader(true);
                          }
                        : undefined
                    }
                    readOnly={readOnly}
                    dropTarget={dropTarget}
                  />

                  {/* Recent Folders */}
                  {recentFolders.length > 1 && (
                    <div className="mt-4 pt-2 border-t border-gray-200">
                      <h4 className="text-xs font-medium text-gray-500 mb-1">
                        Recent Folders
                      </h4>
                      <ul className="space-y-1">
                        {recentFolders.slice(1).map((path) => (
                          <li key={path}>
                            <button
                              className="text-xs text-purple-600 hover:underline truncate w-full text-left"
                              onClick={() => navigateToFolder(path)}
                            >
                              {path === "/" ? "Root" : path.split("/").pop()}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main content area */}
            <div className="explorer-main flex-1 p-3 md:p-4 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <IconLoader2 className="animate-spin text-purple-500 mr-2" />
                  <span>Loading files...</span>
                </div>
              ) : error ? (
                <div className="text-red-500 p-4 text-center rounded-lg border border-red-200 bg-red-50">
                  <div className="flex items-center justify-center mb-2">
                    <IconAlertCircle className="text-red-500 mr-2" size={24} />
                    <span className="font-medium">Error</span>
                  </div>
                  <p>{error}</p>
                  <button
                    className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    onClick={() => {
                      setError(null);
                      void fetchFiles();
                    }}
                  >
                    Try Again
                  </button>
                </div>
              ) : isSearchActive ? (
                // Search results
                <SearchResults
                  searchTerm={searchTerm}
                  results={searchResults}
                  selectedFiles={
                    confirmSelectionMode ? pendingSelection : selectedFiles
                  }
                  onFileSelect={handleFileSelect}
                  onNavigateToFolder={navigateToFolder}
                  onPreview={handleFilePreview}
                  onDownload={handleFileDownload}
                  onRename={!readOnly ? handleRenameFile : undefined}
                  onDelete={!readOnly ? handleFileDelete : undefined}
                  readOnly={readOnly}
                />
              ) : (
                // Normal file/folder view
                <FileList
                  files={currentFiles}
                  folders={currentFolders}
                  selectedFiles={
                    confirmSelectionMode ? pendingSelection : selectedFiles
                  }
                  sortField={sortField}
                  sortDirection={sortDirection}
                  viewMode={viewMode}
                  onFileSelect={handleFileSelect}
                  onFolderSelect={navigateToFolder}
                  onPreview={handleFilePreview}
                  onDownload={handleFileDownload}
                  onRename={!readOnly ? handleRenameFile : undefined}
                  onDelete={!readOnly ? handleFileDelete : undefined}
                  onSort={handleSort}
                  onDragStart={!readOnly ? handleFileDragStart : undefined}
                  onDragEnd={handleFileDragEnd}
                  onFolderDragOver={
                    !readOnly ? handleFolderDragOver : undefined
                  }
                  onFolderDragLeave={handleFolderDragLeave}
                  onFolderDrop={!readOnly ? handleFolderDrop : undefined}
                  readOnly={readOnly}
                  dropTarget={dropTarget}
                  onSortDirectionChange={handleSortDirectionChange}
                />
              )}

              {/* File uploader panel */}
              <AnimatePresence>
                {showUploader && (
                  <motion.div
                    className="uploader-panel p-4 border-t border-gray-200 mt-6 rounded-md bg-gray-50"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                  >
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-md font-medium">
                        Upload Files to{" "}
                        {currentPath === "/" ? "Root Folder" : currentPath}
                      </h3>
                      <button
                        className="text-gray-500 hover:text-gray-700"
                        onClick={() => setShowUploader(false)}
                      >
                        <IconX size={20} />
                      </button>
                    </div>
                    <FileUploader
                      key={`file-uploader-${uploadType}-${currentPath}`}
                      uploadType={uploadType}
                      context={{ ...context, path: currentPath }}
                      currentPath={currentPath}
                      onUploadComplete={handleUploadComplete}
                      multiple={true}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Pending Selection Confirmation Bar (for confirm mode) */}
          {showConfirmationBar && (
            <div className="border-t border-gray-300 bg-purple-50 shadow-sm">
              <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center">
                  <span className="font-medium text-purple-700 mr-2">
                    {pendingSelection.length} file(s) selected
                  </span>
                  <span className="text-sm text-purple-600">
                    Click 'Confirm Selection' to proceed with these files
                  </span>
                </div>
                <div className="flex space-x-3">
                  <button
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    onClick={handleCancelSelection}
                  >
                    Cancel Selection
                  </button>
                  <button
                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                    onClick={handleConfirmSelection}
                  >
                    Confirm Selection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Original Selected Files Bar (for non-confirm mode) */}
          {!confirmSelectionMode && selectedFiles.length > 0 && (
            <div className="border-t border-gray-300 bg-gray-50 shadow-sm">
              <SelectedFilesBar
                selectedFiles={selectedFiles}
                onClearSelection={clearSelectedFiles}
                onRemoveFile={deselectFile}
                onDeleteSelected={
                  !readOnly
                    ? () => {
                        if (
                          window.confirm(
                            `Are you sure you want to delete ${selectedFiles.length} selected file(s)?`,
                          )
                        ) {
                          const deletePromises = selectedFiles.map((file) =>
                            deleteFile(file, uploadType),
                          );
                          Promise.all(deletePromises)
                            .then(() => {
                              // Remove all deleted files from store
                              selectedFiles.forEach((file) =>
                                removeFile(file.id),
                              );
                              clearSelectedFiles();
                              updateFolderStructure();
                              toast.success(
                                `${selectedFiles.length} files deleted successfully`,
                              );
                            })
                            .catch((err) => {
                              console.error("Error deleting files:", err);
                              setError(
                                "Failed to delete some files. Please try again.",
                              );
                            });
                        }
                      }
                    : undefined
                }
                onContinue={onClose}
              />
            </div>
          )}
        </div>

        {/* Create Folder Dialog */}
        {isCreatingFolder && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50"
            onClick={() => setIsCreatingFolder(false)}
          >
            <div
              className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-medium mb-4">Create New Folder</h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Folder Name
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Enter folder name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                  autoFocus
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsCreatingFolder(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitCreateFolder}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                  Create Folder
                </button>
              </div>
            </div>
          </div>
        )}

        {/* File Preview Modal */}
        {showPreview && previewFile && previewContent && (
          <FilePreview
            file={{
              ...previewFile,
              size: (previewFile.size as number) ?? 0,
              updatedAt:
                (previewFile.updatedAt as string) ?? new Date().toISOString(),
            }}
            content={
              previewContent
                ? {
                    ...previewContent,
                    questionId:
                      previewContent.questionId !== undefined &&
                      previewContent.questionId !== null
                        ? String(previewContent.questionId)
                        : undefined,
                  }
                : undefined
            }
            onClose={() => {
              setShowPreview(false);
              setPreviewFile(null);
              setPreviewContent(null);
            }}
            onDownload={(file: EnhancedFileObject) => {
              void handleFileDownload(file);
            }}
            onNext={handlePreviewNext}
            onPrevious={handlePreviewPrevious}
            hasNext={currentFiles.length > 1}
            hasPrevious={currentFiles.length > 1}
          />
        )}

        {/* Rename Dialog */}
        {isRenaming && renamedFile && (
          <RenameDialog
            file={renamedFile}
            onRename={submitRename}
            onCancel={() => {
              setIsRenaming(false);
              setRenameFile(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
