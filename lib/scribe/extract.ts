import fs from "fs/promises";
import path from "path";

export type ScribeMedication = {
  systemId: string;
  diagnosis: string;
  medication: string;
  dose: string;
  how: string;
  purpose: string;
  plan: string;
};

export type StructuredDraft = {
  transcript: string;
  patientName: string;
  caseNumber: string;
  age: string;
  sex: string;
  chiefComplaint: string;
  significantHistory: string;
  associatedSymptoms: string[];
  examFindings: string;
  labSummary: string;
  imagingSummary: string;
  diagnosisHints: string[];
  medications: ScribeMedication[];
  warnings: string[];
};

type StructuredPayload = Omit<StructuredDraft, "transcript">;

type SystemCatalogEntry = {
  id: string;
  name: string;
  diagnosis?: string;
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

const DEFAULT_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-20b";

const STRICT_SCHEMA_MODELS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
]);

const BEST_EFFORT_SCHEMA_MODELS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "moonshotai/kimi-k2-instruct-0905",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
]);

function compactText(input: string) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function safeString(value: unknown) {
  return typeof value === "string" ? compactText(value) : "";
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of values) {
    const value = compactText(item);
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(value);
  }

  return out;
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

function normalizeForMatch(input: string) {
  return safeString(input).toLowerCase();
}

function normalizeMedication(value: unknown): ScribeMedication {
  const medication = (value ?? {}) as Record<string, unknown>;

  return {
    systemId: safeString(medication.systemId),
    diagnosis: safeString(medication.diagnosis),
    medication: safeString(medication.medication),
    dose: safeString(medication.dose),
    how: safeString(medication.how),
    purpose: safeString(medication.purpose),
    plan: safeString(medication.plan),
  };
}

function normalizeStructuredPayload(value: unknown): StructuredPayload {
  const payload = (value ?? {}) as Record<string, unknown>;

  return {
    patientName: safeString(payload.patientName),
    caseNumber: safeString(payload.caseNumber),
    age: safeString(payload.age),
    sex: safeString(payload.sex),
    chiefComplaint: safeString(payload.chiefComplaint),
    significantHistory: safeString(payload.significantHistory),
    associatedSymptoms: Array.isArray(payload.associatedSymptoms)
      ? dedupeStrings(
          payload.associatedSymptoms.map((item) => safeString(item)),
        )
      : [],
    examFindings: safeString(payload.examFindings),
    labSummary: safeString(payload.labSummary),
    imagingSummary: safeString(payload.imagingSummary),
    diagnosisHints: Array.isArray(payload.diagnosisHints)
      ? dedupeStrings(payload.diagnosisHints.map((item) => safeString(item)))
      : [],
    medications: Array.isArray(payload.medications)
      ? payload.medications
          .map(normalizeMedication)
          .filter((item) => item.medication)
      : [],
    warnings: Array.isArray(payload.warnings)
      ? dedupeStrings(payload.warnings.map((item) => safeString(item)))
      : [],
  };
}

async function loadSystemCatalog(): Promise<SystemCatalogEntry[]> {
  try {
    const systemsPath = path.join(process.cwd(), "public", "systems.json");
    const raw = await fs.readFile(systemsPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item: Record<string, unknown>) => ({
      id: safeString(item?.id),
      name: safeString(item?.name),
      diagnosis: safeString(item?.diagnosis),
    }));
  } catch {
    return [];
  }
}

function mapMedicationToSystem(
  medication: ScribeMedication,
  systemCatalog: SystemCatalogEntry[],
): ScribeMedication {
  if (medication.systemId) {
    return medication;
  }

  const diagnosisNorm = normalizeForMatch(medication.diagnosis);
  if (!diagnosisNorm) {
    return medication;
  }

  const matched = systemCatalog.find((system) => {
    const diagnosisName = normalizeForMatch(system.diagnosis || "");
    const systemName = normalizeForMatch(system.name || "");

    return (
      diagnosisNorm === diagnosisName ||
      diagnosisNorm === systemName ||
      diagnosisName.includes(diagnosisNorm) ||
      systemName.includes(diagnosisNorm)
    );
  });

  if (!matched) {
    return medication;
  }

  return {
    ...medication,
    systemId: matched.id,
    diagnosis: medication.diagnosis || matched.diagnosis || matched.name || "",
  };
}

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      patientName: { type: "string" },
      caseNumber: { type: "string" },
      age: { type: "string" },
      sex: { type: "string" },
      chiefComplaint: { type: "string" },
      significantHistory: { type: "string" },
      associatedSymptoms: {
        type: "array",
        items: { type: "string" },
      },
      examFindings: { type: "string" },
      labSummary: { type: "string" },
      imagingSummary: { type: "string" },
      diagnosisHints: {
        type: "array",
        items: { type: "string" },
      },
      medications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            systemId: { type: "string" },
            diagnosis: { type: "string" },
            medication: { type: "string" },
            dose: { type: "string" },
            how: { type: "string" },
            purpose: { type: "string" },
            plan: { type: "string" },
          },
          required: [
            "systemId",
            "diagnosis",
            "medication",
            "dose",
            "how",
            "purpose",
            "plan",
          ],
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "patientName",
      "caseNumber",
      "age",
      "sex",
      "chiefComplaint",
      "significantHistory",
      "associatedSymptoms",
      "examFindings",
      "labSummary",
      "imagingSummary",
      "diagnosisHints",
      "medications",
      "warnings",
    ],
  };
}

