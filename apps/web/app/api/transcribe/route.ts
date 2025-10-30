import { TranscriptSegment } from "@/config/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_SPEECH_TEXT_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 500 });
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: "Invalid or missing audio file" },
        { status: 400 },
      );
    }

    const openAiFormData = new FormData();
    openAiFormData.append("model", "whisper-1");
    openAiFormData.append("file", audioFile);

    openAiFormData.append("response_format", "verbose_json");

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

      return NextResponse.json(
        { error: "OpenAI API request failed", details: errorText },
        { status: response.status },
      );
    }

    const data: {
      text: string;
      segments: TranscriptSegment[];
    } = (await response.json()) as {
      text: string;
      segments: TranscriptSegment[];
    };
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
