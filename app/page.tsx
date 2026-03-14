"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import VoiceScribe, {
  type AiClinicalSupport,
  type ScribeDraft,
  type ScribeMedication,
} from "../components/VoiceScribe";

type ExportLanguage = "en" | "ar";

type SystemCatalog = {
  id: string;
  name: string;
  diagnoses: string[];
};

type MedicationRow = {
  id: string;
  medication: string;
  dose: string;
  how: string;
  purpose: string;
  plan: string;
};

type MedicationSection = {
  id: string;
  systemId: string;
  diagnosis: string;
  diagnosisDate: string;
  rows: MedicationRow[];
};

type ToastState = null | {
  message: string;
  tone: "success" | "error";
};

type SuggestionStore = {
  medications: string[];
  doses: string[];
  how: string[];
  purposes: string[];
  plans: string[];
};

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
  language: ExportLanguage;
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

const STORAGE_KEY = "imr_v7_clean";

const DEFAULT_HOW_OPTIONS = [
  "Take with Food",
  "Take on an Empty Stomach",
  "Take with a Full Glass of Water",
  "Take Before Meals",
  "Take After Meals",
  "Take at Bedtime",
  "Take in the Morning",
  "Take Every 4-6 Hours as Needed",
  "Take Every 8 Hours",
  "Take Every 12 Hours",
  "Take Once Daily",
  "Take Twice Daily",
  "Take Three Times Daily",
  "Take Every Other Day",
  "Take as Directed by Physician",
  "Take with a Spoonful of Water",
  "Take Without Chewing",
  "Take Entire Dose at Once",
  "Take in Divided Doses",
  "Dissolve in Water Before Taking",
  "Shake Well Before Use",
  "Apply Topically",
  "Use as Eye Drops",
  "Take weekly with fatty meals",
  "Take at night with orange or lemon",
  "Take 2 every 12 hours",
  "Take 1/2 tablet in the morning",
];

const DEFAULT_PLAN_OPTIONS = [
  "Lab tests",
  "Blood pressure readings",
  "DXA scan",
  "Medication review with Consultant",
];

const DEFAULT_DOSE_OPTIONS = [
  "2.5 mg",
  "5 mg",
  "10 mg",
  "20 mg",
  "25 mg",
  "40 mg",
  "50 mg",
  "100 mg",
  "250 mg",
  "500 mg",
  "1 tablet",
  "1/2 tablet",
  "1 capsule",
  "2 tablets",
  "5 ml",
  "10 ml",
  "1 puff",
  "2 puffs",
  "1 drop",
  "2 drops",
];

