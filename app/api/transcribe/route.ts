import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const GROQ_TRANSCRIBE_URL = `${GROQ_BASE_URL}/audio/transcriptions`;
const MAX_FREE_TIER_BYTES = 25 * 1024 * 1024;

type GroqTranscriptionResponse = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: unknown[];
  error?: {
    message?: string;
  };
};

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GROQ_API_KEY." },
        { status: 500 },
      );
    }

    const incoming = await req.formData();
    const file = incoming.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing audio file." },
        { status: 400 },
      );
    }

    if (!file.size) {
      return NextResponse.json(
        { error: "Audio file is empty." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FREE_TIER_BYTES) {
      return NextResponse.json(
        {
          error:
            "Audio file is larger than 25MB. Compress it or split it into smaller chunks.",
        },
        { status: 400 },
      );
    }

    const model = process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3";
    const spellingHints = process.env.GROQ_TRANSCRIBE_HINTS?.trim() || "";

    const prompt = [
      "This is mixed Arabic and English medical dictation.",
      "Write spoken Arabic in Arabic script, not Arabizi.",
      "Keep spoken English medical words in English.",
      "Preserve medication names, dosages, diagnoses, abbreviations, ages, and case numbers exactly as spoken.",
      "Do not omit drug names.",
      "Do not invent words that are not in the audio.",
      spellingHints ? `Important spellings: ${spellingHints}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const groqForm = new FormData();
    groqForm.append("file", file, file.name || `visit-${Date.now()}.webm`);
    groqForm.append("model", model);
    groqForm.append("response_format", "verbose_json");
    groqForm.append("temperature", "0");
    groqForm.append("prompt", prompt);
    groqForm.append("timestamp_granularities[]", "segment");

    const groqRes = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: groqForm,
    });

    const rawText = await groqRes.text();
    const parsed = tryParseJson<GroqTranscriptionResponse>(rawText);

    if (!groqRes.ok) {
      return NextResponse.json(
        {
          error: parsed?.error?.message || rawText || "Transcription failed.",
        },
        { status: groqRes.status },
      );
    }

    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    const language =
      typeof parsed?.language === "string" ? parsed.language : "";

    return NextResponse.json({
      text,
      language,
      duration: typeof parsed?.duration === "number" ? parsed.duration : null,
      segments: Array.isArray(parsed?.segments) ? parsed.segments : [],
      model,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected transcription error.",
      },
      { status: 500 },
    );
  }
}
