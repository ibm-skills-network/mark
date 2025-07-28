/* eslint-disable */
import { getApiRoutes, getBaseApiPath } from "@/config/constants";
import type {
  Assignment,
  BaseBackendResponse,
  Choice,
  CreateFolderRequest,
  ExtendedFileContent,
  FileAccessResponse,
  FileResponse,
  FolderListing,
  GetAssignmentResponse,
  MoveFileRequest,
  QuestionStore,
  RenameFileRequest,
  UploadContext,
  UploadRequest,
  UploadResponse,
  UploadType,
  User,
} from "@config/types";
import { absoluteUrl } from "./utils";
import { JSONValue } from "ai";

export interface FileProxyInfo {
  filename: string;
  size: number;
  contentType: string;
  lastModified: Date;
  isImage: boolean;
  isPdf: boolean;
  isText: boolean;
  proxyUrl: string;
  contentUrl?: string;
}

export interface FileContentResponse {
  content: string;
  filename: string;
  size: number;
}

export interface FileAccessInfo {
  filename: string;
  size: number;
  contentType: string;
  lastModified: Date;
  isImage: boolean;
  isPdf: boolean;
  isText: boolean;
  viewUrl: string;
  downloadUrl: string;
  textContentUrl?: string;
}

interface AxiosError {
  response?: {
    data?: {
      message?: string;
    };
  };
  code?: string;
  message: string;
}

interface ErrorResponse {
  message: string;
}

/**
 * Generate a presigned URL for file upload
 */
export async function generateUploadUrl(
  uploadRequest: UploadRequest,
  cookies?: string,
): Promise<UploadResponse> {
  const url = `${getBaseApiPath("v1")}/files/upload`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(uploadRequest),
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to generate upload URL");
  }

  return (await res.json()) as UploadResponse;
}

/**
 * Generate a presigned URL for public file access
 */
export async function getPublicFileUrl(
  key: string,
  cookies?: string,
): Promise<{ presignedUrl: string }> {
  const url = `${getBaseApiPath("v1")}/files/public-url?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to generate public file URL");
  }

  return (await res.json()) as { presignedUrl: string };
}

/**
 * Upload a file using a presigned URL with progress tracking
 */
export async function uploadWithPresignedUrl(
  file: File,
  presignedUrl: string,
  onUploadProgress?: (progressEvent: { loaded: number; total: number }) => void,
): Promise<void> {
  const axios = (await import("axios")).default;

  if (file.size === 0) {
    throw new Error("Cannot upload empty file");
  }

  try {
    await axios.put(presignedUrl, file, {
      headers: {
        "Content-Type": file.type,
      },
      onUploadProgress: onUploadProgress
        ? (progressEvent) => {
            console.log(
              `Uploading ${file.name}: ${progressEvent.loaded} bytes of ${file.size}`,
            );
            if (progressEvent.total) {
              onUploadProgress({
                loaded: progressEvent.loaded,
                total: progressEvent.total,
              });
            }
          }
        : undefined,
      timeout: 60000,
    });
  } catch (error: unknown) {
    const axiosError = error as AxiosError;
    if (axiosError.response?.data?.message) {
      throw new Error(axiosError.response.data.message);
    }
    throw new Error(
      axiosError.message || "Failed to upload file with presigned URL",
    );
  }
}

/**
 * Create a new folder
 */
export async function createFolder(
  folderRequest: CreateFolderRequest,
  cookies?: string,
): Promise<{ success: boolean; folder: { name: string; path: string } }> {
  const url = `${getBaseApiPath("v1")}/files/folder`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(folderRequest),
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to create folder");
  }

  return (await res.json()) as {
    success: boolean;
    folder: { name: string; path: string };
  };
}

/**
 * Enhanced file access function that handles both old and new proxy methods
 */
export async function getFileAccessEnhanced(
  _uploadType: UploadType,
  fileId?: string,
  key?: string,
  bucket?: string,
  useProxy = false,
  cookies?: string,
): Promise<FileAccessResponse | FolderListing | FileProxyInfo> {
  if (useProxy && key && bucket) {
    try {
      return await getFileInfo(key, bucket, cookies);
    } catch {
      // Fall through to alternative method
    }
  }

  const fileAccessInfo = await getFileAccess(
    key || fileId || "",
    bucket || "",
    3600,
    cookies,
  );

  return {
    filename: fileAccessInfo.filename,
    size: fileAccessInfo.size,
    contentType: fileAccessInfo.contentType,
    lastModified: fileAccessInfo.lastModified,
    isImage: fileAccessInfo.isImage,
    isPdf: fileAccessInfo.isPdf,
    isText: fileAccessInfo.isText,
    proxyUrl: fileAccessInfo.viewUrl,
    contentUrl: fileAccessInfo.textContentUrl,
  } as FileProxyInfo;
}

export function isMediaFile(fileName: string): boolean {
  return isImageFile(fileName) || isPdfFile(fileName);
}

/**
 * Get file download URL (authenticated)
 */
export async function getFileDownload(
  fileId: string,
  uploadType: UploadType,
  cookies?: string,
): Promise<FileAccessResponse> {
  const url = `${getBaseApiPath("v1")}/files/download?fileId=${encodeURIComponent(fileId)}&uploadType=${uploadType}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get file download URL");
  }

  return (await res.json()) as FileAccessResponse;
}

