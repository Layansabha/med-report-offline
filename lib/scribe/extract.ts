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

export type ConfidenceLevel = "" | "low" | "medium" | "high";

export type AiClinicalSupport = {
  summary: string;
  likelyDiagnosis: string;
  reasoning: string;
  medicationOptions: string[];
  nextSteps: string[];
  redFlags: string[];
  confidence: ConfidenceLevel;
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
  aiSuggestion: string;
  aiClinicalSupport: AiClinicalSupport;
  medications: ScribeMedication[];
  warnings: string[];
};

type StructuredPayload = Omit<
  StructuredDraft,
  "transcript" | "aiSuggestion" | "aiClinicalSupport"
>;

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
  error?: {
    message?: string;
  };
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

function safeMode(value: unknown): "" | "In-person" | "Video" {
  const mode = safeString(value).toLowerCase();
  if (!mode) return "";
  if (["in person", "in-person", "clinic", "face to face"].includes(mode)) {
    return "In-person";
  }
  if (["video", "virtual", "telemedicine", "telehealth"].includes(mode)) {
    return "Video";
  }
  return "";
}

function cleanJsonText(text: string) {
  return (text || "")
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

function normalizeClinicalSupport(value: unknown): AiClinicalSupport {
  const payload = (value ?? {}) as Record<string, unknown>;
  const confidence = safeString(payload.confidence).toLowerCase();

  return {
    summary: safeString(payload.summary),
    likelyDiagnosis: safeString(payload.likelyDiagnosis),
    reasoning: safeString(payload.reasoning),
    medicationOptions: Array.isArray(payload.medicationOptions)
      ? dedupeStrings(payload.medicationOptions.map((item) => safeString(item)))
      : [],
    nextSteps: Array.isArray(payload.nextSteps)
      ? dedupeStrings(payload.nextSteps.map((item) => safeString(item)))
      : [],
    redFlags: Array.isArray(payload.redFlags)
      ? dedupeStrings(payload.redFlags.map((item) => safeString(item)))
      : [],
    confidence:
      confidence === "high" || confidence === "medium" || confidence === "low"
        ? (confidence as ConfidenceLevel)
        : "",
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
  if (medication.systemId) return medication;

  const diagnosisNorm = normalizeForMatch(medication.diagnosis);
  if (!diagnosisNorm) return medication;

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

  if (!matched) return medication;

  return {
    ...medication,
    systemId: matched.id,
    diagnosis:
      medication.diagnosis || matched.diagnoses[0] || matched.name || "",
  };
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
      warnings: {
        type: "array",
        items: { type: "string" },
      },
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
      medicationOptions: {
        type: "array",
        items: { type: "string" },
      },
      nextSteps: {
        type: "array",
        items: { type: "string" },
      },
      redFlags: {
        type: "array",
        items: { type: "string" },
      },
      confidence: { type: "string" },
    },
    required: [
      "summary",
      "likelyDiagnosis",
      "reasoning",
      "medicationOptions",
      "nextSteps",
      "redFlags",
      "confidence",
    ],
  };
}

function buildResponseFormat(
  model: string,
  schemaName: string,
  schema: Record<string, unknown>,
) {
  if (STRICT_SCHEMA_MODELS.has(model)) {
    return {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    };
  }

  if (BEST_EFFORT_SCHEMA_MODELS.has(model)) {
    return {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: false,
        schema,
      },
    };
  }

  return { type: "json_object" };
}

function buildExtractionPrompts(
  transcript: string,
  systemCatalog: SystemCatalogEntry[],
  schema: Record<string, unknown>,
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
- medications: extract each medication row separately with: systemId, diagnosis, rawMedication, medication, dose, how, purpose, plan
- warnings: include extraction uncertainty or safety warnings only when needed

Medication extraction rules:
- Split medication name from dose whenever possible
- Preserve exact medication identity
- Extract how-to-take instructions as completely as possible
- Extract purpose only if stated
- Extract agreed plan only if stated
- If multiple medications are mentioned, return multiple medication rows
- Do not merge distinct medications into one row
- Do not drop a medication that is clearly stated
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

  return { systemPrompt, userPrompt };
}

function buildSupportPrompts(
  transcript: string,
  structured: StructuredPayload,
  schema: Record<string, unknown>,
) {
  const systemPrompt = `
You are an internal clinical support assistant for a medication review app.

This output is INTERNAL ONLY.
It must never appear in the printable patient report.

Use only the transcript and extracted structured fields provided.
Be helpful, practical, cautious, and clinically organized.

Rules:
- Do not invent facts not supported by the provided data.
- If information is incomplete, say so clearly.
- You may suggest likely diagnoses, common medication approaches, follow-up steps, and red flags, but always use cautious wording such as: likely, possible, may consider, commonly used, depending on clinical assessment.
- Mention medication options only as possible clinical considerations, not definitive prescriptions.
- If medications are already documented, mention them as current documented treatment.
- If no medication is documented, you may mention common options that are typically considered for the likely condition, but clearly label them as possible options, not firm recommendations.
- Do not use markdown.
- Output plain English only.
- Be concise but useful.
- Return a valid JSON object only.

Return this exact structure:
${JSON.stringify(schema)}
  `.trim();

  const userPrompt = `
Transcript:
${transcript}

Structured data:
${JSON.stringify(structured, null, 2)}
  `.trim();

  return { systemPrompt, userPrompt };
}

