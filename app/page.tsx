"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import VoiceScribe, {
  type AiClinicalSupport,
  type ScribeDraft,
  type ScribeMedication,
} from "../components/VoiceScribe";

type TabKey = "patient" | "medications" | "review";
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

const STORAGE_KEY = "imr_v6_complete";

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

function normalize(value: string) {
  return (value ?? "").trim().toLowerCase();
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

  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return "";
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function fromInputDate(value: string) {
  return toInputDate(value);
}

function englishFallback(value: string) {
  return value || "—";
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

function buildCard(label: string, value: string) {
  return `
    <div style="border:1px solid #e2e8f0;border-radius:18px;padding:12px 14px;background:#fff;min-height:76px;">
      ${
        label
          ? `<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:8px;">${escapeHtml(
              label,
            )}</div>`
          : ""
      }
      <div style="font-size:14px;line-height:1.6;color:#0f172a;white-space:pre-wrap;">${escapeHtml(
        value,
      )}</div>
    </div>
  `;
}

function escapeHtml(value: string) {
  return (value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    : `<tr><td colspan="6">${escapeHtml(labels.empty)}</td></tr>`;

  return `
  <!doctype html>
  <html lang="${isArabic ? "ar" : "en"}" dir="${dir}">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(payload.title)}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:Inter,Arial,sans-serif;margin:0;background:#fff;color:#0f172a;padding:24px}
        .hero{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}
        .title{font-size:24px;font-weight:800;margin:0}
        .sub{font-size:12px;color:#64748b;margin-top:6px}
        .section{margin-top:20px}
        .section h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#475569;margin:0 0 12px;font-weight:800}
        .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        table{width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden}
        th,td{padding:12px 14px;border-bottom:1px solid #e2e8f0;text-align:${
          isArabic ? "right" : "left"
        };vertical-align:top;font-size:13px}
        th{background:#f8fafc;color:#475569;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="hero">
        <div>
          <h1 class="title">${escapeHtml(payload.title)}</h1>
          <div class="sub">${escapeHtml(
            isArabic ? "نسخة قابلة للطباعة" : "Printable report",
          )}</div>
        </div>
        <div class="sub">${escapeHtml(payload.reviewDate || todayISO())}</div>
      </div>

      <section class="section">
        <h2>${escapeHtml(labels.patient)}</h2>
        <div class="grid">
          ${buildCard(labels.patientName, payload.patientName || labels.empty)}
          ${buildCard(labels.dob, payload.dob || labels.empty)}
          ${buildCard(labels.mrn, payload.mrn || labels.empty)}
          ${buildCard(labels.occupation, payload.occupation || labels.empty)}
          ${buildCard(labels.supervisingDoctor, payload.supervisingDoctor || labels.empty)}
          ${buildCard(labels.carer, payload.carer || labels.empty)}
          ${buildCard(labels.allergies, payload.allergies || labels.empty)}
          ${buildCard(labels.intolerances, payload.intolerances || labels.empty)}
        </div>
      </section>

      <section class="section">
        <h2>${escapeHtml(labels.history)}</h2>
        ${buildCard("", payload.significantHistory || labels.empty)}
      </section>

      <section class="section">
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
          <tbody>${tableRows}</tbody>
        </table>
      </section>

      <section class="section">
        <h2>${escapeHtml(labels.review)}</h2>
        <div class="grid">
          ${buildCard(labels.reviewDate, payload.reviewDate || labels.empty)}
          ${buildCard(labels.reviewCompletedBy, payload.reviewCompletedBy || labels.empty)}
          ${buildCard(labels.treatmentGoals, payload.treatmentGoals || labels.empty)}
          ${buildCard(labels.nextReviewDate, payload.nextReviewDate || labels.empty)}
          ${buildCard(labels.nextReviewMode, payload.nextReviewMode || labels.empty)}
          ${buildCard(labels.beforeNextReview, payload.beforeNextReview || labels.empty)}
          ${buildCard(labels.notes, payload.notes || labels.empty)}
        </div>
      </section>
    </body>
  </html>
  `;
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
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="mt-1 text-base font-semibold text-[rgb(var(--text))]">
        {value || "—"}
      </div>
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={`field-input ${props.className || ""}`} />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`field-textarea ${props.className || ""}`}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`field-input ${props.className || ""}`} />
  );
}