/**
 * List all files for a specific upload type
 */
export async function listFiles(
  uploadType: UploadType,
  assignmentId?: number,
  questionId?: number,
  reportId?: number,
  cookies?: string,
): Promise<FileResponse[]> {
  const params = new URLSearchParams();
  params.append("uploadType", uploadType);
  if (assignmentId) params.append("assignmentId", assignmentId.toString());
  if (questionId) params.append("questionId", questionId.toString());
  if (reportId) params.append("reportId", reportId.toString());

  const url = `${getBaseApiPath("v1")}/files?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to list files");
  }

  return (await res.json()) as FileResponse[];
}

/**
 * List empty folders
 */
export async function listEmptyFolders(
  uploadType: UploadType,
  groupId?: string,
  assignmentId?: number,
  questionId?: number,
  reportId?: number,
  cookies?: string,
): Promise<string[]> {
  const params = new URLSearchParams();
  params.append("uploadType", uploadType);
  if (groupId) params.append("groupId", groupId);
  if (assignmentId) params.append("assignmentId", assignmentId.toString());
  if (questionId) params.append("questionId", questionId.toString());
  if (reportId) params.append("reportId", reportId.toString());

  const url = `${getBaseApiPath("v1")}/files/empty-folders?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to list empty folders");
  }

  return (await res.json()) as string[];
}

/**
 * Delete a file
 */
export async function deleteFile(
  uploadType: UploadType,
  fileId?: string,
  key?: string,
  cookies?: string,
): Promise<{ success: boolean; message: string }> {
  let url: string;

  if (fileId) {
    const params = new URLSearchParams();
    params.append("uploadType", uploadType);
    if (key) params.append("key", key);

    url = `${getBaseApiPath("v1")}/files/${encodeURIComponent(fileId)}?${params.toString()}`;
  } else if (key) {
    const params = new URLSearchParams();
    params.append("uploadType", uploadType);
    params.append("key", key);

    url = `${getBaseApiPath("v1")}/files/delete?${params.toString()}`;
  } else {
    throw new Error("Either fileId or key must be provided");
  }

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to delete file");
  }

  return (await res.json()) as { success: boolean; message: string };
}

/**
 * Delete a folder and all its contents
 */
