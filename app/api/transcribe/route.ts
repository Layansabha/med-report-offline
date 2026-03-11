import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const MAX_FREE_TIER_BYTES = 25 * 1024 * 1024;

type AudioMode = "transcribe" | "translate";

type GroqAudioResponse = {
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

function resolveAudioMode(value: unknown): AudioMode {
  return value === "translate" ? "translate" : "transcribe";
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

    const requestedModeRaw = incoming.get("mode");
    const envModeRaw = process.env.GROQ_AUDIO_MODE;
    const mode = resolveAudioMode(requestedModeRaw || envModeRaw);

    const endpoint =
      mode === "translate"
        ? `${GROQ_BASE_URL}/audio/translations`
        : `${GROQ_BASE_URL}/audio/transcriptions`;

    const model =
      mode === "translate"
        ? "whisper-large-v3"
        : process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3";

    const spellingHints = process.env.GROQ_TRANSCRIBE_HINTS?.trim() || "";

    const transcribePrompt = [
      "النص عبارة عن إملاء طبي مختلط عربي وإنجليزي.",
      "اكتب الكلام العربي بحروف عربية، وليس Arabizi.",
      "Keep spoken English medical words in English.",
      "Preserve medication names, dosages, abbreviations, case numbers, and ages exactly as spoken.",
      "Do not omit drug names even if they appear inside Arabic speech.",
      "Do not invent words that are not in the audio.",
    ]
      .concat(spellingHints ? [`Important spellings: ${spellingHints}`] : [])
      .join(" ");

    const translatePrompt = [
      "Translate the spoken audio into clear English medical text.",
      "Preserve medication names, dosages, abbreviations, ages, and case numbers accurately.",
      "Do not omit drug names.",
      "Do not invent facts.",
    ]
      .concat(spellingHints ? [`Important spellings: ${spellingHints}`] : [])
      .join(" ");

    const groqForm = new FormData();
    groqForm.append("file", file, file.name || `visit-${Date.now()}.webm`);
    groqForm.append("model", model);
    groqForm.append("response_format", "verbose_json");
    groqForm.append("temperature", "0");
    groqForm.append(
      "prompt",
      mode === "translate" ? translatePrompt : transcribePrompt,
    );
    groqForm.append("timestamp_granularities[]", "segment");

    // For translation endpoint, Groq docs indicate English output.
    if (mode === "translate") {
      groqForm.append("language", "en");
    }

    const groqRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: groqForm,
    });

    const rawText = await groqRes.text();
    const parsed = tryParseJson<GroqAudioResponse>(rawText);

    if (!groqRes.ok) {
      return NextResponse.json(
        {
          error:
            parsed?.error?.message ||
            rawText ||
            `${mode === "translate" ? "Translation" : "Transcription"} failed.`,
        },
        { status: groqRes.status },
      );
    }

    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    const language =
      typeof parsed?.language === "string"
        ? parsed.language
        : mode === "translate"
          ? "en"
          : "";

    return NextResponse.json({
      mode,
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
            : "Unexpected audio processing error.",
      },
      { status: 500 },
    );
  }
}