function MedicationDesktopTable({
  section,
  systems,
  system,
  diagnosisOptions,
  suggestions,
  onSectionChange,
  onRowChange,
  onAddRow,
  onDuplicateRow,
  onDeleteRow,
  onRemoveSection,
}: {
  section: MedicationSection;
  systems: SystemCatalog[];
  system?: SystemCatalog;
  diagnosisOptions: string[];
  suggestions: SuggestionStore;
  onSectionChange: (patch: Partial<MedicationSection>) => void;
  onRowChange: (rowId: string, patch: Partial<MedicationRow>) => void;
  onAddRow: () => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onRemoveSection: () => void;
}) {
  return (
    <div className="table-shell">
      <div className="border-b border-[rgb(var(--border))] bg-[rgb(var(--surface-alt))] px-4 py-4 sm:px-5">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr_190px_160px] xl:items-end">
          <Field label="System">
            <SelectInput
              value={section.systemId}
              onChange={(event) =>
                onSectionChange({
                  systemId: event.target.value,
                  diagnosis:
                    system?.id === event.target.value ? section.diagnosis : "",
                })
              }
            >
              <option value="">Select a system</option>
              {systems.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Diagnosis">
            <input
              className="field-input"
              list={`diag-${section.id}`}
              value={section.diagnosis}
              onChange={(event) =>
                onSectionChange({ diagnosis: event.target.value })
              }
              placeholder={
                section.systemId
                  ? "Select or type diagnosis"
                  : "Pick system first"
              }
              disabled={!section.systemId}
            />
            <datalist id={`diag-${section.id}`}>
              {diagnosisOptions.map((diagnosis) => (
                <option key={diagnosis} value={diagnosis} />
              ))}
            </datalist>
          </Field>

          <Field label="Diagnosis date if available">
            <TextInput
              type="date"
              value={toInputDate(section.diagnosisDate)}
              onChange={(event) =>
                onSectionChange({
                  diagnosisDate: fromInputDate(event.target.value),
                })
              }
            />
          </Field>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" className="btn-primary" onClick={onAddRow}>
              Add medication row
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={onRemoveSection}
            >
              Remove system
            </button>
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="med-table">
          <thead>
            <tr>
              <th className="sticky-first-col">Medication</th>
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
                <td className="sticky-first-col w-[220px]">
                  <input
                    className="field-input"
                    list={`med-${row.id}`}
                    value={row.medication}
                    onChange={(event) =>
                      onRowChange(row.id, { medication: event.target.value })
                    }
                    placeholder="Medication"
                  />
                  <datalist id={`med-${row.id}`}>
                    {suggestions.medications.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </td>
                <td className="w-[170px]">
                  <input
                    className="field-input"
                    list={`dose-${row.id}`}
                    value={row.dose}
                    onChange={(event) =>
                      onRowChange(row.id, { dose: event.target.value })
                    }
                    placeholder="Dose"
                  />
                  <datalist id={`dose-${row.id}`}>
                    {suggestions.doses.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </td>
                <td className="w-[260px]">
                  <input
                    className="field-input"
                    list={`how-${row.id}`}
                    value={row.how}
                    onChange={(event) =>
                      onRowChange(row.id, { how: event.target.value })
                    }
                    placeholder="How to take"
                  />
                  <datalist id={`how-${row.id}`}>
                    {suggestions.how.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </td>
                <td className="w-[220px]">
                  <input
                    className="field-input"
                    list={`purpose-${row.id}`}
                    value={row.purpose}
                    onChange={(event) =>
                      onRowChange(row.id, { purpose: event.target.value })
                    }
                    placeholder="Used for"
                  />
                  <datalist id={`purpose-${row.id}`}>
                    {suggestions.purposes.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </td>
                <td className="w-[240px]">
                  <input
                    className="field-input"
                    list={`plan-${row.id}`}
                    value={row.plan}
                    onChange={(event) =>
                      onRowChange(row.id, { plan: event.target.value })
                    }
                    placeholder="Agreed plan / next review"
                  />
                  <datalist id={`plan-${row.id}`}>
                    {suggestions.plans.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </td>
                <td className="w-[168px]">
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className="btn-secondary !px-3 !py-2 text-xs"
                      onClick={() => onDuplicateRow(row.id)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn-danger !px-3 !py-2 text-xs"
                      onClick={() => onDeleteRow(row.id)}
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
    </div>
  );
}

function MedicationMobileCards({
  section,
  systems,
  systemName,
  diagnosisOptions,
  suggestions,
  onSectionChange,
  onRowChange,
  onAddRow,
  onDuplicateRow,
  onDeleteRow,
  onRemoveSection,
}: {
  section: MedicationSection;
  systems: SystemCatalog[];
  systemName: string;
  diagnosisOptions: string[];
  suggestions: SuggestionStore;
  onSectionChange: (patch: Partial<MedicationSection>) => void;
  onRowChange: (rowId: string, patch: Partial<MedicationRow>) => void;
  onAddRow: () => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onRemoveSection: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="section-card">
        <div className="grid gap-4">
          <Field label="System">
            <SelectInput
              value={section.systemId}
              onChange={(event) =>
                onSectionChange({
                  systemId: event.target.value,
                  diagnosis:
                    systems.find((item) => item.id === event.target.value)
                      ?.id === section.systemId
                      ? section.diagnosis
                      : "",
                })
              }
            >
              <option value="">Select a system</option>
              {systems.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Diagnosis">
            <input
              className="field-input"
              list={`diag-mobile-${section.id}`}
              value={section.diagnosis}
              onChange={(event) =>
                onSectionChange({ diagnosis: event.target.value })
              }
              placeholder="Select or type diagnosis"
            />
            <datalist id={`diag-mobile-${section.id}`}>
              {diagnosisOptions.map((diagnosis) => (
                <option key={diagnosis} value={diagnosis} />
              ))}
            </datalist>
          </Field>
          <Field label="Diagnosis date if available">
            <TextInput
              type="date"
              value={toInputDate(section.diagnosisDate)}
              onChange={(event) =>
                onSectionChange({
                  diagnosisDate: fromInputDate(event.target.value),
                })
              }
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={onAddRow}>
              Add row
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={onRemoveSection}
            >
              Remove system
            </button>
          </div>
        </div>
      </div>

      {section.rows.map((row, index) => (
        <div key={row.id} className="med-card">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="kicker">Medication row {index + 1}</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                Same data, less table punishment.
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary !px-3 !py-2 text-xs"
                onClick={() => onDuplicateRow(row.id)}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="btn-danger !px-3 !py-2 text-xs"
                onClick={() => onDeleteRow(row.id)}
              >
                Delete
              </button>
            </div>
          </div>

          <div className="grid gap-3">
            <Field label="Medication">
              <input
                className="field-input"
                list={`med-mobile-${row.id}`}
                value={row.medication}
                onChange={(event) =>
                  onRowChange(row.id, { medication: event.target.value })
                }
                placeholder="Medication"
              />
              <datalist id={`med-mobile-${row.id}`}>
                {suggestions.medications.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>

            <Field label="Dose">
              <input
                className="field-input"
                list={`dose-mobile-${row.id}`}
                value={row.dose}
                onChange={(event) =>
                  onRowChange(row.id, { dose: event.target.value })
                }
                placeholder="Dose"
              />
              <datalist id={`dose-mobile-${row.id}`}>
                {suggestions.doses.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>

            <Field label="How to take">
              <input
                className="field-input"
                list={`how-mobile-${row.id}`}
                value={row.how}
                onChange={(event) =>
                  onRowChange(row.id, { how: event.target.value })
                }
                placeholder="How to take"
              />
              <datalist id={`how-mobile-${row.id}`}>
                {suggestions.how.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>

            <Field label="Used for">
              <input
                className="field-input"
                list={`purpose-mobile-${row.id}`}
                value={row.purpose}
                onChange={(event) =>
                  onRowChange(row.id, { purpose: event.target.value })
                }
                placeholder="Used for"
              />
              <datalist id={`purpose-mobile-${row.id}`}>
                {suggestions.purposes.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>

            <Field label="Agreed plan / next review">
              <input
                className="field-input"
                list={`plan-mobile-${row.id}`}
                value={row.plan}
                onChange={(event) =>
                  onRowChange(row.id, { plan: event.target.value })
                }
                placeholder="Agreed plan / next review"
              />
              <datalist id={`plan-mobile-${row.id}`}>
                {suggestions.plans.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  const [activeTab, setActiveTab] = useState<TabKey>("patient");

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

  const [systems, setSystems] = useState<SystemCatalog[]>([]);
  const [systemsLoaded, setSystemsLoaded] = useState(false);
  const [sections, setSections] = useState<MedicationSection[]>([
    createSection(),
  ]);
  const [addSystemId, setAddSystemId] = useState("");

  const [search, setSearch] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [online, setOnline] = useState(true);
  const [exporting, setExporting] = useState<ExportLanguage | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastDraft, setLastDraft] = useState<ScribeDraft | null>(null);
  const [aiClinicalSupport, setAiClinicalSupport] = useState<AiClinicalSupport>(
    {
      summary: "",
      likelyDiagnosis: "",
      reasoning: "",
      medicationOptions: [],
      nextSteps: [],
      redFlags: [],
      confidence: "",
    },
  );

  const [suggestions, setSuggestions] = useState<SuggestionStore>({
    medications: [],
    doses: DEFAULT_DOSE_OPTIONS,
    how: DEFAULT_HOW_OPTIONS,
    purposes: [],
    plans: DEFAULT_PLAN_OPTIONS,
  });

  const systemById = useMemo(
    () => new Map(systems.map((system) => [system.id, system] as const)),
    [systems],
  );

  const filteredSections = useMemo(() => {
    const query = normalize(search);
    if (!query && !incompleteOnly) return sections;

    return sections
      .map((section) => {
        const rows = section.rows.filter((row) => {
          const haystack = [
            systemById.get(section.systemId)?.name || "",
            section.diagnosis,
            row.medication,
            row.dose,
            row.how,
            row.purpose,
            row.plan,
          ]
            .join(" ")
            .toLowerCase();

          const matchesSearch = !query || haystack.includes(query);
          const isIncomplete =
            !section.systemId ||
            !section.diagnosis ||
            !row.medication ||
            !row.dose ||
            !row.how;

          return matchesSearch && (!incompleteOnly || isIncomplete);
        });

        return { ...section, rows };
      })
      .filter((section) => section.rows.length > 0);
  }, [incompleteOnly, search, sections, systemById]);

  const completeRowCount = useMemo(
    () =>
      sections
        .flatMap((section) => section.rows)
        .filter((row) => {
          return row.medication && row.dose && row.how;
        }).length,
    [sections],
  );

  useEffect(() => {
    fetch("/systems.json")
      .then((response) => response.json())
      .then((data) => {
        setSystems(Array.isArray(data) ? data : []);
      })
      .finally(() => setSystemsLoaded(true));
  }, []);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      setPatientName(
        typeof saved.patientName === "string" ? saved.patientName : "",
      );
      setDob(typeof saved.dob === "string" ? saved.dob : "");
      setMrn(typeof saved.mrn === "string" ? saved.mrn : "");
      setOccupation(
        typeof saved.occupation === "string" ? saved.occupation : "",
      );
      setSupervisingDoctor(
        typeof saved.supervisingDoctor === "string"
          ? saved.supervisingDoctor
          : "",
      );
      setCarer(typeof saved.carer === "string" ? saved.carer : "");
      setAllergies(typeof saved.allergies === "string" ? saved.allergies : "");
      setIntolerances(
        typeof saved.intolerances === "string" ? saved.intolerances : "",
      );
      setSignificantHistory(
        typeof saved.significantHistory === "string"
          ? saved.significantHistory
          : "",
      );
      setReviewDate(
        typeof saved.reviewDate === "string" ? saved.reviewDate : todayISO(),
      );
      setReviewCompletedBy(
        typeof saved.reviewCompletedBy === "string"
          ? saved.reviewCompletedBy
          : "",
      );
      setTreatmentGoals(
        typeof saved.treatmentGoals === "string" ? saved.treatmentGoals : "",
      );
      setNextReviewDate(
        typeof saved.nextReviewDate === "string" ? saved.nextReviewDate : "",
      );
      setNextReviewMode(
        saved.nextReviewMode === "In-person" || saved.nextReviewMode === "Video"
          ? saved.nextReviewMode
          : "",
      );
      setBeforeNextReview(
        typeof saved.beforeNextReview === "string"
          ? saved.beforeNextReview
          : "",
      );
      setNotes(typeof saved.notes === "string" ? saved.notes : "");
      setSearch(typeof saved.search === "string" ? saved.search : "");
      setIncompleteOnly(Boolean(saved.incompleteOnly));
      setCompactMode(Boolean(saved.compactMode));
      setAddSystemId(
        typeof saved.addSystemId === "string" ? saved.addSystemId : "",
      );
      if (Array.isArray(saved.sections) && saved.sections.length) {
        setSections(
          saved.sections.map((section) => {
            const record = (section ?? {}) as Record<string, unknown>;
            return createSection({
              id: typeof record.id === "string" ? record.id : uid(),
              systemId:
                typeof record.systemId === "string" ? record.systemId : "",
              diagnosis:
                typeof record.diagnosis === "string" ? record.diagnosis : "",
              diagnosisDate:
                typeof record.diagnosisDate === "string"
                  ? record.diagnosisDate
                  : "",
              rows: Array.isArray(record.rows)
                ? record.rows.map((row) => {
                    const rowRecord = (row ?? {}) as Record<string, unknown>;
                    return createMedicationRow({
                      id:
                        typeof rowRecord.id === "string" ? rowRecord.id : uid(),
                      medication:
                        typeof rowRecord.medication === "string"
                          ? rowRecord.medication
                          : "",
                      dose:
                        typeof rowRecord.dose === "string"
                          ? rowRecord.dose
                          : "",
                      how:
                        typeof rowRecord.how === "string" ? rowRecord.how : "",
                      purpose:
                        typeof rowRecord.purpose === "string"
                          ? rowRecord.purpose
                          : "",
                      plan:
                        typeof rowRecord.plan === "string"
                          ? rowRecord.plan
                          : "",
                    });
                  })
                : [createMedicationRow()],
            });
          }),
        );
      }
      if (
        saved.aiClinicalSupport &&
        typeof saved.aiClinicalSupport === "object"
      ) {
        const support = saved.aiClinicalSupport as Record<string, unknown>;
        setAiClinicalSupport({
          summary: typeof support.summary === "string" ? support.summary : "",
          likelyDiagnosis:
            typeof support.likelyDiagnosis === "string"
              ? support.likelyDiagnosis
              : "",
          reasoning:
            typeof support.reasoning === "string" ? support.reasoning : "",
          medicationOptions: Array.isArray(support.medicationOptions)
            ? support.medicationOptions.filter(
                (item): item is string => typeof item === "string",
              )
            : [],
          nextSteps: Array.isArray(support.nextSteps)
            ? support.nextSteps.filter(
                (item): item is string => typeof item === "string",
              )
            : [],
          redFlags: Array.isArray(support.redFlags)
            ? support.redFlags.filter(
                (item): item is string => typeof item === "string",
              )
            : [],
          confidence:
            support.confidence === "low" ||
            support.confidence === "medium" ||
            support.confidence === "high"
              ? support.confidence
              : "",
        });
      }
    } catch {
      // Ignore bad local storage. Humanity stores broken JSON with heroic confidence.
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
      search,
      incompleteOnly,
      compactMode,
      addSystemId,
      aiClinicalSupport,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    addSystemId,
    aiClinicalSupport,
    allergies,
    beforeNextReview,
    carer,
    compactMode,
    dob,
    incompleteOnly,
    intolerances,
    mrn,
    nextReviewDate,
    nextReviewMode,
    notes,
    occupation,
    patientName,
    reviewCompletedBy,
    reviewDate,
    search,
    sections,
    significantHistory,
    supervisingDoctor,
    treatmentGoals,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function pushToast(message: string, tone: ToastState["tone"] = "success") {
    setToast({ message, tone });
  }

  function updateSection(sectionId: string, patch: Partial<MedicationSection>) {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section,
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
        section.id !== sectionId
          ? section
          : {
              ...section,
              rows: section.rows.map((row) =>
                row.id === rowId ? { ...row, ...patch } : row,
              ),
            },
      ),
    );
  }

  function addRow(sectionId: string, seed?: Partial<MedicationRow>) {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId
          ? { ...section, rows: [...section.rows, createMedicationRow(seed)] }
          : section,
      ),
    );
  }

  function duplicateRow(sectionId: string, rowId: string) {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id !== sectionId) return section;
        const row = section.rows.find((item) => item.id === rowId);
        if (!row) return section;
        return {
          ...section,
          rows: [
            ...section.rows,
            {
              ...row,
              id: uid(),
            },
          ],
        };
      }),
    );
  }

  function deleteRow(sectionId: string, rowId: string) {
    setSections((prev) =>
      prev.map((section) => {
        if (section.id !== sectionId) return section;
        const remaining = section.rows.filter((row) => row.id !== rowId);
        return {
          ...section,
          rows: remaining.length ? remaining : [createMedicationRow()],
        };
      }),
    );
  }

  function removeSection(sectionId: string) {
    setSections((prev) => {
      const remaining = prev.filter((section) => section.id !== sectionId);
      return remaining.length ? remaining : [createSection()];
    });
  }

  function addSystemSection(systemId?: string) {
    setSections((prev) => [
      ...prev,
      createSection({ systemId: systemId || "" }),
    ]);
    if (systemId) setAddSystemId("");
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
    setSections([createSection()]);
    setLastTranscript("");
    setLastDraft(null);
    setAiClinicalSupport({
      summary: "",
      likelyDiagnosis: "",
      reasoning: "",
      medicationOptions: [],
      nextSteps: [],
      redFlags: [],
      confidence: "",
    });
    setSuggestions({
      medications: [],
      doses: DEFAULT_DOSE_OPTIONS,
      how: DEFAULT_HOW_OPTIONS,
      purposes: [],
      plans: DEFAULT_PLAN_OPTIONS,
    });
    pushToast("Form reset.");
  }

  function mergeText(current: string, incoming: string) {
    return compactText(incoming) || current;
  }

  function appendMultiline(parts: string[]) {
    return uniqKeepOrder(parts.filter(Boolean)).join("\n");
  }

  function applyMedicationDraftRows(medications: ScribeMedication[]) {
    if (!medications.length) return;

    const grouped = new Map<string, ScribeMedication[]>();
    for (const medication of medications) {
      const key = `${medication.systemId || "manual"}__${medication.diagnosis || ""}`;
      grouped.set(key, [...(grouped.get(key) || []), medication]);
    }

    const nextSections: MedicationSection[] = [];
    for (const [, items] of grouped.entries()) {
      const first = items[0];
      nextSections.push(
        createSection({
          systemId: first.systemId,
          diagnosis: first.diagnosis,
          rows: items.map((item) =>
            createMedicationRow({
              medication: item.medication || item.rawMedication,
              dose: item.dose,
              how: item.how,
              purpose: item.purpose,
              plan: item.plan,
            }),
          ),
        }),
      );
    }

    if (nextSections.length) {
      setSections(nextSections);
    }
  }

  function mergeSuggestionBuckets(draft: ScribeDraft) {
    const medicationSuggestions = uniqKeepOrder([
      ...suggestions.medications,
      ...draft.medications.map((item) => item.medication || item.rawMedication),
    ]);

    const doseSuggestions = uniqKeepOrder([
      ...suggestions.doses,
      ...draft.medications.map((item) => item.dose),
    ]);

    const howSuggestions = uniqKeepOrder([
      ...suggestions.how,
      ...draft.medications.map((item) => item.how),
    ]);

    const purposeSuggestions = uniqKeepOrder([
      ...suggestions.purposes,
      ...draft.medications.map((item) => item.purpose),
    ]);

    const planSuggestions = uniqKeepOrder([
      ...suggestions.plans,
      ...draft.medications.map((item) => item.plan),
      draft.beforeNextReview,
    ]);

    setSuggestions({
      medications: medicationSuggestions,
      doses: doseSuggestions,
      how: howSuggestions,
      purposes: purposeSuggestions,
      plans: planSuggestions,
    });
  }

  function applyDraft(draft: ScribeDraft) {
    setLastDraft(draft);
    setLastTranscript(draft.transcript);

    setPatientName((current) => mergeText(current, draft.patientName));
    setMrn((current) => mergeText(current, draft.caseNumber));
    setDob((current) => mergeText(current, draft.dob));
    setOccupation((current) => mergeText(current, draft.occupation));
    setSupervisingDoctor((current) =>
      mergeText(current, draft.supervisingDoctor),
    );
    setCarer((current) => mergeText(current, draft.carer));
    setAllergies((current) => mergeText(current, draft.allergies));
    setIntolerances((current) => mergeText(current, draft.intolerances));
    setSignificantHistory((current) =>
      mergeText(current, draft.significantHistory),
    );
    setReviewCompletedBy((current) =>
      mergeText(current, draft.reviewCompletedBy),
    );
    setTreatmentGoals((current) => mergeText(current, draft.treatmentGoals));
    setNextReviewDate((current) => mergeText(current, draft.nextReviewDate));
    setNextReviewMode((current) => draft.nextReviewMode || current);
    setBeforeNextReview((current) =>
      mergeText(current, draft.beforeNextReview),
    );
    setAiClinicalSupport(draft.aiClinicalSupport || aiClinicalSupport);

    const structuredNotes = [
      draft.notes,
      draft.chiefComplaint ? `Chief complaint: ${draft.chiefComplaint}` : "",
      draft.associatedSymptoms.length
        ? `Associated symptoms: ${draft.associatedSymptoms.join(", ")}`
        : "",
      draft.examFindings ? `Exam findings: ${draft.examFindings}` : "",
      draft.labSummary ? `Lab summary: ${draft.labSummary}` : "",
      draft.imagingSummary ? `Imaging summary: ${draft.imagingSummary}` : "",
    ].filter(Boolean);

    if (structuredNotes.length) {
      setNotes((current) => appendMultiline([current, ...structuredNotes]));
    }

    applyMedicationDraftRows(draft.medications);
    mergeSuggestionBuckets(draft);
    pushToast("Draft applied to the form.");
  }

  async function exportPdf(language: ExportLanguage) {
    setExporting(language);

    try {
      const basePayload = buildReportPayload({
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

      let finalPayload = basePayload;

      if (language === "ar") {
        const res = await fetch("/api/report/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload),
        });

        const data = (await res.json()) as {
          report?: ReportPayload;
          error?: string;
        };
        if (!res.ok || !data.report) {
          throw new Error(data.error || "Arabic translation failed.");
        }

        finalPayload = data.report;
      }

      openPrintWindow(buildPrintHtml(finalPayload));
      pushToast(
        language === "ar"
          ? "Arabic PDF opened for printing."
          : "English PDF opened for printing.",
      );
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : "Export failed.",
        "error",
      );
    } finally {
      setExporting(null);
    }
  }

  const headerStats = useMemo(() => {
    const totalRows = sections.reduce(
      (sum, section) => sum + section.rows.length,
      0,
    );
    return {
      systems: sections.length,
      rows: totalRows,
      completedRows: completeRowCount,
      pendingRows: Math.max(totalRows - completeRowCount, 0),
    };
  }, [completeRowCount, sections]);

  return (
    <main className="shell space-y-6">
      <header className="glass-card print-card overflow-hidden">
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="kicker">Clinic workflow</div>
            <h1 className="hero-title mt-2">
              Clinical medication review workspace
            </h1>
            <p className="hero-subtitle mt-3">
              Structured patient details, system-based medications, internal AI
              clinical support, and printable English or Arabic reports.
              Finally, something in this project is trying to behave like a real
              product.
            </p>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-[420px] lg:grid-cols-2">
            <SummaryTile label="Systems" value={String(headerStats.systems)} />
            <SummaryTile
              label="Medication rows"
              value={String(headerStats.rows)}
            />
            <SummaryTile
              label="Complete rows"
              value={String(headerStats.completedRows)}
            />
            <SummaryTile
              label="Pending rows"
              value={String(headerStats.pendingRows)}
            />
          </div>
        </div>

        <div className="border-t border-[rgb(var(--border))] px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`status-pill ${online ? "status-online" : "status-offline"}`}
              >
                <span className="h-2 w-2 rounded-full bg-current" />
                {online ? "Online" : "Offline"}
              </span>
              {lastTranscript ? (
                <span className="chip">
                  Last transcript: {lastTranscript.slice(0, 78)}
                  {lastTranscript.length > 78 ? "..." : ""}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 no-print">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => exportPdf("en")}
                disabled={!!exporting}
              >
                {exporting === "en"
                  ? "Preparing English PDF..."
                  : "Download PDF (EN)"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => exportPdf("ar")}
                disabled={!!exporting}
              >
                {exporting === "ar"
                  ? "Preparing Arabic PDF..."
                  : "Download PDF (AR)"}
              </button>
              <button type="button" className="btn-danger" onClick={resetAll}>
                Reset form
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="no-print">
        <VoiceScribe onApplyDraft={applyDraft} />
      </div>

      <section className="section-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="kicker">Form workspace</div>
            <h2 className="mt-2 text-xl font-bold">
              Editable clinical review form
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            {(["patient", "medications", "review"] as TabKey[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`tab-button ${activeTab === tab ? "tab-button-active" : "tab-button-idle"}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "patient"
                  ? "Patient details"
                  : tab === "medications"
                    ? "Medications"
                    : "Review"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {(activeTab === "patient" ||
        activeTab === "medications" ||
        activeTab === "review") && (
        <>
          {activeTab === "patient" ? (
            <section className="section-card print-card space-y-6">
              <div>
                <h3 className="text-2xl font-bold">Patient details</h3>
                <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                  Everything stays editable, whether it came from dictation or
                  manual entry.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <Field
                  label="Patient name"
                  hint="Transcript tries to convert Arabic names into English spelling."
                >
                  <TextInput
                    value={patientName}
                    onChange={(event) => setPatientName(event.target.value)}
                    placeholder="Patient name"
                  />
                </Field>
                <Field label="MRN / case number">
                  <TextInput
                    value={mrn}
                    onChange={(event) => setMrn(event.target.value)}
                    placeholder="MRN / case number"
                  />
                </Field>
                <Field label="Date of birth">
                  <TextInput
                    type="date"
                    value={toInputDate(dob)}
                    onChange={(event) =>
                      setDob(fromInputDate(event.target.value))
                    }
                  />
                </Field>
                <Field label="Occupation">
                  <TextInput
                    value={occupation}
                    onChange={(event) => setOccupation(event.target.value)}
                    placeholder="Occupation"
                  />
                </Field>
                <Field label="Supervising doctor">
                  <TextInput
                    value={supervisingDoctor}
                    onChange={(event) =>
                      setSupervisingDoctor(event.target.value)
                    }
                    placeholder="Supervising doctor"
                  />
                </Field>
                <Field label="Carer / representative">
                  <TextInput
                    value={carer}
                    onChange={(event) => setCarer(event.target.value)}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Allergies">
                  <TextArea
                    value={allergies}
                    onChange={(event) => setAllergies(event.target.value)}
                    placeholder="List known allergies"
                    rows={4}
                  />
                </Field>
                <Field label="Intolerances">
                  <TextArea
                    value={intolerances}
                    onChange={(event) => setIntolerances(event.target.value)}
                    placeholder="List known intolerances"
                    rows={4}
                  />
                </Field>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr]">
                <div>
                  <label className="field-label">Significant history</label>
                  <TextArea
                    value={significantHistory}
                    onChange={(event) =>
                      setSignificantHistory(event.target.value)
                    }
                    placeholder="Free-text history stays clinician-editable and prints exactly as entered."
                    rows={7}
                  />
                </div>
                <div className="grid gap-4 content-start">
                  <SummaryTile
                    label="Printable patient name"
                    value={englishFallback(patientName)}
                  />
                  <SummaryTile
                    label="Printable MRN"
                    value={englishFallback(mrn)}
                  />
                  <SummaryTile
                    label="Printable DOB"
                    value={englishFallback(dob)}
                  />
                  <SummaryTile
                    label="Supervising doctor"
                    value={englishFallback(supervisingDoctor)}
                  />
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "medications" ? (
            <section className="space-y-5 print-card">
              <div className="section-card">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h3 className="text-2xl font-bold">
                      Medications by system
                    </h3>
                    <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                      Desktop and iPad get a table. Mobile gets stacked cards.
                      Same data, less nonsense.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[240px_180px_auto_auto] xl:items-end no-print">
                    <Field label="Search rows">
                      <TextInput
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search medication, diagnosis, plan..."
                      />
                    </Field>
                    <Field label="Add system">
                      <SelectInput
                        value={addSystemId}
                        onChange={(event) => setAddSystemId(event.target.value)}
                      >
                        <option value="">Pick system</option>
                        {systems.map((system) => (
                          <option key={system.id} value={system.id}>
                            {system.name}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <div className="flex flex-wrap gap-2 xl:pb-1">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => addSystemSection(addSystemId)}
                        disabled={!systemsLoaded}
                      >
                        Add system section
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setCompactMode((value) => !value)}
                      >
                        {compactMode ? "Normal spacing" : "Compact mode"}
                      </button>
                    </div>
                    <label className="chip xl:mb-1 cursor-pointer justify-center">
                      <input
                        type="checkbox"
                        checked={incompleteOnly}
                        onChange={(event) =>
                          setIncompleteOnly(event.target.checked)
                        }
                      />
                      Incomplete only
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid gap-5">
                {filteredSections.map((section) => {
                  const system = systemById.get(section.systemId);
                  const diagnosisOptions = system?.diagnoses || [];
                  const mergedSuggestions: SuggestionStore = {
                    medications: suggestions.medications,
                    doses: suggestions.doses,
                    how: suggestions.how,
                    purposes: suggestions.purposes,
                    plans: suggestions.plans,
                  };

                  return (
                    <div
                      key={section.id}
                      className={compactMode ? "space-y-3" : "space-y-4"}
                    >
                      <div className="hidden md:block">
                        <MedicationDesktopTable
                          section={section}
                          systems={systems}
                          system={system}
                          diagnosisOptions={diagnosisOptions}
                          suggestions={mergedSuggestions}
                          onSectionChange={(patch) =>
                            updateSection(section.id, patch)
                          }
                          onRowChange={(rowId, patch) =>
                            updateRow(section.id, rowId, patch)
                          }
                          onAddRow={() => addRow(section.id)}
                          onDuplicateRow={(rowId) =>
                            duplicateRow(section.id, rowId)
                          }
                          onDeleteRow={(rowId) => deleteRow(section.id, rowId)}
                          onRemoveSection={() => removeSection(section.id)}
                        />
                      </div>
                      <div className="md:hidden">
                        <MedicationMobileCards
                          section={section}
                          systems={systems}
                          systemName={system?.name || ""}
                          diagnosisOptions={diagnosisOptions}
                          suggestions={mergedSuggestions}
                          onSectionChange={(patch) =>
                            updateSection(section.id, patch)
                          }
                          onRowChange={(rowId, patch) =>
                            updateRow(section.id, rowId, patch)
                          }
                          onAddRow={() => addRow(section.id)}
                          onDuplicateRow={(rowId) =>
                            duplicateRow(section.id, rowId)
                          }
                          onDeleteRow={(rowId) => deleteRow(section.id, rowId)}
                          onRemoveSection={() => removeSection(section.id)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeTab === "review" ? (
            <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr] print-card">
              <div className="section-card space-y-5">
                <div>
                  <h3 className="text-2xl font-bold">Review details</h3>
                  <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                    These fields print in the final report. Internal AI support
                    does not.
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Review date">
                    <TextInput
                      type="date"
                      value={toInputDate(reviewDate)}
                      onChange={(event) =>
                        setReviewDate(fromInputDate(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Review completed by">
                    <TextInput
                      value={reviewCompletedBy}
                      onChange={(event) =>
                        setReviewCompletedBy(event.target.value)
                      }
                      placeholder="Clinician name"
                    />
                  </Field>
                  <Field label="Treatment goals">
                    <TextArea
                      value={treatmentGoals}
                      onChange={(event) =>
                        setTreatmentGoals(event.target.value)
                      }
                      rows={4}
                    />
                  </Field>
                  <Field label="Next review date">
                    <TextInput
                      type="date"
                      value={toInputDate(nextReviewDate)}
                      onChange={(event) =>
                        setNextReviewDate(fromInputDate(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Next review mode">
                    <SelectInput
                      value={nextReviewMode}
                      onChange={(event) =>
                        setNextReviewMode(
                          event.target.value as "" | "In-person" | "Video",
                        )
                      }
                    >
                      <option value="">Select mode</option>
                      <option value="In-person">In-person</option>
                      <option value="Video">Video</option>
                    </SelectInput>
                  </Field>
                  <Field label="Before next review">
                    <TextArea
                      value={beforeNextReview}
                      onChange={(event) =>
                        setBeforeNextReview(event.target.value)
                      }
                      rows={4}
                    />
                  </Field>
                </div>

                <Field label="Notes">
                  <TextArea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={7}
                  />
                </Field>
              </div>

              <div className="section-card space-y-5">
                <div className="rounded-3xl border border-[rgba(var(--primary),0.12)] bg-[linear-gradient(135deg,rgba(var(--primary),0.10),rgba(var(--primary),0.03))] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="kicker">Internal only</div>
                      <h3 className="mt-2 text-xl font-bold">
                        AI clinical support
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[rgb(var(--muted))]">
                        This is for the clinician or staff member inside the
                        app. It does not appear in the printable patient report.
                      </p>
                    </div>
                    <span className="chip">
                      Confidence: {aiClinicalSupport.confidence || "—"}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4">
                  <Field label="Summary">
                    <TextArea
                      value={aiClinicalSupport.summary}
                      onChange={(event) =>
                        setAiClinicalSupport((current) => ({
                          ...current,
                          summary: event.target.value,
                        }))
                      }
                      rows={4}
                    />
                  </Field>
                  <Field label="Likely diagnosis">
                    <TextInput
                      value={aiClinicalSupport.likelyDiagnosis}
                      onChange={(event) =>
                        setAiClinicalSupport((current) => ({
                          ...current,
                          likelyDiagnosis: event.target.value,
                        }))
                      }
                      placeholder="Likely diagnosis"
                    />
                  </Field>
                  <Field label="Reasoning">
                    <TextArea
                      value={aiClinicalSupport.reasoning}
                      onChange={(event) =>
                        setAiClinicalSupport((current) => ({
                          ...current,
                          reasoning: event.target.value,
                        }))
                      }
                      rows={4}
                    />
                  </Field>
                  <Field label="Medication options / current treatment">
                    <TextArea
                      value={aiClinicalSupport.medicationOptions.join("\n")}
                      onChange={(event) =>
                        setAiClinicalSupport((current) => ({
                          ...current,
                          medicationOptions: uniqKeepOrder(
                            event.target.value.split(/\n+/),
                          ),
                        }))
                      }
                      rows={5}
                    />
                  </Field>
                  <Field label="Suggested next steps">
                    <TextArea
                      value={aiClinicalSupport.nextSteps.join("\n")}
                      onChange={(event) =>
                        setAiClinicalSupport((current) => ({
                          ...current,
                          nextSteps: uniqKeepOrder(
                            event.target.value.split(/\n+/),
                          ),
                        }))
                      }
                      rows={5}
                    />
                  </Field>
                  <Field label="Red flags">
                    <TextArea
                      value={aiClinicalSupport.redFlags.join("\n")}
                      onChange={(event) =>
                        setAiClinicalSupport((current) => ({
                          ...current,
                          redFlags: uniqKeepOrder(
                            event.target.value.split(/\n+/),
                          ),
                        }))
                      }
                      rows={5}
                    />
                  </Field>
                  <Field label="Confidence">
                    <SelectInput
                      value={aiClinicalSupport.confidence}
                      onChange={(event) =>
                        setAiClinicalSupport((current) => ({
                          ...current,
                          confidence: event.target
                            .value as AiClinicalSupport["confidence"],
                        }))
                      }
                    >
                      <option value="">Select confidence</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </SelectInput>
                  </Field>
                </div>

                {lastDraft?.warnings.length ? (
                  <div className="rounded-2xl border border-[rgba(var(--warning),0.25)] bg-[rgba(var(--warning),0.08)] p-4 text-sm text-[rgb(var(--text))]">
                    <div className="font-semibold">Draft warnings</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[rgb(var(--muted))]">
                      {lastDraft.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      )}

      {toast ? (
        <div
          className={`no-print fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
            toast.tone === "error"
              ? "bg-[rgb(var(--danger))]"
              : "bg-[rgb(var(--text))]"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}