async function requestGroqContent(params: {
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
    const parsed = safeParseJson<GroqChatCompletionResponse>(raw);

    if (!res.ok) {
      throw new Error(
        `Groq request failed: ${res.status} ${parsed?.error?.message || raw}`,
      );
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Groq returned empty content.");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJsonWithFallback<T>(params: {
  model: string;
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  normalize: (value: unknown) => T;
}) {
  const primaryResponseFormat = buildResponseFormat(
    params.model,
    params.schemaName,
    params.schema,
  );

  let content = "";
  let parsed: unknown = null;
  let usedJsonObjectFallback = false;

  try {
    content = await requestGroqContent({
      model: params.model,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      responseFormat: primaryResponseFormat,
    });
    parsed = safeParseJson(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const schemaFailed = /json_validate_failed|Failed to generate JSON/i.test(
      message,
    );

    if (!schemaFailed || primaryResponseFormat.type === "json_object") {
      throw error;
    }

    usedJsonObjectFallback = true;
    content = await requestGroqContent({
      model: params.model,
      systemPrompt: `${params.systemPrompt}\nReturn a valid JSON object only. Include every supported key exactly once. No markdown. No prose.`,
      userPrompt: params.userPrompt,
      responseFormat: { type: "json_object" },
    });
    parsed = safeParseJson(content);
  }

  if (
    !parsed &&
    !usedJsonObjectFallback &&
    primaryResponseFormat.type !== "json_object"
  ) {
    content = await requestGroqContent({
      model: params.model,
      systemPrompt: `${params.systemPrompt}\nReturn a valid JSON object only. Include every supported key exactly once. No markdown. No prose.`,
      userPrompt: params.userPrompt,
      responseFormat: { type: "json_object" },
    });
    parsed = safeParseJson(content);
  }

  if (!parsed) {
    throw new Error(`Failed to parse JSON from model output: ${content}`);
  }

  return params.normalize(parsed);
}

async function callGroqExtraction(
  transcript: string,
  systemCatalog: SystemCatalogEntry[],
): Promise<StructuredPayload> {
  const model = DEFAULT_TEXT_MODEL;
  const schema = buildExtractionSchema();
  const { systemPrompt, userPrompt } = buildExtractionPrompts(
    transcript,
    systemCatalog,
    schema,
  );

  return requestJsonWithFallback({
    model,
    schemaName: "medical_scribe_draft",
    schema,
    systemPrompt,
    userPrompt,
    normalize: normalizeStructuredPayload,
  });
}

async function callGroqClinicalSupport(
  transcript: string,
  structured: StructuredPayload,
): Promise<AiClinicalSupport> {
  const model = DEFAULT_TEXT_MODEL;
  const schema = buildSupportSchema();
  const { systemPrompt, userPrompt } = buildSupportPrompts(
    transcript,
    structured,
    schema,
  );

  return requestJsonWithFallback({
    model,
    schemaName: "medical_clinical_support",
    schema,
    systemPrompt,
    userPrompt,
    normalize: normalizeClinicalSupport,
  });
}

function supportToSuggestionText(support: AiClinicalSupport) {
  return [
    support.summary,
    support.reasoning,
    support.medicationOptions.join(" "),
    support.nextSteps.join(" "),
    support.redFlags.join(" "),
  ]
    .map((part) => compactText(part))
    .filter(Boolean)
    .join(" ")
    .trim();
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
      aiSuggestion: "",
      aiClinicalSupport: {
        summary: "",
        likelyDiagnosis: "",
        reasoning: "",
        medicationOptions: [],
        nextSteps: [],
        redFlags: [],
        confidence: "",
      },
      medications: [],
      warnings: ["No transcript detected."],
    };
  }

  const systemCatalog = await loadSystemCatalog();
  const structured = await callGroqExtraction(transcript, systemCatalog);
  const medications = structured.medications.map((item) =>
    mapMedicationToSystem(item, systemCatalog),
  );

  let aiClinicalSupport: AiClinicalSupport = {
    summary: "",
    likelyDiagnosis: "",
    reasoning: "",
    medicationOptions: [],
    nextSteps: [],
    redFlags: [],
    confidence: "",
  };

  const warnings = [...structured.warnings];

  try {
    aiClinicalSupport = await callGroqClinicalSupport(transcript, {
      ...structured,
      medications,
    });
  } catch (error) {
    warnings.push(
      error instanceof Error
        ? `AI clinical support unavailable: ${error.message}`
        : "AI clinical support unavailable.",
    );
  }

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
    aiSuggestion: supportToSuggestionText(aiClinicalSupport),
    aiClinicalSupport,
    medications,
    warnings: dedupeStrings(warnings),
  };
}
