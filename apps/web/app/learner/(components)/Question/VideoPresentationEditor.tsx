import { transcribeAudio } from "@/app/Helpers/transcribeAudio";
import {
  QuestionStore,
  slideMetaData,
  TranscriptSegment,
} from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import JSZip from "jszip";
import React, { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
const ensureFfmpegLoaded = async (ffmpeg: FFmpeg) => {
  if (!ffmpeg.loaded) {
    await ffmpeg.load({
      coreURL: await toBlobURL(
        "/ffmpeg-core/ffmpeg-core.js",
        "text/javascript",
      ),
      wasmURL: await toBlobURL(
        "/ffmpeg-core/ffmpeg-core.wasm",
        "application/wasm",
      ),
    });
  }
};
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert file to base64."));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const extractTextFromPptx = async (file: File): Promise<string> => {
  const zip = await JSZip.loadAsync(file);
  let text = "";
  const slideFiles = Object.keys(zip.files).filter((filename) =>
    filename.startsWith("ppt/slides/slide"),
  );
  for (const slideFile of slideFiles) {
    const content = await zip.file(slideFile)?.async("string");
    if (content) {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, "application/xml");
      const textElements = xmlDoc.getElementsByTagName("a:t");
      for (let i = 0; i < textElements.length; i++) {
        if (textElements[i].textContent) {
          text += textElements[i].textContent + " ";
        }
      }
    }
  }
  return text.trim();
};
const formatTranscriptWithConfidence = (
  segments: TranscriptSegment[],
): string => {
  return segments
    .map((seg) => {
      const start = parseFloat(seg.start.toString()).toFixed(2);
      const end = parseFloat(seg.end.toString()).toFixed(2);
      const text = seg.text.trim();
      const avgLogProb = seg.avg_logprob;

      let confidenceLabel = "";
      if (avgLogProb > -0.3) {
        confidenceLabel = "High";
      } else if (avgLogProb > -0.5) {
        confidenceLabel = "Moderate";
      } else {
        confidenceLabel = "Low";
      }

      let noSpeechMarker = "";
      if (seg.no_speech_prob > 0.1) {
        noSpeechMarker = " [Note: Possible silence]";
      }

      return `[${start}s-${end}s] ${text} (Confidence: ${confidenceLabel}${noSpeechMarker})`;
    })
    .join("\n");
};

const extractAudio = async (ffmpeg: FFmpeg, videoBlob: Blob): Promise<Blob> => {
  await ensureFfmpegLoaded(ffmpeg);

  try {
    await ffmpeg.writeFile("input.mp4", await fetchFile(videoBlob));
    await ffmpeg.exec([
      "-i",
      "input.mp4",
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "output.wav",
    ]);
    const audioData = await ffmpeg.readFile("output.wav");
    return new Blob([audioData], { type: "audio/wav" });
  } finally {
    await ffmpeg.deleteFile("input.mp4");
    await ffmpeg.deleteFile("output.wav");
  }
};

const ffmpeg = new FFmpeg();

interface VideoPresentationEditorProps {
  question: QuestionStore;
  assignmentId: number;
}

