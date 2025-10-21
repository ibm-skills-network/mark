/* eslint-disable */
import { absoluteUrl } from "./utils";
import { getApiRoutes, getBaseApiPath } from "@/config/constants";
import { apiClient } from "./api-client";
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

  return (await apiClient.post(url, uploadRequest, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as UploadResponse;
}

/**
 * Generate a presigned URL for public file access
 */
export async function getPublicFileUrl(
  key: string,
  cookies?: string,
): Promise<{ presignedUrl: string }> {
  const url = `${getBaseApiPath("v1")}/files/public-url?key=${encodeURIComponent(key)}`;

  return (await apiClient.get(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as { presignedUrl: string };
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
 * Direct upload a file through the backend (bypasses CORS issues)
 */
export async function directUpload(
  file: File,
  uploadRequest: UploadRequest,
  cookies?: string,
  onUploadProgress?: (progressEvent: { loaded: number; total: number }) => void,
): Promise<{
  success: boolean;
  key: string;
  bucket: string;
  fileType: string;
  fileName: string;
  uploadType: string;
  size: number;
  etag: string;
}> {
  const url = `${getBaseApiPath("v1")}/files/direct-upload`;

  if (file.size === 0) {
    throw new Error("Cannot upload empty file");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileName", uploadRequest.fileName);
  formData.append("fileType", uploadRequest.fileType);
  formData.append("uploadType", uploadRequest.uploadType);

  if (uploadRequest.context) {
    const contextJson = JSON.stringify(uploadRequest.context);
    formData.append("context", contextJson);
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const errorBody = (await res.json()) as { message: string };
      throw new Error(errorBody.message || "Failed to upload file directly");
    }

    return await res.json();
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to upload file directly");
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

  return (await apiClient.post(url, folderRequest, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as { success: boolean; folder: { name: string; path: string } };
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

  return (await apiClient.get(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as FileAccessResponse;
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

  return (await apiClient.get(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as FileResponse[];
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

  return (await apiClient.get(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as string[];
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

  return (await apiClient.delete(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as { success: boolean; message: string };
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

  return (await apiClient.delete(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as {
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

  return (await apiClient.put(url, moveRequest, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as {
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

  return (await apiClient.put(url, renameRequest, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as {
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

  return (await apiClient.get(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as FileAccessInfo;
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

  return (await apiClient.get(url, {
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as FileContentResponse;
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

  const res = await apiClient.get(url, {
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

  const res = await apiClient.post(url, {
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

  const res = await apiClient.get(url, {
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

  const res = await apiClient.get(url, {
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

  const res = await apiClient.post(url, {
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

/**
 * Admin Data Types
 */
export interface FeedbackData {
  id: number;
  assignmentId: number;
  aiFeedbackRating?: number;
  userId: string;
  comments: string;
  aiGradingRating: number;
  assignmentRating: number;
  allowContact: boolean;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
  assignment: {
    id: number;
    name: string;
  };
  assignmentAttempt: {
    id: number;
    grade: number;
    submittedAt: string;
  };
}

export interface AssignmentAnalyticsData {
  id: number;
  name: string;
  totalCost: number;
  uniqueLearners: number;
  totalAttempts: number;
  completedAttempts: number;
  averageGrade: number;
  averageRating: number;
  published: boolean;
  insights: {
    questionInsights: Array<{
      questionId: number;
      questionText: string;
      correctPercentage: number;
      firstAttemptSuccessRate: number;
      avgPointsEarned: number;
      maxPoints: number;
      insight: string;
    }>;
    performanceInsights: string[];
    costBreakdown: {
      grading: number;
      questionGeneration: number;
      translation: number;
      other: number;
    };
  };
}

export interface AssignmentAnalyticsResponse {
  data: AssignmentAnalyticsData[];
  pagination: AdminPaginationInfo;
}

export interface ReportData {
  id: number;
  reporterId: string;
  assignmentId: number;
  attemptId: number;
  issueType: string;
  description: string;
  author: boolean;
  status: string;
  issueNumber: number;
  statusMessage: string;
  resolution: string;
  comments: string;
  closureReason: string;
  createdAt: string;
  updatedAt: string;
  assignment: {
    id: number;
    name: string;
  };
}

export interface AdminPaginationInfo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FeedbackResponse {
  data: FeedbackData[];
  pagination: AdminPaginationInfo;
}

export interface ReportsResponse {
  data: ReportData[];
  pagination: AdminPaginationInfo;
}

export interface FeedbackFilters {
  page?: number;
  limit?: number;
  search?: string;
  assignmentId?: string;
  allowContact?: string;
  startDate?: string;
  endDate?: string;
}

export interface ReportsFilters {
  page?: number;
  limit?: number;
  search?: string;
  assignmentId?: string;
  status?: string;
  issueType?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Get admin feedback data with pagination and filtering
 */
export async function getAdminFeedback(
  filters: FeedbackFilters = {},
  cookies?: string,
  adminToken?: string,
): Promise<FeedbackResponse> {
  const params = new URLSearchParams();

  // Add all filter parameters
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.append(key, value.toString());
    }
  });

  const url = `${getBaseApiPath("v1")}/reports/feedback?${params.toString()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (cookies) {
    headers.Cookie = cookies;
  }

  if (adminToken) {
    headers["x-admin-token"] = adminToken;
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to fetch feedback data");
  }

  return (await res.json()) as FeedbackResponse;
}

/**
 * Get admin reports data with pagination and filtering
 */
export async function getAdminReports(
  filters: ReportsFilters = {},
  cookies?: string,
  adminToken?: string,
): Promise<ReportsResponse> {
  const params = new URLSearchParams();

  // Add all filter parameters
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.append(key, value.toString());
    }
  });

  const url = `${getBaseApiPath("v1")}/reports?${params.toString()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (cookies) {
    headers.Cookie = cookies;
  }

  if (adminToken) {
    headers["x-admin-token"] = adminToken;
  }

  return (await apiClient.get(url, { headers })) as ReportsResponse;
}

/**
 * Get assignment analytics data with detailed insights
 */
export async function getAssignmentAnalytics(
  sessionToken: string,
  page: number = 1,
  limit: number = 10,
  search?: string,
): Promise<AssignmentAnalyticsResponse> {
  const params = new URLSearchParams();
  params.append("page", page.toString());
  params.append("limit", limit.toString());
  if (search) {
    params.append("search", search);
  }

  const url = `${getBaseApiPath("v1")}/admin-dashboard/analytics?${params.toString()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  return (await apiClient.get(url, { headers })) as AssignmentAnalyticsResponse;
}

/**
 * Dashboard admin functions
 */
export async function getDashboardAssignments(
  sessionToken: string,
  page: number = 1,
  limit: number = 10,
  search?: string,
) {
  const params = new URLSearchParams();
  params.append("page", page.toString());
  params.append("limit", limit.toString());
  if (search) {
    params.append("search", search);
  }

  const url = `${getBaseApiPath("v1")}/admin/dashboard/assignments?${params.toString()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  return await apiClient.get(url, { headers });
}

export async function getDashboardReports(
  sessionToken: string,
  page: number = 1,
  limit: number = 10,
  search?: string,
) {
  const params = new URLSearchParams();
  params.append("page", page.toString());
  params.append("limit", limit.toString());
  if (search) {
    params.append("search", search);
  }

  const url = `${getBaseApiPath("v1")}/admin/dashboard/reports?${params.toString()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  return await apiClient.get(url, { headers });
}

export async function getDashboardFeedback(
  sessionToken: string,
  page: number = 1,
  limit: number = 10,
  search?: string,
) {
  const params = new URLSearchParams();
  params.append("page", page.toString());
  params.append("limit", limit.toString());
  if (search) {
    params.append("search", search);
  }

  const url = `${getBaseApiPath("v1")}/admin/dashboard/feedback?${params.toString()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to fetch dashboard feedback");
  }

  return await res.json();
}

/**
 * Check if user email is authorized for admin access
 */
export async function checkAdminAccess(email: string): Promise<boolean> {
  try {
    const url = `${getBaseApiPath("v1")}/auth/admin/send-code`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    return res.ok; // Returns true if email is authorized
  } catch {
    return false;
  }
}

/**
 * Send admin verification code to email
 */
export async function sendAdminVerificationCode(
  email: string,
): Promise<boolean> {
  const url = `${getBaseApiPath("v1")}/auth/admin/send-code`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to send verification code");
  }

  return true;
}

/**
 * Verify admin code and get session token
 */
export async function verifyAdminCode(
  email: string,
  code: string,
): Promise<string> {
  const url = `${getBaseApiPath("v1")}/auth/admin/verify-code`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, code }),
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to verify code");
  }

  const result = await res.json();
  return result.sessionToken;
}

/**
 * Get current admin user information
 */
export async function getCurrentAdminUser(sessionToken: string): Promise<{
  email: string;
  role: string;
  isAdmin: boolean;
  success: boolean;
}> {
  const url = `${getBaseApiPath("v1")}/auth/admin/me`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionToken }),
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to get current admin user");
  }

  return await res.json();
}

/**
 * Check if the current user is a super admin
 */
export async function isCurrentUserSuperAdmin(
  sessionToken: string,
): Promise<boolean> {
  try {
    const userInfo = await getCurrentAdminUser(sessionToken);
    return userInfo.isAdmin;
  } catch {
    return false;
  }
}

/**
 * Logout admin session
 */
export async function logoutAdmin(sessionToken: string): Promise<void> {
  const url = `${getBaseApiPath("v1")}/auth/admin/logout`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionToken }),
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to logout");
  }
}

export async function getDashboardStats(
  sessionToken: string,
  filters?: {
    startDate?: string;
    endDate?: string;
    assignmentId?: number;
    assignmentName?: string;
    userId?: string;
  },
  bustCache = false,
) {
  const params = new URLSearchParams();
  if (filters?.startDate) params.append("startDate", filters.startDate);
  if (filters?.endDate) params.append("endDate", filters.endDate);
  if (filters?.assignmentId)
    params.append("assignmentId", filters.assignmentId.toString());
  if (filters?.assignmentName)
    params.append("assignmentName", filters.assignmentName);
  if (filters?.userId) params.append("userId", filters.userId);

  if (bustCache) {
    params.append("_t", Date.now().toString());
  }

  const url = `${getBaseApiPath("v1")}/admin-dashboard/stats${params.toString() ? `?${params.toString()}` : ""}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
    ...(bustCache ? { "Cache-Control": "no-cache" } : {}),
  };

  return await apiClient.get(url, { headers });
}

export async function upscalePricing(
  sessionToken: string,
  upscaleData: {
    globalFactor?: number;
    usageFactors?: { [usageType: string]: number };
    reason?: string;
  },
) {
  const url = `${getBaseApiPath("v1")}/llm-pricing/upscale`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(upscaleData),
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to upscale pricing");
  }

  return await res.json();
}

export async function getCurrentPriceUpscaling(
  sessionToken: string,
  bustCache = false,
) {
  const baseUrl = `${getBaseApiPath("v1")}/llm-pricing/upscaling/current`;
  const url = bustCache ? `${baseUrl}?_t=${Date.now()}` : baseUrl;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
    "Cache-Control": "no-cache",
  };

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(
      errorBody.message || "Failed to fetch current price upscaling",
    );
  }

  return await res.json();
}

export async function removePriceUpscaling(
  sessionToken: string,
  reason?: string,
) {
  const url = `${getBaseApiPath("v1")}/llm-pricing/upscaling/remove`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const errorBody = (await res
      .json()
      .catch(() => ({ message: "Unknown error" }))) as ErrorResponse;
    throw new Error(errorBody.message || "Failed to remove price upscaling");
  }

  return await res.json();
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

  const responseBody = (await apiClient.get(url, {
    headers: {
      "Cache-Control": "no-cache",
      ...(cookies ? { Cookie: cookies } : {}),
    },
  })) as GetAssignmentResponse & BaseBackendResponse;

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

/**
 * Get detailed insights for a specific assignment
 */
export async function getDetailedAssignmentInsights(
  sessionToken: string,
  assignmentId: number,
) {
  const url = `${getBaseApiPath("v1")}/admin-dashboard/assignments/${assignmentId}/insights`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  return await apiClient.get(url, { headers });
}

/**
 * Execute a quick action for dashboard insights
 */
export async function executeQuickAction(
  sessionToken: string,
  action: string,
  limit?: number,
) {
  const params = new URLSearchParams();
  if (limit) params.append("limit", limit.toString());

  const url = `${getBaseApiPath("v1")}/admin-dashboard/quick-actions/${action}${params.toString() ? `?${params.toString()}` : ""}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-admin-token": sessionToken,
  };

  return await apiClient.get(url, { headers });
}