const EMPTY_AI_SUPPORT: AiClinicalSupport = {
  summary: "",
  likelyDiagnosis: "",
  reasoning: "",
  currentTreatment: "",
  nextSteps: [],
  redFlags: [],
  confidence: "low",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function compactText(value: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function uniqKeepOrder(values: string[]) {
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

function toInputDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) return raw.replaceAll("/", "-");
  const slashMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (slashMatch) {
    const [, a, b, yyyy] = slashMatch;
    return `${yyyy}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

function humanDate(value: string) {
  const input = toInputDate(value);
  if (!input) return compactText(value);
  const [y, m, d] = input.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function createMedicationRow(initial?: Partial<MedicationRow>): MedicationRow {
  return {
    id: uid(),
    medication: initial?.medication || "",
    dose: initial?.dose || "",
    how: initial?.how || "",
    purpose: initial?.purpose || "",
    plan: initial?.plan || "",
  };
}

function createSection(
  initial?: Partial<MedicationSection>,
): MedicationSection {
  return {
    id: uid(),
    systemId: initial?.systemId || "",
    diagnosis: initial?.diagnosis || "",
    diagnosisDate: initial?.diagnosisDate || "",
    rows: initial?.rows?.length ? initial.rows : [createMedicationRow()],
  };
}

function escapeHtml(value: string) {
  return (value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildReportPayload(params: {
  language: ExportLanguage;
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
  sections: MedicationSection[];
  systemById: Map<string, SystemCatalog>;
}): ReportPayload {
  return {
    language: params.language,
    title: "Clinical Medication Review",
    patientName: params.patientName.trim(),
    dob: params.dob.trim(),
    mrn: params.mrn.trim(),
    occupation: params.occupation.trim(),
    supervisingDoctor: params.supervisingDoctor.trim(),
    carer: params.carer.trim(),
    allergies: params.allergies.trim(),
    intolerances: params.intolerances.trim(),
    significantHistory: params.significantHistory.trim(),
    reviewDate: params.reviewDate.trim(),
    reviewCompletedBy: params.reviewCompletedBy.trim(),
    treatmentGoals: params.treatmentGoals.trim(),
    nextReviewDate: params.nextReviewDate.trim(),
    nextReviewMode: params.nextReviewMode.trim(),
    beforeNextReview: params.beforeNextReview.trim(),
    notes: params.notes.trim(),
    rows: params.sections.flatMap((section) => {
      const systemName = params.systemById.get(section.systemId)?.name || "";
      return section.rows.map((row) => ({
        system: systemName,
        diagnosis: section.diagnosis,
        diagnosisDate: section.diagnosisDate,
        medication: row.medication.trim(),
        dose: row.dose.trim(),
        how: row.how.trim(),
        purpose: row.purpose.trim(),
        plan: row.plan.trim(),
      }));
    }),
  };
}

function buildPrintHtml(payload: ReportPayload) {
  const isArabic = payload.language === "ar";
  const dir = isArabic ? "rtl" : "ltr";
  const labels = isArabic
    ? {
        patient: "بيانات المريض",
        patientName: "اسم المريض",
        dob: "تاريخ الميلاد",
        mrn: "رقم الملف / الحالة",
        occupation: "العمل",
        supervisingDoctor: "الطبيب المشرف",
        carer: "المرافق / الممثل",
        allergies: "الحساسية",
        intolerances: "عدم التحمل",
        history: "التاريخ المرضي المهم",
        meds: "الأدوية حسب الجهاز",
        system: "الجهاز",
        diagnosis: "التشخيص والتاريخ إن وجد",
        medication: "الدواء والجرعة",
        how: "طريقة الاستخدام",
        purpose: "الغرض من الدواء",
        plan: "الخطة المتفق عليها / المراجعة القادمة",
        review: "معلومات المراجعة",
        reviewDate: "تاريخ المراجعة",
        reviewCompletedBy: "تمت المراجعة بواسطة",
        treatmentGoals: "الأهداف العلاجية",
        nextReviewDate: "تاريخ المراجعة القادمة",
        nextReviewMode: "نوع المراجعة القادمة",
        beforeNextReview: "قبل المراجعة القادمة",
        notes: "ملاحظات",
        empty: "—",
      }
    : {
        patient: "Patient details",
        patientName: "Patient name",
        dob: "Date of birth",
        mrn: "MRN / case number",
        occupation: "Occupation",
        supervisingDoctor: "Supervising doctor",
        carer: "Carer / representative",
        allergies: "Allergies",
        intolerances: "Intolerances",
        history: "Significant history",
        meds: "Medications by system",
        system: "System",
        diagnosis: "Diagnosis and date if available",
        medication: "Medication & Dose",
        how: "How to take",
        purpose: "What are they for?",
        plan: "Agreed Plan / Next Review",
        review: "Review details",
        reviewDate: "Review date",
        reviewCompletedBy: "Review completed by",
        treatmentGoals: "Treatment goals",
        nextReviewDate: "Next review date",
        nextReviewMode: "Next review mode",
        beforeNextReview: "Before next review",
        notes: "Notes",
        empty: "—",
      };

  const card = (label: string, value: string) => `
    <div class="card-item">
      <div class="card-label">${escapeHtml(label)}</div>
      <div class="card-value">${escapeHtml(value || labels.empty)}</div>
    </div>
  `;

  const rowsHtml = payload.rows.length
    ? payload.rows
        .map((row) => {
          const diagnosisCell = [row.diagnosis, row.diagnosisDate]
            .filter(Boolean)
            .join(row.diagnosis && row.diagnosisDate ? " • " : "");
          const medicationCell = [row.medication, row.dose]
            .filter(Boolean)
            .join(row.medication && row.dose ? " • " : "");
          return `
            <tr>
              <td>${escapeHtml(row.system || labels.empty)}</td>
              <td>${escapeHtml(diagnosisCell || labels.empty)}</td>
              <td>${escapeHtml(medicationCell || labels.empty)}</td>
              <td>${escapeHtml(row.how || labels.empty)}</td>
              <td>${escapeHtml(row.purpose || labels.empty)}</td>
              <td>${escapeHtml(row.plan || labels.empty)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6">${escapeHtml(labels.empty)}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${isArabic ? "ar" : "en"}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(payload.title)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
      h1 { margin: 0 0 6px; font-size: 28px; }
      h2 { margin: 26px 0 10px; font-size: 18px; }
      .sub { color: #475467; margin-bottom: 20px; }
      .card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .card-item { border: 1px solid #d0d5dd; border-radius: 14px; padding: 12px 14px; }
      .card-label { font-size: 11px; text-transform: uppercase; color: #667085; letter-spacing: .08em; margin-bottom: 8px; }
      .card-value { white-space: pre-wrap; line-height: 1.45; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #d0d5dd; padding: 10px 12px; text-align: ${isArabic ? "right" : "left"}; vertical-align: top; }
      th { background: #f8fafc; }
      .single { border: 1px solid #d0d5dd; border-radius: 14px; padding: 14px; white-space: pre-wrap; line-height: 1.55; }
      @media print { body { margin: 18px; } }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(payload.title)}</h1>
    <div class="sub">${escapeHtml(payload.reviewDate || todayISO())}</div>

    <h2>${escapeHtml(labels.patient)}</h2>
    <div class="card-grid">
      ${card(labels.patientName, payload.patientName)}
      ${card(labels.dob, payload.dob)}
      ${card(labels.mrn, payload.mrn)}
      ${card(labels.occupation, payload.occupation)}
      ${card(labels.supervisingDoctor, payload.supervisingDoctor)}
      ${card(labels.carer, payload.carer)}
      ${card(labels.allergies, payload.allergies)}
      ${card(labels.intolerances, payload.intolerances)}
    </div>

    <h2>${escapeHtml(labels.history)}</h2>
    <div class="single">${escapeHtml(payload.significantHistory || labels.empty)}</div>

    <h2>${escapeHtml(labels.meds)}</h2>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(labels.system)}</th>
          <th>${escapeHtml(labels.diagnosis)}</th>
          <th>${escapeHtml(labels.medication)}</th>
          <th>${escapeHtml(labels.how)}</th>
          <th>${escapeHtml(labels.purpose)}</th>
          <th>${escapeHtml(labels.plan)}</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <h2>${escapeHtml(labels.review)}</h2>
    <div class="card-grid">
      ${card(labels.reviewDate, payload.reviewDate)}
      ${card(labels.reviewCompletedBy, payload.reviewCompletedBy)}
      ${card(labels.treatmentGoals, payload.treatmentGoals)}
      ${card(labels.nextReviewDate, payload.nextReviewDate)}
      ${card(labels.nextReviewMode, payload.nextReviewMode)}
      ${card(labels.beforeNextReview, payload.beforeNextReview)}
      ${card(labels.notes, payload.notes)}
    </div>
  </body>
</html>`;
}

async function printHtmlDocument(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      iframe.remove();
    }, 1000);
  };

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve();
    try {
      const doc = iframe.contentWindow?.document;
      if (!doc) {
        reject(new Error("Failed to open print frame."));
        return;
      }
      doc.open();
      doc.write(html);
      doc.close();
    } catch (error) {
      reject(error);
    }
  });

  const frameWindow = iframe.contentWindow;
  if (!frameWindow) {
    cleanup();
    throw new Error("Print frame is unavailable.");
  }

  frameWindow.focus();
  frameWindow.print();
  cleanup();
}

async function translateReport(payload: ReportPayload) {
  const res = await fetch("/api/report/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    throw new Error(data?.error || "Arabic report translation failed.");
  }
  return data.report as ReportPayload;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field-block">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function SectionCard({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel panel-lg">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description ? <p className="muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default function Page() {
  const [systems, setSystems] = useState<SystemCatalog[]>([]);
  const [systemsLoading, setSystemsLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [patientName, setPatientName] = useState("");
  const [dob, setDob] = useState("");
  const [mrn, setMrn] = useState("");
  const [occupation, setOccupation] = useState("");
  const [supervisingDoctor, setSupervisingDoctor] = useState("");
  const [carer, setCarer] = useState("");
  const [allergies, setAllergies] = useState("");
  const [intolerances, setIntolerances] = useState("");
  const [significantHistory, setSignificantHistory] = useState("");
  const [reviewDate, setReviewDate] = useState(todayISO());
  const [reviewCompletedBy, setReviewCompletedBy] = useState("");
  const [treatmentGoals, setTreatmentGoals] = useState("");
  const [nextReviewDate, setNextReviewDate] = useState("");
  const [nextReviewMode, setNextReviewMode] = useState("");
  const [beforeNextReview, setBeforeNextReview] = useState("");
  const [notes, setNotes] = useState("");
  const [sections, setSections] = useState<MedicationSection[]>([
    createSection(),
  ]);
  const [aiClinicalSupport, setAiClinicalSupport] =
    useState<AiClinicalSupport>(EMPTY_AI_SUPPORT);
  const [suggestions, setSuggestions] = useState<SuggestionStore>({
    medications: [],
    doses: DEFAULT_DOSE_OPTIONS,
    how: DEFAULT_HOW_OPTIONS,
    purposes: [],
    plans: DEFAULT_PLAN_OPTIONS,
  });

  const systemById = useMemo(
    () => new Map(systems.map((item) => [item.id, item])),
    [systems],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/systems.json")
      .then((res) => res.json())
      .then((data: SystemCatalog[]) => {
        if (!cancelled) {
          setSystems(Array.isArray(data) ? data : []);
          setSystemsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSystems([]);
          setSystemsLoading(false);
          setToast({
            message: "Could not load systems catalog.",
            tone: "error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
      setPatientName(String(parsed.patientName || ""));
      setDob(String(parsed.dob || todayISO()));
      setMrn(String(parsed.mrn || ""));
      setOccupation(String(parsed.occupation || ""));
      setSupervisingDoctor(String(parsed.supervisingDoctor || ""));
      setCarer(String(parsed.carer || ""));
      setAllergies(String(parsed.allergies || ""));
      setIntolerances(String(parsed.intolerances || ""));
      setSignificantHistory(String(parsed.significantHistory || ""));
      setReviewDate(String(parsed.reviewDate || todayISO()));
      setReviewCompletedBy(String(parsed.reviewCompletedBy || ""));
      setTreatmentGoals(String(parsed.treatmentGoals || ""));
      setNextReviewDate(String(parsed.nextReviewDate || ""));
      setNextReviewMode(String(parsed.nextReviewMode || ""));
      setBeforeNextReview(String(parsed.beforeNextReview || ""));
      setNotes(String(parsed.notes || ""));
      if (Array.isArray(parsed.sections) && parsed.sections.length) {
        setSections(
          parsed.sections.map((section) => {
            const value = section as Partial<MedicationSection>;
            return createSection({
              systemId: String(value.systemId || ""),
              diagnosis: String(value.diagnosis || ""),
              diagnosisDate: String(value.diagnosisDate || ""),
              rows: Array.isArray(value.rows)
                ? value.rows.map((row) =>
                    createMedicationRow(row as Partial<MedicationRow>),
                  )
                : [createMedicationRow()],
            });
          }),
        );
      }
      if (
        parsed.aiClinicalSupport &&
        typeof parsed.aiClinicalSupport === "object"
      ) {
        setAiClinicalSupport(parsed.aiClinicalSupport as AiClinicalSupport);
      }
      if (parsed.suggestions && typeof parsed.suggestions === "object") {
        setSuggestions(parsed.suggestions as SuggestionStore);
      }
    } catch {
      // ignore corrupt local storage
    }
  }, []);

  useEffect(() => {
    const payload = {
      patientName,
      dob,
      mrn,
      occupation,
      supervisingDoctor,
      carer,
      allergies,
      intolerances,
      significantHistory,
      reviewDate,
      reviewCompletedBy,
      treatmentGoals,
      nextReviewDate,
      nextReviewMode,
      beforeNextReview,
      notes,
      sections,
      aiClinicalSupport,
      suggestions,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    patientName,
    dob,
    mrn,
    occupation,
    supervisingDoctor,
    carer,
    allergies,
    intolerances,
    significantHistory,
    reviewDate,
    reviewCompletedBy,
    treatmentGoals,
    nextReviewDate,
    nextReviewMode,
    beforeNextReview,
    notes,
    sections,
    aiClinicalSupport,
    suggestions,
  ]);

  function mergeSuggestionsFromDraft(draft: ScribeDraft) {
    setSuggestions((current) => ({
      medications: uniqKeepOrder([
        ...current.medications,
        ...draft.medications.map(
          (item) => item.medication || item.rawMedication,
        ),
      ]),
      doses: uniqKeepOrder([
        ...current.doses,
        ...draft.medications.map((item) => item.dose),
      ]),
      how: uniqKeepOrder([
        ...current.how,
        ...draft.medications.map((item) => item.how),
      ]),
      purposes: uniqKeepOrder([
        ...current.purposes,
        ...draft.medications.map((item) => item.purpose),
      ]),
      plans: uniqKeepOrder([
        ...current.plans,
        ...draft.medications.map((item) => item.plan),
        draft.beforeNextReview,
      ]),
    }));
  }

  function medicationsToSections(medications: ScribeMedication[]) {
    const groups = new Map<string, MedicationSection>();
    for (const item of medications) {
      const systemId = item.systemId || "";
      const diagnosis = item.diagnosis || "";
      const key = `${systemId}__${diagnosis}`;
      if (!groups.has(key)) {
        groups.set(
          key,
          createSection({
            systemId,
            diagnosis,
            rows: [],
          }),
        );
      }
      groups.get(key)?.rows.push(
        createMedicationRow({
          medication: item.medication || item.rawMedication,
          dose: item.dose,
          how: item.how,
          purpose: item.purpose,
          plan: item.plan,
        }),
      );
    }
    const values = [...groups.values()].filter(
      (section) => section.rows.length,
    );
    return values.length ? values : [createSection()];
  }

  function applyDraftToForm(draft: ScribeDraft) {
    if (draft.patientName) setPatientName(draft.patientName);
    if (draft.caseNumber) setMrn(draft.caseNumber);
    if (draft.dob) setDob(toInputDate(draft.dob));
    if (draft.occupation) setOccupation(draft.occupation);
    if (draft.supervisingDoctor) setSupervisingDoctor(draft.supervisingDoctor);
    if (draft.carer) setCarer(draft.carer);
    if (draft.allergies) setAllergies(draft.allergies);
    if (draft.intolerances) setIntolerances(draft.intolerances);
    if (draft.significantHistory)
      setSignificantHistory(draft.significantHistory);
    if (draft.reviewCompletedBy) setReviewCompletedBy(draft.reviewCompletedBy);
    if (draft.treatmentGoals) setTreatmentGoals(draft.treatmentGoals);
    if (draft.nextReviewDate)
      setNextReviewDate(toInputDate(draft.nextReviewDate));
    if (draft.nextReviewMode) setNextReviewMode(draft.nextReviewMode);
    if (draft.beforeNextReview) setBeforeNextReview(draft.beforeNextReview);

    const structuredNotes = [
      draft.chiefComplaint ? `Chief complaint: ${draft.chiefComplaint}` : "",
      draft.associatedSymptoms.length
        ? `Associated symptoms: ${draft.associatedSymptoms.join(", ")}`
        : "",
      draft.examFindings ? `Exam findings: ${draft.examFindings}` : "",
      draft.labSummary ? `Lab summary: ${draft.labSummary}` : "",
      draft.imagingSummary ? `Imaging summary: ${draft.imagingSummary}` : "",
      draft.notes,
    ]
      .filter(Boolean)
      .join("\n");
    if (structuredNotes) setNotes(structuredNotes);

    if (draft.medications.length) {
      setSections(medicationsToSections(draft.medications));
    }

    setAiClinicalSupport(draft.aiClinicalSupport || EMPTY_AI_SUPPORT);
    mergeSuggestionsFromDraft(draft);
    setToast({
      message: "Structured draft applied to the form.",
      tone: "success",
    });
  }

  function updateSection(
    sectionId: string,
    updater: (section: MedicationSection) => MedicationSection,
  ) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? updater(section) : section,
      ),
    );
  }

  function addSection() {
    setSections((current) => [...current, createSection()]);
  }

  function removeSection(sectionId: string) {
    setSections((current) =>
      current.length > 1
        ? current.filter((section) => section.id !== sectionId)
        : current,
    );
  }

  function addRow(sectionId: string) {
    updateSection(sectionId, (section) => ({
      ...section,
      rows: [...section.rows, createMedicationRow()],
    }));
  }

  function removeRow(sectionId: string, rowId: string) {
    updateSection(sectionId, (section) => ({
      ...section,
      rows:
        section.rows.length > 1
          ? section.rows.filter((row) => row.id !== rowId)
          : section.rows,
    }));
  }

  function duplicateRow(sectionId: string, rowId: string) {
    updateSection(sectionId, (section) => ({
      ...section,
      rows: section.rows.flatMap((row) =>
        row.id === rowId ? [row, createMedicationRow({ ...row })] : [row],
      ),
    }));
  }

  async function handleExport(language: ExportLanguage) {
    setIsExporting(true);
    setToast(null);
    try {
      const payload = buildReportPayload({
        language,
        patientName,
        dob: humanDate(dob),
        mrn,
        occupation,
        supervisingDoctor,
        carer,
        allergies,
        intolerances,
        significantHistory,
        reviewDate: humanDate(reviewDate),
        reviewCompletedBy,
        treatmentGoals,
        nextReviewDate: nextReviewDate ? humanDate(nextReviewDate) : "",
        nextReviewMode,
        beforeNextReview,
        notes,
        sections,
        systemById,
      });
      const finalPayload =
        language === "ar" ? await translateReport(payload) : payload;
      await printHtmlDocument(buildPrintHtml(finalPayload));
      setToast({
        message: `${language === "ar" ? "Arabic" : "English"} report opened for print/save as PDF.`,
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "PDF export failed.",
        tone: "error",
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Offline-friendly clinic workflow</p>
          <h1>Clinical medication review</h1>
          <p className="muted hero-copy">
            Structured dictation, editable patient details, clean medication
            tables, and PDF-ready output.
          </p>
        </div>
        <div className="toolbar-row">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => handleExport("en")}
            disabled={isExporting}
          >
            {isExporting ? "Preparing..." : "Export English PDF"}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => handleExport("ar")}
            disabled={isExporting}
          >
            {isExporting ? "Preparing..." : "Export Arabic PDF"}
          </button>
        </div>
      </section>

      {toast ? (
        <div className={`toast toast-${toast.tone}`}>{toast.message}</div>
      ) : null}

      <VoiceScribe onApplyDraft={applyDraftToForm} />

      <SectionCard
        title="Patient details"
        description="Everything stays editable, whether it came from dictation or manual entry."
      >
        <div className="form-grid">
          <Field
            label="Patient name"
            hint="Transcript tries to convert Arabic names into English spelling."
          >
            <input
              className="input"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
          </Field>
          <Field label="MRN / case number">
            <input
              className="input"
              value={mrn}
              onChange={(e) => setMrn(e.target.value)}
            />
          </Field>
          <Field label="Date of birth">
            <input
              className="input"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </Field>
          <Field label="Occupation">
            <input
              className="input"
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
            />
          </Field>
          <Field label="Supervising doctor">
            <input
              className="input"
              value={supervisingDoctor}
              onChange={(e) => setSupervisingDoctor(e.target.value)}
            />
          </Field>
          <Field label="Carer / representative">
            <input
              className="input"
              value={carer}
              onChange={(e) => setCarer(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Allergies">
            <textarea
              className="textarea"
              rows={4}
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="List known allergies"
            />
          </Field>
          <Field label="Intolerances">
            <textarea
              className="textarea"
              rows={4}
              value={intolerances}
              onChange={(e) => setIntolerances(e.target.value)}
              placeholder="List known intolerances"
            />
          </Field>
          <div className="full-span">
            <Field label="Significant history">
              <textarea
                className="textarea"
                rows={5}
                value={significantHistory}
                onChange={(e) => setSignificantHistory(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Medications by system"
        description="Manual entry still works even if the doctor skips dictation."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={addSection}
          >
            Add system
          </button>
        }
      >
        {systemsLoading ? <p className="muted">Loading systems...</p> : null}
        <div className="stack-lg">
          {sections.map((section) => {
            const diagnoses = systemById.get(section.systemId)?.diagnoses || [];
            return (
              <div key={section.id} className="panel nested-panel">
                <div className="section-head compact-head">
                  <div className="section-grid-top">
                    <Field label="System">
                      <select
                        className="input"
                        value={section.systemId}
                        onChange={(e) =>
                          updateSection(section.id, (current) => ({
                            ...current,
                            systemId: e.target.value,
                            diagnosis: "",
                          }))
                        }
                      >
                        <option value="">Select system</option>
                        {systems.map((system) => (
                          <option key={system.id} value={system.id}>
                            {system.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Diagnosis date if available">
                      <input
                        className="input"
                        type="date"
                        value={section.diagnosisDate}
                        onChange={(e) =>
                          updateSection(section.id, (current) => ({
                            ...current,
                            diagnosisDate: e.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeSection(section.id)}
                  >
                    Remove system
                  </button>
                </div>

                <Field label="Diagnosis">
                  <input
                    className="input"
                    list={`diagnosis-list-${section.id}`}
                    value={section.diagnosis}
                    onChange={(e) =>
                      updateSection(section.id, (current) => ({
                        ...current,
                        diagnosis: e.target.value,
                      }))
                    }
                    placeholder="Select or type diagnosis"
                  />
                </Field>
                <datalist id={`diagnosis-list-${section.id}`}>
                  {diagnoses.map((diagnosis) => (
                    <option key={diagnosis} value={diagnosis} />
                  ))}
                </datalist>

                <div className="med-table-wrap">
                  <table className="med-table desktop-only">
                    <thead>
                      <tr>
                        <th>Medication</th>
                        <th>Dose</th>
                        <th>How to take</th>
                        <th>Used for</th>
                        <th>Agreed plan / next review</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <input
                              className="input"
                              list={`medication-suggestions-${section.id}`}
                              value={row.medication}
                              onChange={(e) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  rows: current.rows.map((item) =>
                                    item.id === row.id
                                      ? { ...item, medication: e.target.value }
                                      : item,
                                  ),
                                }))
                              }
                              placeholder="Type medication"
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              list="dose-suggestions"
                              value={row.dose}
                              onChange={(e) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  rows: current.rows.map((item) =>
                                    item.id === row.id
                                      ? { ...item, dose: e.target.value }
                                      : item,
                                  ),
                                }))
                              }
                              placeholder="Dose"
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              list="how-suggestions"
                              value={row.how}
                              onChange={(e) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  rows: current.rows.map((item) =>
                                    item.id === row.id
                                      ? { ...item, how: e.target.value }
                                      : item,
                                  ),
                                }))
                              }
                              placeholder="How to take"
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              list="purpose-suggestions"
                              value={row.purpose}
                              onChange={(e) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  rows: current.rows.map((item) =>
                                    item.id === row.id
                                      ? { ...item, purpose: e.target.value }
                                      : item,
                                  ),
                                }))
                              }
                              placeholder="Optional"
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              list="plan-suggestions"
                              value={row.plan}
                              onChange={(e) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  rows: current.rows.map((item) =>
                                    item.id === row.id
                                      ? { ...item, plan: e.target.value }
                                      : item,
                                  ),
                                }))
                              }
                              placeholder="Optional"
                            />
                          </td>
                          <td>
                            <div className="action-stack">
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => duplicateRow(section.id, row.id)}
                              >
                                Duplicate
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger ghost-danger"
                                onClick={() => removeRow(section.id, row.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mobile-only stack-md">
                    {section.rows.map((row, index) => (
                      <div key={row.id} className="mobile-med-card">
                        <div className="row-between">
                          <h4>Medication row {index + 1}</h4>
                          <div className="toolbar-row">
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => duplicateRow(section.id, row.id)}
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger ghost-danger"
                              onClick={() => removeRow(section.id, row.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <Field label="Medication">
                          <input
                            className="input"
                            value={row.medication}
                            onChange={(e) =>
                              updateSection(section.id, (current) => ({
                                ...current,
                                rows: current.rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, medication: e.target.value }
                                    : item,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Dose">
                          <input
                            className="input"
                            value={row.dose}
                            onChange={(e) =>
                              updateSection(section.id, (current) => ({
                                ...current,
                                rows: current.rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, dose: e.target.value }
                                    : item,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="How to take">
                          <input
                            className="input"
                            value={row.how}
                            onChange={(e) =>
                              updateSection(section.id, (current) => ({
                                ...current,
                                rows: current.rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, how: e.target.value }
                                    : item,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Used for">
                          <input
                            className="input"
                            value={row.purpose}
                            onChange={(e) =>
                              updateSection(section.id, (current) => ({
                                ...current,
                                rows: current.rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, purpose: e.target.value }
                                    : item,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Agreed plan / next review">
                          <input
                            className="input"
                            value={row.plan}
                            onChange={(e) =>
                              updateSection(section.id, (current) => ({
                                ...current,
                                rows: current.rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, plan: e.target.value }
                                    : item,
                                ),
                              }))
                            }
                          />
                        </Field>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => addRow(section.id)}
                >
                  Add medication row
                </button>
              </div>
            );
          })}
        </div>

        <datalist id="dose-suggestions">
          {suggestions.doses.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="how-suggestions">
          {suggestions.how.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="purpose-suggestions">
          {suggestions.purposes.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id="plan-suggestions">
          {suggestions.plans.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        {sections.map((section) => (
          <datalist
            key={section.id}
            id={`medication-suggestions-${section.id}`}
          >
            {suggestions.medications.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        ))}
      </SectionCard>

      <SectionCard
        title="Review details"
        description="These fields print in the final report. Internal AI support does not."
      >
        <div className="form-grid">
          <Field label="Review date">
            <input
              className="input"
              type="date"
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
            />
          </Field>
          <Field label="Review completed by">
            <input
              className="input"
              value={reviewCompletedBy}
              onChange={(e) => setReviewCompletedBy(e.target.value)}
              placeholder="Clinician name"
            />
          </Field>
          <Field label="Treatment goals">
            <textarea
              className="textarea"
              rows={4}
              value={treatmentGoals}
              onChange={(e) => setTreatmentGoals(e.target.value)}
            />
          </Field>
          <Field label="Next review date">
            <input
              className="input"
              type="date"
              value={nextReviewDate}
              onChange={(e) => setNextReviewDate(e.target.value)}
            />
          </Field>
          <Field label="Next review mode">
            <select
              className="input"
              value={nextReviewMode}
              onChange={(e) => setNextReviewMode(e.target.value)}
            >
              <option value="">Select mode</option>
              <option value="In person">In person</option>
              <option value="Video">Video</option>
              <option value="Phone">Phone</option>
            </select>
          </Field>
          <Field label="Before next review">
            <textarea
              className="textarea"
              rows={4}
              value={beforeNextReview}
              onChange={(e) => setBeforeNextReview(e.target.value)}
            />
          </Field>
          <div className="full-span">
            <Field label="Notes">
              <textarea
                className="textarea"
                rows={6}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <details className="internal-support">
          <summary>
            <div>
              <p className="eyebrow">Internal only</p>
              <h3>AI clinical support</h3>
              <p className="muted">
                For the clinician or staff member inside the app only.
              </p>
            </div>
            <span className="pill">
              Confidence: {aiClinicalSupport.confidence || "low"}
            </span>
          </summary>
          <div className="support-grid">
            <Field label="Summary">
              <textarea
                className="textarea"
                rows={3}
                value={aiClinicalSupport.summary}
                onChange={(e) =>
                  setAiClinicalSupport((current) => ({
                    ...current,
                    summary: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Likely diagnosis">
              <input
                className="input"
                value={aiClinicalSupport.likelyDiagnosis}
                onChange={(e) =>
                  setAiClinicalSupport((current) => ({
                    ...current,
                    likelyDiagnosis: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Reasoning">
              <textarea
                className="textarea"
                rows={5}
                value={aiClinicalSupport.reasoning}
                onChange={(e) =>
                  setAiClinicalSupport((current) => ({
                    ...current,
                    reasoning: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Current treatment / documented meds">
              <textarea
                className="textarea"
                rows={4}
                value={aiClinicalSupport.currentTreatment}
                onChange={(e) =>
                  setAiClinicalSupport((current) => ({
                    ...current,
                    currentTreatment: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Suggested next steps">
              <textarea
                className="textarea"
                rows={5}
                value={aiClinicalSupport.nextSteps.join("\n")}
                onChange={(e) =>
                  setAiClinicalSupport((current) => ({
                    ...current,
                    nextSteps: e.target.value
                      .split(/\n+/)
                      .map((item) => compactText(item))
                      .filter(Boolean),
                  }))
                }
              />
            </Field>
            <Field label="Red flags">
              <textarea
                className="textarea"
                rows={5}
                value={aiClinicalSupport.redFlags.join("\n")}
                onChange={(e) =>
                  setAiClinicalSupport((current) => ({
                    ...current,
                    redFlags: e.target.value
                      .split(/\n+/)
                      .map((item) => compactText(item))
                      .filter(Boolean),
                  }))
                }
              />
            </Field>
          </div>
        </details>
      </SectionCard>
    </main>
  );
}
