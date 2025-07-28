import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import * as posenet from "@tensorflow-models/posenet";
import nlp from "compromise";
import React, { useEffect, useRef, useState } from "react";
import "@tensorflow/tfjs-backend-webgl";
import { transcribeAudio } from "@/app/Helpers/transcribeAudio";
import FeedbackFormatter from "@/components/FeedbackFormatter";
import {
  LiveRecordingConfig,
  LiveRecordingData,
  QuestionStore,
  TranscriptSegment,
} from "@/config/types";
import { getLiveRecordingFeedback } from "@/lib/talkToBackend";
import { useLearnerStore, useVideoRecorderStore } from "@/stores/learner";

const ffmpeg = new FFmpeg();

/** ------------------------------------------------------------------
 * HOOK #1: Manage camera stream, recording, and a manual timer
 * ------------------------------------------------------------------ */
const useVideoRecorder = (onRecordingComplete: (blob: Blob) => void) => {
  const [recordingStartTime, setRecordingStartTimeLocal] = useState<
    number | null
  >(null);

  const {
    recording,
    videoBlob,
    videoURL,
    countdown,
    cameraError,
    startRecording: storeStartRecording,
    stopRecording: storeStopRecording,
    reconnectCamera,
    setCameraError,
    setVideoBlob,
    setVideoURL,
    setRecording,
    setCountdown,
  } = useVideoRecorderStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const setVideoRef = useVideoRecorderStore((state) => state.setVideoRef);
  useEffect(() => {
    setVideoRef(videoRef.current);
  }, [setVideoRef]);

  useEffect(() => {
    const initPreview = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        useVideoRecorderStore.getState().setStreamRef(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (err) {
            console.error("Error playing video:", err);
            setCameraError(
              "Error playing video. Please check your browser settings.",
            );
          }
        }
      } catch (err: any) {
        setCameraError(
          "Error accessing camera. Please check your camera settings.",
        );
      }
    };
    void initPreview();
  }, [setCameraError]);

  useEffect(() => {
    return () => {
      const stream = useVideoRecorderStore.getState().streamRef;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        useVideoRecorderStore.getState().setStreamRef(null);
      }
    };
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      useVideoRecorderStore.getState().startRecordingImpl(onRecordingComplete);
      setCountdown(null);
    }
  }, [countdown, setCountdown, onRecordingComplete]);

  useEffect(() => {
    setRecordingStartTimeLocal(
      useVideoRecorderStore.getState().recordingStartTime,
    );
  }, [recording]);

  return {
    recording,
    videoBlob,
    videoURL,
    videoRef,
    countdown,
    cameraError,
    reconnectCamera,
    startRecording: storeStartRecording,
    stopRecording: storeStopRecording,
    recordingStartTime,
  };
};

/** ------------------------------------------------------------------
 * HOOK #2: Process the video (FFmpeg + /api/transcribe)
 * ------------------------------------------------------------------ */