export async function deleteFolder(
  folderPath: string,
  uploadType: UploadType,
  cookies?: string,
): Promise<{ success: boolean; message: string; deletedCount?: number }> {
  const params = new URLSearchParams();
  params.append("folderPath", folderPath);
  params.append("uploadType", uploadType);

  const url = `${getBaseApiPath("v1")}/files/folder?${params.toString()}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to delete folder");
  }

  return (await res.json()) as {
    success: boolean;
    message: string;
    deletedCount?: number;
  };
}

/**
 * Move a file to a different folder
 */
export async function moveFile(
  moveRequest: MoveFileRequest,
  cookies?: string,
): Promise<{ success: boolean; message: string; newKey: string }> {
  const url = `${getBaseApiPath("v1")}/files/move`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(moveRequest),
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to move file");
  }

  return (await res.json()) as {
    success: boolean;
    message: string;
    newKey: string;
  };
}

/**
 * Rename a file
 */
export async function renameFile(
  renameRequest: RenameFileRequest,
  cookies?: string,
): Promise<{ success: boolean; message: string; newKey: string }> {
  const url = `${getBaseApiPath("v1")}/files/rename`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(renameRequest),
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to rename file");
  }

  return (await res.json()) as {
    success: boolean;
    message: string;
    newKey: string;
  };
}

/**
 * Utility function to get file MIME type from filename
 */
export function getFileType(fileName: string): string {
  const MIME_TYPES: Record<string, string> = {
    tar: "application/x-tar",
    gz: "application/gzip",
    zip: "application/zip",
    "7z": "application/x-7z-compressed",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    avif: "image/avif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    ts: "application/typescript",
    tsx: "application/typescript",
    sh: "application/x-sh",
    sql: "application/sql",
    json: "application/json",
    xml: "application/xml",
    yaml: "application/x-yaml",
    yml: "application/x-yaml",
    ipynb: "application/x-ipynb+json",
    wasm: "application/wasm",
  };

  const baseName = fileName.split(/[?#]/)[0].toLowerCase();
  const parts = baseName.split(".");
  if (parts.length < 2) return "application/octet-stream";

  for (let i = 2; i <= parts.length; i++) {
    const ext = parts.slice(-i).join(".");
    if (MIME_TYPES[ext]) return MIME_TYPES[ext];
  }

  const lastExt = parts.pop()!;
  return MIME_TYPES[lastExt] ?? "application/octet-stream";
}

/**
 * SIMPLIFIED: Get direct file access URLs using presigned URLs
 */
export async function getFileAccess(
  key: string,
  bucket: string,
  expiration = 3600,
  cookies?: string,
): Promise<FileAccessInfo> {
  const params = new URLSearchParams();
  params.append("key", key);
  params.append("bucket", bucket);
  params.append("expiration", expiration.toString());

  const url = `${getBaseApiPath("v1")}/files/access?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get file access");
  }

  const result = (await res.json()) as FileAccessInfo;

  return result;
}

/**
 * Get file content as text (for text files only)
 */
export async function getFileContent(
  key: string,
  bucket: string,
  cookies?: string,
): Promise<FileContentResponse> {
  const params = new URLSearchParams();
  params.append("key", key);
  params.append("bucket", bucket);

  const url = `${getBaseApiPath("v1")}/files/content?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get file content");
  }

  return (await res.json()) as FileContentResponse;
}

/**
 * SIMPLIFIED: Download file using direct presigned URL
 */
export async function downloadFile(
  key: string,
  bucket: string,
  filename?: string,
  cookies?: string,
): Promise<void> {
  try {
    const fileAccess = await getFileAccess(key, bucket, 3600, cookies);

    const a = document.createElement("a");
    a.href = fileAccess.downloadUrl;
    a.download = filename || fileAccess.filename;
    a.target = "_blank";
    a.style.display = "none";

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download file: ${errorMessage}`);
  }
}

/**
 * SIMPLIFIED: Fetch file content safely using direct URLs
 */
export async function fetchFileContentSafe(
  key: string,
  bucket: string,
  fileName: string,
  _uploadType: UploadType = "learner",
  cookies?: string,
): Promise<ExtendedFileContent> {
  try {
    if (!key || !bucket) {
      throw new Error("File key and bucket are required");
    }

    const isText = isTextFile(fileName);

    if (isText) {
      try {
        const contentResponse = await getFileContent(key, bucket, cookies);
        return {
          content: contentResponse.content,
          filename: fileName,
          questionId: "",
        };
      } catch {
        // Fall through to alternative method
      }
    }

    const fileAccess = await getFileAccess(key, bucket, 3600, cookies);

    return {
      url: fileAccess.viewUrl,
      filename: fileName,
      questionId: "",
      contentUrl: fileAccess.viewUrl,
      type: fileAccess.contentType,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      error: `Failed to load ${fileName}: ${errorMessage}`,
      filename: fileName,
      questionId: "",
    };
  }
}

/**
 * LEGACY SUPPORT: For compatibility with existing code
 */
