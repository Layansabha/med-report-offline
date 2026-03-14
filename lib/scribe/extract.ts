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
  aiSuggestion: string;
  medications: ScribeMedication[];
  warnings: string[];
};

type StructuredPayload = Omit<StructuredDraft, "transcript">;

type AiSupportConfidence = "low" | "medium" | "high";

type AiClinicalSupportPayload = {
  summary: string;
  likelyDiagnosis: string;
  reasoning: string;
  currentTreatment: string;
  medicationOptions: string[];
  nextSteps: string[];
  redFlags: string[];
  confidence: AiSupportConfidence;
};

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
    aiSuggestion: safeString(payload.aiSuggestion),
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

function normalizeConfidence(value: unknown): AiSupportConfidence {
  const normalized = safeString(value).toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function normalizeAiSupportPayload(value: unknown): AiClinicalSupportPayload {
  const payload = (value ?? {}) as Record<string, unknown>;

  return {
    summary: safeString(payload.summary),
    likelyDiagnosis: safeString(payload.likelyDiagnosis),
    reasoning: safeString(payload.reasoning),
    currentTreatment: safeString(payload.currentTreatment),
    medicationOptions: Array.isArray(payload.medicationOptions)
      ? dedupeStrings(payload.medicationOptions.map((item) => safeString(item)))
      : [],
    nextSteps: Array.isArray(payload.nextSteps)
      ? dedupeStrings(payload.nextSteps.map((item) => safeString(item)))
      : [],
    redFlags: Array.isArray(payload.redFlags)
      ? dedupeStrings(payload.redFlags.map((item) => safeString(item)))
      : [],
    confidence: normalizeConfidence(payload.confidence),
  };
}

function formatMedicationSummary(medications: ScribeMedication[]) {
  const parts = medications
    .map((item) => {
      const med = safeString(item.medication || item.rawMedication);
      const dose = safeString(item.dose);
      const how = safeString(item.how);
      const joined = [med, dose].filter(Boolean).join(" ").trim();
      return [joined, how ? `(${how})` : ""].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean);

  return parts.join("; ");
}

function formatAiSupportText(payload: AiClinicalSupportPayload) {
  const lines: string[] = [];

  if (payload.summary) {
    lines.push(`Summary: ${payload.summary}`);
  }
  if (payload.likelyDiagnosis) {
    lines.push(`Likely diagnosis: ${payload.likelyDiagnosis}`);
  }
  if (payload.reasoning) {
    lines.push(`Why this fits: ${payload.reasoning}`);
  }
  if (payload.currentTreatment) {
    lines.push(`Current documented treatment: ${payload.currentTreatment}`);
  }
  if (payload.medicationOptions.length) {
    lines.push(
      `Common options to consider: ${payload.medicationOptions.join("; ")}`,
    );
  }
  if (payload.nextSteps.length) {
    lines.push(`Suggested next steps: ${payload.nextSteps.join("; ")}`);
  }
  if (payload.redFlags.length) {
    lines.push(`Red flags: ${payload.redFlags.join("; ")}`);
  }
  lines.push(
    `Confidence: ${payload.confidence[0].toUpperCase()}${payload.confidence.slice(1)}`,
  );
  lines.push(
    "Internal support only. Final diagnosis and treatment decisions require clinician review.",
  );

  return lines.join("\n").trim();
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

  const systemPrompt = `
You are a medical documentation extraction assistant.

Your task is to extract structured clinical information from a dictated visit transcript.
The transcript may contain Arabic, English, or mixed Arabic-English speech in the same sentence.

Return ONLY valid JSON that matches the required schema exactly.

Important rules:
- Fill as many fields as possible when explicitly stated or strongly supported by the transcript.
- If a field is not mentioned, return an empty string for text fields or an empty array for list fields.
- Do not invent facts.
- Do not guess unsupported diagnoses or unsupported treatments.
- Patient names spoken in Arabic should be written in natural English spelling using best-effort transliteration.
- Keep medication names exactly as clinically intended.
- Use concise, clean clinical English in extracted fields.
- Do not output markdown.
- Do not output explanations.
- Do not output anything except valid JSON.

Field extraction guidance:
- patientName: extract the full patient name and transliterate Arabic names into English spelling when needed
- caseNumber: extract MRN, case number, or file number
- dob: extract date of birth only if stated
- age: extract age if stated
- sex: extract male/female if stated
- occupation: extract occupation if stated
- supervisingDoctor: extract supervising doctor if stated
- carer: extract carer or representative if stated
- allergies: extract known allergies if stated
- intolerances: extract medication intolerances if stated
- chiefComplaint: extract the main reason for visit
- significantHistory: extract important past medical history
- associatedSymptoms: extract symptoms clearly linked to the complaint
- examFindings: extract examination findings, vital signs, and documented observations
- labSummary: extract laboratory information if stated
- imagingSummary: extract imaging information if stated
- diagnosisHints: extract likely documented diagnoses clearly supported by the transcript
- reviewCompletedBy: extract if stated
- treatmentGoals: extract if stated
- nextReviewDate: extract if a clear next review date is stated
- nextReviewMode: extract In-person or Video only when clearly supported
- beforeNextReview: extract tasks or monitoring requested before the next review
- notes: extract clinically useful extra information that does not fit cleanly elsewhere
- warnings: only include extraction or uncertainty warnings when needed

Medication extraction rules:
- Extract each medication as a separate row.
- Do not merge distinct medications into one row.
- Do not drop a medication that is clearly stated.
- Preserve the exact medication identity.
- Split medication name from dose whenever possible.
- Keep how-to-take instructions as completely as possible.
- If the transcript says "one tablet twice daily after meals", keep the full instruction, not a shortened fragment.
- Keep purpose only if stated or strongly implied by the same medication statement.
- Keep agreed plan only if stated.
- Map systemId to the closest supported system when diagnosis or system is clear from the transcript and the available systems list.

${
  medicationHints
    ? `Medication hints:
${medicationHints}`
    : ""
}
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

function buildAiSupportSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      likelyDiagnosis: { type: "string" },
      reasoning: { type: "string" },
      currentTreatment: { type: "string" },
      medicationOptions: { type: "array", items: { type: "string" } },
      nextSteps: { type: "array", items: { type: "string" } },
      redFlags: { type: "array", items: { type: "string" } },
      confidence: { type: "string" },
    },
    required: [
      "summary",
      "likelyDiagnosis",
      "reasoning",
      "currentTreatment",
      "medicationOptions",
      "nextSteps",
      "redFlags",
      "confidence",
    ],
  };
}

function buildAiSupportPrompts(
  transcript: string,
  structured: StructuredPayload,
  medications: ScribeMedication[],
) {
  const structuredInput = {
    patientName: structured.patientName,
    age: structured.age,
    sex: structured.sex,
    chiefComplaint: structured.chiefComplaint,
    significantHistory: structured.significantHistory,
    associatedSymptoms: structured.associatedSymptoms,
    examFindings: structured.examFindings,
    labSummary: structured.labSummary,
    imagingSummary: structured.imagingSummary,
    diagnosisHints: structured.diagnosisHints,
    currentTreatment: formatMedicationSummary(medications),
    medications,
    treatmentGoals: structured.treatmentGoals,
    nextReviewDate: structured.nextReviewDate,
    nextReviewMode: structured.nextReviewMode,
    beforeNextReview: structured.beforeNextReview,
    notes: structured.notes,
  };

  const systemPrompt = `
You are an internal clinical support assistant for a medical documentation app.

This output is INTERNAL ONLY for the clinician or staff member inside the app.
It must never be included in the printable patient report.

Use only the transcript and extracted structured data that you are given.
Be helpful, practical, and professionally cautious.

Rules:
- Do not invent facts that are not supported by the transcript or structured data.
- If information is incomplete, say so clearly.
- You may suggest likely diagnoses, common medication approaches, next steps, and red flags, but always use cautious wording such as: likely, possible, may consider, commonly used, depending on clinical assessment.
- If medications are already documented, mention them as current documented treatment.
- Do not recommend adding a medication that is already documented.
- Do not suggest specialist referral unless clearly supported.
- Do not present a definitive diagnosis unless the case strongly supports it.
- Do not use markdown.
- Output plain English only.
- Return valid JSON only.

The medicationOptions field may include common options that are often considered for the likely diagnosis, but they must be phrased as possibilities for clinician consideration, not definitive prescriptions.
`.trim();

  const userPrompt = [
    "Transcript:",
    transcript,
    "",
    "Structured data:",
    JSON.stringify(structuredInput, null, 2),
    "",
    "Return this exact JSON shape:",
    JSON.stringify(buildAiSupportSchema()),
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

  let content = "";
  let parsed: StructuredPayload | null = null;
  let usedJsonObjectFallback = false;

  try {
    content = await requestGroqExtraction({
      model,
      systemPrompt,
      userPrompt,
      responseFormat: primaryResponseFormat,
    });
    parsed = safeParseJson<StructuredPayload>(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const schemaFailed = /json_validate_failed|Failed to generate JSON/i.test(
      message,
    );

    if (!schemaFailed || primaryResponseFormat.type === "json_object") {
      throw error;
    }

    usedJsonObjectFallback = true;
    content = await requestGroqExtraction({
      model,
      systemPrompt: `${systemPrompt} Return a valid JSON object only. Include every supported key exactly once. No markdown. No prose.`,
      userPrompt,
      responseFormat: { type: "json_object" },
    });
    parsed = safeParseJson<StructuredPayload>(content);
  }

  if (
    !parsed &&
    !usedJsonObjectFallback &&
    primaryResponseFormat.type !== "json_object"
  ) {
    content = await requestGroqExtraction({
      model,
      systemPrompt: `${systemPrompt} Return a valid JSON object only. Include every supported key exactly once. No markdown. No prose.`,
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

async function callGroqAiSupport(
  transcript: string,
  structured: StructuredPayload,
  medications: ScribeMedication[],
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return "AI clinical support unavailable because GROQ_API_KEY is missing.";
  }

  const model = process.env.GROQ_SUPPORT_MODEL || DEFAULT_TEXT_MODEL;
  const schema = buildAiSupportSchema();
  const { systemPrompt, userPrompt } = buildAiSupportPrompts(
    transcript,
    structured,
    medications,
  );

  try {
    const content = await requestGroqExtraction({
      model,
      systemPrompt,
      userPrompt,
      responseFormat: { type: "json_object" },
    });

    const parsed = safeParseJson<AiClinicalSupportPayload>(content);
    if (!parsed) {
      const fallback = safeString(content);
      return (
        fallback ||
        "AI clinical support was not generated from the current transcript."
      );
    }

    const normalized = normalizeAiSupportPayload(parsed);
    const formatted = formatAiSupportText(normalized);
    return (
      formatted ||
      "AI clinical support was not generated from the current transcript."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `AI clinical support unavailable. ${message}`.trim();
  }
}

export async function extractStructuredDraft(
  rawTranscript: string,
): Promise<StructuredDraft> {
  const transcript = (rawTranscript || "").replace(/\r/g, "").trim();

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
      medications: [],
      warnings: ["No transcript detected."],
    };
  }

  const systemCatalog = await loadSystemCatalog();
  const structured = await callGroqExtraction(transcript, systemCatalog);
  const medications = structured.medications.map((item) =>
    mapMedicationToSystem(item, systemCatalog),
  );
  const aiSuggestion = await callGroqAiSupport(
    transcript,
    structured,
    medications,
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
    aiSuggestion,
    medications,
    warnings: dedupeStrings(structured.warnings),
  };
}