const useVideoProcessor = () => {
  const [processing, setProcessing] = useState(false);

  const extractAudio = async (videoBlob: Blob) => {
    try {
      await ffmpeg.writeFile("input.webm", await fetchFile(videoBlob));

      await ffmpeg.exec([
        "-i",
        "input.webm",
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
      try {
        await ffmpeg.deleteFile("input.webm");
        await ffmpeg.deleteFile("output.wav");
      } catch {
        console.error("Error deleting temporary files");
      }
    }
  };

  const processVideo = async (
    videoBlob: Blob,
  ): Promise<{
    text: string;
    segments: TranscriptSegment[];
  }> => {
    setProcessing(true);
    try {
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
      const audioBlob = await extractAudio(videoBlob);
      return await transcribeAudio(audioBlob);
    } finally {
      setProcessing(false);
    }
  };

  return { processing, processVideo };
};

/** ------------------------------------------------------------------
 * BODY LANGUAGE ANALYSIS (PoseNet)
 * ------------------------------------------------------------------ */
const getFrameCountAdaptive = (duration: number): number => {
  const minFrames = 10;
  const maxFrames = 30;
  if (duration <= 30) return minFrames;
  if (duration >= 120) return maxFrames;
  return Math.round(
    minFrames + ((duration - 30) / (120 - 30)) * (maxFrames - minFrames),
  );
};

const evaluateBodyLanguageMultipleFrames = async (
  videoElement: HTMLVideoElement,
  frameCount?: number,
): Promise<{ score: number; explanation: string }> => {
  while (
    !videoElement.duration ||
    videoElement.duration === Infinity ||
    isNaN(videoElement.duration)
  ) {
    await new Promise((r) => setTimeout(r, 100));
  }

  const duration = videoElement.duration;
  const framesToSample = frameCount ?? getFrameCountAdaptive(duration);

  const originalTime = videoElement.currentTime;
  videoElement.pause();

  const net = await posenet.load();

  let totalConfidence = 0;
  let framesAnalyzed = 0;

  let totalShoulderPenalty = 0;
  let effectiveLeftCount = 0;
  let effectiveRightCount = 0;
  let effectiveEyeCount = 0;

  for (let i = 0; i < framesToSample; i++) {
    const targetTime = (duration / (framesToSample + 1)) * (i + 1);

    await new Promise<void>((resolve) => {
      const handler = () => {
        resolve();
        videoElement.removeEventListener("seeked", handler);
      };
      videoElement.addEventListener("seeked", handler);
      videoElement.currentTime = targetTime;
    });

    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const pose = await net.estimateSinglePose(canvas, {
      flipHorizontal: false,
    });
    const keypoints = pose.keypoints;
    const avgConfidence =
      keypoints.reduce((sum, kp) => sum + kp.score, 0) / keypoints.length;
    totalConfidence += avgConfidence;

    const leftShoulder = keypoints.find((kp) => kp.part === "leftShoulder");
    const rightShoulder = keypoints.find((kp) => kp.part === "rightShoulder");
    if (leftShoulder && rightShoulder) {
      const shoulderDiff = Math.abs(
        leftShoulder.position.y - rightShoulder.position.y,
      );
      const penalty = (shoulderDiff / canvas.height) * 50;
      totalShoulderPenalty += penalty;
    }

    const leftWrist = keypoints.find((kp) => kp.part === "leftWrist");
    const rightWrist = keypoints.find((kp) => kp.part === "rightWrist");
    if (leftShoulder && rightShoulder && leftWrist) {
      const shoulderWidth = Math.abs(
        rightShoulder.position.x - leftShoulder.position.x,
      );
      const leftDistance = Math.abs(
        leftWrist.position.x - leftShoulder.position.x,
      );
      if (leftDistance > shoulderWidth * 0.3) {
        effectiveLeftCount++;
      }
    }
    if (leftShoulder && rightShoulder && rightWrist) {
      const shoulderWidth = Math.abs(
        rightShoulder.position.x - leftShoulder.position.x,
      );
      const rightDistance = Math.abs(
        rightWrist.position.x - rightShoulder.position.x,
      );
      if (rightDistance > shoulderWidth * 0.3) {
        effectiveRightCount++;
      }
    }

    const leftEye = keypoints.find((kp) => kp.part === "leftEye");
    const rightEye = keypoints.find((kp) => kp.part === "rightEye");
    if (leftEye && rightEye) {
      const avgEyeX = (leftEye.position.x + rightEye.position.x) / 2;
      const centerX = canvas.width / 2;
      const allowedDeviation = canvas.width * 0.1;
      if (Math.abs(avgEyeX - centerX) < allowedDeviation) {
        effectiveEyeCount++;
      }
    }

    framesAnalyzed++;
  }

  videoElement.currentTime = originalTime;
  const avgConfidencePercent = (totalConfidence / framesAnalyzed) * 100;
  const avgShoulderPenalty = totalShoulderPenalty / framesAnalyzed;
  const effectiveLeftPercentage = (effectiveLeftCount / framesAnalyzed) * 100;
  const effectiveRightPercentage = (effectiveRightCount / framesAnalyzed) * 100;
  const effectiveEyePercentage = (effectiveEyeCount / framesAnalyzed) * 100;

  let finalScore = avgConfidencePercent - avgShoulderPenalty;
  if (effectiveLeftPercentage > 50) finalScore += 5;
  if (effectiveRightPercentage > 50) finalScore += 5;
  if (effectiveEyePercentage > 50) finalScore += 5;
  finalScore = Math.max(0, Math.min(100, finalScore));

  const explanation = `Body Language Analysis:
- ${framesAnalyzed} frames analyzed
- Avg keypoint confidence: ${avgConfidencePercent.toFixed(1)}%
- Shoulder penalty: ${avgShoulderPenalty.toFixed(1)}
- Left-hand usage: ${effectiveLeftPercentage.toFixed(1)}%
- Right-hand usage: ${effectiveRightPercentage.toFixed(1)}%
- Eye contact measure: ${effectiveEyePercentage.toFixed(1)}%
- Final body language score: ${finalScore.toFixed(1)}%`;

  return { score: finalScore, explanation };
};

/** ------------------------------------------------------------------
 * SPEECH & CONTENT ANALYSIS
 * ------------------------------------------------------------------ */
const analyzeSpeechReport = (text: string): string => {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const uniqueWords = new Set(words.map((w) => w.toLowerCase())).size;
  const lexicalDiversity = wordCount ? uniqueWords / wordCount : 0;

  const fillerWords = [
    "um",
    "uh",
    "like",
    "you",
    "know",
    "basically",
    "literally",
  ];
  const fillerCount = words.filter((w) =>
    fillerWords.includes(w.toLowerCase()),
  ).length;

  return `Speech Analysis:
- Total words: ${wordCount}
- Lexical diversity: ${(lexicalDiversity * 100).toFixed(1)}% unique
- Filler words: ${fillerCount}`;
};

const analyzeContentReport = (text: string): string => {
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const doc = nlp(text);

  const namedEntities: string[] = doc.topics().out("array") as string[];
  const hasStrongEntities = namedEntities.length > 3;

  const totalWords = text.split(/\s+/).filter(Boolean).length;
  const complexWords = text.split(/\s+/).filter((w) => w.length > 6).length;
  const vocabComplexity = totalWords ? complexWords / totalWords : 0;

  return `Content Analysis:
- Sentences: ${sentences.length}
- Key topics: ${namedEntities.join(", ") || "(none)"}
- Vocab complexity: ${(vocabComplexity * 100).toFixed(1)}%
- Strong usage of named entities: ${hasStrongEntities ? "Yes" : "No"}`;
};

/** ------------------------------------------------------------------
 * MAIN COMPONENT: PresentationGrader
 * ------------------------------------------------------------------ */
interface PresentationGraderProps {
  question: QuestionStore;
  assignmentId: number;
}

export default function PresentationGrader({
  question,
  assignmentId,
}: PresentationGraderProps) {
  const [aiFeedback, setAiFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const [lastTranscript, setLastTranscript] = useState("");
  const [lastSpeechReport, setLastSpeechReport] = useState("");
  const [lastContentReport, setLastContentReport] = useState("");
  const [lastBodyLanguageExplanation, setLastBodyLanguageExplanation] =
    useState("");

  const [cachedEvaluation, setCachedEvaluation] =
    useState<LiveRecordingData | null>(null);

  const liveConfig: LiveRecordingConfig = question.liveRecordingConfig ?? {
    evaluateBodyLanguage: false,
    realTimeAiCoach: false,
    evaluateTimeManagement: false,
    targetTime: 60,
  };
  const evaluateBodyLanguageEnabled = liveConfig.evaluateBodyLanguage ?? false;
  const realTimeAiCoachEnabled = liveConfig.realTimeAiCoach ?? false;
  const maxDuration = liveConfig.targetTime ?? 60;

  const questionId = question.id;
  const setPresentationResponse = useLearnerStore(
    (state) => state.setPresentationResponse,
  );
  function buildTimestampedTranscript(segments: TranscriptSegment[]): string {
    if (!Array.isArray(segments)) return "";

    return segments
      .map((seg) => {
        const startTime: string =
          typeof seg.start === "number" ? seg.start.toFixed(2) : "0.00";
        const endTime: string =
          typeof seg.end === "number" ? seg.end.toFixed(2) : "0.00";
        return `[${startTime}s - ${endTime}s] ${seg.text.trim()}`;
      })
      .join("\n");
  }

  const { processing, processVideo } = useVideoProcessor();

  const evaluatePresentation = async (
    rawBlob: Blob,
    videoEl: HTMLVideoElement,
  ): Promise<LiveRecordingData> => {
    if (cachedEvaluation) {
      return cachedEvaluation;
    }

    const transcription = await processVideo(rawBlob);

    let rawText = transcription.text || "";
    if (
      liveConfig.evaluateTimeManagement &&
      Array.isArray(transcription.segments)
    ) {
      rawText = buildTimestampedTranscript(transcription.segments);
    }

    const speechAnalysis = analyzeSpeechReport(rawText);
    const contentAnalysis = analyzeContentReport(rawText);

    let bodyGrade = 0;
    let bodyExplanation = "";
    if (evaluateBodyLanguageEnabled) {
      const { score, explanation } =
        await evaluateBodyLanguageMultipleFrames(videoEl);
      bodyGrade = score;
      bodyExplanation = explanation;
    }

    const evaluation: LiveRecordingData = {
      transcript: rawText,
      speechReport: speechAnalysis,
      contentReport: contentAnalysis,
      bodyLanguageScore: bodyGrade,
      bodyLanguageExplanation: bodyExplanation,
      question,
    };

    setCachedEvaluation(evaluation);
    setLastTranscript(rawText);
    setLastSpeechReport(speechAnalysis);
    setLastContentReport(contentAnalysis);
    setLastBodyLanguageExplanation(bodyExplanation);

    const minimalReport = {
      transcript: rawText,
      speechReport: speechAnalysis,
      contentReport: contentAnalysis,
      ...(evaluateBodyLanguageEnabled && {
        bodyLanguageScore: bodyGrade,
        bodyLanguageExplanation: bodyExplanation,
      }),
    };
    setPresentationResponse(questionId, minimalReport);

    return evaluation;
  };

  const getFeedbackForRecording = async (
    evaluation: LiveRecordingData,
  ): Promise<string> => {
    const feedbackResponse = await getLiveRecordingFeedback(
      assignmentId,
      evaluation,
    );
    return feedbackResponse && feedbackResponse.feedback
      ? feedbackResponse.feedback
      : "No feedback received from server.";
  };

  const handleRecordingComplete = async (finalBlob: Blob) => {
    if (!videoRef.current) return;
    try {
      setFeedbackLoading(true);
      const evalData = await evaluatePresentation(finalBlob, videoRef.current);

      if (realTimeAiCoachEnabled) {
        const feedback = await getFeedbackForRecording(evalData);
        setAiFeedback(feedback);
      } else {
        setAiFeedback("");
      }
    } catch (err) {
      setAiFeedback("Error processing video. Please try again.");
    } finally {
      setFeedbackLoading(false);
    }
  };

  const {
    recording,
    videoBlob,
    videoURL,
    videoRef,
    countdown,
    cameraError,
    reconnectCamera,
    startRecording,
    stopRecording,
    recordingStartTime,
  } = useVideoRecorder(handleRecordingComplete);

  const [currentRecordingTime, setCurrentRecordingTime] = useState(0);

  useEffect(() => {
    const loadFFmpeg = async () => {
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
    void loadFFmpeg();
  }, []);

  useEffect(() => {
    setCachedEvaluation(null);
    setAiFeedback("");
    setLastTranscript("");
    setLastSpeechReport("");
    setLastContentReport("");
    setLastBodyLanguageExplanation("");
  }, [videoBlob]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (recording && recordingStartTime !== null) {
      timer = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        setCurrentRecordingTime(elapsed);

        if (elapsed >= maxDuration) {
          stopRecording();
        }
      }, 200);
    } else {
      setCurrentRecordingTime(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording, recordingStartTime, maxDuration, stopRecording]);

  return (
    <div className="bg-white rounded-lg overflow-hidden w-full max-w-lg mx-auto border relative">
      <div className="relative">
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className="w-full aspect-video object-contain bg-black"
        />

        {countdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white text-6xl font-bold">
            {countdown > 0 ? countdown : "Go!"}
          </div>
        )}

        {recording && (
          <div className="absolute top-4 left-4 flex items-center space-x-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
            <span className="text-white font-semibold">Recording</span>
          </div>
        )}

        {recording && (
          <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            {currentRecordingTime.toFixed(1)}s / {maxDuration}s
          </div>
        )}
      </div>

      <div className="p-6">
        {cameraError && (
          <div className="text-red-600 text-center mb-4 flex flex-col items-center">
            <span>{cameraError}</span>
            <button
              onClick={reconnectCamera}
              className="mt-2 px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition"
            >
              Reconnect Camera
            </button>
          </div>
        )}

        <div className="flex justify-center space-x-4 mb-4">
          {!recording ? (
            <button
              onClick={() => {
                setCachedEvaluation(null);
                setAiFeedback("");
                void startRecording();
              }}
              disabled={feedbackLoading || processing}
              className="flex items-center space-x-2 px-5 py-3 bg-purple-600 text-white rounded hover:bg-purple-700 transition disabled:bg-purple-300"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="8" />
              </svg>
              <span>{videoURL ? "Re-record" : "Start Recording"}</span>
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center space-x-2 px-5 py-3 bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <rect x="6" y="6" width="12" height="12" />
              </svg>
              <span>Stop Recording</span>
            </button>
          )}
        </div>

        {(evaluateBodyLanguageEnabled || liveConfig.evaluateTimeManagement) && (
          <p className="mt-4 text-center text-gray-600 italic">
            Note: Your{" "}
            {evaluateBodyLanguageEnabled && (
              <span className="font-semibold">body language</span>
            )}
            {liveConfig.evaluateTimeManagement && (
              <>
                {evaluateBodyLanguageEnabled ? " and " : ""}
                <span className="font-semibold">pacing</span>
              </>
            )}{" "}
            will be evaluated.
          </p>
        )}

        {(processing || feedbackLoading) && (
          <div className="mt-4 p-4 border rounded bg-gray-100 text-gray-800 text-sm">
            <div className="animate-pulse">Processing video… please wait.</div>
          </div>
        )}

        {videoBlob && !recording && !processing && (
          <div className="mt-4 p-4 border rounded bg-gray-50 text-gray-800">
            {feedbackLoading ? (
              <div className="animate-pulse">Analyzing your presentation…</div>
            ) : (
              <>
                {realTimeAiCoachEnabled && (
                  <>
                    <h3 className="font-bold mb-2">AI Feedback:</h3>
                    {aiFeedback ? (
                      <FeedbackFormatter>{aiFeedback}</FeedbackFormatter>
                    ) : (
                      <div className="text-sm text-gray-500 italic">
                        No feedback yet.
                      </div>
                    )}
                    <hr className="my-4" />
                  </>
                )}
                <p className="text-sm whitespace-pre-line">
                  <strong>What The Ai heard:</strong>{" "}
                  {lastTranscript || "(not available)"}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