function buildResponseFormat(
  model: string,
  schema: ReturnType<typeof buildSchema>,
) {
  if (STRICT_SCHEMA_MODELS.has(model)) {
    return {
      type: "json_schema",
      json_schema: {
        name: "medical_scribe_draft",
        strict: true,
        schema,
      },
    };
  }

  if (BEST_EFFORT_SCHEMA_MODELS.has(model)) {
    return {
      type: "json_schema",
      json_schema: {
        name: "medical_scribe_draft",
        strict: false,
        schema,
      },
    };
  }

  return {
    type: "json_object",
  };
}

function buildPrompts(
  transcript: string,
  systemCatalog: SystemCatalogEntry[],
  schema: ReturnType<typeof buildSchema>,
) {
  const systemsText = systemCatalog.length
    ? systemCatalog
        .map(
          (system) =>
            `- id:${system.id} | name:${system.name} | diagnosis:${system.diagnosis || ""}`,
        )
        .join("\n")
    : "No systems catalog provided.";

  const systemPrompt = [
    "You are a medical scribe extraction engine.",
    "Your task is to convert a clinical transcript into structured JSON.",
    "The transcript may contain mixed Arabic and English speech.",
    "Return JSON only.",
    "All output fields should be in English whenever reasonably possible.",
    "Keep medication names, brand names, abbreviations, dosages, numbers, and identifiers exactly as spoken when needed.",
    "Do not invent facts.",
    'If a field is unknown, return an empty string "".',
    "If an array field is unknown, return [].",
    "Only include medications that are explicitly stated in the transcript.",
    "Only include diagnosis hints that are explicitly supported by the transcript.",
    "If no confident system match exists, leave systemId empty.",
    "Do not add commentary outside the JSON object.",
  ].join(" ");

  const userPrompt = [
    "Schema:",
    JSON.stringify(schema),
    "",
    "Available systems:",
    systemsText,
    "",
    "Transcript:",
    transcript,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

async function requestGroqExtraction(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseFormat: Record<string, unknown>;
}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        temperature: 0,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
        response_format: params.responseFormat,
      }),
    });

    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`Groq extraction failed: ${res.status} ${raw}`);
    }

    const parsed = safeParseJson<GroqChatCompletionResponse>(raw);
    const content = parsed?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Groq returned empty extraction content.");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGroqExtraction(
  transcript: string,
  systemCatalog: SystemCatalogEntry[],
): Promise<StructuredPayload> {
  const model = DEFAULT_TEXT_MODEL;
  const schema = buildSchema();
  const { systemPrompt, userPrompt } = buildPrompts(
    transcript,
    systemCatalog,
    schema,
  );

  const primaryResponseFormat = buildResponseFormat(model, schema);

  let content = await requestGroqExtraction({
    model,
    systemPrompt,
    userPrompt,
    responseFormat: primaryResponseFormat,
  });

  let parsed = safeParseJson<StructuredPayload>(content);

  if (!parsed && primaryResponseFormat.type !== "json_object") {
    content = await requestGroqExtraction({
      model,
      systemPrompt: `${systemPrompt} Return a valid JSON object only. No markdown. No prose.`,
      userPrompt,
      responseFormat: { type: "json_object" },
    });

    parsed = safeParseJson<StructuredPayload>(content);
  }

  if (!parsed) {
    throw new Error(
      `Failed to parse structured JSON from model output: ${content}`,
    );
  }

  return normalizeStructuredPayload(parsed);
}

export async function extractStructuredDraft(
  rawTranscript: string,
): Promise<StructuredDraft> {
  const transcript = compactText(rawTranscript);

  if (!transcript) {
    return {
      transcript: "",
      patientName: "",
      caseNumber: "",
      age: "",
      sex: "",
      chiefComplaint: "",
      significantHistory: "",
      associatedSymptoms: [],
      examFindings: "",
      labSummary: "",
      imagingSummary: "",
      diagnosisHints: [],
      medications: [],
      warnings: ["No transcript detected."],
    };
  }

  const systemCatalog = await loadSystemCatalog();
  const structured = await callGroqExtraction(transcript, systemCatalog);

  const medications = structured.medications.map((item) =>
    mapMedicationToSystem(item, systemCatalog),
  );

  return {
    transcript,
    patientName: structured.patientName,
    caseNumber: structured.caseNumber,
    age: structured.age,
    sex: structured.sex,
    chiefComplaint: structured.chiefComplaint,
    significantHistory: structured.significantHistory,
    associatedSymptoms: dedupeStrings(structured.associatedSymptoms),
    examFindings: structured.examFindings,
    labSummary: structured.labSummary,
    imagingSummary: structured.imagingSummary,
    diagnosisHints: dedupeStrings(structured.diagnosisHints),
    medications,
    warnings: dedupeStrings(structured.warnings),
  };
}
