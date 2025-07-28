import { UploadType } from "@/config/types";
import {
  FileProxyInfo,
  getFileInfo,
  FileContentResponse,
  getFileContent,
  downloadFileViaProxy,
  fetchFileContentSafe,
} from "@/lib/shared";
import { useState } from "react";

export function useEnhancedFileOperations() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getFileInfoSafe = async (
    key: string,
    bucket: string,
  ): Promise<FileProxyInfo | null> => {
    setLoading(true);
    setError(null);
    try {
      const info = await getFileInfo(key, bucket);
      return info;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const getFileContentSafe = async (
    key: string,
    bucket: string,
  ): Promise<FileContentResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const content = await getFileContent(key, bucket);
      return content;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const downloadFileSafe = async (
    key: string,
    bucket: string,
    filename?: string,
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await downloadFileViaProxy(key, bucket, filename);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const fetchContentSafe = async (
    key: string,
    bucket: string,
    fileName: string,
    uploadType: UploadType = "learner",
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFileContentSafe(
        key,
        bucket,
        fileName,
        uploadType,
      );
      if (result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      return {
        error: errorMessage,
        filename: fileName,
      };
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    getFileInfoSafe,
    getFileContentSafe,
    downloadFileSafe,
    fetchContentSafe,
    clearError: () => setError(null),
  };
}
