"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import VoiceScribe, { type ScribeDraft } from "../components/VoiceScribe";

type TabKey = "patient" | "meds" | "review";
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
};

type SuggestionState = {
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

const STORAGE_KEY = "imr_v5_business";
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
  "Take with a Spoonful of Water (for dissolvable tablets)",
  "Take Without Chewing (for slow-release or coated tablets)",
  "Take Entire Dose at Once",
  "Take in Divided Doses (split throughout the day)",
  "Dissolve in Water Before Taking",
  "Shake Well Before Use (for suspensions)",
  "Apply Topically (for creams or ointments)",
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

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalize(value: string) {
  return (value ?? "").trim().toLowerCase();
}

function uniqKeepOrder(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const next = value.trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }

  return out;
}

function toInputDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) return raw.replaceAll("/", "-");

  const match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!match) return "";

  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function englishFallback(value: string) {
  return value || "—";
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

  const tableRows = payload.rows.length
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
    : `
      <tr>
        <td colspan="6" class="empty-row">${escapeHtml(labels.empty)}</td>
      </tr>
    `;

  return `<!doctype html>
<html lang="${isArabic ? "ar" : "en"}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(payload.title)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px;
        font-family: Arial, Helvetica, sans-serif;
        color: #0f172a;
        background: white;
      }
      .page { max-width: 1120px; margin: 0 auto; }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 24px;
        border-bottom: 2px solid #e2e8f0;
        padding-bottom: 16px;
      }
      h1 { margin: 0; font-size: 28px; }
      .muted { color: #64748b; font-size: 13px; margin-top: 6px; }
      .section { margin-top: 24px; }
      .section-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #475569;
        margin-bottom: 12px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .card {
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 12px 14px;
        background: #f8fafc;
        min-height: 68px;
      }
      .label {
        font-size: 12px;
        color: #64748b;
        margin-bottom: 6px;
      }
      .value {
        font-size: 14px;
        line-height: 1.55;
        white-space: pre-wrap;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        overflow: hidden;
      }
      thead th {
        background: #eff6ff;
        color: #1e3a8a;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      th, td {
        border-bottom: 1px solid #e2e8f0;
        padding: 12px;
        text-align: ${isArabic ? "right" : "left"};
        vertical-align: top;
        font-size: 13px;
        line-height: 1.5;
      }
      tr:last-child td { border-bottom: none; }
      .empty-row { text-align: center; color: #64748b; }
      @media print {
        body { padding: 0; }
        .page { max-width: 100%; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          <h1>${escapeHtml(payload.title)}</h1>
          <div class="muted">${escapeHtml(
            isArabic ? "نسخة قابلة للطباعة" : "Printable report",
          )}</div>
        </div>
        <div class="muted">${escapeHtml(payload.reviewDate || todayISO())}</div>
      </div>

      <div class="section">
        <div class="section-title">${escapeHtml(labels.patient)}</div>
        <div class="grid">
          ${buildCard(labels.patientName, payload.patientName || labels.empty)}
          ${buildCard(labels.dob, payload.dob || labels.empty)}
          ${buildCard(labels.mrn, payload.mrn || labels.empty)}
          ${buildCard(labels.occupation, payload.occupation || labels.empty)}
          ${buildCard(
            labels.supervisingDoctor,
            payload.supervisingDoctor || labels.empty,
          )}
          ${buildCard(labels.carer, payload.carer || labels.empty)}
          ${buildCard(labels.allergies, payload.allergies || labels.empty)}
          ${buildCard(
            labels.intolerances,
            payload.intolerances || labels.empty,
          )}
        </div>
      </div>

      <div class="section">
        <div class="section-title">${escapeHtml(labels.history)}</div>
        ${buildCard("", payload.significantHistory || labels.empty)}
      </div>

      <div class="section">
        <div class="section-title">${escapeHtml(labels.meds)}</div>
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
          <tbody>${tableRows}</tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">${escapeHtml(labels.review)}</div>
        <div class="grid">
          ${buildCard(labels.reviewDate, payload.reviewDate || labels.empty)}
          ${buildCard(
            labels.reviewCompletedBy,
            payload.reviewCompletedBy || labels.empty,
          )}
          ${buildCard(
            labels.treatmentGoals,
            payload.treatmentGoals || labels.empty,
          )}
          ${buildCard(
            labels.nextReviewDate,
            payload.nextReviewDate || labels.empty,
          )}
          ${buildCard(
            labels.nextReviewMode,
            payload.nextReviewMode || labels.empty,
          )}
          ${buildCard(
            labels.beforeNextReview,
            payload.beforeNextReview || labels.empty,
          )}
          ${buildCard(labels.notes, payload.notes || labels.empty)}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function buildCard(label: string, value: string) {
  return `<div class="card">${
    label ? `<div class="label">${escapeHtml(label)}</div>` : ""
  }<div class="value">${escapeHtml(value)}</div></div>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function openPrintWindow(html: string) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    throw new Error("Popup blocked. Allow popups to print the report.");
  }

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.onload = () => {
    win.print();
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <div>
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        {hint ? (
          <div className="mt-1 text-xs text-slate-500">{hint}</div>
        ) : null}
      </div>
      {children}
    </label>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm font-medium text-slate-900">
        {value || "—"}
      </div>
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState<TabKey>("patient");
  const [systems, setSystems] = useState<SystemCatalog[]>([]);
  const [systemsLoaded, setSystemsLoaded] = useState(false);

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
  const [nextReviewMode, setNextReviewMode] = useState<
    "" | "In-person" | "Video"
  >("");
  const [beforeNextReview, setBeforeNextReview] = useState("");
  const [notes, setNotes] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");

  const [sections, setSections] = useState<MedicationSection[]>([]);
  const [addSystemId, setAddSystemId] = useState("");
  const [search, setSearch] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);

  const [online, setOnline] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [toast, setToast] = useState<ToastState>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<ExportLanguage | "">("");
  const [scribeResetSignal, setScribeResetSignal] = useState(0);

  const [suggestions, setSuggestions] = useState<SuggestionState>({
    medications: [],
    doses: [],
    how: [],
    purposes: [],
    plans: [],
  });

  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    fetch("/systems.json")
      .then((res) => res.json())
      .then((data) => {
        setSystems(Array.isArray(data) ? data : []);
      })
      .finally(() => setSystemsLoaded(true));
  }, []);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      setPatientName(String(parsed.patientName ?? ""));
      setDob(String(parsed.dob ?? ""));
      setMrn(String(parsed.mrn ?? ""));
      setOccupation(String(parsed.occupation ?? ""));
      setSupervisingDoctor(String(parsed.supervisingDoctor ?? ""));
      setCarer(String(parsed.carer ?? ""));
      setAllergies(String(parsed.allergies ?? ""));
      setIntolerances(String(parsed.intolerances ?? ""));
      setSignificantHistory(String(parsed.significantHistory ?? ""));
      setReviewDate(String(parsed.reviewDate ?? todayISO()));
      setReviewCompletedBy(String(parsed.reviewCompletedBy ?? ""));
      setTreatmentGoals(String(parsed.treatmentGoals ?? ""));
      setNextReviewDate(String(parsed.nextReviewDate ?? ""));
      setNextReviewMode(
        parsed.nextReviewMode === "In-person" ||
          parsed.nextReviewMode === "Video"
          ? parsed.nextReviewMode
          : "",
      );
      setBeforeNextReview(String(parsed.beforeNextReview ?? ""));
      setNotes(String(parsed.notes ?? ""));
      setAiSuggestion(String(parsed.aiSuggestion ?? ""));
      setAddSystemId(String(parsed.addSystemId ?? ""));
      setSearch(String(parsed.search ?? ""));
      setIncompleteOnly(Boolean(parsed.incompleteOnly));
      setSections(
        Array.isArray(parsed.sections)
          ? (parsed.sections as MedicationSection[])
          : [],
      );
      const loadedSuggestions = parsed.suggestions;
      if (loadedSuggestions && typeof loadedSuggestions === "object") {
        setSuggestions({
          medications: Array.isArray(
            (loadedSuggestions as SuggestionState).medications,
          )
            ? uniqKeepOrder((loadedSuggestions as SuggestionState).medications)
            : [],
          doses: Array.isArray((loadedSuggestions as SuggestionState).doses)
            ? uniqKeepOrder((loadedSuggestions as SuggestionState).doses)
            : [],
          how: Array.isArray((loadedSuggestions as SuggestionState).how)
            ? uniqKeepOrder((loadedSuggestions as SuggestionState).how)
            : [],
          purposes: Array.isArray(
            (loadedSuggestions as SuggestionState).purposes,
          )
            ? uniqKeepOrder((loadedSuggestions as SuggestionState).purposes)
            : [],
          plans: Array.isArray((loadedSuggestions as SuggestionState).plans)
            ? uniqKeepOrder((loadedSuggestions as SuggestionState).plans)
            : [],
        });
      }
    } catch {
      // ignore broken local state
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
      aiSuggestion,
      addSystemId,
      search,
      incompleteOnly,
      sections,
      suggestions,
    };

    setSaveState("saving");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      const timer = window.setTimeout(() => setSaveState("saved"), 160);
      return () => window.clearTimeout(timer);
    } catch {
      setSaveState("idle");
      return undefined;
    }
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
    aiSuggestion,
    addSystemId,
    search,
    incompleteOnly,
    sections,
    suggestions,
  ]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, [toast]);

  const systemById = useMemo(() => {
    return new Map(systems.map((system) => [system.id, system]));
  }, [systems]);

  const allMedicationSuggestions = useMemo(
    () => uniqKeepOrder(suggestions.medications),
    [suggestions.medications],
  );
  const allDoseSuggestions = useMemo(
    () => uniqKeepOrder([...DEFAULT_DOSE_OPTIONS, ...suggestions.doses]),
    [suggestions.doses],
  );
  const allHowSuggestions = useMemo(
    () => uniqKeepOrder([...DEFAULT_HOW_OPTIONS, ...suggestions.how]),
    [suggestions.how],
  );
  const allPurposeSuggestions = useMemo(
    () => uniqKeepOrder(suggestions.purposes),
    [suggestions.purposes],
  );
  const allPlanSuggestions = useMemo(
    () => uniqKeepOrder([...DEFAULT_PLAN_OPTIONS, ...suggestions.plans]),
    [suggestions.plans],
  );

  const filteredSections = useMemo(() => {
    const q = normalize(search);
    return sections
      .map((section) => {
        const systemName = systemById.get(section.systemId)?.name || "";
        const rows = section.rows.filter((row) => {
          const text = [
            systemName,
            section.diagnosis,
            section.diagnosisDate,
            row.medication,
            row.dose,
            row.how,
            row.purpose,
            row.plan,
          ]
            .join(" ")
            .toLowerCase();

          const matchesSearch = !q || text.includes(q);
          const incomplete = [
            row.medication,
            row.dose,
            row.how,
            row.purpose,
            row.plan,
          ].some((value) => !value.trim());

          return matchesSearch && (!incompleteOnly || incomplete);
        });

        if (q && !rows.length) {
          const sectionText =
            `${systemName} ${section.diagnosis} ${section.diagnosisDate}`.toLowerCase();
          if (!sectionText.includes(q)) {
            return null;
          }
        }

        if (!rows.length && (q || incompleteOnly)) return null;

        return {
          ...section,
          rows,
        };
      })
      .filter(Boolean) as MedicationSection[];
  }, [sections, systemById, search, incompleteOnly]);

  const totalRows = useMemo(
    () => sections.reduce((sum, section) => sum + section.rows.length, 0),
    [sections],
  );

  function showToast(message: string) {
    setToast({ message });
  }

  function addSection(systemId: string) {
    if (!systemId) return;
    const system = systemById.get(systemId);
    const next: MedicationSection = {
      id: `section-${uid()}`,
      systemId,
      diagnosis: "",
      diagnosisDate: "",
      rows: [
        {
          id: `row-${uid()}`,
          medication: "",
          dose: "",
          how: "",
          purpose: "",
          plan: "",
        },
      ],
    };
    setSections((prev) => [...prev, next]);
    setAddSystemId("");
    setTab("meds");
    showToast(`Added ${system?.name || "system"}`);
  }

  function removeSection(sectionId: string) {
    setSections((prev) => prev.filter((section) => section.id !== sectionId));
    showToast("System removed");
  }

  function updateSection(sectionId: string, patch: Partial<MedicationSection>) {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section,
      ),
    );
  }

  function addMedicationRow(sectionId: string) {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              rows: [
                ...section.rows,
                {
                  id: `row-${uid()}`,
                  medication: "",
                  dose: "",
                  how: "",
                  purpose: "",
                  plan: "",
                },
              ],
            }
          : section,
      ),
    );
  }

  function updateRow(
    sectionId: string,
    rowId: string,
    patch: Partial<MedicationRow>,
  ) {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              rows: section.rows.map((row) =>
                row.id === rowId ? { ...row, ...patch } : row,
              ),
            }
          : section,
      ),
    );
  }

  function duplicateRow(sectionId: string, rowId: string) {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id !== sectionId) return section;
        const source = section.rows.find((row) => row.id === rowId);
        if (!source) return section;
        return {
          ...section,
          rows: [
            ...section.rows,
            {
              ...source,
              id: `row-${uid()}`,
            },
          ],
        };
      }),
    );
  }

  function removeRow(sectionId: string, rowId: string) {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id !== sectionId) return section;
        const nextRows = section.rows.filter((row) => row.id !== rowId);
        return {
          ...section,
          rows: nextRows.length
            ? nextRows
            : [
                {
                  id: `row-${uid()}`,
                  medication: "",
                  dose: "",
                  how: "",
                  purpose: "",
                  plan: "",
                },
              ],
        };
      }),
    );
  }

  function appendIfEmpty(
    setter: Dispatch<SetStateAction<string>>,
    incoming?: string,
  ) {
    const next = incoming?.trim();
    if (!next) return;
    setter((prev) => prev.trim() || next);
  }

  function appendText(
    setter: Dispatch<SetStateAction<string>>,
    incoming?: string,
  ) {
    const next = incoming?.trim();
    if (!next) return;
    setter((prev) => (prev.trim() ? `${prev.trim()}\n${next}` : next));
  }

  function resolveSystemId(systemId?: string, diagnosis?: string) {
    const direct = (systemId ?? "").trim();
    if (direct && systemById.has(direct)) return direct;

    const diagnosisNorm = normalize(diagnosis || "");
    if (!diagnosisNorm) return "";

    const matched = systems.find((system) => {
      if (normalize(system.name) === diagnosisNorm) return true;
      return system.diagnoses.some((item) => normalize(item) === diagnosisNorm);
    });

    return matched?.id || "";
  }

  function mergeTranscriptSuggestions(draft: ScribeDraft) {
    const meds = Array.isArray(draft.medications) ? draft.medications : [];
    setSuggestions((prev) => ({
      medications: uniqKeepOrder([
        ...prev.medications,
        ...meds.map((item) => item.medication || item.rawMedication || ""),
      ]),
      doses: uniqKeepOrder([
        ...prev.doses,
        ...meds.map((item) => item.dose || ""),
      ]),
      how: uniqKeepOrder([...prev.how, ...meds.map((item) => item.how || "")]),
      purposes: uniqKeepOrder([
        ...prev.purposes,
        ...meds.map((item) => item.purpose || ""),
      ]),
      plans: uniqKeepOrder([
        ...prev.plans,
        ...meds.map((item) => item.plan || ""),
      ]),
    }));
  }

  function applyScribeDraft(draft: ScribeDraft) {
    appendIfEmpty(setPatientName, draft.patientName);
    appendIfEmpty(setMrn, draft.caseNumber);
    appendIfEmpty(setOccupation, draft.occupation);
    appendIfEmpty(setSupervisingDoctor, draft.supervisingDoctor);
    appendIfEmpty(setCarer, draft.carer);
    appendIfEmpty(setAllergies, draft.allergies);
    appendIfEmpty(setIntolerances, draft.intolerances);
    appendIfEmpty(setReviewCompletedBy, draft.reviewCompletedBy);
    appendIfEmpty(setTreatmentGoals, draft.treatmentGoals);
    appendIfEmpty(setBeforeNextReview, draft.beforeNextReview);
    appendIfEmpty(setNotes, draft.notes);
    appendIfEmpty(setAiSuggestion, draft.aiSuggestion);

    const nextDob = toInputDate(draft.dob || "");
    if (nextDob) {
      setDob((prev) => prev || nextDob);
    }

    const nextReview = toInputDate(draft.nextReviewDate || "");
    if (nextReview) {
      setNextReviewDate((prev) => prev || nextReview);
    }

    if (
      draft.nextReviewMode === "In-person" ||
      draft.nextReviewMode === "Video"
    ) {
      setNextReviewMode((prev) => prev || draft.nextReviewMode!);
    }

    appendText(setSignificantHistory, draft.significantHistory);

    const structuredNotes = [
      draft.chiefComplaint?.trim()
        ? `Chief complaint: ${draft.chiefComplaint.trim()}`
        : "",
      Array.isArray(draft.associatedSymptoms) && draft.associatedSymptoms.length
        ? `Associated symptoms: ${draft.associatedSymptoms.join(", ")}`
        : "",
      draft.examFindings?.trim()
        ? `Exam findings: ${draft.examFindings.trim()}`
        : "",
      draft.labSummary?.trim() ? `Lab summary: ${draft.labSummary.trim()}` : "",
      draft.imagingSummary?.trim()
        ? `Imaging summary: ${draft.imagingSummary.trim()}`
        : "",
    ].filter(Boolean);

    if (structuredNotes.length) {
      appendText(setNotes, structuredNotes.join(""));
    }

    mergeTranscriptSuggestions(draft);

    const medications = Array.isArray(draft.medications)
      ? draft.medications
      : [];
    let addedCount = 0;
    let skippedCount = 0;

    if (medications.length) {
      setSections((prev) => {
        const next = [...prev];

        for (const item of medications) {
          const medicationName = (
            item.medication ||
            item.rawMedication ||
            ""
          ).trim();
          if (!medicationName) {
            skippedCount += 1;
            continue;
          }

          const resolvedSystemId = resolveSystemId(
            item.systemId,
            item.diagnosis,
          );
          if (!resolvedSystemId) {
            skippedCount += 1;
            continue;
          }

          let section = next.find(
            (entry) => entry.systemId === resolvedSystemId,
          );
          if (!section) {
            section = {
              id: `section-${uid()}`,
              systemId: resolvedSystemId,
              diagnosis: (item.diagnosis || "").trim(),
              diagnosisDate: "",
              rows: [],
            };
            next.push(section);
          }

          section.rows = [
            ...section.rows,
            {
              id: `row-${uid()}`,
              medication: medicationName,
              dose: (item.dose || "").trim(),
              how: (item.how || "").trim(),
              purpose: (item.purpose || "").trim(),
              plan: (item.plan || "").trim(),
            },
          ];

          if (!section.diagnosis.trim() && item.diagnosis?.trim()) {
            section.diagnosis = item.diagnosis.trim();
          }

          addedCount += 1;
        }

        return next;
      });
    }

    const filled = [
      draft.patientName,
      draft.caseNumber,
      draft.occupation,
      draft.supervisingDoctor,
      draft.significantHistory,
      draft.allergies,
      draft.intolerances,
      draft.reviewCompletedBy,
      draft.notes,
      draft.aiSuggestion,
      draft.chiefComplaint,
      draft.examFindings,
      draft.labSummary,
      draft.imagingSummary,
    ].filter((value) => value?.trim()).length;

    showToast(
      addedCount || filled
        ? `Applied ${filled} field${filled === 1 ? "" : "s"} and ${addedCount} medication${addedCount === 1 ? "" : "s"}${
            skippedCount ? ` • skipped ${skippedCount}` : ""
          }`
        : "Nothing new was applied from the transcript.",
    );

    setTab(addedCount > 0 ? "meds" : "patient");
  }

  function resetDraft() {
    setPatientName("");
    setDob("");
    setMrn("");
    setOccupation("");
    setSupervisingDoctor("");
    setCarer("");
    setAllergies("");
    setIntolerances("");
    setSignificantHistory("");
    setReviewDate(todayISO());
    setReviewCompletedBy("");
    setTreatmentGoals("");
    setNextReviewDate("");
    setNextReviewMode("");
    setBeforeNextReview("");
    setNotes("");
    setAiSuggestion("");
    setSections([]);
    setAddSystemId("");
    setSearch("");
    setIncompleteOnly(false);
    setSuggestions({
      medications: [],
      doses: [],
      how: [],
      purposes: [],
      plans: [],
    });
    setScribeResetSignal((prev) => prev + 1);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    showToast("Draft cleared");
  }

  async function handleExport(language: ExportLanguage) {
    try {
      setExportBusy(language);
      const payload = buildReportPayload({
        language,
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
        systemById,
      });

      if (language === "ar") {
        const res = await fetch("/api/report/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Arabic export failed.");
        }
        openPrintWindow(buildPrintHtml(data.report as ReportPayload));
      } else {
        openPrintWindow(buildPrintHtml(payload));
      }

      setExportOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExportBusy("");
    }
  }

  const previewPayload = useMemo(
    () =>
      buildReportPayload({
        language: "en",
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
        systemById,
      }),
    [
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
      systemById,
    ],
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 md:px-6 xl:px-8">
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  Clinical workflow
                </span>
                <span
                  className={[
                    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                    online
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  ].join(" ")}
                >
                  {online ? "Online" : "Offline"}
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {saveState === "saving"
                    ? "Saving"
                    : saveState === "saved"
                      ? "Saved"
                      : "Draft"}
                </span>
              </div>

              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                  Clinical Medication Review
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
                  Cleaner intake, editable transcript import, diagnosis-based
                  medication workflow, and printable PDF export in English or
                  Arabic. Humanity finally reinvented a form without making it
                  worse. Mostly.
                </p>
              </div>
            </div>

            <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-[360px]">
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={resetDraft}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                Reset draft
              </button>
              <button
                type="button"
                onClick={() => setTab("patient")}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                Patient details
              </button>
              <button
                type="button"
                onClick={() => setTab("meds")}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                Medications
              </button>
              <button
                type="button"
                onClick={() => setTab("review")}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 sm:col-span-2"
              >
                Review & preview
              </button>
            </div>
          </div>
        </section>

        <VoiceScribe
          onApply={applyScribeDraft}
          resetSignal={scribeResetSignal}
        />

        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <SummaryTile label="Patient" value={englishFallback(patientName)} />
          <SummaryTile label="MRN" value={englishFallback(mrn)} />
          <SummaryTile label="Occupation" value={englishFallback(occupation)} />
          <SummaryTile
            label="Supervising doctor"
            value={englishFallback(supervisingDoctor)}
          />
          <SummaryTile label="Systems" value={String(sections.length)} />
          <SummaryTile label="Medications" value={String(totalRows)} />
        </section>

        {tab === "patient" && (
          <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">
                  Patient details
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Everything stays editable, whether it came from dictation or
                  manual entry.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Patient name"
                  hint="Transcript tries to convert Arabic names into English spelling."
                >
                  <input
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="field"
                    placeholder="Full name"
                  />
                </Field>

                <Field label="MRN / case number">
                  <input
                    value={mrn}
                    onChange={(e) => setMrn(e.target.value)}
                    className="field"
                    placeholder="Medical record number"
                  />
                </Field>

                <Field label="Date of birth">
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="field"
                  />
                </Field>

                <Field label="Occupation">
                  <input
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    className="field"
                    placeholder="Patient occupation"
                  />
                </Field>

                <Field label="Supervising doctor">
                  <input
                    value={supervisingDoctor}
                    onChange={(e) => setSupervisingDoctor(e.target.value)}
                    className="field"
                    placeholder="Consultant or supervising physician"
                  />
                </Field>

                <Field label="Carer / representative">
                  <input
                    value={carer}
                    onChange={(e) => setCarer(e.target.value)}
                    className="field"
                    placeholder="Optional"
                  />
                </Field>

                <Field label="Allergies">
                  <textarea
                    value={allergies}
                    onChange={(e) => setAllergies(e.target.value)}
                    className="field min-h-[110px]"
                    placeholder="List known allergies"
                  />
                </Field>

                <Field label="Intolerances">
                  <textarea
                    value={intolerances}
                    onChange={(e) => setIntolerances(e.target.value)}
                    className="field min-h-[110px]"
                    placeholder="List known intolerances"
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">
                  History
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Free-text history stays clinician-editable and prints exactly
                  as entered.
                </p>
              </div>
              <Field label="Significant history">
                <textarea
                  value={significantHistory}
                  onChange={(e) => setSignificantHistory(e.target.value)}
                  className="field min-h-[320px]"
                  placeholder="Relevant background, chronic conditions, prior issues..."
                />
              </Field>
            </div>
          </section>
        )}

        {tab === "meds" && (
          <section className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <aside className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">
                  Medication builder
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Pick a system, then choose a diagnosis and fill medication
                  rows without drama.
                </p>
              </div>

              <div className="space-y-4">
                <Field label="Add system">
                  <div className="flex gap-2">
                    <select
                      value={addSystemId}
                      onChange={(e) => setAddSystemId(e.target.value)}
                      className="field"
                    >
                      <option value="">Select system</option>
                      {systems.map((system) => (
                        <option key={system.id} value={system.id}>
                          {system.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => addSection(addSystemId)}
                      className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      Add
                    </button>
                  </div>
                </Field>

                <Field label="Search within medications">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="field"
                    placeholder="Search medication, diagnosis, plan..."
                  />
                </Field>

                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={incompleteOnly}
                    onChange={(e) => setIncompleteOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  Show incomplete rows only
                </label>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                {systemsLoaded ? (
                  <>
                    <div className="font-semibold text-slate-900">
                      {sections.length} systems
                    </div>
                    <div className="mt-1">
                      {totalRows} medication rows in this draft.
                    </div>
                  </>
                ) : (
                  "Loading systems..."
                )}
              </div>
            </aside>

            <div className="space-y-4">
              {filteredSections.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
                  No systems yet. Add one from the left and the table stops
                  being a barren wasteland.
                </div>
              ) : (
                filteredSections.map((section) => {
                  const system = systemById.get(section.systemId);
                  const diagnosisOptions = system?.diagnoses ?? [];

                  return (
                    <div
                      key={section.id}
                      className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
                        <div className="grid flex-1 gap-4 md:grid-cols-[1fr_260px]">
                          <Field label="System">
                            <select
                              value={section.systemId}
                              onChange={(e) =>
                                updateSection(section.id, {
                                  systemId: e.target.value,
                                  diagnosis: "",
                                })
                              }
                              className="field"
                            >
                              <option value="">Select system</option>
                              {systems.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.name}
                                </option>
                              ))}
                            </select>
                          </Field>

                          <Field label="Diagnosis date if available">
                            <input
                              value={section.diagnosisDate}
                              onChange={(e) =>
                                updateSection(section.id, {
                                  diagnosisDate: e.target.value,
                                })
                              }
                              className="field"
                              placeholder="Optional"
                            />
                          </Field>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => addMedicationRow(section.id)}
                            className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                          >
                            Add medication row
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSection(section.id)}
                            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                          >
                            Remove system
                          </button>
                        </div>
                      </div>

                      <div className="mt-5">
                        <Field label="Diagnosis">
                          <>
                            <input
                              value={section.diagnosis}
                              onChange={(e) =>
                                updateSection(section.id, {
                                  diagnosis: e.target.value,
                                })
                              }
                              list={`diagnosis-list-${section.id}`}
                              className="field"
                              placeholder="Select or type a diagnosis"
                            />
                            <datalist id={`diagnosis-list-${section.id}`}>
                              {diagnosisOptions.map((diagnosis) => (
                                <option key={diagnosis} value={diagnosis} />
                              ))}
                            </datalist>
                          </>
                        </Field>
                      </div>

                      <div className="mt-5 hidden overflow-x-auto rounded-3xl border border-slate-200 lg:block">
                        <table className="min-w-[1180px] divide-y divide-slate-200">
                          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            <tr>
                              <th className="px-4 py-3">Medication</th>
                              <th className="px-4 py-3">Dose</th>
                              <th className="px-4 py-3">How to take</th>
                              <th className="px-4 py-3">Used for</th>
                              <th className="px-4 py-3">
                                Agreed plan / next review
                              </th>
                              <th className="px-4 py-3">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 bg-white">
                            {section.rows.map((row) => (
                              <tr key={row.id} className="align-top">
                                <td className="px-4 py-4">
                                  <input
                                    value={row.medication}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        medication: e.target.value,
                                      })
                                    }
                                    list={`med-list-${row.id}`}
                                    className="field"
                                    placeholder="Medication name"
                                  />
                                  <datalist id={`med-list-${row.id}`}>
                                    {allMedicationSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </td>
                                <td className="px-4 py-4">
                                  <input
                                    value={row.dose}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        dose: e.target.value,
                                      })
                                    }
                                    list={`dose-list-${row.id}`}
                                    className="field"
                                    placeholder="Dose"
                                  />
                                  <datalist id={`dose-list-${row.id}`}>
                                    {allDoseSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </td>
                                <td className="px-4 py-4">
                                  <input
                                    value={row.how}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        how: e.target.value,
                                      })
                                    }
                                    list={`how-list-${row.id}`}
                                    className="field"
                                    placeholder="How to take"
                                  />
                                  <datalist id={`how-list-${row.id}`}>
                                    {allHowSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </td>
                                <td className="px-4 py-4">
                                  <input
                                    value={row.purpose}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        purpose: e.target.value,
                                      })
                                    }
                                    list={`purpose-list-${row.id}`}
                                    className="field"
                                    placeholder="Optional"
                                  />
                                  <datalist id={`purpose-list-${row.id}`}>
                                    {allPurposeSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </td>
                                <td className="px-4 py-4">
                                  <input
                                    value={row.plan}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        plan: e.target.value,
                                      })
                                    }
                                    list={`plan-list-${row.id}`}
                                    className="field"
                                    placeholder="Optional"
                                  />
                                  <datalist id={`plan-list-${row.id}`}>
                                    {allPlanSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        duplicateRow(section.id, row.id)
                                      }
                                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                      Duplicate
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeRow(section.id, row.id)
                                      }
                                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-5 space-y-3 lg:hidden">
                        {section.rows.map((row, index) => (
                          <div
                            key={row.id}
                            className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                          >
                            <div className="mb-3 flex items-center justify-between">
                              <div className="text-sm font-semibold text-slate-900">
                                Medication row {index + 1}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    duplicateRow(section.id, row.id)
                                  }
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                                >
                                  Duplicate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeRow(section.id, row.id)}
                                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <Field label="Medication">
                                <>
                                  <input
                                    value={row.medication}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        medication: e.target.value,
                                      })
                                    }
                                    list={`med-mobile-${row.id}`}
                                    className="field"
                                    placeholder="Medication name"
                                  />
                                  <datalist id={`med-mobile-${row.id}`}>
                                    {allMedicationSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </>
                              </Field>
                              <Field label="Dose">
                                <>
                                  <input
                                    value={row.dose}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        dose: e.target.value,
                                      })
                                    }
                                    list={`dose-mobile-${row.id}`}
                                    className="field"
                                    placeholder="Dose"
                                  />
                                  <datalist id={`dose-mobile-${row.id}`}>
                                    {allDoseSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </>
                              </Field>
                              <Field label="How to take">
                                <>
                                  <input
                                    value={row.how}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        how: e.target.value,
                                      })
                                    }
                                    list={`how-mobile-${row.id}`}
                                    className="field"
                                    placeholder="How to take"
                                  />
                                  <datalist id={`how-mobile-${row.id}`}>
                                    {allHowSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </>
                              </Field>
                              <Field label="Used for">
                                <>
                                  <input
                                    value={row.purpose}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        purpose: e.target.value,
                                      })
                                    }
                                    list={`purpose-mobile-${row.id}`}
                                    className="field"
                                    placeholder="Optional"
                                  />
                                  <datalist id={`purpose-mobile-${row.id}`}>
                                    {allPurposeSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </>
                              </Field>
                              <Field label="Agreed plan / next review">
                                <>
                                  <input
                                    value={row.plan}
                                    onChange={(e) =>
                                      updateRow(section.id, row.id, {
                                        plan: e.target.value,
                                      })
                                    }
                                    list={`plan-mobile-${row.id}`}
                                    className="field"
                                    placeholder="Optional"
                                  />
                                  <datalist id={`plan-mobile-${row.id}`}>
                                    {allPlanSuggestions.map((value) => (
                                      <option key={value} value={value} />
                                    ))}
                                  </datalist>
                                </>
                              </Field>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}

        {tab === "review" && (
          <section className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
            <div className="space-y-4">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5">
                  <h2 className="text-xl font-semibold text-slate-950">
                    Review details
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    These fields also stay editable even if transcript import
                    filled them first.
                  </p>
                </div>

                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="font-semibold">Internal AI suggestion</div>
                  <div className="mt-1 whitespace-pre-wrap text-amber-800">
                    {aiSuggestion || "No AI suggestion yet."}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Review date">
                    <input
                      type="date"
                      value={reviewDate}
                      onChange={(e) => setReviewDate(e.target.value)}
                      className="field"
                    />
                  </Field>
                  <Field label="Review completed by">
                    <input
                      value={reviewCompletedBy}
                      onChange={(e) => setReviewCompletedBy(e.target.value)}
                      className="field"
                      placeholder="Clinician name"
                    />
                  </Field>
                  <Field label="Next review date">
                    <input
                      type="date"
                      value={nextReviewDate}
                      onChange={(e) => setNextReviewDate(e.target.value)}
                      className="field"
                    />
                  </Field>
                  <Field label="Mode">
                    <select
                      value={nextReviewMode}
                      onChange={(e) =>
                        setNextReviewMode(
                          e.target.value as "" | "In-person" | "Video",
                        )
                      }
                      className="field"
                    >
                      <option value="">Select mode</option>
                      <option value="In-person">In-person</option>
                      <option value="Video">Video</option>
                    </select>
                  </Field>
                </div>

                <div className="mt-4 grid gap-4">
                  <Field label="Treatment goals">
                    <textarea
                      value={treatmentGoals}
                      onChange={(e) => setTreatmentGoals(e.target.value)}
                      className="field min-h-[120px]"
                      placeholder="Treatment goals"
                    />
                  </Field>
                  <Field label="Before next review">
                    <textarea
                      value={beforeNextReview}
                      onChange={(e) => setBeforeNextReview(e.target.value)}
                      className="field min-h-[120px]"
                      placeholder="Tasks before next review"
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="field min-h-[140px]"
                      placeholder="Printable notes"
                    />
                  </Field>
                  <Field
                    label="AI suggestion"
                    hint="Internal clinician-only suggestion. This does not appear in the printed patient report."
                  >
                    <textarea
                      value={aiSuggestion}
                      onChange={(e) => setAiSuggestion(e.target.value)}
                      className="field min-h-[160px]"
                      placeholder="AI impression and treatment suggestion"
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-950">
                    Printable preview
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    English preview. Arabic version is generated at export time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExportOpen(true)}
                  className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Download PDF
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <SummaryTile
                  label="Patient name"
                  value={previewPayload.patientName || "—"}
                />
                <SummaryTile
                  label="Date of birth"
                  value={previewPayload.dob || "—"}
                />
                <SummaryTile
                  label="MRN / case number"
                  value={previewPayload.mrn || "—"}
                />
                <SummaryTile
                  label="Occupation"
                  value={previewPayload.occupation || "—"}
                />
                <SummaryTile
                  label="Supervising doctor"
                  value={previewPayload.supervisingDoctor || "—"}
                />
                <SummaryTile
                  label="Carer"
                  value={previewPayload.carer || "—"}
                />
                <SummaryTile
                  label="Allergies"
                  value={previewPayload.allergies || "—"}
                />
                <SummaryTile
                  label="Intolerances"
                  value={previewPayload.intolerances || "—"}
                />
              </div>

              <div className="mt-6">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Significant history
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
                  {previewPayload.significantHistory || "—"}
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">System</th>
                      <th className="px-4 py-3">
                        Diagnosis and date if available
                      </th>
                      <th className="px-4 py-3">Medication & Dose</th>
                      <th className="px-4 py-3">How to take</th>
                      <th className="px-4 py-3">What are they for?</th>
                      <th className="px-4 py-3">Agreed Plan / Next Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-800">
                    {previewPayload.rows.length ? (
                      previewPayload.rows.map((row, index) => (
                        <tr key={`${row.system}-${row.medication}-${index}`}>
                          <td className="px-4 py-3">{row.system || "—"}</td>
                          <td className="px-4 py-3">
                            {[row.diagnosis, row.diagnosisDate]
                              .filter(Boolean)
                              .join(" • ") || "—"}
                          </td>
                          <td className="px-4 py-3">
                            {[row.medication, row.dose]
                              .filter(Boolean)
                              .join(" • ") || "—"}
                          </td>
                          <td className="px-4 py-3">{row.how || "—"}</td>
                          <td className="px-4 py-3">{row.purpose || "—"}</td>
                          <td className="px-4 py-3">{row.plan || "—"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-slate-500"
                        >
                          No medication rows added yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <SummaryTile
                  label="Review date"
                  value={previewPayload.reviewDate || "—"}
                />
                <SummaryTile
                  label="Review completed by"
                  value={previewPayload.reviewCompletedBy || "—"}
                />
                <SummaryTile
                  label="Treatment goals"
                  value={previewPayload.treatmentGoals || "—"}
                />
                <SummaryTile
                  label="Next review"
                  value={
                    [
                      previewPayload.nextReviewDate,
                      previewPayload.nextReviewMode,
                    ]
                      .filter(Boolean)
                      .join(" • ") || "—"
                  }
                />
                <SummaryTile
                  label="Before next review"
                  value={previewPayload.beforeNextReview || "—"}
                />
                <SummaryTile
                  label="Notes"
                  value={previewPayload.notes || "—"}
                />
              </div>
            </div>
          </section>
        )}
      </main>

      {exportOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-semibold text-slate-950">
              Download report PDF
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Choose the export language. English downloads as-is. Arabic
              translates the report text online while keeping medication names
              and patient name untouched.
            </p>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => void handleExport("en")}
                disabled={!!exportBusy}
                className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportBusy === "en"
                  ? "Preparing English PDF..."
                  : "English PDF"}
              </button>
              <button
                type="button"
                onClick={() => void handleExport("ar")}
                disabled={!!exportBusy}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportBusy === "ar" ? "Preparing Arabic PDF..." : "Arabic PDF"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setExportOpen(false)}
              disabled={!!exportBusy}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-lg">
          {toast.message}
        </div>
      )}

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 18px;
          border: 1px solid rgb(226 232 240);
          background: white;
          padding: 0.9rem 1rem;
          font-size: 0.95rem;
          line-height: 1.5;
          color: rgb(15 23 42);
          outline: none;
          transition:
            border-color 120ms ease,
            box-shadow 120ms ease,
            background 120ms ease;
        }

        .field::placeholder {
          color: rgb(148 163 184);
        }

        .field:focus {
          border-color: rgb(59 130 246);
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.14);
        }

        textarea.field {
          resize: vertical;
        }
      `}</style>
    </div>
  );
}
