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

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

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

function uniqueWarnings(values: string[]) {
  return dedupeStrings(values);
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

function removeTeachingNoise(transcript: string) {
  let t = transcript || "";

  const patterns = [
    /what'?s the most likely diagnosis\??/gi,
    /choice\s+[a-e]\s+(?:is|=)?.*?(?=(choice\s+[a-e])|$)/gi,
    /question number\s+\w+.*?(?=(question number\s+\w+)|$)/gi,
    /the second question.*$/gi,
    /the third question.*$/gi,
    /so those are the questions.*$/gi,
    /let me know what you think.*$/gi,
    /in the comment section.*$/gi,
    /what can you do for this patient\??/gi,
    /how do you treat this patient\??/gi,
    /what is the path of pathophysiology.*$/gi,
  ];

  for (const pattern of patterns) {
    t = t.replace(pattern, " ");
  }

  return compactText(t);
}

function normalizeForMatch(input: string) {
  return safeString(input).toLowerCase();
}

function extractCaseNumber(transcript: string) {
  const digitMatch =
    transcript.match(/\bcase number[:\s-]*(\d+)\b/i) ||
    transcript.match(/\bmrn[:\s-]*([a-zA-Z0-9-]+)\b/i) ||
    transcript.match(/\bfile number[:\s-]*([a-zA-Z0-9-]+)\b/i);

  if (digitMatch?.[1]) return digitMatch[1].trim();

  const wordMatch = transcript.match(/\bcase number[:\s-]*([a-zA-Z]+)\b/i);
  if (wordMatch?.[1]) {
    const word = wordMatch[1].toLowerCase().trim();
    return NUMBER_WORDS[word] || word;
  }

  return "";
}

function fallbackAge(transcript: string) {
  const match =
    transcript.match(/\b(\d{1,3})\s*year[s]?\s*old\b/i) ||
    transcript.match(/\bage[:\s-]*(\d{1,3})\b/i);

  return match?.[1]?.trim() || "";
}

function fallbackSex(transcript: string) {
  if (/\bfemale\b/i.test(transcript)) return "Female";
  if (/\bmale\b/i.test(transcript)) return "Male";
  if (/أنثى|انثى|امرأة|امراه|سيدة|سيده/i.test(transcript)) return "Female";
  if (/ذكر|رجل/i.test(transcript)) return "Male";
  return "";
}

function fallbackChiefComplaint(transcript: string) {
  const patterns = [
    /\bcomes to the emergency room with complaint of ([^.]+)/i,
    /\bcomplaint of ([^.]+)/i,
    /\bcomplains of ([^.]+)/i,
    /\bpresents with ([^.]+)/i,
    /\bpresenting complaint[:\s-]*([^.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match?.[1]) return compactText(match[1]);
  }

  return "";
}

function fallbackHistory(transcript: string) {
  const patterns = [
    /\bwith history of ([^.]+)/i,
    /\bhistory of ([^.]+)/i,
    /\bknown case of ([^.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match?.[1]) return compactText(match[1]);
  }

  return "";
}

function fallbackDiagnosisHints(transcript: string) {
  const t = transcript.toLowerCase();
  const out: string[] = [];

  if (t.includes("small bowel obstruction") || /\bsbo\b/i.test(transcript)) {
    out.push("Small bowel obstruction");
  }

  if (
    t.includes("biliary calculus") ||
    t.includes("biliary calculi") ||
    t.includes("biliary stones") ||
    t.includes("stones in the biliary tree")
  ) {
    out.push("Biliary calculus");
  }

  if (t.includes("gallstone ileus")) out.push("Gallstone ileus");
  if (t.includes("type 2 diabetes")) out.push("Type 2 diabetes");
  if (t.includes("hypertension")) out.push("Hypertension");

  return dedupeStrings(out);
}

function fallbackSymptoms(transcript: string) {
  const out: string[] = [];
  const t = transcript.toLowerCase();

  if (t.includes("nausea")) out.push("nausea");
  if (t.includes("vomiting")) out.push("vomiting");
  if (t.includes("fever")) out.push("fever");
  if (t.includes("diarrhea")) out.push("diarrhea");
  if (t.includes("constipation")) out.push("constipation");
  if (t.includes("colicky pain")) out.push("colicky pain");
  if (t.includes("abdominal pain")) out.push("abdominal pain");

  return dedupeStrings(out);
}

function fallbackExamFindings(transcript: string) {
  const t = transcript.toLowerCase();
  const findings: string[] = [];

  if (t.includes("abdominal distension")) findings.push("abdominal distension");
  if (t.includes("diminished bowel sounds"))
    findings.push("diminished bowel sounds");
  if (t.includes("tenderness")) findings.push("tenderness");

  return dedupeStrings(findings).join(", ");
}

function fallbackLabSummary(transcript: string) {
  const parts: string[] = [];
  const t = transcript;

  if (/wbc|cbc|y count/i.test(t)) {
    const match = t.match(/(?:wbc|y count|cbc)[^.]{0,120}/i);
    if (match?.[0]) parts.push(compactText(match[0]));
  }

  if (/hemoglobin/i.test(t)) {
    const match = t.match(/hemoglobin[^.]{0,80}/i);
    if (match?.[0]) parts.push(compactText(match[0]));
  }

  if (/electrolytes are normal/i.test(t)) parts.push("electrolytes normal");
  if (/lfts?/i.test(t) && /normal/i.test(t)) parts.push("LFTs normal");
  if (/lipase/i.test(t) && /normal/i.test(t)) parts.push("lipase normal");

  return dedupeStrings(parts).join(", ");
}

function fallbackImagingSummary(transcript: string) {
  const t = transcript.toLowerCase();
  const parts: string[] = [];

  if (t.includes("small bowel obstruction") || t.includes("sbo")) {
    parts.push("small bowel obstruction");
  }

  if (
    t.includes("biliary calculus") ||
    t.includes("biliary calculi") ||
    t.includes("biliary stones") ||
    t.includes("stones in the biliary tree")
  ) {
    parts.push("biliary calculus or stones");
  }

  return dedupeStrings(parts).join(", ");
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
      ? uniqueWarnings(payload.warnings.map((item) => safeString(item)))
      : [],
  };
}

function mapMedicationToSystem(
  med: ScribeMedication,
  systemCatalog: SystemCatalogEntry[],
): ScribeMedication {
  const systemId = safeString(med.systemId);
  const diagnosis = safeString(med.diagnosis);

  if (systemId) return med;

  const diagnosisNorm = normalizeForMatch(diagnosis);
  if (!diagnosisNorm) return med;

  const matched = systemCatalog.find((system) => {
    const diagnosisName = normalizeForMatch(system.diagnosis || "");
    const systemName = normalizeForMatch(system.name || "");

    return (
      diagnosisNorm === diagnosisName ||
      diagnosisNorm === systemName ||
      diagnosisName.includes(diagnosisNorm)
    );
  });

  if (!matched) {
    return med;
  }

  return {
    ...med,
    systemId: matched.id,
    diagnosis: diagnosis || matched.diagnosis || matched.name || "",
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
    "You extract structured medical data from a clinical transcript.",
    "The transcript may mix Arabic and English.",
    "Return JSON only.",
    'Unknown strings must be "".',
    "Unknown arrays must be [].",
    "Do not invent facts.",
    "Do not translate medication names unless the transcript already says them in English.",
    "Preserve numbers, ages, dosages, case numbers, and medication names exactly as spoken whenever possible.",
    "Medication list must contain only explicit medication instructions.",
    "If no confident system match exists, keep systemId and diagnosis empty.",
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

    const parsed = safeParseJson<Record<string, unknown>>(raw);
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
      systemPrompt: `${systemPrompt} Return a valid JSON object only. No prose, no markdown.`,
      userPrompt,
      responseFormat: { type: "json_object" },
    });

    parsed = safeParseJson<StructuredPayload>(content);
  }

  if (!parsed) {
    throw new Error(`Failed to parse Groq JSON: ${content}`);
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

  const cleanedTranscript = removeTeachingNoise(transcript) || transcript;
  const systemCatalog = await loadSystemCatalog();
  const structured = await callGroqExtraction(cleanedTranscript, systemCatalog);

  const finalCaseNumber =
    structured.caseNumber || extractCaseNumber(transcript);
  const finalAge = structured.age || fallbackAge(transcript);
  const finalSex = structured.sex || fallbackSex(transcript);
  const finalChiefComplaint =
    structured.chiefComplaint || fallbackChiefComplaint(cleanedTranscript);
  const finalHistory =
    structured.significantHistory || fallbackHistory(cleanedTranscript);

  const finalSymptoms = dedupeStrings([
    ...(structured.associatedSymptoms || []),
    ...fallbackSymptoms(cleanedTranscript),
  ]);

  const finalExam =
    structured.examFindings || fallbackExamFindings(cleanedTranscript);

  const finalLabs =
    structured.labSummary || fallbackLabSummary(cleanedTranscript);

  const finalImaging =
    structured.imagingSummary || fallbackImagingSummary(cleanedTranscript);

  const finalDiagnosisHints = dedupeStrings([
    ...(structured.diagnosisHints || []),
    ...fallbackDiagnosisHints(cleanedTranscript),
  ]);

  const finalMedications = Array.isArray(structured.medications)
    ? structured.medications
        .map((medication) => mapMedicationToSystem(medication, systemCatalog))
        .filter((medication) => medication.medication)
    : [];

  const warnings = uniqueWarnings([
    ...(structured.warnings || []),
    !structured.age && finalAge ? "Age filled from transcript fallback." : "",
    !structured.sex && finalSex ? "Sex filled from transcript fallback." : "",
    !structured.caseNumber && finalCaseNumber
      ? "Case number filled from transcript fallback."
      : "",
    !structured.chiefComplaint && finalChiefComplaint
      ? "Chief complaint filled from transcript fallback."
      : "",
    !structured.significantHistory && finalHistory
      ? "History filled from transcript fallback."
      : "",
    !structured.diagnosisHints?.length && finalDiagnosisHints.length
      ? "Diagnosis hints filled from transcript fallback."
      : "",
  ]);

  return {
    transcript,
    patientName: structured.patientName || "",
    caseNumber: finalCaseNumber,
    age: finalAge,
    sex: finalSex,
    chiefComplaint: finalChiefComplaint,
    significantHistory: finalHistory,
    associatedSymptoms: finalSymptoms,
    examFindings: finalExam,
    labSummary: finalLabs,
    imagingSummary: finalImaging,
    diagnosisHints: finalDiagnosisHints,
    medications: finalMedications,
    warnings,
  };
}
