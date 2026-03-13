import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const GROQ_TRANSCRIBE_URL = `${GROQ_BASE_URL}/audio/transcriptions`;
const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;
const MAX_FREE_TIER_BYTES = 25 * 1024 * 1024;

type GroqTranscriptionResponse = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    id?: number;
    start?: number;
    end?: number;
    text?: string;
  }>;
  error?: {
    message?: string;
  };
};

type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
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

function compactText(value: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function buildLanguageHint(
  language: string,
  transcript: string,
  segments: Array<{ text?: string }> = [],
) {
  const sample = [
    transcript,
    ...segments.map((segment) => segment.text || ""),
  ].join(" ");
  const hasArabic = /[؀-ۿ]/.test(sample);
  const hasLatin = /[A-Za-z]/.test(sample);

  if (hasArabic && hasLatin) return "mixed-ar-en";
  if (hasArabic) return "arabic";
  if (hasLatin) return language || "english";
  return language || "unknown";
}

async function postProcessMixedTranscript(params: {
  apiKey: string;
  transcript: string;
  segments: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
}) {
  const transcript = compactText(params.transcript);
  if (!transcript) return "";

  const model = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-20b";
  const segmentText = params.segments
    .map((segment, index) => {
      const part = compactText(segment.text || "");
      if (!part) return "";
      const start =
        typeof segment.start === "number" ? segment.start.toFixed(2) : "";
      const end = typeof segment.end === "number" ? segment.end.toFixed(2) : "";
      return `${index + 1}. [${start}-${end}] ${part}`.trim();
    })
    .filter(Boolean)
    .join("\n");

  const systemPrompt = [
    "You clean ASR transcripts for clinical dictation.",
    "The audio may switch between Arabic and English inside the same sentence.",
    "Keep Arabic speech in Arabic script.",
    "Keep English speech in English.",
    "Do not translate the transcript into one language.",
    "Do not summarize.",
    "Do not drop medication names, patient names, numbers, dates, doses, abbreviations, or diagnoses.",
    "Only fix obvious ASR spacing and punctuation mistakes when helpful.",
    "Return plain text only.",
  ].join(" ");

  const userPrompt = [
    "Raw transcript:",
    transcript,
    segmentText ? "" : "",
    segmentText ? "ASR segments:" : "",
    segmentText,
    "",
    "Rewrite the transcript as one clean bilingual transcript while preserving the original language of each spoken phrase.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const raw = await res.text();
  const parsed = tryParseJson<GroqChatCompletionResponse>(raw);

  if (!res.ok) {
    throw new Error(
      parsed?.error?.message || raw || "Transcript cleanup failed.",
    );
  }

  return compactText(parsed?.choices?.[0]?.message?.content || transcript);
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
      "The speaker may code-switch several times in one sentence.",
      "Write spoken Arabic in Arabic script, not Arabizi.",
      "Keep spoken English medical words in English.",
      "Do not translate the whole audio into one language.",
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

    const text =
      typeof parsed?.text === "string" ? compactText(parsed.text) : "";
    const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];

    let mixedText = text;
    try {
      mixedText = await postProcessMixedTranscript({
        apiKey,
        transcript: text,
        segments,
      });
    } catch {
      mixedText = text;
    }

    const language =
      typeof parsed?.language === "string" ? parsed.language : "";
    const languageHint = buildLanguageHint(language, mixedText, segments);

    return NextResponse.json({
      text,
      mixedText,
      language,
      languageHint,
      duration: typeof parsed?.duration === "number" ? parsed.duration : null,
      segments,
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
