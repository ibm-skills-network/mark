import React, { useState, useCallback, useEffect } from "react";
import { DropzoneOptions, useDropzone } from "react-dropzone";
import { motion } from "framer-motion";
import {
  IconCloudUpload,
  IconFile,
  IconTrash,
  IconLoader2,
} from "@tabler/icons-react";
import { formatFileSize } from "./FileExplorer/utils/fileUtils";
import { learnerFileResponse } from "@/stores/learner";
import { deleteFile, uploadFileToStorage } from "@/lib/shared";
import { UploadType, UploadContext, UploadRequest } from "@/config/types";
import { toast } from "sonner";
interface FileData {
  file: File;
  id: string;
  status: string;
  progress: number;
}

interface UploadStatus {
  status: string;
  message: string;
  progress: number;
  recordId?: number;
}

interface FileUploaderProps {
  uploadType: UploadType;
  context?: UploadContext;
  onUploadComplete?: (fileData: learnerFileResponse) => void;
  onUploadError?: (error: unknown, file: File) => void;
  onDeleteComplete?: (key: string) => void;
  onUploadStateChange?: (isUploading: boolean) => void;
  maxFileSize?: number;
  acceptedFileTypes?: { [key: string]: string[] };
  multiple?: boolean;
  currentPath?: string;
  showUploadedFiles?: boolean;
  uploadedFiles?: learnerFileResponse[];
  restrictFileTypes?: boolean;
}

/**
 * A reusable file uploader component that handles file uploads to IBM Cloud Object Storage
 * with multiple upload strategies depending on the environment and file type
 */
