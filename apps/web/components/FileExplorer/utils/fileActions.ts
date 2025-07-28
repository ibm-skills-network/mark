// src/components/FileExplorer/utils/fileActions.ts
import axios, { AxiosProgressEvent } from "axios";
import { FileObject } from "@/stores/fileStore";
import { ExtendedFileContent, readFile } from "@/app/Helpers/fileReader";
import { toast } from "sonner";
import { EnhancedFileObject } from "@/config/types";

// Type definitions for responses
interface PresignedUrlResponse {
  presignedUrl: string;
  bucket?: string;
  key?: string;
}

interface FileOperationResponse {
  newKey?: string;
  success: boolean;
  message?: string;
  recordId?: number;
}

interface UploadContext {
  path?: string;
  assignmentId?: number;
  questionId?: number;
  [key: string]: unknown;
}

// Error handling type guard
function isAxiosError(error: unknown): error is {
  response?: {
    data?: {
      error?: string;
    };
  };
  message?: string;
} {
  return typeof error === "object" && error !== null && "message" in error;
}

// Fetch file content for preview or download
export const fetchFileContent = async (
  file: FileObject,
  uploadType: string,
  questionId?: number,
): Promise<ExtendedFileContent> => {
  try {
    const urlResponse = await axios.get<PresignedUrlResponse>(
      `/api/files/getFileUrl?fileId=${
        file.id
      }&uploadType=${uploadType}&key=${encodeURIComponent(file.cosKey)}`,
      { withCredentials: true },
    );

    const presignedUrl = urlResponse.data.presignedUrl;
    if (!presignedUrl) {
      throw new Error(`Presigned URL not available for file: ${file.fileName}`);
    }

    const fileResponse = await fetch(presignedUrl);
    if (!fileResponse.ok) {
      throw new Error(
        `Failed to fetch file: ${fileResponse.status} ${fileResponse.statusText}`,
      );
    }

    const blob = await fileResponse.blob();
    const fileObj = new File([blob], file.fileName, {
      type: file.contentType || file.fileType,
    });

    const fileContent: ExtendedFileContent = await readFile(
      fileObj,
      questionId || 0,
    );
    fileContent.blob = blob;
    fileContent.url = URL.createObjectURL(blob);

    return fileContent;
  } catch (err) {
    console.error("Error fetching file content:", err);
    toast.error(`Failed to fetch file: ${file.fileName}`);
    throw new Error(
      `Failed to fetch file content: ${
        isAxiosError(err) ? err.message || "Unknown error" : "Unknown error"
      }`,
    );
  }
};

// Create a new folder
export const createFolder = async (
  folderName: string,
  currentPath: string,
  uploadType: string,
  context: UploadContext = {},
): Promise<FileOperationResponse> => {
  if (!folderName || folderName.trim() === "") {
    toast.error("Folder name cannot be empty");
    throw new Error("Folder name cannot be empty");
  }

  try {
    const response = await axios.post<FileOperationResponse>(
      "/api/files/createFolder",
      {
        name: folderName,
        path: currentPath,
        uploadType,
        context,
      },
    );

    toast.success(`Folder "${folderName}" created successfully`);
    return response.data;
  } catch (err) {
    const message =
      isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : "Failed to create folder";
    toast.error(message);
    throw new Error(message);
  }
};

// Delete a file
export const deleteFile = async (
  file: FileObject,
  uploadType: string,
): Promise<void> => {
  try {
    await axios.delete(
      `/api/files/delete?fileId=${
        file.id
      }&uploadType=${uploadType}&key=${encodeURIComponent(file.cosKey)}`,
    );
    toast.success(`File "${file.fileName}" deleted successfully`);
  } catch (err) {
    const message =
      isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : "Failed to delete file";
    toast.error(message);
    throw new Error(message);
  }
};

// Download a file
export const downloadFile = async (
  file: EnhancedFileObject,
  uploadType: string,
): Promise<void> => {
  try {
    toast.info(`Preparing download for ${file.fileName}...`);

    const response = await axios.get<PresignedUrlResponse>(
      `/api/files/getFileUrl?fileId=${
        file.id
      }&uploadType=${uploadType}&key=${encodeURIComponent(file.cosKey)}`,
      { withCredentials: true },
    );

    if (response.data.presignedUrl) {
      // Create an invisible link and click it to trigger download
      const a = document.createElement("a");
      a.href = response.data.presignedUrl;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      toast.success(`Downloading ${file.fileName}`);
    } else {
      throw new Error("Failed to get download URL");
    }
  } catch (err) {
    const message =
      isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : "Failed to download file";
    toast.error(message);
    throw new Error(message);
  }
};

// Rename a file
export const renameFile = async (
  file: FileObject,
  newFileName: string,
  uploadType: string,
): Promise<FileObject> => {
  if (!newFileName || newFileName.trim() === "") {
    toast.error("New filename cannot be empty");
    throw new Error("New filename cannot be empty");
  }

  if (newFileName === file.fileName) {
    return file; // No change needed
  }

  try {
    // Call API to rename file using the dedicated rename endpoint
    const response = await axios.put<FileOperationResponse>(
      "/api/files/rename",
      {
        fileId: file.id,
        uploadType,
        sourceKey: file.cosKey,
        newFileName,
        bucket: file.cosBucket,
      },
    );

    // Calculate the new key path based on the rename result
    const newKey =
      response.data.newKey || calculateNewKeyPath(file.cosKey, newFileName);

    toast.success(`File renamed to "${newFileName}"`);

    // Return updated file object
    return {
      ...file,
      fileName: newFileName,
      cosKey: newKey,
    };
  } catch (err) {
    const message =
      isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : `Failed to rename file to "${newFileName}"`;
    toast.error(message);
    throw new Error(message);
  }
};

