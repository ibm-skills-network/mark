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

// --------------------------------------------------------------------
//  GLOBAL FFmpeg INSTANCE
// --------------------------------------------------------------------
const ffmpeg = new FFmpeg();

/** ------------------------------------------------------------------
 * HOOK #1: Manage camera stream, recording, and a manual timer
 * ------------------------------------------------------------------ */
const useVideoRecorder = (onRecordingComplete: (blob: Blob) => void) => {
  // Keep local state only for values not (or not yet) stored in Zustand.
  const [recordingStartTime, setRecordingStartTimeLocal] = useState<
    number | null
  >(null);

  // Get values and actions from the store.
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

  // Use the store’s videoRef.
  const videoRef = useRef<HTMLVideoElement>(null);
  const setVideoRef = useVideoRecorderStore((state) => state.setVideoRef);
  useEffect(() => {
    setVideoRef(videoRef.current);
  }, [setVideoRef]);

  // Instead of using a local streamRef, use the store’s.
  useEffect(() => {
    const initPreview = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        // Set stream into the store.
        useVideoRecorderStore.getState().setStreamRef(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (err) {
            console.log("video play interrupted:", err);
          }
        }
      } catch (err: any) {
        console.error("Error initializing camera:", err);
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

  // Local countdown effect: when countdown reaches zero, trigger startRecordingImpl from the store.
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

  // Optionally, if you need to sync local recordingStartTime with the store:
  useEffect(() => {
    setRecordingStartTimeLocal(
      useVideoRecorderStore.getState().recordingStartTime,
    );
  }, [recording]); // update when recording changes

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
      // Store input as input.webm
      await ffmpeg.writeFile("input.webm", await fetchFile(videoBlob));

      // Convert to WAV (mono, 16kHz)
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
      // Clean up
      try {
        await ffmpeg.deleteFile("input.webm");
        await ffmpeg.deleteFile("output.wav");
      } catch {
        // ignore
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
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
            "text/javascript",
          ),
          wasmURL: await toBlobURL(
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
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
  // Wait for metadata
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
  // Using .topics() for named entities. Adjust if you prefer doc.nouns() or doc.ner() instead
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
  // 1) State for showing AI feedback (only used if realTimeAiCoachEnabled)
  const [aiFeedback, setAiFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  // 2) Store intermediate analysis if desired
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastSpeechReport, setLastSpeechReport] = useState("");
  const [lastContentReport, setLastContentReport] = useState("");
  const [lastBodyLanguageExplanation, setLastBodyLanguageExplanation] =
    useState("");

  // 3) Keep a cached evaluation so we don't re-run if user replays the same blob
  const [cachedEvaluation, setCachedEvaluation] =
    useState<LiveRecordingData | null>(null);

  // Extract config from the question
  const liveConfig: LiveRecordingConfig = question.liveRecordingConfig ?? {
    evaluateBodyLanguage: false,
    realTimeAiCoach: false,
    evaluateTimeManagement: false,
    targetTime: 60,
  };
  const evaluateBodyLanguageEnabled = liveConfig.evaluateBodyLanguage ?? false;
  const realTimeAiCoachEnabled = liveConfig.realTimeAiCoach ?? false;
  const maxDuration = liveConfig.targetTime ?? 60;

  // We may store results in your global app state
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

  // 5) Evaluate everything (transcribe, analyze speech/body) and store results
  const evaluatePresentation = async (
    rawBlob: Blob,
    videoEl: HTMLVideoElement,
  ): Promise<LiveRecordingData> => {
    // If we have it cached, skip re-analysis
    if (cachedEvaluation) {
      return cachedEvaluation;
    }

    // 1) Transcribe audio from the blob
    const transcription = await processVideo(rawBlob);
    // If time management is enabled, build a timestamped transcript
    let rawText = transcription.text || "";
    if (
      liveConfig.evaluateTimeManagement &&
      Array.isArray(transcription.segments)
    ) {
      rawText = buildTimestampedTranscript(transcription.segments);
    }

    // 2) Basic speech & content
    const speechAnalysis = analyzeSpeechReport(rawText);
    const contentAnalysis = analyzeContentReport(rawText);

    // 3) Body language if enabled
    let bodyGrade = 0;
    let bodyExplanation = "";
    if (evaluateBodyLanguageEnabled) {
      const { score, explanation } =
        await evaluateBodyLanguageMultipleFrames(videoEl);
      bodyGrade = score;
      bodyExplanation = explanation;
    }

    // 4) Build evaluation object
    const evaluation: LiveRecordingData = {
      transcript: rawText,
      speechReport: speechAnalysis,
      contentReport: contentAnalysis,
      bodyLanguageScore: bodyGrade,
      bodyLanguageExplanation: bodyExplanation,
      question,
    };

    // 5) Save to local state for reference
    setCachedEvaluation(evaluation);
    setLastTranscript(rawText);
    setLastSpeechReport(speechAnalysis);
    setLastContentReport(contentAnalysis);
    setLastBodyLanguageExplanation(bodyExplanation);

    // 6) Also store in your global store (Zustand)
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

  // 6) Once we have an evaluation, get AI feedback from your server IF realTimeAiCoachEnabled
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

  // 7) This callback is passed to our hook so that as soon as the recording stops
  //    (and we have the final Blob), we run everything automatically.
  const handleRecordingComplete = async (finalBlob: Blob) => {
    if (!videoRef.current) return;
    try {
      setFeedbackLoading(true);
      const evalData = await evaluatePresentation(finalBlob, videoRef.current);

      // Only request server-side AI feedback if realTimeAiCoachEnabled is true
      if (realTimeAiCoachEnabled) {
        const feedback = await getFeedbackForRecording(evalData);
        setAiFeedback(feedback);
      } else {
        // If coaching is disabled, we simply won't set any AI feedback
        setAiFeedback("");
      }
    } catch (err) {
      console.error("Error processing video:", err);
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

  // 9) Show the "X seconds" timer
  const [currentRecordingTime, setCurrentRecordingTime] = useState(0);

  // Load FFmpeg once
  useEffect(() => {
    const loadFFmpeg = async () => {
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: await toBlobURL(
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
            "text/javascript",
          ),
          wasmURL: await toBlobURL(
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
            "application/wasm",
          ),
        });
      }
    };
    void loadFFmpeg();
  }, []);

  // If user re-records a new video, reset the cached evaluation & AI feedback
  useEffect(() => {
    setCachedEvaluation(null);
    setAiFeedback("");
    setLastTranscript("");
    setLastSpeechReport("");
    setLastContentReport("");
    setLastBodyLanguageExplanation("");
  }, [videoBlob]);

  // Manual timer effect
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (recording && recordingStartTime !== null) {
      timer = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        setCurrentRecordingTime(elapsed);

        // Stop automatically if we've reached maxDuration
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

  // RENDER
  return (
    <div className="bg-white rounded-lg overflow-hidden w-full max-w-lg mx-auto border relative">
      {/* VIDEO AREA */}
      <div className="relative">
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className="w-full aspect-video object-contain bg-black"
        />
        {/* Countdown overlay */}
        {countdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white text-6xl font-bold">
            {countdown > 0 ? countdown : "Go!"}
          </div>
        )}
        {/* Recording indicator */}
        {recording && (
          <div className="absolute top-4 left-4 flex items-center space-x-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
            <span className="text-white font-semibold">Recording</span>
          </div>
        )}
        {/* Timer */}
        {recording && (
          <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            {currentRecordingTime.toFixed(1)}s / {maxDuration}s
          </div>
        )}
      </div>

      {/* CONTROLS */}
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
              className="flex items-center space-x-2 px-5 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:bg-blue-300"
            >
              {/* Record icon */}
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
              {/* Stop icon */}
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

        {/* LOADING STATE */}
        {(processing || feedbackLoading) && (
          <div className="mt-4 p-4 border rounded bg-gray-100 text-gray-800 text-sm">
            <div className="animate-pulse">Processing video… please wait.</div>
          </div>
        )}

        {/* AFTER FINISHED: Show local analysis and (optionally) AI feedback */}
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

                {/* <p className="text-sm whitespace-pre-line">
                  <strong>Transcript:</strong>{" "}
                  {lastTranscript || "(not available)"}
                </p>
                <p className="text-sm whitespace-pre-line mt-2">
                  <strong>Speech Report:</strong> {lastSpeechReport}
                </p>
                <p className="text-sm whitespace-pre-line mt-2">
                  <strong>Content Report:</strong> {lastContentReport}
                </p>

                {evaluateBodyLanguageEnabled && lastBodyLanguageExplanation && (
                  <p className="text-sm whitespace-pre-line mt-2">
                    <strong>Body Language Analysis:</strong>{" "}
                    {lastBodyLanguageExplanation}
                  </p>
                )} */}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