const FileUploader: React.FC<FileUploaderProps> = ({
  uploadType,
  context = {},
  onUploadComplete,
  onUploadError,
  onDeleteComplete,
  onUploadStateChange,
  maxFileSize = 100 * 1024 * 1024,
  acceptedFileTypes = {},
  multiple = false,
  currentPath,
  showUploadedFiles = false,
  uploadedFiles = [],
  restrictFileTypes = true,
}) => {
  const [files, setFiles] = useState<FileData[]>([]);
  const [uploadStatus, setUploadStatus] = useState<
    Record<string, UploadStatus>
  >({});
  const [isUploading, setIsUploading] = useState(false);
  const [showUploaded, setShowUploaded] = useState<boolean>(showUploadedFiles);
  const [existingFiles, setExistingFiles] =
    useState<learnerFileResponse[]>(uploadedFiles);
  const [deleteStatus, setDeleteStatus] = useState<Record<string, string>>({});

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: FileData[] = acceptedFiles.map((orig) => {
      const file = orig;
      return {
        file,
        id: `${orig.name}-${Date.now()}`,
        status: "ready",
        progress: 0,
      };
    });
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);
  const fileValidator = (file: File) => {
    if (!acceptedFileTypes || Object.keys(acceptedFileTypes).length === 0) {
      return null;
    }
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const allowed = Object.values(acceptedFileTypes).flat();
    if (!allowed.includes(ext)) {
      toast.error(
        `Invalid file type: ${ext}. Recommended types: ${allowed.join(", ")}`,
        {
          duration: 5000,
          position: "bottom-left",
        },
      );
      return {
        code: "file-invalid-type",
        message: `Recommended types: ${allowed.join(", ")}. You chose: ${ext}`,
      };
    }

    return null;
  };

  const dropzoneConfig: DropzoneOptions = {
    onDrop,
    maxSize: maxFileSize,
    multiple,
    disabled: isUploading,
    noClick: isUploading,
    noKeyboard: isUploading,
    noDrag: isUploading,
    noDragEventsBubbling: isUploading,
    validator: fileValidator,
    accept: {},
    maxFiles: multiple ? undefined : 1,
    onDropRejected: (fileRejections) => {
      // File rejections are handled by the validator callback
      // This handler is kept to prevent default dropzone behavior
      fileRejections.forEach(() => {
        // No action needed - validation errors shown via validator
      });
    },
  };

  if (
    restrictFileTypes &&
    acceptedFileTypes &&
    typeof acceptedFileTypes === "object" &&
    !Array.isArray(acceptedFileTypes) &&
    Object.keys(acceptedFileTypes).length > 0
  ) {
    dropzoneConfig.accept = acceptedFileTypes;
  } else {
    dropzoneConfig.validator = fileValidator;
  }

  const { getRootProps, getInputProps, isDragActive } =
    useDropzone(dropzoneConfig);

  const handleDeleteFile = async (file: learnerFileResponse) => {
    if (!file.key) {
      return;
    }

    try {
      setDeleteStatus((prev) => ({
        ...prev,
        [file.key]: "deleting",
      }));

      await deleteFile(uploadType, undefined, file.key);

      setDeleteStatus((prev) => ({ ...prev, [file.key]: "deleted" }));
      setExistingFiles((prev) => prev.filter((f) => f.key !== file.key));

      if (onDeleteComplete) {
        onDeleteComplete(file.key);
      }
    } catch (error) {
      setDeleteStatus((prev) => ({ ...prev, [file.key]: "error" }));
    }
  };

  const uploadFile = async (fileData: FileData) => {
    const { file, id } = fileData;

    try {
      setUploadStatus((prev) => ({
        ...prev,
        [id]: {
          status: "uploading",
          message: "Uploading file...",
          progress: 0,
        },
      }));

      const uploadContext = {
        ...context,
        path: currentPath || context.path || "/",
      };
      const uploadRequest: UploadRequest = {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadType,
        context: uploadContext,
      };

      const uploadedFile = await uploadFileToStorage(file, uploadRequest, {
        onUploadProgress: (ProgressEvent: {
          loaded: number;
          total: number;
        }) => {
          const progress = Math.round(
            (ProgressEvent.loaded / ProgressEvent.total) * 100,
          );
          setUploadStatus((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              status: "uploading",
              progress,
              message: `Uploading... ${progress}%`,
            },
          }));
        },
        onWaitingForCapacity: () => {
          setUploadStatus((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              status: "waiting",
              message: "Waiting to upload…",
            },
          }));
        },
      });
      setUploadStatus((prev) => ({
        ...prev,
        [id]: {
          status: "success",
          message: "Upload complete!",
          progress: 100,
          result: uploadedFile,
        },
      }));

      if (onUploadComplete) {
        const formattedFile: learnerFileResponse = {
          filename: uploadedFile.fileName,
          content: "InCos",
          fileType: uploadedFile.fileType,
          key: uploadedFile.key,
          bucket: uploadedFile.bucket,
        };
        setExistingFiles((prev) => [...prev, formattedFile]);
        onUploadComplete(formattedFile);
      }
    } catch (error: unknown) {
      const { UploadError } = await import("@/lib/reliableUpload");
      const userMessage =
        error instanceof UploadError
          ? error.userMessage
          : error instanceof Error
            ? error.message
            : "An unknown error occurred.";
      setUploadStatus((prev) => ({
        ...prev,
        [id]: {
          status: "error",
          message: userMessage,
          progress: 0,
        },
      }));
      if (error instanceof Error) {
        onUploadError?.(error, file);
      }
    }
  };

  useEffect(() => {
    const filesToUpload = files.filter(
      (f) => !uploadStatus[f.id] || uploadStatus[f.id].status === "ready",
    );

    if (filesToUpload.length > 0) {
      setIsUploading(true);
      onUploadStateChange?.(true);

      const selectedFiles = multiple
        ? filesToUpload
        : [filesToUpload[filesToUpload.length - 1]];

      const uploadSequentially = async () => {
        for (const fileData of selectedFiles) {
          await uploadFile(fileData);
        }
        setIsUploading(false);
        onUploadStateChange?.(false);
      };

      void uploadSequentially();
    }
  }, [files, multiple, uploadStatus]);

  useEffect(() => {
    if (uploadedFiles && uploadedFiles.length > 0) {
      setExistingFiles(uploadedFiles);
    }
  }, [uploadedFiles]);

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={`w-full ${
          isUploading ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <motion.div
          whileHover={{ scale: isUploading ? 1 : 1.02 }}
          className={`flex flex-col items-center justify-center border-2 border-dashed p-6 rounded-md transition-colors ${
            isDragActive ? "border-purple-500 bg-purple-50" : "border-gray-300"
          }`}
        >
          <input {...getInputProps()} disabled={isUploading} />
          <IconCloudUpload size={50} className="text-gray-500 mb-4" />
          {isDragActive ? (
            <p className="text-purple-500">Drop the files here...</p>
          ) : isUploading ? (
            <p className="text-gray-500">Upload in progress...</p>
          ) : (
            <>
              <p className="text-gray-500">
                Drag & drop files here, or click to select files.
              </p>
              {Object.keys(acceptedFileTypes).length > 0 && (
                <p className="text-gray-500 text-sm mt-2">
                  Allowed file types:{" "}
                  {Object.values(acceptedFileTypes).flat().join(", ")}
                </p>
              )}
              <p className="text-gray-500 text-sm">
                Maximum file size: {formatFileSize(maxFileSize)}
              </p>
            </>
          )}
        </motion.div>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-3">
          {files.map((fileData) => {
            const status = uploadStatus[fileData.id];
            if (!status || status.status === "success") return null;

            return (
              <motion.div
                key={fileData.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={`
                      flex items-center justify-center w-10 h-10 rounded-full
                      ${
                        status.status === "error"
                          ? "bg-red-100"
                          : status.status === "waiting"
                            ? "bg-amber-100"
                            : "bg-purple-100"
                      }
                    `}
                    >
                      {status.status === "uploading" ? (
                        <IconLoader2
                          size={20}
                          className="text-purple-600 animate-spin"
                        />
                      ) : status.status === "waiting" ? (
                        <IconLoader2
                          size={20}
                          className="text-amber-600 animate-spin"
                        />
                      ) : status.status === "error" ? (
                        <IconFile size={20} className="text-red-600" />
                      ) : (
                        <IconFile size={20} className="text-gray-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {fileData.file.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatFileSize(fileData.file.size)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`
                    text-sm font-semibold px-3 py-1 rounded-full
                    ${
                      status.status === "error"
                        ? "bg-red-100 text-red-700"
                        : status.status === "uploading"
                          ? "bg-purple-100 text-purple-700"
                          : status.status === "waiting"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-700"
                    }
                  `}
                  >
                    {status.status === "waiting" ? "…" : `${status.progress}%`}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="relative h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className={`absolute h-full rounded-full ${
                      status.status === "error"
                        ? "bg-red-500"
                        : status.status === "success"
                          ? "bg-green-500"
                          : status.status === "waiting"
                            ? "bg-amber-400"
                            : "bg-gradient-to-r from-purple-500 to-purple-600"
                    }`}
                    initial={{ width: "0%" }}
                    animate={{
                      width:
                        status.status === "waiting"
                          ? "100%"
                          : `${status.progress}%`,
                    }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  >
                    {/* Shimmer effect for active uploads */}
                    {status.status === "uploading" && (
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                        animate={{ x: ["-100%", "200%"] }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                      />
                    )}
                  </motion.div>
                </div>

                {/* Status message */}
                <p
                  className={`
                  text-xs mt-2
                  ${
                    status.status === "error"
                      ? "text-red-600"
                      : status.status === "waiting"
                        ? "text-amber-700"
                        : "text-gray-600"
                  }
                `}
                >
                  {status.message}
                </p>
              </motion.div>
            );
          })}
        </div>
      )}

      {existingFiles.length > 0 && (
        <div className="mt-6 w-full">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-md font-medium">Uploaded Files</h3>
            <button
              onClick={() => setShowUploaded(!showUploaded)}
              className="text-purple-500 text-sm hover:text-purple-700"
            >
              {showUploaded ? "Hide" : "Show"} ({existingFiles.length})
            </button>
          </div>

          {showUploaded && (
            <ul className="space-y-3">
              {existingFiles.map((file) => (
                <motion.li
                  key={file.key || file.filename}
                  className="flex flex-col border-gray-300 border rounded-md px-4 py-3 hover:shadow-md"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center justify-between space-x-3 px-4">
                    <div className="flex items-center space-x-3">
                      <IconFile size={32} className="text-gray-500" />
                      <div>
                        <p className="text-gray-700 font-medium text-left">
                          {file.filename}
                        </p>
                        <p className="text-xs text-gray-500 truncate max-w-xs">
                          {file.key}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {deleteStatus[file.key] === "deleting" ? (
                        <IconLoader2
                          size={20}
                          className="text-purple-500 animate-spin"
                        />
                      ) : (
                        <button
                          className="text-red-500 hover:text-red-600"
                          onClick={() => handleDeleteFile(file)}
                          aria-label={`Delete file ${file.filename}`}
                          disabled={deleteStatus[file.key] === "deleting"}
                        >
                          <IconTrash size={20} />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUploader;