// Helper function to calculate new key path when renaming
function calculateNewKeyPath(oldKey: string, newFileName: string): string {
  const pathParts = oldKey.split("/");
  pathParts.pop(); // Remove the original filename

  return pathParts.length > 0
    ? `${pathParts.join("/")}/${newFileName}`
    : newFileName;
}

// Move a file to a different folder
export const moveFile = async (
  file: FileObject,
  targetPath: string,
  uploadType: string,
): Promise<FileObject> => {
  // Don't do anything if moving to the same folder
  if (file.path === targetPath) {
    return file;
  }

  try {
    // Make API call to move file
    const response = await axios.put<FileOperationResponse>("/api/files/move", {
      fileId: file.id,
      uploadType,
      sourceKey: file.cosKey,
      targetPath,
      bucket: file.cosBucket,
    });

    // Get the new key from the response, or calculate it if not provided
    const newKey =
      response.data.newKey || calculateNewKeyForMove(file.fileName, targetPath);

    toast.success(`Moved "${file.fileName}" to ${targetPath}`);

    // Update the file with new path and key
    return {
      ...file,
      path: targetPath,
      cosKey: newKey,
    };
  } catch (err) {
    const message =
      isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : "Failed to move file";
    toast.error(message);
    throw new Error(message);
  }
};

// Helper function to calculate new key when moving
function calculateNewKeyForMove(fileName: string, targetPath: string): string {
  return targetPath === "/"
    ? fileName
    : `${targetPath.substring(1)}/${fileName}`;
}

// Function to handle folder deletion
export const deleteFolder = async (
  folderPath: string,
  uploadType: string,
): Promise<void> => {
  if (folderPath === "/") {
    toast.error("Cannot delete the root folder");
    throw new Error("Cannot delete the root folder");
  }

  try {
    await axios.delete(
      `/api/files/deleteFolder?folderPath=${encodeURIComponent(
        folderPath,
      )}&uploadType=${uploadType}`,
    );
    toast.success(`Folder "${folderPath}" deleted successfully`);
  } catch (err) {
    const message =
      isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : "Failed to delete folder";
    toast.error(message);
    throw new Error(message);
  }
};

// Upload file interface
interface UploadResult {
  fileName: string;
  fileType: string;
  key: string;
  bucket: string;
  recordId?: number;
}

// Function to handle file upload
export const uploadFile = async (
  file: File,
  uploadType: string,
  path = "/",
  context: UploadContext = {},
  onProgress?: (progress: number) => void,
): Promise<UploadResult> => {
  try {
    // Step 1: Get pre-signed URL
    const { data: urlData } = await axios.post<PresignedUrlResponse>(
      "/api/upload/getPresignedUrl",
      {
        fileName: file.name,
        fileType: file.type,
        uploadType,
        context: {
          ...context,
          path,
        },
      },
      {
        withCredentials: true,
      },
    );

    let uploadSuccess = false;
    let recordId: number | undefined;

    // Create abort controller for upload cancellation
    const controller = new AbortController();

    try {
      // Create a FormData object to send the file directly
      const formData = new FormData();
      formData.append("file", file);

      if (urlData.bucket) {
        formData.append("bucket", urlData.bucket);
      }

      if (urlData.key) {
        formData.append("key", urlData.key);
      }

      // Use the direct upload endpoint
      const uploadResult = await axios.post<FileOperationResponse>(
        "/api/upload/directUpload",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          onUploadProgress: (progressEvent: AxiosProgressEvent) => {
            if (!progressEvent.total) return;
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total,
            );
            onProgress?.(percentCompleted);
          },
          signal: controller.signal,
        },
      );
      uploadSuccess = true;
      recordId = uploadResult.data.recordId; // Assuming the API returns a record ID

      if (!uploadSuccess) {
        throw new Error("Direct upload failed");
      }
      // If the upload is successful, we can return the file details
      return {
        fileName: file.name,
        fileType: file.type,
        key: urlData.key || "",
        bucket: urlData.bucket || "",
        recordId,
      };
    } catch (directUploadError) {
      console.error(
        "Direct upload failed, trying pre-signed URL method:",
        directUploadError,
      );
      // Fall back to pre-signed URL method
      if (!urlData.presignedUrl) {
        throw new Error("No presigned URL available for fallback upload");
      }

      await axios.put(urlData.presignedUrl, file, {
        headers: {
          "Content-Type": file.type,
        },
        onUploadProgress: (progressEvent: AxiosProgressEvent) => {
          if (!progressEvent.total) return;
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          onProgress?.(percentCompleted);
        },
        signal: controller.signal,
      });
      uploadSuccess = true;
      recordId = Date.now(); // Mock record ID
    }

    if (!uploadSuccess) {
      throw new Error("All upload methods failed");
    }

    toast.success(`Uploaded ${file.name} successfully`);

    return {
      fileName: file.name,
      fileType: file.type,
      key: urlData.key || "",
      bucket: urlData.bucket || "",
      recordId,
    };
  } catch (err) {
    const message =
      isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : `Failed to upload ${file.name}`;
    toast.error(message);
    throw new Error(message);
  }
};
