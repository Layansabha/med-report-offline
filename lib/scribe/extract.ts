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

export type AiClinicalSupport = {
  summary: string;
  likelyDiagnosis: string;
  reasoning: string;
  currentTreatment: string;
  nextSteps: string[];
  redFlags: string[];
  confidence: "low" | "medium" | "high";
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
  nextReviewMode: string;
  beforeNextReview: string;
  notes: string;
  medications: ScribeMedication[];
  warnings: string[];
  aiClinicalSupport: AiClinicalSupport;
};

type StructuredPayload = Omit<
  StructuredDraft,
  "transcript" | "aiClinicalSupport"
>;

type SystemCatalogEntry = {
  id: string;
  name: string;
  diagnoses?: string[];
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

const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const DEFAULT_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-20b";
const DEFAULT_EXTRACTION_MODEL =
  process.env.GROQ_EXTRACTION_MODEL || DEFAULT_TEXT_MODEL;
const DEFAULT_SUPPORT_MODEL =
  process.env.GROQ_SUPPORT_MODEL || DEFAULT_TEXT_MODEL;

function compactText(value: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function safeString(value: unknown) {
  return typeof value === "string" ? compactText(value) : "";
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = compactText(raw);
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

function extractJsonBlock(text: string) {
  const cleaned = cleanJsonText(text);
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");
  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return cleaned.slice(firstObject, lastObject + 1);
  }
  return cleaned;
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(cleanJsonText(text)) as T;
  } catch {
    try {
      return JSON.parse(extractJsonBlock(text)) as T;
    } catch {
      return null;
    }
  }
}

function normalizeMedication(value: unknown): ScribeMedication {
  const item = (value ?? {}) as Record<string, unknown>;
  return {
    systemId: safeString(item.systemId),
    diagnosis: safeString(item.diagnosis),
    rawMedication: safeString(item.rawMedication),
    medication: safeString(item.medication),
    dose: safeString(item.dose),
    how: safeString(item.how),
    purpose: safeString(item.purpose),
    plan: safeString(item.plan),
  };
}

function normalizeAiClinicalSupport(value: unknown): AiClinicalSupport {
  const item = (value ?? {}) as Record<string, unknown>;
  const confidenceRaw = safeString(item.confidence).toLowerCase();
  const confidence: AiClinicalSupport["confidence"] =
    confidenceRaw === "high"
      ? "high"
      : confidenceRaw === "medium"
        ? "medium"
        : "low";

  return {
    summary: safeString(item.summary),
    likelyDiagnosis: safeString(item.likelyDiagnosis),
    reasoning: safeString(item.reasoning),
    currentTreatment: safeString(item.currentTreatment),
    nextSteps: Array.isArray(item.nextSteps)
      ? dedupeStrings(item.nextSteps.map((entry) => safeString(entry)))
      : [],
    redFlags: Array.isArray(item.redFlags)
      ? dedupeStrings(item.redFlags.map((entry) => safeString(entry)))
      : [],
    confidence,
  };
}

function normalizeStructuredPayload(value: unknown): StructuredPayload {
  const payload = (value ?? {}) as Record<string, unknown>;

  return {
    patientName: safeString(payload.patientName),
    caseNumber: safeString(payload.caseNumber),
    dob: safeString(payload.dob),
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
          payload.associatedSymptoms.map((entry) => safeString(entry)),
        )
      : [],
    examFindings: safeString(payload.examFindings),
    labSummary: safeString(payload.labSummary),
    imagingSummary: safeString(payload.imagingSummary),
    diagnosisHints: Array.isArray(payload.diagnosisHints)
      ? dedupeStrings(payload.diagnosisHints.map((entry) => safeString(entry)))
      : [],
    reviewCompletedBy: safeString(payload.reviewCompletedBy),
    treatmentGoals: safeString(payload.treatmentGoals),
    nextReviewDate: safeString(payload.nextReviewDate),
    nextReviewMode: safeString(payload.nextReviewMode),
    beforeNextReview: safeString(payload.beforeNextReview),
    notes: safeString(payload.notes),
    medications: Array.isArray(payload.medications)
      ? payload.medications
          .map(normalizeMedication)
          .filter((item) => item.medication || item.rawMedication)
      : [],
    warnings: Array.isArray(payload.warnings)
      ? dedupeStrings(payload.warnings.map((entry) => safeString(entry)))
      : [],
  };
}

