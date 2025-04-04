import { TranscriptionResult } from "@/config/types";

export const transcribeAudio = async (
  audioBlob: Blob,
): Promise<TranscriptionResult> => {
  const formData = new FormData();
  formData.append("audio", audioBlob);

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Transcription request failed");
  }

  const data = (await response.json()) as TranscriptionResult;
  return data;
};
