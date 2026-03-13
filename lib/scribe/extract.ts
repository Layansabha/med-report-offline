import fs from "fs/promises";
import path from "path";

export type ScribeMedication = {
  systemId: string;
  diagnosis: string;
  rawMedication: string;
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
  dob: string;
  age: string;
  sex: string;
  occupation: string;
  supervisingDoctor: string;
  carer: string;
  allergies: string;
  intolerances: string;
  chiefComplaint: string;
  significantHistory: string;
  associatedSymptoms: string[];
  examFindings: string;
  labSummary: string;
  imagingSummary: string;
  diagnosisHints: string[];
  reviewCompletedBy: string;
  treatmentGoals: string;
  nextReviewDate: string;
  nextReviewMode: "" | "In-person" | "Video";
  beforeNextReview: string;
  notes: string;
  medications: ScribeMedication[];
  warnings: string[];
};

type StructuredPayload = Omit<StructuredDraft, "transcript">;

type SystemCatalogEntry = {
  id: string;
  name: string;
  diagnoses: string[];
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

function safeMode(value: unknown): "" | "In-person" | "Video" {
  const mode = safeString(value).toLowerCase();
  if (!mode) return "";
  if (mode === "in person" || mode === "in-person" || mode === "clinic") {
    return "In-person";
  }
  if (mode === "video" || mode === "virtual" || mode === "telemedicine") {
    return "Video";
  }
  return "";
}

function normalizeDate(value: unknown) {
  const text = safeString(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return text.replaceAll("/", "-");

  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return text;

  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
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
  const rawMedication = safeString(
    medication.rawMedication || medication.medication,
  );
  const normalizedMedication =
    safeString(medication.medication) || rawMedication;

  return {
    systemId: safeString(medication.systemId),
    diagnosis: safeString(medication.diagnosis),
    rawMedication,
    medication: normalizedMedication,
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
    dob: normalizeDate(payload.dob),
    age: safeString(payload.age),
    sex: safeString(payload.sex),
    occupation: safeString(payload.occupation),
    supervisingDoctor: safeString(payload.supervisingDoctor),
    carer: safeString(payload.carer),
    allergies: safeString(payload.allergies),
    intolerances: safeString(payload.intolerances),
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
    reviewCompletedBy: safeString(payload.reviewCompletedBy),
    treatmentGoals: safeString(payload.treatmentGoals),
    nextReviewDate: normalizeDate(payload.nextReviewDate),
    nextReviewMode: safeMode(payload.nextReviewMode),
    beforeNextReview: safeString(payload.beforeNextReview),
    notes: safeString(payload.notes),
    medications: Array.isArray(payload.medications)
      ? payload.medications
          .map(normalizeMedication)
          .filter((item) => item.rawMedication || item.medication)
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
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        return {
          id: safeString(record.id),
          name: safeString(record.name),
          diagnoses: Array.isArray(record.diagnoses)
            ? dedupeStrings(record.diagnoses.map((entry) => safeString(entry)))
            : [],
        } satisfies SystemCatalogEntry;
      })
      .filter((item) => item.id && item.name);
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
    const systemName = normalizeForMatch(system.name);
    if (systemName === diagnosisNorm || systemName.includes(diagnosisNorm)) {
      return true;
    }

    return system.diagnoses.some((diagnosis) => {
      const diagnosisName = normalizeForMatch(diagnosis);
      return (
        diagnosisName === diagnosisNorm || diagnosisName.includes(diagnosisNorm)
      );
    });
  });

  if (!matched) {
    return medication;
  }

  return {
    ...medication,
    systemId: matched.id,
    diagnosis:
      medication.diagnosis || matched.diagnoses[0] || matched.name || "",
  };
}

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      patientName: { type: "string" },
      caseNumber: { type: "string" },
      dob: { type: "string" },
      age: { type: "string" },
      sex: { type: "string" },
      occupation: { type: "string" },
      supervisingDoctor: { type: "string" },
      carer: { type: "string" },
      allergies: { type: "string" },
      intolerances: { type: "string" },
      chiefComplaint: { type: "string" },
      significantHistory: { type: "string" },
      associatedSymptoms: { type: "array", items: { type: "string" } },
      examFindings: { type: "string" },
      labSummary: { type: "string" },
      imagingSummary: { type: "string" },
      diagnosisHints: { type: "array", items: { type: "string" } },
      reviewCompletedBy: { type: "string" },
      treatmentGoals: { type: "string" },
      nextReviewDate: { type: "string" },
      nextReviewMode: { type: "string" },
      beforeNextReview: { type: "string" },
      notes: { type: "string" },
      medications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            systemId: { type: "string" },
            diagnosis: { type: "string" },
            rawMedication: { type: "string" },
            medication: { type: "string" },
            dose: { type: "string" },
            how: { type: "string" },
            purpose: { type: "string" },
            plan: { type: "string" },
          },
          required: [
            "systemId",
            "diagnosis",
            "rawMedication",
            "medication",
            "dose",
            "how",
            "purpose",
            "plan",
          ],
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "patientName",
      "caseNumber",
      "dob",
      "age",
      "sex",
      "occupation",
      "supervisingDoctor",
      "carer",
      "allergies",
      "intolerances",
      "chiefComplaint",
      "significantHistory",
      "associatedSymptoms",
      "examFindings",
      "labSummary",
      "imagingSummary",
      "diagnosisHints",
      "reviewCompletedBy",
      "treatmentGoals",
      "nextReviewDate",
      "nextReviewMode",
      "beforeNextReview",
      "notes",
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

  return { type: "json_object" };
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
            `- id:${system.id} | name:${system.name} | diagnoses:${system.diagnoses.join(", ")}`,
        )
        .join("\n")
    : "No systems catalog provided.";

  const medicationHints = process.env.GROQ_MEDICATION_HINTS?.trim() || "";

  const systemPrompt = [
    "You are a medical scribe extraction engine.",
    "Convert a clinical transcript into structured JSON.",
    "The transcript may contain mixed Arabic and English speech, sometimes inside the same sentence.",
    "Never assume the whole transcript is one language.",
    "Return JSON only.",
    "Use the bilingual transcript as evidence, but return general note fields in English whenever reasonably possible.",
    "When the patient's name is spoken in Arabic, transliterate it into a natural English spelling instead of leaving it in Arabic script.",
    "Keep medication names in English when reasonably possible.",
    "For every explicitly mentioned medication, always return both rawMedication and medication.",
    "rawMedication must contain the medication name exactly as it appears in the transcript.",
    "medication must contain the best normalized English medication name when you are reasonably confident.",
    "If you are not confident about the standardized English medication name, copy rawMedication into medication exactly and do not omit the drug.",
    "If a medication is explicitly mentioned, include it in the medications array even if dose, how, purpose, or plan are missing.",
    "If dose, how, purpose, or plan are missing, return empty strings for those fields.",
    "purpose must stay empty if it is not clearly supported by the transcript.",
    "Extract occupation, supervisingDoctor, carer, allergies, intolerances, reviewCompletedBy, treatmentGoals, nextReviewDate, nextReviewMode, beforeNextReview, and notes when clearly stated.",
    "nextReviewMode must be either In-person, Video, or an empty string.",
    "If a date is clearly stated, prefer YYYY-MM-DD.",
    "Do not invent facts.",
    'Unknown strings must be "".',
    "Unknown arrays must be [].",
    "Only include medications and diagnoses clearly supported by the transcript.",
    "Do not add commentary outside the JSON object.",
  ]
    .concat(
      medicationHints
        ? [`Helpful medication spellings: ${medicationHints}`]
        : [],
    )
    .join(" ");

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
      dob: "",
      age: "",
      sex: "",
      occupation: "",
      supervisingDoctor: "",
      carer: "",
      allergies: "",
      intolerances: "",
      chiefComplaint: "",
      significantHistory: "",
      associatedSymptoms: [],
      examFindings: "",
      labSummary: "",
      imagingSummary: "",
      diagnosisHints: [],
      reviewCompletedBy: "",
      treatmentGoals: "",
      nextReviewDate: "",
      nextReviewMode: "",
      beforeNextReview: "",
      notes: "",
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
    dob: structured.dob,
    age: structured.age,
    sex: structured.sex,
    occupation: structured.occupation,
    supervisingDoctor: structured.supervisingDoctor,
    carer: structured.carer,
    allergies: structured.allergies,
    intolerances: structured.intolerances,
    chiefComplaint: structured.chiefComplaint,
    significantHistory: structured.significantHistory,
    associatedSymptoms: dedupeStrings(structured.associatedSymptoms),
    examFindings: structured.examFindings,
    labSummary: structured.labSummary,
    imagingSummary: structured.imagingSummary,
    diagnosisHints: dedupeStrings(structured.diagnosisHints),
    reviewCompletedBy: structured.reviewCompletedBy,
    treatmentGoals: structured.treatmentGoals,
    nextReviewDate: structured.nextReviewDate,
    nextReviewMode: structured.nextReviewMode,
    beforeNextReview: structured.beforeNextReview,
    notes: structured.notes,
    medications,
    warnings: dedupeStrings(structured.warnings),
  };
}