async function loadSystems() {
  const systemsPath = path.join(process.cwd(), "public", "systems.json");
  try {
    const text = await fs.readFile(systemsPath, "utf8");
    const parsed = safeParseJson<SystemCatalogEntry[]>(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore and fall through
  }
  return [] as SystemCatalogEntry[];
}

function buildExtractionSchema() {
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

function buildSupportSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      likelyDiagnosis: { type: "string" },
      reasoning: { type: "string" },
      currentTreatment: { type: "string" },
      nextSteps: { type: "array", items: { type: "string" } },
      redFlags: { type: "array", items: { type: "string" } },
      confidence: { type: "string" },
    },
    required: [
      "summary",
      "likelyDiagnosis",
      "reasoning",
      "currentTreatment",
      "nextSteps",
      "redFlags",
      "confidence",
    ],
  };
}

function buildExtractionPrompts(
  transcript: string,
  systems: SystemCatalogEntry[],
) {
  const schema = buildExtractionSchema();
  const medicationHints = process.env.GROQ_MEDICATION_HINTS?.trim() || "";
  const systemsText = JSON.stringify(systems);
  const systemPrompt = `
You are a medical documentation extraction assistant.

Your task is to extract structured clinical information from a dictated transcript.
The transcript may contain Arabic, English, or mixed Arabic-English speech in the same sentence.
Return ONLY valid JSON that matches the required schema exactly.

Important rules:
- Fill as many fields as possible when explicitly stated or strongly supported by the transcript.
- If a field is not mentioned, return an empty string for text fields or an empty array for list fields.
- Do not invent facts.
- Do not guess unsupported diagnoses or unsupported treatments.
- Patient name should be written in English spelling when spoken in Arabic, using best-effort transliteration.
- Keep medication names exactly as clinically intended.
- Preserve medically relevant wording.
- Use concise, clean clinical English in extracted fields.
- Do not output markdown.
- Do not output explanations.
- Do not output anything except valid JSON.

Field extraction guidance:
- patientName: extract full patient name and transliterate Arabic names into English spelling if needed
- caseNumber: extract MRN, case number, or file number
- dob: extract date of birth if explicitly stated
- age: extract age if stated
- sex: extract male/female if stated
- occupation: extract occupation if stated
- supervisingDoctor: extract supervising doctor if stated
- carer: extract carer or representative if stated
- allergies: extract known allergies if stated
- intolerances: extract medication intolerances if stated
- chiefComplaint: extract main reason for visit
- significantHistory: extract important past medical history
- associatedSymptoms: extract symptoms clearly associated with the complaint
- examFindings: extract examination findings, vitals, or documented observations
- labSummary: extract laboratory information if stated
- imagingSummary: extract imaging information if stated
- diagnosisHints: extract likely documented diagnoses explicitly supported by the transcript
- reviewCompletedBy: extract if stated
- treatmentGoals: extract if stated
- nextReviewDate: extract if stated
- nextReviewMode: extract if stated
- beforeNextReview: extract follow-up steps before next review
- notes: extract additional useful clinical notes that do not fit cleanly elsewhere
- medications: extract each medication row separately with systemId, diagnosis, rawMedication, medication, dose, how, purpose, plan
- warnings: include extraction uncertainty or safety warnings only when needed

Medication extraction rules:
- Split medication name from dose whenever possible.
- Preserve exact medication identity.
- Extract how-to-take instructions as completely as possible.
- Extract purpose only if stated.
- Extract agreed plan only if stated.
- If multiple medications are mentioned, return multiple medication rows.
- Do not merge distinct medications into one row.
- Do not drop a medication that is clearly stated.
${medicationHints ? `\nMedication hints:\n${medicationHints}` : ""}
`.trim();

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

  return { schema, systemPrompt, userPrompt };
}

