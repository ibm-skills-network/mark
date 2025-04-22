import { TranscriptSegment } from "@/config/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    // Ensure API key is available
    const apiKey = process.env.OPENAI_API_SPEECH_TEXT_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 500 });
    }

    // Parse the request body
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: "Invalid or missing audio file" },
        { status: 400 },
      );
    }
    // Prepare formData for OpenAI API
    const openAiFormData = new FormData();
    openAiFormData.append("model", "whisper-1");
    openAiFormData.append("file", audioFile);
    // Set response_format to verbose_json to receive timestamped segments
    openAiFormData.append("response_format", "verbose_json");

    // Call OpenAI Whisper API
    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: openAiFormData,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API Error:", errorText);
      return NextResponse.json(
        { error: "OpenAI API request failed", details: errorText },
        { status: response.status },
      );
    }

    // Parse and return OpenAI API response
    const data: {
      text: string;
      segments: TranscriptSegment[];
    } = (await response.json()) as {
      text: string;
      segments: TranscriptSegment[];
    };
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error processing transcription:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
