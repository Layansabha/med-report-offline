import { NextRequest, NextResponse } from "next/server";

type ReportRow = {
  system: string;
  diagnosis: string;
  diagnosisDate: string;
  medication: string;
  dose: string;
  how: string;
  purpose: string;
  plan: string;
};

type ReportPayload = {
  language: "en" | "ar";
  title: string;
  patientName: string;
  dob: string;
  mrn: string;
  occupation: string;
  supervisingDoctor: string;
  carer: string;
  allergies: string;
  intolerances: string;
  significantHistory: string;
  reviewDate: string;
  reviewCompletedBy: string;
  treatmentGoals: string;
  nextReviewDate: string;
  nextReviewMode: string;
  beforeNextReview: string;
  notes: string;
  rows: ReportRow[];
};

type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const DEFAULT_TRANSLATE_MODEL =
  process.env.GROQ_TRANSLATE_MODEL ||
  process.env.GROQ_TEXT_MODEL ||
  "openai/gpt-oss-20b";

function compactText(input: string) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function safeString(value: unknown) {
  return typeof value === "string" ? compactText(value) : "";
}

function cleanJsonText(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObject(text: string) {
  const cleaned = cleanJsonText(text);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return cleaned.slice(first, last + 1);
  }
  return cleaned;
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(cleanJsonText(text)) as T;
  } catch {
    try {
      return JSON.parse(extractJsonObject(text)) as T;
    } catch {
      return null;
    }
  }
}

function normalizeRow(value: unknown): ReportRow {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    system: safeString(row.system),
    diagnosis: safeString(row.diagnosis),
    diagnosisDate: safeString(row.diagnosisDate),
    medication: safeString(row.medication),
    dose: safeString(row.dose),
    how: safeString(row.how),
    purpose: safeString(row.purpose),
    plan: safeString(row.plan),
  };
}

function normalizePayload(value: unknown): ReportPayload {
  const payload = (value ?? {}) as Record<string, unknown>;
  return {
    language: payload.language === "ar" ? "ar" : "en",
    title: safeString(payload.title) || "Clinical Medication Review",
    patientName: safeString(payload.patientName),
    dob: safeString(payload.dob),
    mrn: safeString(payload.mrn),
    occupation: safeString(payload.occupation),
    supervisingDoctor: safeString(payload.supervisingDoctor),
    carer: safeString(payload.carer),
    allergies: safeString(payload.allergies),
    intolerances: safeString(payload.intolerances),
    significantHistory: safeString(payload.significantHistory),
    reviewDate: safeString(payload.reviewDate),
    reviewCompletedBy: safeString(payload.reviewCompletedBy),
    treatmentGoals: safeString(payload.treatmentGoals),
    nextReviewDate: safeString(payload.nextReviewDate),
    nextReviewMode: safeString(payload.nextReviewMode),
    beforeNextReview: safeString(payload.beforeNextReview),
    notes: safeString(payload.notes),
    rows: Array.isArray(payload.rows) ? payload.rows.map(normalizeRow) : [],
  };
}

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      language: { type: "string" },
      title: { type: "string" },
      patientName: { type: "string" },
      dob: { type: "string" },
      mrn: { type: "string" },
      occupation: { type: "string" },
      supervisingDoctor: { type: "string" },
      carer: { type: "string" },
      allergies: { type: "string" },
      intolerances: { type: "string" },
      significantHistory: { type: "string" },
      reviewDate: { type: "string" },
      reviewCompletedBy: { type: "string" },
      treatmentGoals: { type: "string" },
      nextReviewDate: { type: "string" },
      nextReviewMode: { type: "string" },
      beforeNextReview: { type: "string" },
      notes: { type: "string" },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            system: { type: "string" },
            diagnosis: { type: "string" },
            diagnosisDate: { type: "string" },
            medication: { type: "string" },
            dose: { type: "string" },
            how: { type: "string" },
            purpose: { type: "string" },
            plan: { type: "string" },
          },
          required: [
            "system",
            "diagnosis",
            "diagnosisDate",
            "medication",
            "dose",
            "how",
            "purpose",
            "plan",
          ],
        },
      },
    },
    required: [
      "language",
      "title",
      "patientName",
      "dob",
      "mrn",
      "occupation",
      "supervisingDoctor",
      "carer",
      "allergies",
      "intolerances",
      "significantHistory",
      "reviewDate",
      "reviewCompletedBy",
      "treatmentGoals",
      "nextReviewDate",
      "nextReviewMode",
      "beforeNextReview",
      "notes",
      "rows",
    ],
  };
}

async function requestTranslation(payload: ReportPayload) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY.");
  }

  const schema = buildSchema();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  const systemPrompt = [
    "You translate structured clinical report JSON into Arabic.",
    "Return JSON only.",
    "Translate field values into Arabic where translation makes sense.",
    "Do not translate medication names.",
    "Do not translate patientName.",
    "Do not alter personal names, dates, identifiers, medication names, dosages, or numbers.",
    "You may translate system, diagnosis, how, purpose, plan, history, notes, and review text.",
    "Keep the exact same schema and property names.",
    "If a value is already English medication text, keep it unchanged.",
  ].join(" ");

  const userPrompt = [
    "Schema:",
    JSON.stringify(schema),
    "",
    "Input JSON:",
    JSON.stringify({ ...payload, language: "ar" }),
  ].join("\n");

  try {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEFAULT_TRANSLATE_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "translated_clinical_report",
            strict: false,
            schema,
          },
        },
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Groq translation failed: ${res.status} ${raw}`);
    }

    const parsed = safeParseJson<GroqChatCompletionResponse>(raw);
    const content = parsed?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Translation model returned empty content.");
    }

    const translated = safeParseJson<ReportPayload>(content);
    if (!translated) {
      throw new Error("Failed to parse translated report JSON.");
    }

    return normalizePayload(translated);
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = normalizePayload(await req.json());
    if (!body.rows && !body.patientName) {
      return NextResponse.json(
        { error: "Invalid report payload." },
        { status: 400 },
      );
    }

    const report = await requestTranslation(body);
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to translate report.",
      },
      { status: 500 },
    );
  }
}
