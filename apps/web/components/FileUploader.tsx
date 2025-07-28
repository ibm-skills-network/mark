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
import {
  deleteFile,
  generateUploadUrl,
  getFileType,
  uploadWithPresignedUrl,
} from "@/lib/shared"; // Import the new shared functions
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
  maxFileSize?: number;
  acceptedFileTypes?: { [key: string]: string[] };
  multiple?: boolean;
  currentPath?: string;
  showUploadedFiles?: boolean;
  uploadedFiles?: learnerFileResponse[];
  restrictFileTypes?: boolean;
}

const isDevelopment = process.env.NODE_ENV === "development";

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
  maxFileSize = 10 * 1024 * 1024,
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
  const recentFileUploaded = files[files.length - 1];
  const [isUploading, setIsUploading] = useState(false);
  const [showUploaded, setShowUploaded] = useState<boolean>(showUploadedFiles);
  const [existingFiles, setExistingFiles] =
    useState<learnerFileResponse[]>(uploadedFiles);
  const [deleteStatus, setDeleteStatus] = useState<Record<string, string>>({});

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: FileData[] = acceptedFiles.map((orig) => {
      const mimeType = getFileType(orig.name);
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
      fileRejections.forEach((rejection) => {
        console.error(
          `File rejected: ${rejection.file.name} - ${rejection.errors
            .map((err) => err.message)
            .join(", ")}`,
        );
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

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone(dropzoneConfig);

  const handleDeleteFile = async (file: learnerFileResponse) => {
    if (!file.key) {
      console.error("Cannot delete file: missing key");
      return;
    }

    try {
      setDeleteStatus((prev) => ({
        ...prev,
        [file.key]: "deleting",
      }));

      // Use the shared function instead of direct axios call
      await deleteFile(uploadType, undefined, file.key);

      setDeleteStatus((prev) => ({ ...prev, [file.key]: "deleted" }));
      setExistingFiles((prev) => prev.filter((f) => f.key !== file.key));

      if (onDeleteComplete) {
        onDeleteComplete(file.key);
      }
    } catch (error) {
      console.error("Error deleting file:", error);
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
        uploadType,
        context: uploadContext,
      };

      const responseWithPresignedUrl = await generateUploadUrl(uploadRequest);
      if (!responseWithPresignedUrl.presignedUrl) {
        throw new Error("Failed to generate presigned URL");
      }
      const result = await uploadWithPresignedUrl(
        file,
        responseWithPresignedUrl.presignedUrl,
        (ProgressEvent: { loaded: number; total: number }) => {
          const progress = Math.round(
            (ProgressEvent.loaded / ProgressEvent.total) * 100,
          );
          setUploadStatus((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              progress,
              message: `Uploading... ${progress}%`,
            },
          }));
        },
      );
      setUploadStatus((prev) => ({
        ...prev,
        [id]: {
          status: "success",
          message: "Upload complete!",
          progress: 100,
          result,
        },
      }));

      if (onUploadComplete) {
        const formattedFile: learnerFileResponse = {
          filename: responseWithPresignedUrl.fileName,
          content: "InCos",
          fileType: responseWithPresignedUrl.fileType,
          key: responseWithPresignedUrl.key,
          bucket: responseWithPresignedUrl.bucket,
        };
        setExistingFiles((prev) => [...prev, formattedFile]);
        onUploadComplete(formattedFile);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Error uploading file:", error.message);
        setUploadStatus((prev) => ({
          ...prev,
          [id]: {
            status: "error",
            message: error.message,
            progress: 0,
          },
        }));
        onUploadError?.(error, file);
      } else {
        console.error("Error uploading file:", error);
        setUploadStatus((prev) => ({
          ...prev,
          [id]: {
            status: "error",
            message: "An unknown error occurred.",
            progress: 0,
          },
        }));
      }
    }
  };

  useEffect(() => {
    const filesToUpload = files.filter(
      (f) => !uploadStatus[f.id] || uploadStatus[f.id].status === "ready",
    );

    if (filesToUpload.length > 0) {
      setIsUploading(true);

      const selectedFiles = multiple
        ? filesToUpload
        : [filesToUpload[filesToUpload.length - 1]];

      const uploadSequentially = async () => {
        for (const fileData of selectedFiles) {
          await uploadFile(fileData);
        }
        setIsUploading(false);
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

      {recentFileUploaded && (
        <div className="flex-1 mx-4 mt-2">
          <p className="text-right text-sm mb-1">
            {uploadStatus[recentFileUploaded?.id]?.message || "Ready to upload"}
          </p>
          <div className="relative h-1 w-full bg-gray-200 rounded">
            <motion.div
              className={`absolute h-1 rounded ${
                uploadStatus[recentFileUploaded?.id]?.status === "error"
                  ? "bg-red-500"
                  : uploadStatus[recentFileUploaded?.id]?.status === "success"
                    ? "bg-green-500"
                    : "bg-purple-500"
              }`}
              initial={{ width: "0%" }}
              animate={{
                width: `${
                  uploadStatus[recentFileUploaded?.id]?.progress || 0
                }%`,
              }}
              transition={{ duration: 0.5 }}
            ></motion.div>
          </div>
        </div>
      )}

      {/* Previously uploaded files section */}
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
                    {/* File Icon and Details */}
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

                    {/* Delete Button */}
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