function buildSupportPrompts(
  transcript: string,
  structured: StructuredPayload,
) {
  const schema = buildSupportSchema();
  const systemPrompt = `
You are an internal clinical support assistant for a medication review app.
This output is INTERNAL ONLY and must never be printed in the patient PDF.
Use only the provided transcript and extracted structured data.

Rules:
- Be cautious, practical, and professional.
- Do not invent facts not supported by the provided data.
- Do not label a case as hypertensive emergency, sepsis, acute crisis, urgent admission, or specialist referral unless the provided data clearly supports it with concrete findings.
- Do not recommend IV medications, empiric antibiotics, admission, emergency referral, or specialist referral unless explicitly justified by the provided data.
- If medication data is missing, say that current treatment is not documented.
- If vital signs, labs, imaging, or examination details are missing, say the assessment is incomplete.
- Prefer wording such as likely, possible, documented, appears consistent with, reassess, clinician review, or depends on full assessment.
- Do not prescribe. Do not write direct treatment orders.
- Mention currently documented medications only. Do not invent new medication names.
- Keep the output concise and useful.
- Return JSON only that matches the requested schema.
`.trim();

  const userPrompt = [
    "Transcript:",
    transcript,
    "",
    "Structured data:",
    JSON.stringify(structured),
    "",
    "Return an internal support object with a short summary, likely diagnosis, cautious reasoning, documented current treatment, suggested next steps, red flags, and a conservative confidence level.",
  ].join("\n");

  return { schema, systemPrompt, userPrompt };
}

async function requestGroqJson<T>(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? 45000,
  );

  try {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
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
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "structured_response",
            strict: false,
            schema: params.schema,
          },
        },
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Groq request failed: ${response.status} ${raw}`);
    }

    const parsedEnvelope = safeParseJson<GroqChatCompletionResponse>(raw);
    const content = parsedEnvelope?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Model returned empty content.");
    }

    const parsed = safeParseJson<T>(content);
    if (parsed) {
      return parsed;
    }

    throw new Error("Failed to parse model JSON content.");
  } finally {
    clearTimeout(timeout);
  }
}

async function extractStructuredPayload(
  transcript: string,
  systems: SystemCatalogEntry[],
) {
  const { schema, systemPrompt, userPrompt } = buildExtractionPrompts(
    transcript,
    systems,
  );
  const raw = await requestGroqJson<StructuredPayload>({
    model: DEFAULT_EXTRACTION_MODEL,
    systemPrompt,
    userPrompt,
    schema,
  });
  return normalizeStructuredPayload(raw);
}

async function generateAiClinicalSupport(
  transcript: string,
  structured: StructuredPayload,
) {
  const hasMeaningfulData = Boolean(
    structured.chiefComplaint ||
    structured.significantHistory ||
    structured.examFindings ||
    structured.associatedSymptoms.length ||
    structured.diagnosisHints.length ||
    structured.medications.length,
  );

  if (!hasMeaningfulData) {
    return normalizeAiClinicalSupport({
      summary: "",
      likelyDiagnosis: "",
      reasoning: "",
      currentTreatment: "Current treatment is not documented.",
      nextSteps: [],
      redFlags: [],
      confidence: "low",
    });
  }

  try {
    const { schema, systemPrompt, userPrompt } = buildSupportPrompts(
      transcript,
      structured,
    );
    const raw = await requestGroqJson<AiClinicalSupport>({
      model: DEFAULT_SUPPORT_MODEL,
      systemPrompt,
      userPrompt,
      schema,
      timeoutMs: 30000,
    });
    return normalizeAiClinicalSupport(raw);
  } catch {
    return normalizeAiClinicalSupport({
      summary: structured.chiefComplaint
        ? `Case includes ${structured.chiefComplaint}.`
        : "Clinical support unavailable for this transcript.",
      likelyDiagnosis: structured.diagnosisHints[0] || "",
      reasoning: structured.significantHistory
        ? `Documented history: ${structured.significantHistory}.`
        : "Assessment is limited because structured clinical details are incomplete.",
      currentTreatment: structured.medications.length
        ? structured.medications
            .map((item) =>
              [item.medication || item.rawMedication, item.dose]
                .filter(Boolean)
                .join(" "),
            )
            .filter(Boolean)
            .join(", ")
        : "Current treatment is not documented.",
      nextSteps: structured.beforeNextReview
        ? [structured.beforeNextReview]
        : [],
      redFlags: [],
      confidence: "low",
    });
  }
}

export async function extractStructuredDraft(
  transcript: string,
): Promise<StructuredDraft> {
  const normalizedTranscript = compactText(transcript);
  const systems = await loadSystems();
  const structured = await extractStructuredPayload(
    normalizedTranscript,
    systems,
  );
  const aiClinicalSupport = await generateAiClinicalSupport(
    normalizedTranscript,
    structured,
  );

  return {
    transcript: normalizedTranscript,
    ...structured,
    aiClinicalSupport,
  };
}