const VideoPresentationEditor = ({
  question,
  assignmentId,
}: VideoPresentationEditorProps) => {
  const questionId = question.id;

  const config = question.videoPresentationConfig;
  const evaluateSlidesQuality = config?.evaluateSlidesQuality ?? false;
  const evaluateTimeManagement = config?.evaluateTimeManagement ?? false;

  const targetTime = config?.targetTime ?? 0;

  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [processSlides, setProcessSlides] = useState(false);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoURL, setVideoURL] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimStartMinutes, setTrimStartMinutes] = useState(0);
  const [trimStartSeconds, setTrimStartSeconds] = useState(0);
  const [trimEndMinutes, setTrimEndMinutes] = useState(0);
  const [trimEndSeconds, setTrimEndSeconds] = useState(0);
  const [trimmedVideoURL, setTrimmedVideoURL] = useState("");
  const [processingTrim, setProcessingTrim] = useState(false);

  const [slidesFiles, setSlidesFiles] = useState<File[]>([]);
  const slidesData = question.presentationResponse?.slidesData ?? "";
  const setSlidesData = useLearnerStore((state) => state.setSlidesData);

  const transcript = question.presentationResponse?.transcript ?? "";
  const setTranscript = useLearnerStore((state) => state.setTranscript);
  const [processingTranscript, setProcessingTranscript] = useState(false);

  const [showEditorModal, setShowEditorModal] = useState(false);
  const [limitError, setLimitError] = useState("");

  const [readyIndicator, setReadyIndicator] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: await toBlobURL(
            "/ffmpeg-core/ffmpeg-core.js",
            "text/javascript",
          ),
          wasmURL: await toBlobURL(
            "/ffmpeg-core/ffmpeg-core.wasm",
            "application/wasm",
          ),
        });
        setFfmpegLoaded(true);
      } else {
        setFfmpegLoaded(true);
      }
    };
    void load();
  }, []);
  const onDropVideo = (acceptedFiles: File[]) => {
    if (!acceptedFiles || acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setVideoFile(file);
    setVideoURL(URL.createObjectURL(file));
    void generateTranscript(file);
  };
  const onDropSlides = async (acceptedFiles: File[]) => {
    if (!acceptedFiles || acceptedFiles.length === 0) return;

    setSlidesFiles((prev) => [...prev, ...acceptedFiles]);

    await generateSlidesData([...slidesFiles, ...acceptedFiles]);
  };

  const {
    getRootProps: getVideoRootProps,
    getInputProps: getVideoInputProps,
    acceptedFiles: acceptedVideoFiles,
  } = useDropzone({
    accept: { "video/*": [] },
    multiple: false,
    onDrop: onDropVideo,
  });

  const {
    getRootProps: getSlidesRootProps,
    getInputProps: getSlidesInputProps,
  } = useDropzone({
    accept: {
      "application/vnd.ms-powerpoint": [],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        [],
    },
    multiple: true,
    onDrop: onDropSlides,
  });
  useEffect(() => {
    if (acceptedVideoFiles.length > 0) {
      const file = acceptedVideoFiles[0];
      setVideoFile(file);
      setVideoURL(URL.createObjectURL(file));

      setTrimmedVideoURL("");
      setTranscript(questionId, "");
      setSlidesData(questionId, undefined);
      setLimitError("");
      setReadyIndicator(false);
    }
  }, [acceptedVideoFiles]);

  const removeVideo = () => {
    setVideoFile(null);
    setVideoURL("");
    setTrimmedVideoURL("");
    setTranscript(questionId, "");
    setSlidesData(questionId, undefined);
    setLimitError("");
    setReadyIndicator(false);
  };

  const removeSlide = (idx: number) => {
    setSlidesFiles((prev) => prev.filter((_, i) => i !== idx));
    setReadyIndicator(false);
  };

  useEffect(() => {
    if (videoFile) {
      void generateTranscript(videoFile);
    }
  }, [videoFile]);

  const onVideoLoadedMetadata = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      setVideoDuration(duration);
      setTrimStart(0);
      setTrimEnd(duration);
      setTrimStartMinutes(0);
      setTrimStartSeconds(0);
      const endMin = Math.floor(duration / 60);
      const endSec = Math.round(duration % 60);
      setTrimEndMinutes(endMin);
      setTrimEndSeconds(endSec);
      setLimitError("");
    }
  };

  const enforceTargetTime = (
    startSec: number,
    endSec: number,
  ): [number, string] => {
    let errorMsg = "";

    if (targetTime <= 0) return [endSec, errorMsg];

    const length = endSec - startSec;
    if (length > targetTime) {
      errorMsg = `Maximum allowed length is ${targetTime} seconds. Clamping end time.`;
      return [startSec + targetTime, errorMsg];
    }
    return [endSec, errorMsg];
  };

  const updateTrimStart = (minutes: number, seconds: number) => {
    setTrimStartMinutes(minutes);
    setTrimStartSeconds(seconds);
    const newStartSec = minutes * 60 + seconds;

    const currentLength = trimEnd - newStartSec;
    let newEndSec = trimEnd;
    let errorMsg = "";
    if (targetTime > 0 && currentLength > targetTime) {
      errorMsg = `Maximum allowed length is ${targetTime} seconds. Clamping end time.`;
      newEndSec = newStartSec + targetTime;
      if (newEndSec > videoDuration) newEndSec = videoDuration;
    }

    setTrimStart(newStartSec);
    setTrimEnd(newEndSec);
    if (errorMsg) setLimitError(errorMsg);
    else setLimitError("");

    const endMin = Math.floor(newEndSec / 60);
    const endSec = Math.round(newEndSec % 60);
    setTrimEndMinutes(endMin);
    setTrimEndSeconds(endSec);
  };

  const updateTrimEnd = (minutes: number, seconds: number) => {
    setTrimEndMinutes(minutes);
    setTrimEndSeconds(seconds);
    const newEndSec = minutes * 60 + seconds;
    const startSec = trimStart;

    const [finalEnd, errorMsg] = enforceTargetTime(startSec, newEndSec);

    let clampedEnd = finalEnd;
    if (clampedEnd > videoDuration) clampedEnd = videoDuration;

    setTrimEnd(clampedEnd);
    if (errorMsg) setLimitError(errorMsg);
    else setLimitError("");

    const endMin = Math.floor(clampedEnd / 60);
    const endSec = Math.round(clampedEnd % 60);
    setTrimEndMinutes(endMin);
    setTrimEndSeconds(endSec);
  };

  const trimVideo = async () => {
    if (!videoFile) return;
    setProcessingTrim(true);
    setLimitError("");
    try {
      await ensureFfmpegLoaded(ffmpeg);

      await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));
      await ffmpeg.exec([
        "-ss",
        trimStart.toString(),
        "-to",
        trimEnd.toString(),
        "-i",
        "input.mp4",
        "-c",
        "copy",
        "output.mp4",
      ]);
      const data = await ffmpeg.readFile("output.mp4");
      const trimmedBlob = new Blob([data], { type: "video/mp4" });
      setTrimmedVideoURL(URL.createObjectURL(trimmedBlob));
    } catch (err) {
      console.error("Error trimming video:", err);
      setTrimmedVideoURL("");
      setLimitError("Error trimming video. Please try again.");
    } finally {
      await ffmpeg.deleteFile("input.mp4");
      await ffmpeg.deleteFile("output.mp4");
      setProcessingTrim(false);
    }
  };

  const removeTrimmedVideo = () => {
    setTrimmedVideoURL("");
  };

  const generateTranscript = async (file: File) => {
    try {
      setProcessingTranscript(true);
      await ensureFfmpegLoaded(ffmpeg);
      const audioBlob = await extractAudio(ffmpeg, file);

      const result = await transcribeAudio(audioBlob);
      if (evaluateTimeManagement && result.segments) {
        setTranscript(
          questionId,
          formatTranscriptWithConfidence(result.segments),
        );
      } else {
        setTranscript(questionId, result.text || "");
      }
    } catch (err) {
      console.error("Error generating transcript:", err);
      setTranscript(questionId, "");
    } finally {
      setProcessingTranscript(false);
    }
  };

  const generateSlidesData = async (files: File[]) => {
    if (!evaluateSlidesQuality || files.length === 0) return;

    const slidesArray: slideMetaData[] = [];
    setProcessSlides(true);
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];

      try {
        if (file.type.startsWith("image/")) {
          const base64 = await fileToBase64(file);
          slidesArray.push({
            slideNumber: slidesArray.length + 1,
            slideText: "",
            slideImage: base64,
          });
          continue;
        }

        if (
          file.type ===
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ) {
          const zip = await JSZip.loadAsync(file);

          const internalSlideFiles = Object.keys(zip.files).filter((filename) =>
            filename.startsWith("ppt/slides/slide"),
          );

          for (let i = 0; i < internalSlideFiles.length; i++) {
            const slideXmlFile = internalSlideFiles[i];
            let slideText = "";
            let slideImage = "";

            try {
              const content = await zip.file(slideXmlFile)?.async("string");
              if (content) {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(
                  content,
                  "application/xml",
                );
                const textElements = xmlDoc.getElementsByTagName("a:t");
                for (let t = 0; t < textElements.length; t++) {
                  if (textElements[t].textContent) {
                    slideText += textElements[t].textContent + " ";
                  }
                }
                slideText = slideText.trim();
              }
            } catch (textErr) {
              slideText = "[Error extracting text]";
            }

            try {
              const relFileName =
                slideXmlFile.replace("slides/slide", "slides/_rels/slide") +
                ".rels";
              const relContent = await zip.file(relFileName)?.async("string");
              if (relContent) {
                const parser = new DOMParser();
                const relDoc = parser.parseFromString(
                  relContent,
                  "application/xml",
                );

                const relNodes = relDoc.getElementsByTagName("Relationship");
                for (let r = 0; r < relNodes.length; r++) {
                  const relType = relNodes[r].getAttribute("Type");
                  if (
                    relType ===
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                  ) {
                    const targetValue =
                      relNodes[r].getAttribute("Target") || "";

                    const mediaPath =
                      "ppt/slides/" + targetValue.replace("../", "");

                    let actualPath = mediaPath;
                    if (!mediaPath.startsWith("ppt/media")) {
                      actualPath = mediaPath.replace("slides/media", "media");
                      actualPath = `ppt/${actualPath}`;
                    }

                    const imageBinary = await zip
                      .file(actualPath)
                      ?.async("uint8array");
                    if (imageBinary) {
                      const blob = new Blob([imageBinary]);
                      const base64 = await fileToBase64(
                        new File([blob], "slideImage", { type: "image/*" }),
                      );
                      slideImage = base64;
                    }

                    break;
                  }
                }
              }
            } catch (imgErr) {
              slideImage = "[Error extracting image]";
            }

            slidesArray.push({
              slideNumber: slidesArray.length + 1,
              slideText,
              slideImage,
            });
          }
          continue;
        }

        if (file.type === "application/vnd.ms-powerpoint") {
          slidesArray.push({
            slideNumber: slidesArray.length + 1,
            slideText: "[Legacy PPT format not supported]",
            slideImage: "",
          });
        } else {
          slidesArray.push({
            slideNumber: slidesArray.length + 1,
            slideText: "[Unsupported file type]",
            slideImage: "",
          });
        }
      } catch (outerErr) {
        slidesArray.push({
          slideNumber: slidesArray.length + 1,
          slideText: "[Error reading file]",
          slideImage: "",
        });
      }
    }

    setSlidesData(questionId, slidesArray);
    setProcessSlides(false);
  };

  const handleReplaceOriginalVideo = async () => {
    if (!trimmedVideoURL) return;
    try {
      const res = await fetch(trimmedVideoURL);
      const trimmedBlob = await res.blob();
      const trimmedFile = new File([trimmedBlob], "trimmed.mp4", {
        type: "video/mp4",
      });
      setVideoFile(trimmedFile);
      setVideoURL(trimmedVideoURL);
      setTrimmedVideoURL("");
      setShowEditorModal(false);

      setReadyIndicator(false);
    } catch (err) {
      console.error("Error replacing original video:", err);
    }
  };

  const openEditorModal = () => setShowEditorModal(true);
  const closeEditorModal = () => {
    setShowEditorModal(false);
    setLimitError("");
  };

  const finalTrimLength = trimEnd - trimStart;
  const isExceedingLimit = targetTime > 0 && finalTrimLength > targetTime;

  return (
    <div className="bg-white rounded-lg overflow-hidden w-full max-w-lg mx-auto border">
      {processingTranscript || (!transcript && videoFile) ? (
        <div className="flex items-center justify-center h-64 border-b">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
            <p className="text-violet-600">Processing...</p>
          </div>
        </div>
      ) : (
        <div className="relative">
          {videoURL ? (
            <video
              ref={videoRef}
              src={videoURL}
              onLoadedMetadata={onVideoLoadedMetadata}
              controls
              className="w-full aspect-video object-contain bg-black"
            />
          ) : null}
        </div>
      )}

      <div className="p-6">
        <label className="block font-semibold mb-1">Upload Video:</label>

        <div
          {...getVideoRootProps()}
          className="border-dashed border-2 p-4 text-center cursor-pointer mb-4"
        >
          <input {...getVideoInputProps()} />
          <p className="text-sm text-gray-600">
            {videoURL
              ? "Replace the video by dropping or clicking here."
              : "Drag & drop or click to select a video file."}
          </p>
        </div>

        {videoURL && (
          <div className="flex justify-center space-x-4 mb-4">
            <button
              onClick={removeVideo}
              className="px-5 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
              Remove Video
            </button>
            <button
              onClick={openEditorModal}
              className="px-5 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
            >
              Edit/Trim Video
            </button>
          </div>
        )}

        {evaluateSlidesQuality && (
          <div className="mb-4">
            <label className="block font-semibold mb-1">
              Upload Slides (PowerPoint only):
            </label>
            {processSlides ? (
              <div className="flex items-center justify-center h-16 border-b">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
                  <p className="text-violet-600">Processing...</p>
                </div>
              </div>
            ) : (
              <div
                {...getSlidesRootProps()}
                className="border-dashed border-2 p-4 text-center cursor-pointer"
              >
                <input {...getSlidesInputProps()} />
                <p className="text-sm text-gray-600">
                  Drag & drop or click to select PPTX files.
                </p>
              </div>
            )}
            {slidesFiles.length > 0 && (
              <ul className="mt-2">
                {slidesFiles.map((file, idx) => (
                  <li
                    key={file.name}
                    className="flex items-center justify-between text-sm my-1"
                  >
                    <span>{file.name}</span>
                    <button
                      onClick={() => removeSlide(idx)}
                      className="ml-2 px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {readyIndicator &&
          (transcript || (evaluateSlidesQuality && slidesData)) && (
            <div className="mb-4 p-3 border border-green-300 bg-green-50 text-green-700 rounded">
              <h3 className="font-semibold text-center text-sm mb-1">
                Ready to Submit
              </h3>
            </div>
          )}

        {limitError && (
          <p className="text-red-600 text-sm mb-2">
            <strong>Note:</strong> {limitError}
          </p>
        )}
      </div>

      {showEditorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-lg p-4 rounded shadow-lg relative">
            <h3 className="text-lg font-semibold mb-4">Edit / Trim Video</h3>
            {targetTime > 0 && (
              <p className="text-xs text-gray-600 mb-2">
                Maximum allowed length: {targetTime} seconds
              </p>
            )}

            <p className="text-sm font-medium mb-1">Start Time (mm:ss):</p>
            <div className="flex space-x-2 mb-3">
              <input
                type="number"
                value={trimStartMinutes}
                min={0}
                max={Math.floor(videoDuration / 60)}
                onChange={(e) =>
                  updateTrimStart(
                    parseInt(e.target.value, 10),
                    trimStartSeconds,
                  )
                }
                className="border rounded p-1 w-16"
              />

              <input
                type="number"
                value={trimStartSeconds}
                min={0}
                max={59}
                onChange={(e) =>
                  updateTrimStart(
                    trimStartMinutes,
                    parseInt(e.target.value, 10),
                  )
                }
                className="border rounded p-1 w-16"
              />
            </div>

            <p className="text-sm font-medium mb-1">End Time (mm:ss):</p>
            <div className="flex space-x-2 mb-3">
              <input
                type="number"
                value={trimEndMinutes}
                min={0}
                max={Math.floor(videoDuration / 60)}
                onChange={(e) =>
                  updateTrimEnd(parseInt(e.target.value, 10), trimEndSeconds)
                }
                className="border rounded p-1 w-16"
              />

              <input
                type="number"
                value={trimEndSeconds}
                min={0}
                max={59}
                onChange={(e) =>
                  updateTrimEnd(trimEndMinutes, parseInt(e.target.value, 10))
                }
                className="border rounded p-1 w-16"
              />
            </div>

            {trimmedVideoURL && (
              <div className="mb-3">
                <p className="font-semibold">Trimmed Video Preview:</p>
                <video
                  src={trimmedVideoURL}
                  controls
                  className="w-full mt-2 bg-black"
                />

                <button
                  onClick={removeTrimmedVideo}
                  className="mt-2 px-2 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                >
                  Remove Trimmed Video
                </button>
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <button
                onClick={closeEditorModal}
                className="px-3 py-1 bg-gray-300 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={trimVideo}
                disabled={!ffmpegLoaded || processingTrim}
                className={`px-4 py-2 rounded text-white ${
                  !ffmpegLoaded || processingTrim
                    ? "bg-gray-400"
                    : "bg-purple-600 hover:bg-purple-700"
                }`}
              >
                {processingTrim ? "Trimming..." : "Trim Now"}
              </button>
              <button
                onClick={handleReplaceOriginalVideo}
                disabled={!trimmedVideoURL || isExceedingLimit}
                className={`px-4 py-2 rounded text-white ${
                  trimmedVideoURL && !isExceedingLimit
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-gray-400"
                }`}
              >
                Done
              </button>
            </div>

            {isExceedingLimit && (
              <p className="text-red-600 text-xs mt-2">
                Your trim exceeds the {targetTime}-second limit. Adjust times or
                remove the trimmed video.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPresentationEditor;
