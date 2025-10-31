import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  IconX,
  IconDownload,
  IconChevronLeft,
  IconChevronRight,
  IconMaximize,
  IconMinimize,
  IconZoomIn,
  IconZoomOut,
  IconRotate,
  IconFile,
  IconLoader2,
  IconFileText,
  IconPhoto,
  IconVideo,
  IconMusic,
  IconRefresh,
  IconBug,
  IconExternalLink,
} from "@tabler/icons-react";
import { EnhancedFileObject, ExtendedFileContent } from "@/config/types";
import {
  downloadFile,
  isImageFile,
  isTextFile,
  isPdfFile,
  isVideoFile,
  isAudioFile,
  formatFileSize,
} from "@/lib/shared";
import Loading from "../Loading";
import animationData from "@/animations/LoadSN.json";

interface FilePreviewProps {
  file: EnhancedFileObject;
  content?: ExtendedFileContent | null;
  onClose?: () => void;
  onDownload?: (file: EnhancedFileObject) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

const FilePreview = ({
  file,
  content,
  onClose,
  onDownload,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false,
}: FilePreviewProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const [scale, setScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLImageElement>(null);

  const getFileType = () => {
    const fileName = file.fileName;
    if (isImageFile(fileName)) return "image";
    if (isPdfFile(fileName)) return "pdf";
    if (isVideoFile(fileName)) return "video";
    if (isAudioFile(fileName)) return "audio";
    if (isTextFile(fileName)) return "text";
    return "unknown";
  };

  const getFileIcon = () => {
    const type = getFileType();
    const iconProps = { size: 20, className: "text-purple-600" };

    switch (type) {
      case "image":
        return <IconPhoto {...iconProps} />;
      case "video":
        return <IconVideo {...iconProps} />;
      case "audio":
        return <IconMusic {...iconProps} />;
      case "text":
        return <IconFileText {...iconProps} />;
      case "pdf":
        return <IconFileText {...iconProps} />;
      default:
        return <IconFile {...iconProps} />;
    }
  };

  const openInNewTab = () => {
    if (content?.url) {
      window.open(content.url, "_blank");
    }
  };

  const handleZoomIn = () => setScale((prev) => Math.min(prev * 1.2, 5));
  const handleZoomOut = () => setScale((prev) => Math.max(prev / 1.2, 0.1));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const resetView = () => {
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (getFileType() === "image" && scale > 1) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      }
    },
    [scale, position],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          if (hasPrevious) onPrevious();
          break;
        case "ArrowRight":
          if (hasNext) onNext();
          break;
        case "+":
        case "=":
          e.preventDefault();
          handleZoomIn();
          break;
        case "-":
          e.preventDefault();
          handleZoomOut();
          break;
        case "r":
          e.preventDefault();
          handleRotate();
          break;
        case "0":
          e.preventDefault();
          resetView();
          break;
        case "d":
          e.preventDefault();
          setShowDebug(!showDebug);
          break;
        case "o":
          e.preventDefault();
          openInNewTab();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    onClose,
    onNext,
    onPrevious,
    hasNext,
    hasPrevious,
    handleMouseMove,
    handleMouseUp,
    showDebug,
    content?.url,
  ]);

  const handleDownloadFile = async () => {
    if (onDownload) {
      onDownload(file);
      return;
    }

    try {
      if (file.content) {
        const blob = new Blob([file.content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      if (file.cosKey && file.cosBucket) {
        await downloadFile(file.cosKey, file.cosBucket, file.fileName);
      } else {
        throw new Error("No file content or location available for download");
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown download error";
      console.error("Download error:", error);
      setError(`Failed to download file: ${errorMessage}`);
    }
  };

  const renderImage = () => {
    if (!content?.url) {
      if (isLoading) {
        return (
          <div className="h-full flex items-center justify-center">
            <Loading animationData={animationData} />
          </div>
        );
      }
      if (error) {
        return (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4 mx-auto">
                <IconX size={24} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Error loading image
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4 max-w-md">
                {error}
              </p>
              <button
                onClick={handleDownloadFile}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              >
                <IconDownload size={16} />
                Download Image
              </button>
            </div>
          </div>
        );
      }
    }
    return (
      <div className="relative h-full flex items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-800">
        <div
          className="relative h-full w-full flex items-center justify-center"
          onMouseDown={handleMouseDown}
          style={{
            cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
          }}
        >
          <img
            ref={contentRef}
            src={content?.url}
            alt={file.fileName}
            className="max-w-full max-h-full object-contain transition-transform duration-200 ease-out select-none"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
              transformOrigin: "center",
            }}
            draggable={false}
            onLoad={(e) => {
              setIsLoading(false);
              setError(null);
            }}
            onError={(e) => {
              console.error(`[PREVIEW] Image failed to load:`, {
                url: content.url,
                error: e,
              });
              setError(
                `Failed to load image. This might be a temporary issue with the file URL.`,
              );
              setIsLoading(false);
            }}
          />
        </div>

        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg p-2 shadow-lg flex gap-1">
            <button
              onClick={handleZoomIn}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              title="Zoom In (+)"
            >
              <IconZoomIn size={16} />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              title="Zoom Out (-)"
            >
              <IconZoomOut size={16} />
            </button>
            <button
              onClick={handleRotate}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              title="Rotate (R)"
            >
              <IconRotate size={16} />
            </button>
            <button
              onClick={resetView}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              title="Reset View (0)"
            >
              <IconRefresh size={16} />
            </button>
            <button
              onClick={openInNewTab}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              title="Open in New Tab (O)"
            >
              <IconExternalLink size={16} />
            </button>
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              title="Toggle Debug (D)"
            >
              <IconBug size={16} />
            </button>
          </div>

          {scale > 1 && (
            <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg px-3 py-1 shadow-lg">
              <span className="text-sm font-medium">
                {Math.round(scale * 100)}%
              </span>
            </div>
          )}
        </div>

        {showDebug && (
          <div className="absolute top-4 left-4 bg-black/90 text-white p-3 rounded-lg max-w-sm text-xs max-h-96 overflow-auto">
            <div className="mb-2 font-bold">Debug Info:</div>
            <div>URL: {content.url}</div>
            <div>Type: {content.type || "unknown"}</div>
            <div>File: {file.fileName}</div>
            <div>Key: {file.cosKey}</div>
            <div>Bucket: {file.cosBucket}</div>
            <div>
              Is Direct S3 URL:{" "}
              {content.url?.includes("amazonaws.com") ||
              content.url?.includes("cos.")
                ? "✅ Yes"
                : "❌ No"}
            </div>
          </div>
        )}

        {scale > 1 && (
          <div className="absolute bottom-4 right-4 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg px-3 py-1 shadow-lg flex items-center gap-1">
            <span className="text-xs">Drag to pan</span>
          </div>
        )}
      </div>
    );
  };

  const renderVideo = () => (
    <div className="h-full flex items-center justify-center bg-black">
      {content?.url ? (
        <video
          controls
          className="max-w-full max-h-full"
          onLoadStart={() => setIsLoading(true)}
          onLoadedData={() => setIsLoading(false)}
          onError={() => setError("Failed to load video")}
        >
          <source src={content.url} type={content.type} />
          Your browser does not support the video tag.
        </video>
      ) : (
        <div className="text-center text-white">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4 mx-auto">
            <IconVideo size={24} className="text-red-600" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Video Not Available</h3>
          <div className="space-x-2">
            <button
              onClick={handleDownloadFile}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
            >
              <IconDownload size={16} />
              Download Video
            </button>
            {content?.url && (
              <button
                onClick={openInNewTab}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <IconExternalLink size={16} />
                Open Direct Link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderAudio = () => (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 to-purple-50 dark:from-purple-900/20 dark:to-purple-900/20">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-500 rounded-xl flex items-center justify-center">
            <IconMusic size={32} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">{file.fileName}</h3>
            <p className="text-gray-500 text-sm">
              {formatFileSize(file.fileSize || file.size)}
            </p>
          </div>
        </div>

        {content?.url ? (
          <audio
            controls
            className="w-full"
            onLoadStart={() => setIsLoading(true)}
            onLoadedData={() => setIsLoading(false)}
            onError={() => setError("Failed to load audio")}
          >
            <source src={content.url} type={content.type} />
            Your browser does not support the audio element.
          </audio>
        ) : (
          <div className="text-center">
            <p className="text-gray-600 mb-4">
              Audio file cannot be played inline.
            </p>
            <div className="space-x-2">
              <button
                onClick={handleDownloadFile}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              >
                <IconDownload size={16} />
                Download Audio
              </button>
              {content?.url && (
                <button
                  onClick={openInNewTab}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  <IconExternalLink size={16} />
                  Direct Link
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderTextContent = () => (
    <div className="h-full overflow-auto p-6 bg-white dark:bg-gray-900">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {file.fileName}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {formatFileSize(file.fileSize || file.size)}
          </p>
        </div>

        <pre className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 font-mono leading-relaxed">
          {content?.content || file.content || "Content not available"}
        </pre>
      </div>
    </div>
  );

  const renderPdf = () => (
    <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
      {content?.url ? (
        <iframe
          src={content.url}
          className="w-full h-full border-0"
          title={file.fileName}
          onLoad={() => setIsLoading(false)}
          onError={() => setError("Failed to load PDF")}
        />
      ) : (
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4 mx-auto">
            <IconFileText size={24} className="text-red-600" />
          </div>
          <h3 className="text-lg font-semibold mb-2">PDF Not Available</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            PDF could not be loaded for preview.
          </p>
          <div className="space-x-2">
            <button
              onClick={handleDownloadFile}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
            >
              <IconDownload size={16} />
              Download PDF
            </button>
            {content?.url && (
              <button
                onClick={openInNewTab}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <IconExternalLink size={16} />
                Open Direct Link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderUnsupported = () => (
    <div className="h-full flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-gray-800">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-gray-200 dark:bg-gray-700 rounded-2xl flex items-center justify-center mb-6 mx-auto">
          {getFileIcon()}
        </div>

        <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          Preview not available
        </h3>

        <p className="text-gray-600 dark:text-gray-400 mb-6">
          This file format cannot be previewed in the browser. You can download
          it to view with an appropriate application.
        </p>

        <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400 mb-6">
          <div>File: {file.fileName}</div>
          <div>Size: {formatFileSize(file.fileSize || file.size)}</div>
        </div>

        <div className="space-y-2">
          <button
            onClick={handleDownloadFile}
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            <IconDownload size={18} />
            Download File
          </button>
          <div className="space-x-2">
            {content?.url && (
              <button
                onClick={openInNewTab}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <IconExternalLink size={16} />
                Direct Link
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <IconLoader2 size={32} className="animate-spin text-purple-600" />
            <p className="text-gray-600 dark:text-gray-400">Loading...</p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4 mx-auto">
              <IconX size={24} className="text-red-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Error loading file</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4 max-w-md">
              {error}
            </p>
            <div className="space-x-2">
              <button
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              >
                <IconRefresh size={16} />
                Retry
              </button>
              <button
                onClick={handleDownloadFile}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <IconDownload size={16} />
                Download
              </button>
              {content?.url && (
                <button
                  onClick={openInNewTab}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                >
                  <IconExternalLink size={16} />
                  Direct Link
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (content?.error) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4 mx-auto">
              <IconX size={24} className="text-red-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Error loading file</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4 max-w-md">
              {content.error}
            </p>
            <button
              onClick={handleDownloadFile}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
            >
              <IconDownload size={16} />
              Download Instead
            </button>
          </div>
        </div>
      );
    }

    const fileType = getFileType();

    if (content?.content || file.content) {
      return renderTextContent();
    }

    switch (fileType) {
      case "image":
        return renderImage();
      case "video":
        return renderVideo();
      case "audio":
        return renderAudio();
      case "pdf":
        return renderPdf();
      default:
        return renderUnsupported();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className={`bg-white dark:bg-gray-900 shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ease-out ${
          isFullscreen
            ? "w-full h-full"
            : "w-full max-w-6xl max-h-[90vh] rounded-xl"
        }`}
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {getFileIcon()}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                {file.fileName}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <IconMinimize size={18} />
              ) : (
                <IconMaximize size={18} />
              )}
            </button>

            {content?.url && (
              <button
                onClick={openInNewTab}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Open in New Tab (O)"
              >
                <IconExternalLink size={18} />
              </button>
            )}

            <button
              onClick={handleDownloadFile}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Download"
            >
              <IconDownload size={18} />
            </button>

            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Close (Esc)"
            >
              <IconX size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">{renderContent()}</div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm">
          <button
            onClick={onPrevious}
            disabled={!hasPrevious}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              hasPrevious
                ? "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                : "text-gray-400 dark:text-gray-600 cursor-not-allowed"
            }`}
            title="Previous (←)"
          >
            <IconChevronLeft size={16} />
            Previous
          </button>

          <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
            <div>{new Date(file.createdAt).toLocaleDateString()}</div>
          </div>

          <button
            onClick={onNext}
            disabled={!hasNext}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              hasNext
                ? "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                : "text-gray-400 dark:text-gray-600 cursor-not-allowed"
            }`}
            title="Next (→)"
          >
            Next
            <IconChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilePreview;
