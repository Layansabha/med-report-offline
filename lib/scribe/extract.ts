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

type SystemCatalogEntry = {
  id: string;
  name: string;
  diagnosis?: string;
};

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
    const v = compactText(item);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
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
  const m =
    transcript.match(/\b(\d{1,3})\s*year[s]?\s*old\b/i) ||
    transcript.match(/\bage[:\s-]*(\d{1,3})\b/i);
  return m?.[1]?.trim() || "";
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

  for (const p of patterns) {
    const m = transcript.match(p);
    if (m?.[1]) return compactText(m[1]);
  }

  return "";
}

function fallbackHistory(transcript: string) {
  const patterns = [
    /\bwith history of ([^.]+)/i,
    /\bhistory of ([^.]+)/i,
    /\bknown case of ([^.]+)/i,
  ];

  for (const p of patterns) {
    const m = transcript.match(p);
    if (m?.[1]) return compactText(m[1]);
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
    const m = t.match(/(?:wbc|y count|cbc)[^.]{0,120}/i);
    if (m?.[0]) parts.push(compactText(m[0]));
  }

  if (/hemoglobin/i.test(t)) {
    const m = t.match(/hemoglobin[^.]{0,80}/i);
    if (m?.[0]) parts.push(compactText(m[0]));
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

function mapMedicationToSystem(
  med: ScribeMedication,
  systemCatalog: SystemCatalogEntry[],
): ScribeMedication {
  const systemId = safeString(med.systemId);
  const diagnosis = safeString(med.diagnosis);

  if (systemId) return med;

  const diagnosisNorm = normalizeForMatch(diagnosis);
  if (!diagnosisNorm) return med;

  const matched = systemCatalog.find((s) => {
    const a = normalizeForMatch(s.diagnosis || "");
    const b = normalizeForMatch(s.name || "");
    return (
      diagnosisNorm === a || diagnosisNorm === b || a.includes(diagnosisNorm)
    );
  });

  if (!matched) return med;

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

    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      id: safeString(item?.id),
      name: safeString(item?.name),
      diagnosis: safeString(item?.diagnosis),
    }));
  } catch {
    return [];
  }
}

async function callOllama(
  transcript: string,
  systemCatalog: SystemCatalogEntry[],
): Promise<Omit<StructuredDraft, "transcript">> {
  const ollamaUrl =
    process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/api/chat";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct";

  const schema = {
    type: "object",
    properties: {
      patientName: { type: "string" },
      caseNumber: { type: "string" },
      age: { type: "string" },
      sex: { type: "string" },
      chiefComplaint: { type: "string" },
      significantHistory: { type: "string" },
      associatedSymptoms: { type: "array", items: { type: "string" } },
      examFindings: { type: "string" },
      labSummary: { type: "string" },
      imagingSummary: { type: "string" },
      diagnosisHints: { type: "array", items: { type: "string" } },
      medications: {
        type: "array",
        items: {
          type: "object",
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
      warnings: { type: "array", items: { type: "string" } },
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

  const systemsText = systemCatalog.length
    ? systemCatalog
        .map(
          (s) =>
            `- id:${s.id} | name:${s.name} | diagnosis:${s.diagnosis || ""}`,
        )
        .join("\n")
    : "No systems catalog provided.";

  const systemPrompt = `
You extract structured medical data from a clinical transcript.
Return JSON only.
Do not invent facts.
Unknown strings = "".
Unknown arrays = [].
Ignore teaching chatter, answer choices, and social-media filler.
Medication list must contain only explicit medication instructions.
If no confident system match exists, keep systemId and diagnosis empty.
Available systems:
${systemsText}
`.trim();

  const userPrompt = `
Schema:
${JSON.stringify(schema)}

Transcript:
${transcript}
`.trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: schema,
        options: {
          temperature: 0,
          top_p: 0.9,
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Ollama failed: ${res.status} ${txt}`);
    }

    const data = await res.json();
    const content = data?.message?.content ?? "";
    const parsed = safeParseJson<any>(content);

    if (!parsed) {
      throw new Error(`Failed to parse Ollama JSON: ${content}`);
    }

    return {
      patientName: safeString(parsed.patientName),
      caseNumber: safeString(parsed.caseNumber),
      age: safeString(parsed.age),
      sex: safeString(parsed.sex),
      chiefComplaint: safeString(parsed.chiefComplaint),
      significantHistory: safeString(parsed.significantHistory),
      associatedSymptoms: Array.isArray(parsed.associatedSymptoms)
        ? dedupeStrings(
            parsed.associatedSymptoms.map((x: unknown) => safeString(x)),
          )
        : [],
      examFindings: safeString(parsed.examFindings),
      labSummary: safeString(parsed.labSummary),
      imagingSummary: safeString(parsed.imagingSummary),
      diagnosisHints: Array.isArray(parsed.diagnosisHints)
        ? dedupeStrings(
            parsed.diagnosisHints.map((x: unknown) => safeString(x)),
          )
        : [],
      medications: Array.isArray(parsed.medications)
        ? parsed.medications.map((m: any) => ({
            systemId: safeString(m.systemId),
            diagnosis: safeString(m.diagnosis),
            medication: safeString(m.medication),
            dose: safeString(m.dose),
            how: safeString(m.how),
            purpose: safeString(m.purpose),
            plan: safeString(m.plan),
          }))
        : [],
      warnings: Array.isArray(parsed.warnings)
        ? uniqueWarnings(parsed.warnings.map((x: unknown) => safeString(x)))
        : [],
    };
  } finally {
    clearTimeout(timeout);
  }
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
  const structured = await callOllama(cleanedTranscript, systemCatalog);

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
        .map((m) => mapMedicationToSystem(m, systemCatalog))
        .filter((m) => m.medication)
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