export async function fetchFileAsBlob(
  key: string,
  bucket: string,
  cookies?: string,
): Promise<Blob> {
  const fileAccess = await getFileAccess(key, bucket, 3600, cookies);

  const response = await fetch(fileAccess.viewUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch file: ${response.status} ${response.statusText}`,
    );
  }

  return await response.blob();
}

/**
 * LEGACY SUPPORT: For compatibility with existing code
 */
export async function downloadFileViaProxy(
  key: string,
  bucket: string,
  filename?: string,
  cookies?: string,
): Promise<void> {
  return downloadFile(key, bucket, filename, cookies);
}

/**
 * LEGACY SUPPORT: Get proxy URL (now returns direct URL)
 */
export function getFileProxyUrl(key: string, bucket: string): string {
  return `/api/v1/files/access?key=${encodeURIComponent(key)}&bucket=${encodeURIComponent(bucket)}`;
}

/**
 * Get download URL (forces download)
 */
export function getFileDownloadUrl(key: string, bucket: string): string {
  return `/api/v1/files/access?key=${encodeURIComponent(key)}&bucket=${encodeURIComponent(bucket)}`;
}

/**
 * LEGACY SUPPORT: Old getFileInfo function
 */
export async function getFileInfo(
  key: string,
  bucket: string,
  cookies?: string,
): Promise<FileProxyInfo> {
  const fileAccess = await getFileAccess(key, bucket, 3600, cookies);

  return {
    filename: fileAccess.filename,
    size: fileAccess.size,
    contentType: fileAccess.contentType,
    lastModified: fileAccess.lastModified,
    isImage: fileAccess.isImage,
    isPdf: fileAccess.isPdf,
    isText: fileAccess.isText,
    proxyUrl: fileAccess.viewUrl,
    contentUrl: fileAccess.textContentUrl,
  };
}

export function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

export function isImageFile(fileName: string): boolean {
  const imageExtensions = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "svg",
    "bmp",
    "webp",
    "avif",
    "ico",
    "tiff",
    "tif",
  ];
  return imageExtensions.includes(getFileExtension(fileName));
}

export function isTextFile(fileName: string): boolean {
  const textExtensions = [
    "txt",
    "md",
    "csv",
    "json",
    "js",
    "jsx",
    "ts",
    "tsx",
    "html",
    "css",
    "py",
    "java",
    "cpp",
    "c",
    "cs",
    "php",
    "rb",
    "go",
    "rs",
    "swift",
    "kt",
    "scala",
    "sql",
    "sh",
    "yaml",
    "yml",
    "xml",
    "ipynb",
    "log",
  ];
  return textExtensions.includes(getFileExtension(fileName));
}

export function isPdfFile(fileName: string): boolean {
  return getFileExtension(fileName) === "pdf";
}

export function isVideoFile(fileName: string): boolean {
  const videoExtensions = [
    "mp4",
    "webm",
    "ogg",
    "avi",
    "mov",
    "wmv",
    "flv",
    "mkv",
  ];
  return videoExtensions.includes(getFileExtension(fileName));
}

export function isAudioFile(fileName: string): boolean {
  const audioExtensions = ["mp3", "wav", "ogg", "aac", "m4a", "flac"];
  return audioExtensions.includes(getFileExtension(fileName));
}

export function formatFileSize(bytes: number): string {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (
    (Math.round((bytes / Math.pow(1024, i)) * 100) / 100).toString() +
    " " +
    sizes[i]
  );
}

/**
 * Test function to validate direct file access
 */
export async function testFileIntegrity(
  key: string,
  bucket: string,
  cookies?: string,
): Promise<{ success: boolean; details: Record<string, unknown> }> {
  try {
    const fileAccess = await getFileAccess(key, bucket, 3600, cookies);

    const response = await fetch(fileAccess.viewUrl, { method: "HEAD" });

    return {
      success: response.ok,
      details: {
        fileAccess,
        responseStatus: response.status,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        directUrl: fileAccess.viewUrl,
      },
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      details: { error: errorMessage },
    };
  }
}

/**
 * Types for chat functionality
 */
export interface ChatMessage {
  id: number;
  chatId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  timestamp: string;
  toolCalls?: JSONValue;
}

export interface Chat {
  id: string;
  userId: string;
  startedAt: string;
  lastActiveAt: string;
  title?: string;
  assignmentId?: number;
  isActive: boolean;
  messages?: ChatMessage[];
}

interface Report {
  id: string;
  issueType: string;
  description: string;
  status: string;
  statusMessage?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  issueNumber?: string;
  severity?: string;
  assignmentId?: string;
  attemptId?: string;
}

export async function getReportsForUser(cookies?: string): Promise<Report[]> {
  const url = `${getBaseApiPath("v1")}/reports/user`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get reports");
  }
  return (await res.json()) as Report[];
}

/**
 * Get or create a chat session for today
 */
export async function getOrCreateTodayChat(
  userId: string,
  assignmentId?: number,
  cookies?: string,
): Promise<Chat> {
  const url = `${getApiRoutes().chats}/today`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify({
      userId,
      assignmentId,
    }),
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get or create chat");
  }

  return (await res.json()) as Chat;
}

/**
 * Get a specific chat by ID with all its messages
 */
export async function getChatById(
  chatId: string,
  cookies?: string,
): Promise<Chat> {
  const url = `${getApiRoutes().chats}/${chatId}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get chat");
  }

  return (await res.json()) as Chat;
}

/**
 * Get all chats for a user
 */
