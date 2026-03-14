"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import VoiceScribe, {
  type ScribeDraft,
  type ScribeMedication,
} from "../components/VoiceScribe";

type StepKey = "patient" | "meds" | "review";
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

const STORAGE_KEY = "imr_v8_clinic_ui";

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
  "Medication review with Consultant",
  "DXA scan",
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

function compactText(value: string) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: string) {
  return compactText(value).toLowerCase();
}

function uniqKeepOrder(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of values) {
    const value = compactText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  return next;
}

function toInputDate(value: string) {
  const raw = compactText(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) return raw.replaceAll("/", "-");

  const slashMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function humanDate(value: string) {
  const input = toInputDate(value);
  if (!input) return compactText(value) || "—";
  const [y, m, d] = input.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function createMedicationRow(initial?: Partial<MedicationRow>): MedicationRow {
  return {
    id: initial?.id || `row-${uid()}`,
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
    id: initial?.id || `section-${uid()}`,
    systemId: initial?.systemId || "",
    diagnosis: initial?.diagnosis || "",
    diagnosisDate: initial?.diagnosisDate || "",
    rows: initial?.rows?.length
      ? initial.rows.map((row) => createMedicationRow(row))
      : [createMedicationRow()],
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
    patientName: compactText(params.patientName),
    dob: compactText(params.dob),
    mrn: compactText(params.mrn),
    occupation: compactText(params.occupation),
    supervisingDoctor: compactText(params.supervisingDoctor),
    carer: compactText(params.carer),
    allergies: compactText(params.allergies),
    intolerances: compactText(params.intolerances),
    significantHistory: compactText(params.significantHistory),
    reviewDate: compactText(params.reviewDate),
    reviewCompletedBy: compactText(params.reviewCompletedBy),
    treatmentGoals: compactText(params.treatmentGoals),
    nextReviewDate: compactText(params.nextReviewDate),
    nextReviewMode: compactText(params.nextReviewMode),
    beforeNextReview: compactText(params.beforeNextReview),
    notes: compactText(params.notes),
    rows: params.sections.flatMap((section) => {
      const systemName = params.systemById.get(section.systemId)?.name || "";
      return section.rows.map((row) => ({
        system: systemName,
        diagnosis: compactText(section.diagnosis),
        diagnosisDate: compactText(section.diagnosisDate),
        medication: compactText(row.medication),
        dose: compactText(row.dose),
        how: compactText(row.how),
        purpose: compactText(row.purpose),
        plan: compactText(row.plan),
      }));
    }),
  };
}

function buildInfoCard(label: string, value: string) {
  return `
    <div class="info-card">
      <div class="info-label">${escapeHtml(label)}</div>
      <div class="info-value">${escapeHtml(value || "—")}</div>
    </div>
  `;
}

function buildPrintHtml(payload: ReportPayload) {
  const isArabic = payload.language === "ar";
  const dir = isArabic ? "rtl" : "ltr";
  const labels = isArabic
    ? {
        subtitle: "نسخة قابلة للطباعة",
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
        diagnosis: "التشخيص والتاريخ",
        medication: "الدواء والجرعة",
        how: "طريقة الاستخدام",
        purpose: "الغرض",
        plan: "الخطة / المراجعة القادمة",
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
        subtitle: "Printable report",
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
        diagnosis: "Diagnosis and date",
        medication: "Medication & dose",
        how: "How to take",
        purpose: "Purpose",
        plan: "Plan / next review",
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

  const rowsHtml = payload.rows.length
    ? payload.rows
        .map((row) => {
          const diagnosisCell = [row.diagnosis, row.diagnosisDate]
            .filter(Boolean)
            .join(" • ");
          const medicationCell = [row.medication, row.dose]
            .filter(Boolean)
            .join(" • ");
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

  return `
    <!doctype html>
    <html lang="${isArabic ? "ar" : "en"}" dir="${dir}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(payload.title)}</title>
        <style>
          :root {
            color-scheme: light;
            --line: #dbe3ee;
            --text: #172033;
            --muted: #5f6d84;
            --soft: #f6f9fc;
            --brand: #205ecf;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 28px;
            font-family: Inter, Arial, sans-serif;
            color: var(--text);
            background: white;
          }
          .sheet {
            max-width: 1080px;
            margin: 0 auto;
          }
          .topbar {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 18px;
            margin-bottom: 24px;
          }
          h1 {
            margin: 0;
            font-size: 28px;
          }
          .subtitle {
            margin: 6px 0 0;
            color: var(--muted);
            font-size: 13px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }
          .date-pill {
            white-space: nowrap;
            border: 1px solid var(--line);
            border-radius: 999px;
            padding: 10px 14px;
            font-size: 13px;
            color: var(--muted);
            background: var(--soft);
          }
          .section {
            border: 1px solid var(--line);
            border-radius: 18px;
            padding: 18px;
            margin-bottom: 18px;
            page-break-inside: avoid;
          }
          .section-title {
            margin: 0 0 14px;
            font-size: 16px;
            color: var(--brand);
          }
          .info-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }
          .info-card {
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 12px 14px;
            background: var(--soft);
          }
          .info-label {
            font-size: 11px;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 6px;
          }
          .info-value {
            font-size: 14px;
            line-height: 1.6;
            white-space: pre-wrap;
          }
          .rich-box {
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 14px;
            line-height: 1.7;
            white-space: pre-wrap;
            background: white;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border-top: 1px solid var(--line);
            padding: 12px 10px;
            text-align: ${isArabic ? "right" : "left"};
            vertical-align: top;
            font-size: 13px;
          }
          th {
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-size: 11px;
            white-space: nowrap;
          }
          @media print {
            body { padding: 12px; }
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="topbar">
            <div>
              <h1>${escapeHtml(payload.title)}</h1>
              <div class="subtitle">${escapeHtml(labels.subtitle)}</div>
            </div>
            <div class="date-pill">${escapeHtml(payload.reviewDate || todayISO())}</div>
          </div>

          <section class="section">
            <h2 class="section-title">${escapeHtml(labels.patient)}</h2>
            <div class="info-grid">
              ${buildInfoCard(labels.patientName, payload.patientName)}
              ${buildInfoCard(labels.dob, payload.dob)}
              ${buildInfoCard(labels.mrn, payload.mrn)}
              ${buildInfoCard(labels.occupation, payload.occupation)}
              ${buildInfoCard(labels.supervisingDoctor, payload.supervisingDoctor)}
              ${buildInfoCard(labels.carer, payload.carer)}
              ${buildInfoCard(labels.allergies, payload.allergies)}
              ${buildInfoCard(labels.intolerances, payload.intolerances)}
            </div>
          </section>

          <section class="section">
            <h2 class="section-title">${escapeHtml(labels.history)}</h2>
            <div class="rich-box">${escapeHtml(payload.significantHistory || labels.empty)}</div>
          </section>

          <section class="section">
            <h2 class="section-title">${escapeHtml(labels.meds)}</h2>
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
          </section>

          <section class="section">
            <h2 class="section-title">${escapeHtml(labels.review)}</h2>
            <div class="info-grid">
              ${buildInfoCard(labels.reviewDate, payload.reviewDate)}
              ${buildInfoCard(labels.reviewCompletedBy, payload.reviewCompletedBy)}
              ${buildInfoCard(labels.treatmentGoals, payload.treatmentGoals)}
              ${buildInfoCard(labels.nextReviewDate, payload.nextReviewDate)}
              ${buildInfoCard(labels.nextReviewMode, payload.nextReviewMode)}
              ${buildInfoCard(labels.beforeNextReview, payload.beforeNextReview)}
              ${buildInfoCard(labels.notes, payload.notes)}
            </div>
          </section>
        </div>
      </body>
    </html>
  `;
}

async function printHtmlDocument(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve();
    try {
      const doc = iframe.contentWindow?.document;
      if (!doc) {
        reject(new Error("Print frame is unavailable."));
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
    iframe.remove();
    throw new Error("Print frame is unavailable.");
  }

  frameWindow.focus();
  frameWindow.print();
  window.setTimeout(() => iframe.remove(), 1200);
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

function appendIfEmpty(
  setter: Dispatch<SetStateAction<string>>,
  incoming?: string,
) {
  const next = compactText(incoming || "");
  if (!next) return;
  setter((prev) => compactText(prev) || next);
}

function appendText(
  setter: Dispatch<SetStateAction<string>>,
  incoming?: string,
) {
  const next = compactText(incoming || "");
  if (!next) return;
  setter((prev) => {
    const current = compactText(prev);
    if (!current) return next;
    if (normalize(current).includes(normalize(next))) return current;
    return `${current}\n${next}`;
  });
}

function mapDraftMedicationToRow(item: ScribeMedication): MedicationRow {
  return createMedicationRow({
    medication: compactText(item.medication || item.rawMedication || ""),
    dose: compactText(item.dose || ""),
    how: compactText(item.how || ""),
    purpose: compactText(item.purpose || ""),
    plan: compactText(item.plan || ""),
  });
}

function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`status-chip status-chip-${tone}`}>{children}</span>;
}

function SectionCard({
  title,
  description,
  actions,
  children,
  compact = false,
}: {
  key?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={`surface-card ${compact ? "surface-card-compact" : ""}`}
    >
      <div className="section-title-row">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field-block">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {required ? <span className="field-required">Required</span> : null}
      </div>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <div className={`summary-metric summary-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TabButton({
  active,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`step-tab ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="step-tab-label">{label}</span>
      {meta ? <span className="step-tab-meta">{meta}</span> : null}
    </button>
  );
}

function EmptyWorkspace({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export default function Page() {
  const [step, setStep] = useState<StepKey>("patient");
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
  const [exportBusy, setExportBusy] = useState<ExportLanguage | "">("");
  const [scribeResetSignal, setScribeResetSignal] = useState(0);
  const [suggestions, setSuggestions] = useState<SuggestionStore>({
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
          ? (parsed.sections as MedicationSection[]).map((section) =>
              createSection(section),
            )
          : [],
      );

      const loadedSuggestions = parsed.suggestions;
      if (loadedSuggestions && typeof loadedSuggestions === "object") {
        const typed = loadedSuggestions as SuggestionStore;
        setSuggestions({
          medications: uniqKeepOrder(
            Array.isArray(typed.medications) ? typed.medications : [],
          ),
          doses: uniqKeepOrder(Array.isArray(typed.doses) ? typed.doses : []),
          how: uniqKeepOrder(Array.isArray(typed.how) ? typed.how : []),
          purposes: uniqKeepOrder(
            Array.isArray(typed.purposes) ? typed.purposes : [],
          ),
          plans: uniqKeepOrder(Array.isArray(typed.plans) ? typed.plans : []),
        });
      }
    } catch {
      // ignore broken persisted state
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
      const timer = window.setTimeout(() => setSaveState("saved"), 180);
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

  const systemById = useMemo(
    () => new Map(systems.map((system) => [system.id, system])),
    [systems],
  );

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
          ].some((value) => !compactText(value));
          return matchesSearch && (!incompleteOnly || incomplete);
        });

        if (q && !rows.length) {
          const sectionText =
            `${systemName} ${section.diagnosis} ${section.diagnosisDate}`.toLowerCase();
          if (!sectionText.includes(q)) return null;
        }

        if (!rows.length && (q || incompleteOnly)) return null;
        return { ...section, rows };
      })
      .filter(Boolean) as MedicationSection[];
  }, [sections, systemById, search, incompleteOnly]);

  const totalRows = useMemo(
    () => sections.reduce((sum, section) => sum + section.rows.length, 0),
    [sections],
  );
  const incompleteRows = useMemo(
    () =>
      sections.reduce(
        (sum, section) =>
          sum +
          section.rows.filter((row) =>
            [row.medication, row.dose, row.how, row.purpose, row.plan].some(
              (value) => !compactText(value),
            ),
          ).length,
        0,
      ),
    [sections],
  );
  const completedRows = Math.max(totalRows - incompleteRows, 0);
  const patientCompleteCount = [
    patientName,
    mrn,
    reviewDate,
    supervisingDoctor,
  ].filter((value) => compactText(value)).length;

  const previewRows = useMemo(
    () =>
      sections
        .flatMap((section) => section.rows.map((row) => ({ section, row })))
        .filter(({ row }) => compactText(row.medication))
        .slice(0, 6),
    [sections],
  );

  function showToast(message: string, tone: "success" | "error" = "success") {
    setToast({ message, tone });
  }

  function rememberSuggestion(kind: keyof SuggestionStore, value: string) {
    const next = compactText(value);
    if (!next) return;
    setSuggestions((prev) => ({
      ...prev,
      [kind]: uniqKeepOrder([...prev[kind], next]),
    }));
  }

  function addSection(systemId: string) {
    if (!systemId) return;
    const system = systemById.get(systemId);
    setSections((prev) => [...prev, createSection({ systemId })]);
    setAddSystemId("");
    setStep("meds");
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
          ? { ...section, rows: [...section.rows, createMedicationRow()] }
          : section,
      ),
    );
  }

  function updateMedicationRow(
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
          rows: [...section.rows, { ...source, id: `row-${uid()}` }],
        };
      }),
    );
    showToast("Medication row duplicated");
  }

  function removeRow(sectionId: string, rowId: string) {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id !== sectionId) return section;
        const nextRows = section.rows.filter((row) => row.id !== rowId);
        return {
          ...section,
          rows: nextRows.length ? nextRows : [createMedicationRow()],
        };
      }),
    );
    showToast("Medication row removed");
  }

  function handleApplyDraft(draft: ScribeDraft) {
    appendIfEmpty(setPatientName, draft.patientName);
    appendIfEmpty(setMrn, draft.caseNumber);
    appendIfEmpty(setDob, toInputDate(draft.dob || ""));
    appendIfEmpty(setOccupation, draft.occupation);
    appendIfEmpty(setSupervisingDoctor, draft.supervisingDoctor);
    appendIfEmpty(setCarer, draft.carer);
    appendIfEmpty(setAllergies, draft.allergies);
    appendIfEmpty(setIntolerances, draft.intolerances);
    appendIfEmpty(setReviewCompletedBy, draft.reviewCompletedBy);
    appendIfEmpty(setTreatmentGoals, draft.treatmentGoals);
    appendIfEmpty(setNextReviewDate, toInputDate(draft.nextReviewDate || ""));
    if (
      draft.nextReviewMode === "In-person" ||
      draft.nextReviewMode === "Video"
    ) {
      setNextReviewMode((prev) => prev || draft.nextReviewMode || "");
    }
    appendText(setSignificantHistory, draft.significantHistory);
    appendText(setBeforeNextReview, draft.beforeNextReview);
    appendText(setNotes, draft.notes);
    appendText(setAiSuggestion, draft.aiSuggestion);

    if (draft.chiefComplaint)
      appendText(
        setNotes,
        `Chief complaint: ${compactText(draft.chiefComplaint)}`,
      );
    if (draft.examFindings)
      appendText(setNotes, `Examination: ${compactText(draft.examFindings)}`);
    if (draft.labSummary)
      appendText(setNotes, `Labs: ${compactText(draft.labSummary)}`);
    if (draft.imagingSummary)
      appendText(setNotes, `Imaging: ${compactText(draft.imagingSummary)}`);
    if (draft.associatedSymptoms?.length)
      appendText(
        setNotes,
        `Associated symptoms: ${uniqKeepOrder(draft.associatedSymptoms).join(", ")}`,
      );
    if (draft.diagnosisHints?.length)
      appendText(
        setAiSuggestion,
        `Possible diagnoses: ${uniqKeepOrder(draft.diagnosisHints).join(", ")}`,
      );
    if (draft.warnings?.length)
      appendText(
        setAiSuggestion,
        `Warnings: ${uniqKeepOrder(draft.warnings).join(" • ")}`,
      );

    if (draft.medications?.length) {
      setSections((prev) => {
        const next = prev.map((section) => ({
          ...section,
          rows: [...section.rows],
        }));
        for (const item of draft.medications || []) {
          const systemId = compactText(item.systemId);
          const diagnosis = compactText(item.diagnosis);
          const diagnosisDate = "";
          const row = mapDraftMedicationToRow(item);

          let target = next.find(
            (section) =>
              section.systemId === systemId &&
              normalize(section.diagnosis) === normalize(diagnosis),
          );

          if (!target) {
            target = createSection({
              systemId,
              diagnosis,
              diagnosisDate,
              rows: [],
            });
            next.push(target);
          }

          const firstRow = target.rows[0];
          const sectionHasOnlyEmptyStarter =
            target.rows.length === 1 &&
            firstRow &&
            ![
              firstRow.medication,
              firstRow.dose,
              firstRow.how,
              firstRow.purpose,
              firstRow.plan,
            ].some((value) => compactText(value));

          if (sectionHasOnlyEmptyStarter) {
            target.rows = [row];
          } else {
            target.rows = [...target.rows, row];
          }
        }
        return next;
      });

      setSuggestions((prev) => ({
        medications: uniqKeepOrder([
          ...prev.medications,
          ...(draft.medications || []).map(
            (item) => item.medication || item.rawMedication || "",
          ),
        ]),
        doses: uniqKeepOrder([
          ...prev.doses,
          ...(draft.medications || []).map((item) => item.dose || ""),
        ]),
        how: uniqKeepOrder([
          ...prev.how,
          ...(draft.medications || []).map((item) => item.how || ""),
        ]),
        purposes: uniqKeepOrder([
          ...prev.purposes,
          ...(draft.medications || []).map((item) => item.purpose || ""),
        ]),
        plans: uniqKeepOrder([
          ...prev.plans,
          ...(draft.medications || []).map((item) => item.plan || ""),
        ]),
      }));
    }

    setStep(draft.medications?.length ? "meds" : "patient");
    showToast("Voice intake applied to the report");
  }

  function resetAll() {
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
    setStep("patient");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    showToast("Form reset");
  }

  async function handlePrint(language: ExportLanguage) {
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
      const finalPayload =
        language === "ar" ? await translateReport(payload) : payload;
      const html = buildPrintHtml(finalPayload);
      await printHtmlDocument(html);
      showToast(
        language === "ar"
          ? "Arabic report ready to print"
          : "Report ready to print",
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to prepare print view.",
        "error",
      );
    } finally {
      setExportBusy("");
    }
  }

  return (
    <div className="clinic-shell">
      <header className="app-header-shell">
        <div className="app-header surface-card">
          <div className="app-header-main">
            <div>
              <h1>Clinical Medication Review</h1>
            </div>
            <div className="app-header-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetAll}
              >
                Reset form
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handlePrint("en")}
                disabled={!!exportBusy}
              >
                {exportBusy === "en" ? "Preparing…" : "Print English"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handlePrint("ar")}
                disabled={!!exportBusy}
              >
                {exportBusy === "ar" ? "Preparing…" : "Print Arabic"}
              </button>
            </div>
          </div>
          <div className="header-metrics"></div>
          <div className="step-tabs">
            <TabButton
              active={step === "patient"}
              label="Patient"
              meta="Details and voice intake"
              onClick={() => setStep("patient")}
            />
            <TabButton
              active={step === "meds"}
              label="Medications"
              meta="Review and edit medication list"
              onClick={() => setStep("meds")}
            />
            <TabButton
              active={step === "review"}
              label="Review"
              meta="Next steps and print"
              onClick={() => setStep("review")}
            />
          </div>
        </div>
      </header>

      <main className="clinic-main">
        {toast ? (
          <div className={`floating-toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ) : null}

        {step === "patient" ? (
          <div className="layout-two-col">
            <div className="stack-lg">
              <SectionCard title="Patient details">
                <div className="form-grid form-grid-3">
                  <Field label="Patient name" required>
                    <input
                      className="input"
                      value={patientName}
                      onChange={(event) => setPatientName(event.target.value)}
                      placeholder="Full patient name"
                    />
                  </Field>
                  <Field label="MRN / case number" required>
                    <input
                      className="input"
                      value={mrn}
                      onChange={(event) => setMrn(event.target.value)}
                    />
                  </Field>
                  <Field label="Date of birth">
                    <input
                      className="input"
                      type="date"
                      value={toInputDate(dob)}
                      onChange={(event) => setDob(event.target.value)}
                    />
                  </Field>
                  <Field label="Occupation">
                    <input
                      className="input"
                      value={occupation}
                      onChange={(event) => setOccupation(event.target.value)}
                      placeholder="Occupation"
                    />
                  </Field>
                  <Field label="Supervising doctor" required>
                    <input
                      className="input"
                      value={supervisingDoctor}
                      onChange={(event) =>
                        setSupervisingDoctor(event.target.value)
                      }
                      placeholder="Doctor name"
                    />
                  </Field>
                  <Field label="Carer / representative">
                    <input
                      className="input"
                      value={carer}
                      onChange={(event) => setCarer(event.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </div>
              </SectionCard>

              <SectionCard title="Clinical background">
                <div className="form-grid">
                  <Field label="Allergies">
                    <textarea
                      className="textarea textarea-sm"
                      value={allergies}
                      onChange={(event) => setAllergies(event.target.value)}
                    />
                  </Field>
                  <Field label="Intolerances">
                    <textarea
                      className="textarea textarea-sm"
                      value={intolerances}
                      onChange={(event) => setIntolerances(event.target.value)}
                    />
                  </Field>
                  <Field label="Significant history">
                    <textarea
                      className="textarea textarea-lg"
                      value={significantHistory}
                      onChange={(event) =>
                        setSignificantHistory(event.target.value)
                      }
                    />
                  </Field>
                </div>
              </SectionCard>
            </div>

            <div className="stack-lg">
              <SectionCard title="AI voice intake">
                <VoiceScribe
                  onApply={handleApplyDraft}
                  resetSignal={scribeResetSignal}
                />
              </SectionCard>

              <SectionCard title="Quick readiness snapshot" compact>
                <div className="summary-grid">
                  <SummaryMetric
                    label="Review date"
                    value={humanDate(reviewDate)}
                    tone="success"
                  />
                  <SummaryMetric
                    label="Systems added"
                    value={String(sections.length)}
                  />
                  <SummaryMetric
                    label="Medication rows"
                    value={String(totalRows)}
                  />
                  <SummaryMetric
                    label="AI suggestion"
                    value={compactText(aiSuggestion) ? "Available" : "Empty"}
                    tone={compactText(aiSuggestion) ? "success" : "neutral"}
                  />
                </div>
                <div className="section-inline-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setStep("meds")}
                  >
                    Continue to medications
                  </button>
                </div>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {step === "meds" ? (
          <div className="stack-lg">
            <SectionCard
              title="Medication workspace"
              actions={
                <div className="toolbar-row toolbar-row-wrap">
                  <div className="select-inline-wrap">
                    <select
                      className="input"
                      value={addSystemId}
                      onChange={(event) => setAddSystemId(event.target.value)}
                    >
                      <option value="">Choose system</option>
                      {systems.map((system) => (
                        <option key={system.id} value={system.id}>
                          {system.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => addSection(addSystemId)}
                    disabled={!addSystemId || !systemsLoaded}
                  >
                    Add system
                  </button>
                </div>
              }
            >
              <div className="workspace-toolbar">
                <div className="toolbar-search">
                  <input
                    className="input"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search system, diagnosis, medication, dose, purpose…"
                  />
                </div>
              </div>
            </SectionCard>

            {!systemsLoaded ? (
              <SectionCard title="Loading systems" compact>
                <p className="muted-text">Fetching system catalogue…</p>
              </SectionCard>
            ) : filteredSections.length ? (
              filteredSections.map((section) => {
                const system = systemById.get(section.systemId);
                const diagnosisOptions = system?.diagnoses ?? [];
                const sectionOriginal =
                  sections.find((item) => item.id === section.id) || section;
                return (
                  <SectionCard
                    key={section.id}
                    title={system?.name || "Unassigned system"}
                    actions={
                      <div className="toolbar-row toolbar-row-wrap">
                        <StatusChip tone="neutral">
                          {sectionOriginal.rows.length} rows
                        </StatusChip>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => addMedicationRow(section.id)}
                        >
                          Add row
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeSection(section.id)}
                        >
                          Remove system
                        </button>
                      </div>
                    }
                  >
                    <div className="form-grid diagnosis-grid">
                      <Field label="Diagnosis">
                        <input
                          className="input"
                          value={sectionOriginal.diagnosis}
                          onChange={(event) =>
                            updateSection(section.id, {
                              diagnosis: event.target.value,
                            })
                          }
                          list={
                            diagnosisOptions.length
                              ? `diagnoses-${section.id}`
                              : undefined
                          }
                          placeholder="Diagnosis"
                        />
                        {diagnosisOptions.length ? (
                          <datalist id={`diagnoses-${section.id}`}>
                            {diagnosisOptions.map((diagnosis) => (
                              <option key={diagnosis} value={diagnosis} />
                            ))}
                          </datalist>
                        ) : null}
                      </Field>
                      <Field label="Diagnosis date">
                        <input
                          className="input"
                          type="date"
                          value={toInputDate(sectionOriginal.diagnosisDate)}
                          onChange={(event) =>
                            updateSection(section.id, {
                              diagnosisDate: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>

                    <div className="medication-table desktop-medication-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Medication</th>
                            <th>Dose</th>
                            <th>How to take</th>
                            <th>Purpose</th>
                            <th>Plan</th>
                            <th className="actions-col">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sectionOriginal.rows.map((row) => (
                            <tr key={row.id}>
                              <td>
                                <input
                                  className="input input-compact"
                                  value={row.medication}
                                  onChange={(event) =>
                                    updateMedicationRow(section.id, row.id, {
                                      medication: event.target.value,
                                    })
                                  }
                                  onBlur={(event) =>
                                    rememberSuggestion(
                                      "medications",
                                      event.target.value,
                                    )
                                  }
                                  list="medication-suggestions"
                                  placeholder="Medication"
                                />
                              </td>
                              <td>
                                <input
                                  className="input input-compact"
                                  value={row.dose}
                                  onChange={(event) =>
                                    updateMedicationRow(section.id, row.id, {
                                      dose: event.target.value,
                                    })
                                  }
                                  onBlur={(event) =>
                                    rememberSuggestion(
                                      "doses",
                                      event.target.value,
                                    )
                                  }
                                  list="dose-suggestions"
                                  placeholder="Dose"
                                />
                              </td>
                              <td>
                                <input
                                  className="input input-compact"
                                  value={row.how}
                                  onChange={(event) =>
                                    updateMedicationRow(section.id, row.id, {
                                      how: event.target.value,
                                    })
                                  }
                                  onBlur={(event) =>
                                    rememberSuggestion(
                                      "how",
                                      event.target.value,
                                    )
                                  }
                                  list="how-suggestions"
                                  placeholder="How to take"
                                />
                              </td>
                              <td>
                                <input
                                  className="input input-compact"
                                  value={row.purpose}
                                  onChange={(event) =>
                                    updateMedicationRow(section.id, row.id, {
                                      purpose: event.target.value,
                                    })
                                  }
                                  onBlur={(event) =>
                                    rememberSuggestion(
                                      "purposes",
                                      event.target.value,
                                    )
                                  }
                                  list="purpose-suggestions"
                                  placeholder="Purpose"
                                />
                              </td>
                              <td>
                                <input
                                  className="input input-compact"
                                  value={row.plan}
                                  onChange={(event) =>
                                    updateMedicationRow(section.id, row.id, {
                                      plan: event.target.value,
                                    })
                                  }
                                  onBlur={(event) =>
                                    rememberSuggestion(
                                      "plans",
                                      event.target.value,
                                    )
                                  }
                                  list="plan-suggestions"
                                  placeholder="Plan"
                                />
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={() =>
                                      duplicateRow(section.id, row.id)
                                    }
                                  >
                                    Duplicate
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn danger"
                                    onClick={() =>
                                      removeRow(section.id, row.id)
                                    }
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

                    <div className="mobile-medication-cards">
                      {sectionOriginal.rows.map((row, index) => (
                        <div key={row.id} className="mobile-med-card">
                          <div className="mobile-med-card-head">
                            <div>
                              <span className="eyebrow">Medication row</span>
                              <h3>Row {index + 1}</h3>
                            </div>
                            <div className="row-actions row-actions-mobile">
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => duplicateRow(section.id, row.id)}
                              >
                                Duplicate
                              </button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                onClick={() => removeRow(section.id, row.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="stack-md">
                            <Field label="Medication">
                              <input
                                className="input"
                                value={row.medication}
                                onChange={(event) =>
                                  updateMedicationRow(section.id, row.id, {
                                    medication: event.target.value,
                                  })
                                }
                                onBlur={(event) =>
                                  rememberSuggestion(
                                    "medications",
                                    event.target.value,
                                  )
                                }
                                list="medication-suggestions"
                              />
                            </Field>
                            <Field label="Dose">
                              <input
                                className="input"
                                value={row.dose}
                                onChange={(event) =>
                                  updateMedicationRow(section.id, row.id, {
                                    dose: event.target.value,
                                  })
                                }
                                onBlur={(event) =>
                                  rememberSuggestion(
                                    "doses",
                                    event.target.value,
                                  )
                                }
                                list="dose-suggestions"
                              />
                            </Field>
                            <Field label="How to take">
                              <input
                                className="input"
                                value={row.how}
                                onChange={(event) =>
                                  updateMedicationRow(section.id, row.id, {
                                    how: event.target.value,
                                  })
                                }
                                onBlur={(event) =>
                                  rememberSuggestion("how", event.target.value)
                                }
                                list="how-suggestions"
                              />
                            </Field>
                            <Field label="Purpose">
                              <input
                                className="input"
                                value={row.purpose}
                                onChange={(event) =>
                                  updateMedicationRow(section.id, row.id, {
                                    purpose: event.target.value,
                                  })
                                }
                                onBlur={(event) =>
                                  rememberSuggestion(
                                    "purposes",
                                    event.target.value,
                                  )
                                }
                                list="purpose-suggestions"
                              />
                            </Field>
                            <Field label="Plan">
                              <input
                                className="input"
                                value={row.plan}
                                onChange={(event) =>
                                  updateMedicationRow(section.id, row.id, {
                                    plan: event.target.value,
                                  })
                                }
                                onBlur={(event) =>
                                  rememberSuggestion(
                                    "plans",
                                    event.target.value,
                                  )
                                }
                                list="plan-suggestions"
                              />
                            </Field>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                );
              })
            ) : (
              <SectionCard title="No medication sections yet" compact>
                <EmptyWorkspace
                  title="Start with one clinical system"
                  body="Pick a system from the toolbar, then add medication rows."
                />
              </SectionCard>
            )}

            <datalist id="medication-suggestions">
              {allMedicationSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <datalist id="dose-suggestions">
              {allDoseSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <datalist id="how-suggestions">
              {allHowSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <datalist id="purpose-suggestions">
              {allPurposeSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <datalist id="plan-suggestions">
              {allPlanSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
        ) : null}

        {step === "review" ? (
          <div className="layout-two-col layout-two-col-review">
            <div className="stack-lg">
              <SectionCard title="Review details">
                <div className="form-grid review-meta-grid">
                  <Field label="Review date" required>
                    <input
                      className="input"
                      type="date"
                      value={toInputDate(reviewDate)}
                      onChange={(event) => setReviewDate(event.target.value)}
                    />
                  </Field>
                  <Field label="Review completed by">
                    <input
                      className="input"
                      value={reviewCompletedBy}
                      onChange={(event) =>
                        setReviewCompletedBy(event.target.value)
                      }
                      placeholder="Clinician"
                    />
                  </Field>
                  <Field label="Next review date">
                    <input
                      className="input"
                      type="date"
                      value={toInputDate(nextReviewDate)}
                      onChange={(event) =>
                        setNextReviewDate(event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Next review mode">
                    <select
                      className="input"
                      value={nextReviewMode}
                      onChange={(event) =>
                        setNextReviewMode(
                          event.target.value as "" | "In-person" | "Video",
                        )
                      }
                    >
                      <option value="">Choose mode</option>
                      <option value="In-person">In-person</option>
                      <option value="Video">Video</option>
                    </select>
                  </Field>
                </div>
                <div className="stack-md">
                  <Field label="Treatment goals">
                    <textarea
                      className="textarea textarea-md"
                      value={treatmentGoals}
                      onChange={(event) =>
                        setTreatmentGoals(event.target.value)
                      }
                      placeholder="Clinical goals for this review"
                    />
                  </Field>
                  <Field label="Before next review">
                    <textarea
                      className="textarea textarea-md"
                      value={beforeNextReview}
                      onChange={(event) =>
                        setBeforeNextReview(event.target.value)
                      }
                      placeholder="Tasks, checks, or monitoring before follow-up"
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea
                      className="textarea textarea-md"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Printable notes"
                    />
                  </Field>
                  <Field label="Internal AI suggestion">
                    <textarea
                      className="textarea textarea-md"
                      value={aiSuggestion}
                      onChange={(event) => setAiSuggestion(event.target.value)}
                      placeholder="Internal note from AI support"
                    />
                  </Field>
                </div>
              </SectionCard>
            </div>

            <div className="stack-lg">
              <SectionCard title="Report preview">
                <div className="preview-panel">
                  <div className="preview-header">
                    <div>
                      <p className="eyebrow">Printable summary</p>
                      <h3>{patientName || "Unnamed patient"}</h3>
                    </div>
                    <StatusChip tone="neutral">
                      {humanDate(reviewDate)}
                    </StatusChip>
                  </div>
                  <div className="preview-grid">
                    <div className="preview-item">
                      <span>MRN</span>
                      <strong>{mrn || "—"}</strong>
                    </div>
                    <div className="preview-item">
                      <span>DOB</span>
                      <strong>{dob ? humanDate(dob) : "—"}</strong>
                    </div>
                    <div className="preview-item">
                      <span>Supervising doctor</span>
                      <strong>{supervisingDoctor || "—"}</strong>
                    </div>
                    <div className="preview-item">
                      <span>Rows</span>
                      <strong>{totalRows}</strong>
                    </div>
                  </div>
                  <div className="preview-block">
                    <span className="preview-label">History</span>
                    <p>{significantHistory || "—"}</p>
                  </div>
                  <div className="preview-block">
                    <span className="preview-label">Medication snapshot</span>
                    {previewRows.length ? (
                      <ul className="preview-list">
                        {previewRows.map(({ section, row }) => (
                          <li key={`${section.id}-${row.id}`}>
                            <strong>
                              {systemById.get(section.systemId)?.name ||
                                "System"}
                            </strong>
                            <span>
                              {[row.medication, row.dose, row.how]
                                .filter(Boolean)
                                .join(" • ") || "Empty row"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>—</p>
                    )}
                  </div>
                </div>
                <div className="section-inline-actions section-inline-actions-wrap">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setStep("meds")}
                  >
                    Back to medications
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handlePrint("en")}
                    disabled={!!exportBusy}
                  >
                    {exportBusy === "en" ? "Preparing…" : "Print English"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handlePrint("ar")}
                    disabled={!!exportBusy}
                  >
                    {exportBusy === "ar" ? "Preparing…" : "Print Arabic"}
                  </button>
                </div>
              </SectionCard>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