export async function getUserChats(
  userId: string,
  cookies?: string,
): Promise<Chat[]> {
  const url = `${getApiRoutes().chats}/user/${userId}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get user chats");
  }

  return (await res.json()) as Chat[];
}

/**
 * Add a message to a chat
 */
export async function addMessageToChat(
  chatId: string,
  role: "USER" | "ASSISTANT" | "SYSTEM",
  content: string,
  toolCalls?: JSONValue,
  cookies?: string,
): Promise<ChatMessage> {
  const url = `${getApiRoutes().chats}/${chatId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify({
      role,
      content,
      toolCalls,
    }),
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to add message to chat");
  }

  return (await res.json()) as ChatMessage;
}

/**
 * End a chat session (mark as inactive)
 */
export async function endChat(chatId: string, cookies?: string): Promise<Chat> {
  const url = `${getApiRoutes().chats}/${chatId}/end`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to end chat");
  }

  return (await res.json()) as Chat;
}

/**
 * Search messages in a chat
 */
export async function searchChatMessages(
  chatId: string,
  searchTerm: string,
  cookies?: string,
): Promise<ChatMessage[]> {
  const url = `${getApiRoutes().chats}/${chatId}/search?term=${encodeURIComponent(searchTerm)}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to search messages");
  }

  return (await res.json()) as ChatMessage[];
}

/**
 * Load more messages for a chat (pagination)
 */
export async function getMoreMessages(
  chatId: string,
  limit: number,
  offset: number,
  cookies?: string,
): Promise<ChatMessage[]> {
  const url = `${getApiRoutes().chats}/${chatId}/messages?limit=${limit}&offset=${offset}`;

  const res = await fetch(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get more messages");
  }

  return (await res.json()) as ChatMessage[];
}

const V1_USER_ROUTE = absoluteUrl("/api/v1/user-session");

export async function getUser(cookies?: string): Promise<User | undefined> {
  const res = await fetch(V1_USER_ROUTE, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to fetch user");
  }

  return (await res.json()) as User;
}

/**
 * Calls the backend to get an assignment.
 * @param id The id of the assignment to get.
 * @returns The assignment if it exists, undefined otherwise.
 * @throws An error if the request fails.
 * @throws An error if the assignment does not exist.
 * @throws An error if the user is not authorized to view the assignment.
 */
export async function getAssignment(
  id: number,
  userPreferedLanguage?: string,
  cookies?: string,
): Promise<Assignment> {
  const url = userPreferedLanguage
    ? `${getApiRoutes().assignments}/${id}?lang=${userPreferedLanguage}`
    : `${getApiRoutes().assignments}/${id}`;

  const res = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache",
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });

  const responseBody = (await res.json()) as GetAssignmentResponse &
    BaseBackendResponse;

  if (!res.ok) {
    throw new Error(
      responseBody.message || `Request failed with status ${res.status}`,
    );
  }

  const { success: _success, ...remainingData } = responseBody;

  return remainingData as Assignment;
}

/**
 * Calls the backend to get all assignments.
 * @returns An array of assignments.
 */
export async function getAssignments(
  cookies?: string,
): Promise<Assignment[] | undefined> {
  const res = await fetch(getApiRoutes().assignments, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });
  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to fetch assignments");
  }
  const assignments = (await res.json()) as Assignment[];
  return assignments;
}

/**
 * Fetches the supported languages for an assignment.
 * @param assignmentId The ID of the assignment.
 * @returns An array of supported language codes.
 * @throws An error if the request fails.
 */
export async function getSupportedLanguages(
  assignmentId: number,
): Promise<string[]> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/languages`;

  const res = await fetch(endpointURL);

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to fetch languages");
  }

  const data = (await res.json()) as { languages: string[] };
  if (!data.languages) {
    throw new Error("Failed to fetch languages");
  }
  return data.languages || [];
}

/**
 * Translates a question to a different language.
 */
export async function translateQuestion(
  assignmentId: number,
  questionId: number,
  question: QuestionStore,
  selectedLanguage: string,
  selectedLanguageCode: string,
  cookies?: string,
): Promise<{ translatedQuestion: string; translatedChoices?: Choice[] }> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/${questionId}/translations`;

  const res = await fetch(endpointURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify({
      selectedLanguage,
      selectedLanguageCode,
      question,
    }),
  });

  if (!res.ok) {
    const errorBody = (await res.json()) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to translate question");
  }

  return (await res.json()) as {
    translatedQuestion: string;
    translatedChoices?: Choice[];
  };
}
