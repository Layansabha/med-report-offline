"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import VoiceScribe, { type ScribeDraft } from "../components/VoiceScribe";

/* ===================== Types ===================== */

type RowTemplate = {
  medication_options: string[];
  dose_options: string[];
  how_options: string[];
  purpose_options: string[];
  plan_options: string[];
};

type SystemTemplate = {
  id: string;
  name: string;
  diagnosis?: string;
  diagnosis_date?: string;
  row_templates: RowTemplate[];
};

type CustomColumn = {
  id: string;
  title: string;
};

type MedicationRow = {
  id: string;
  medication: string;
  dose: string;
  how: string;
  purpose: string;
  plan: string;
  templateIndex?: number;
  extra: Record<string, string>;
};

type SystemSection = {
  id: string;
  systemId: string;
  diagnosis: string;
  diagnosisDate: string;
  rows: MedicationRow[];
};

type InputMode = "smart" | "pick" | "type";
type TabKey = "meds" | "patient" | "review";

type ToastState = null | {
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
};

type MapList = Record<string, string[]>;

/* ===================== Storage Keys ===================== */

const STORAGE_KEY = "imr_v4";
const RECENTS_KEY = "imr_v4_recents";
const FAVS_KEY = "imr_v4_favs";

/* ===================== Utils ===================== */

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

function normalize(s: string) {
  return (s ?? "").toLowerCase().trim();
}

function uniqKeepOrder(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const x of arr) {
    const v = x.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }

  return out;
}

/* ===================== Page ===================== */

export default function Page() {
  const [tab, setTab] = useState<TabKey>("meds");

  const [patientName, setPatientName] = useState("");
  const [dob, setDob] = useState("");
  const [mrn, setMrn] = useState("");
  const [allergies, setAllergies] = useState("");
  const [intolerances, setIntolerances] = useState("");
  const [carer, setCarer] = useState("");

  const [significantHistory, setSignificantHistory] = useState("");

  const [reviewDate, setReviewDate] = useState<string>(todayISO());
  const [reviewCompletedBy, setReviewCompletedBy] = useState("");
  const [treatmentGoals, setTreatmentGoals] = useState("");

  const [nextReviewDate, setNextReviewDate] = useState<string>("");
  const [nextReviewMode, setNextReviewMode] = useState<
    "" | "In-person" | "Video"
  >("");
  const [beforeNextReview, setBeforeNextReview] = useState("");

  const [notes, setNotes] = useState("");

  const [systems, setSystems] = useState<SystemTemplate[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [newColTitle, setNewColTitle] = useState("");

  const [sections, setSections] = useState<SystemSection[]>([]);
  const [addSystemId, setAddSystemId] = useState("");

  const [search, setSearch] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);

  const [showMore, setShowMore] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("smart");
  const [dense, setDense] = useState(false);

  const [online, setOnline] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [scribeResetSignal, setScribeResetSignal] = useState(0);

  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<number | null>(null);

  const [recents, setRecents] = useState<MapList>({});
  const [favs, setFavs] = useState<MapList>({});

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSectionId, setEditorSectionId] = useState<string>("");
  const [editorRowId, setEditorRowId] = useState<string | null>(null);
  const [editorTemplateIndex, setEditorTemplateIndex] = useState<
    number | undefined
  >(undefined);
  const [editorDraft, setEditorDraft] = useState<MedicationRow>(() => ({
    id: "draft",
    medication: "",
    dose: "",
    how: "",
    purpose: "",
    plan: "",
    extra: {},
  }));

  const refMed = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const refDose = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const refHow = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const refPurpose = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const refPlan = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  /* ===================== Load systems ===================== */
  useEffect(() => {
    fetch("/systems.json")
      .then((r) => r.json())
      .then((data) => setSystems(Array.isArray(data) ? data : []));
  }, []);

  /* ===================== Online/offline ===================== */
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

  /* ===================== Load recents/favs ===================== */
  useEffect(() => {
    try {
      const r = localStorage.getItem(RECENTS_KEY);
      if (r) setRecents(JSON.parse(r) ?? {});
    } catch {}

    try {
      const f = localStorage.getItem(FAVS_KEY);
      if (f) setFavs(JSON.parse(f) ?? {});
    } catch {}
  }, []);

  /* ===================== Autosave load ===================== */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);

      setPatientName(parsed.patientName ?? "");
      setDob(parsed.dob ?? "");
      setMrn(parsed.mrn ?? "");
      setAllergies(parsed.allergies ?? "");
      setIntolerances(parsed.intolerances ?? "");
      setCarer(parsed.carer ?? "");
      setSignificantHistory(parsed.significantHistory ?? "");
      setReviewDate(parsed.reviewDate ?? todayISO());
      setReviewCompletedBy(parsed.reviewCompletedBy ?? "");
      setTreatmentGoals(parsed.treatmentGoals ?? "");
      setNextReviewDate(parsed.nextReviewDate ?? "");
      setNextReviewMode(parsed.nextReviewMode ?? "");
      setBeforeNextReview(parsed.beforeNextReview ?? "");
      setNotes(parsed.notes ?? "");
      setCustomColumns(
        Array.isArray(parsed.customColumns) ? parsed.customColumns : [],
      );
      setSections(Array.isArray(parsed.sections) ? parsed.sections : []);
      setShowMore(Boolean(parsed.showMore));
      setInputMode(parsed.inputMode ?? "smart");
      setDense(Boolean(parsed.dense));
    } catch {}
  }, []);

  /* ===================== Autosave save ===================== */
  useEffect(() => {
    const payload = {
      patientName,
      dob,
      mrn,
      allergies,
      intolerances,
      carer,
      significantHistory,
      reviewDate,
      reviewCompletedBy,
      treatmentGoals,
      nextReviewDate,
      nextReviewMode,
      beforeNextReview,
      notes,
      customColumns,
      sections,
      showMore,
      inputMode,
      dense,
    };

    setSaveState("saving");
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, 350);

    return () => window.clearTimeout(t);
  }, [
    patientName,
    dob,
    mrn,
    allergies,
    intolerances,
    carer,
    significantHistory,
    reviewDate,
    reviewCompletedBy,
    treatmentGoals,
    nextReviewDate,
    nextReviewMode,
    beforeNextReview,
    notes,
    customColumns,
    sections,
    showMore,
    inputMode,
    dense,
  ]);

  /* ===================== Persist recents/favs ===================== */
  useEffect(() => {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
    } catch {}
  }, [recents]);

  useEffect(() => {
    try {
      localStorage.setItem(FAVS_KEY, JSON.stringify(favs));
    } catch {}
  }, [favs]);

  /* ===================== Toast ===================== */
  function showToast(next: ToastState) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }

  /* ===================== Computed ===================== */
  const systemById = useMemo(() => {
    const m = new Map<string, SystemTemplate>();
    systems.forEach((s) => m.set(s.id, s));
    return m;
  }, [systems]);

  const totalRows = useMemo(
    () => sections.reduce((acc, s) => acc + s.rows.length, 0),
    [sections],
  );

  const requiredMissing = useMemo(() => {
    let missing = 0;
    if (!patientName.trim()) missing += 1;
    if (!reviewDate.trim()) missing += 1;
    if (!reviewCompletedBy.trim()) missing += 1;
    if (!sections.length) missing += 1;
    return missing;
  }, [patientName, reviewDate, reviewCompletedBy, sections]);

  const readyToPrint = requiredMissing === 0;

  const filteredSections = useMemo(() => {
    const q = normalize(search);

    return sections
      .map((sec) => {
        const rows = sec.rows.filter((r) => {
          const matchSearch =
            !q ||
            [
              systemById.get(sec.systemId)?.name ?? "",
              sec.diagnosis,
              r.medication,
              r.dose,
              r.how,
              r.purpose,
              r.plan,
              ...Object.values(r.extra ?? {}),
            ]
              .join(" \n ")
              .toLowerCase()
              .includes(q);

          const missingCritical =
            !r.medication.trim() ||
            !r.dose.trim() ||
            !r.how.trim() ||
            !r.plan.trim();

          return matchSearch && (!incompleteOnly || missingCritical);
        });

        if (!q && !incompleteOnly) return sec;
        return { ...sec, rows };
      })
      .filter((sec) => {
        const systemName = systemById.get(sec.systemId)?.name ?? "";
        const secMatch =
          !search.trim() ||
          `${systemName} ${sec.diagnosis}`
            .toLowerCase()
            .includes(search.toLowerCase());

        return secMatch || sec.rows.length > 0;
      });
  }, [sections, search, incompleteOnly, systemById]);

  /* ===================== Helpers ===================== */
  function addRecent(systemId: string, med: string) {
    const v = med.trim();
    if (!systemId || !v) return;

    setRecents((prev) => {
      const list = uniqKeepOrder([v, ...(prev[systemId] ?? [])]).slice(0, 8);
      return { ...prev, [systemId]: list };
    });
  }

  function toggleFav(systemId: string, med: string) {
    const v = med.trim();
    if (!systemId || !v) return;

    setFavs((prev) => {
      const list = prev[systemId] ?? [];
      const has = list.some((x) => normalize(x) === normalize(v));
      return {
        ...prev,
        [systemId]: has
          ? list.filter((x) => normalize(x) !== normalize(v))
          : uniqKeepOrder([v, ...list]).slice(0, 20),
      };
    });
  }

  function makeBlankRow(): MedicationRow {
    const extra: Record<string, string> = {};
    customColumns.forEach((c) => {
      extra[c.id] = "";
    });

    return {
      id: `med-${uid()}`,
      medication: "",
      dose: "",
      how: "",
      purpose: "",
      plan: "",
      extra,
    };
  }

  function addSystemSection(systemId: string) {
    if (!systemId) return;

    const sys = systemById.get(systemId);
    if (!sys) return;

    setSections((prev) => [
      ...prev,
      {
        id: `sec-${uid()}`,
        systemId,
        diagnosis: sys.diagnosis ?? "",
        diagnosisDate: sys.diagnosis_date ?? "",
        rows: [],
      },
    ]);

    setAddSystemId("");
    setTab("meds");
  }

  function removeSystemSection(sectionId: string) {
    const snapshot = sections;
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    showToast({
      message: "System removed",
      undoLabel: "Undo",
      onUndo: () => setSections(snapshot),
    });
  }

  function addCustomColumn() {
    const title = newColTitle.trim();
    if (!title) return;

    const col: CustomColumn = { id: `col-${uid()}`, title };
    setCustomColumns((prev) => [...prev, col]);
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        rows: sec.rows.map((r) => ({
          ...r,
          extra: { ...r.extra, [col.id]: "" },
        })),
      })),
    );
    setNewColTitle("");
  }

  function removeCustomColumn(colId: string) {
    const snapshotCols = customColumns;
    const snapshotSections = sections;

    setCustomColumns((prev) => prev.filter((c) => c.id !== colId));
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        rows: sec.rows.map((r) => {
          const nextExtra = { ...r.extra };
          delete nextExtra[colId];
          return { ...r, extra: nextExtra };
        }),
      })),
    );

    showToast({
      message: "Custom column removed",
      undoLabel: "Undo",
      onUndo: () => {
        setCustomColumns(snapshotCols);
        setSections(snapshotSections);
      },
    });
  }

  function openAddRow(sectionId: string) {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;

    const blank = makeBlankRow();
    setEditorOpen(true);
    setEditorSectionId(sectionId);
    setEditorRowId(null);
    setEditorTemplateIndex(undefined);
    setEditorDraft(blank);
  }

  function openEditRow(sectionId: string, rowId: string) {
    const sec = sections.find((s) => s.id === sectionId);
    const row = sec?.rows.find((r) => r.id === rowId);
    if (!sec || !row) return;

    setEditorOpen(true);
    setEditorSectionId(sectionId);
    setEditorRowId(rowId);
    setEditorTemplateIndex(row.templateIndex);
    setEditorDraft({
      ...row,
      extra: { ...row.extra },
    });
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorSectionId("");
    setEditorRowId(null);
    setEditorTemplateIndex(undefined);
    setEditorDraft(makeBlankRow());
  }

  function saveEditor() {
    if (!editorSectionId) return;

    const draft = {
      ...editorDraft,
      medication: editorDraft.medication.trim(),
      dose: editorDraft.dose.trim(),
      how: editorDraft.how.trim(),
      purpose: editorDraft.purpose.trim(),
      plan: editorDraft.plan.trim(),
      extra: Object.fromEntries(
        Object.entries(editorDraft.extra ?? {}).map(([k, v]) => [
          k,
          (v ?? "").trim(),
        ]),
      ),
    };

    setSections((prev) =>
      prev.map((sec) => {
        if (sec.id !== editorSectionId) return sec;

        if (editorRowId) {
          return {
            ...sec,
            rows: sec.rows.map((r) => (r.id === editorRowId ? draft : r)),
          };
        }

        return {
          ...sec,
          rows: [...sec.rows, { ...draft, id: `med-${uid()}` }],
        };
      }),
    );

    const sec = sections.find((s) => s.id === editorSectionId);
    if (sec && draft.medication) addRecent(sec.systemId, draft.medication);

    showToast({
      message: editorRowId ? "Medication updated" : "Medication added",
    });
    closeEditor();
  }

  function removeRow(sectionId: string, rowId: string) {
    const snapshot = sections;
    setSections((prev) =>
      prev.map((sec) =>
        sec.id !== sectionId
          ? sec
          : { ...sec, rows: sec.rows.filter((r) => r.id !== rowId) },
      ),
    );

    showToast({
      message: "Medication removed",
      undoLabel: "Undo",
      onUndo: () => setSections(snapshot),
    });
  }

  function duplicateRow(sectionId: string, rowId: string) {
    setSections((prev) =>
      prev.map((sec) => {
        if (sec.id !== sectionId) return sec;
        const row = sec.rows.find((r) => r.id === rowId);
        if (!row) return sec;
        return {
          ...sec,
          rows: [
            ...sec.rows,
            {
              ...row,
              id: `med-${uid()}`,
              extra: { ...row.extra },
            },
          ],
        };
      }),
    );

    showToast({ message: "Medication duplicated" });
  }

  function moveRow(sectionId: string, rowId: string, dir: -1 | 1) {
    setSections((prev) =>
      prev.map((sec) => {
        if (sec.id !== sectionId) return sec;
        const idx = sec.rows.findIndex((r) => r.id === rowId);
        if (idx === -1) return sec;
        const nextIdx = idx + dir;
        if (nextIdx < 0 || nextIdx >= sec.rows.length) return sec;
        const nextRows = [...sec.rows];
        const [item] = nextRows.splice(idx, 1);
        nextRows.splice(nextIdx, 0, item);
        return { ...sec, rows: nextRows };
      }),
    );
  }

  function applyTemplateToEditor(sectionId: string, templateIndex: number) {
    const sec = sections.find((s) => s.id === sectionId);
    const sys = sec ? systemById.get(sec.systemId) : null;
    const template = sys?.row_templates?.[templateIndex];
    if (!template) return;

    setEditorTemplateIndex(templateIndex);
    setEditorDraft((prev) => ({
      ...prev,
      medication: prev.medication || template.medication_options?.[0] || "",
      dose: prev.dose || template.dose_options?.[0] || "",
      how: prev.how || template.how_options?.[0] || "",
      purpose: prev.purpose || template.purpose_options?.[0] || "",
      plan: prev.plan || template.plan_options?.[0] || "",
      templateIndex,
    }));
  }

  function clearAll() {
    setPatientName("");
    setDob("");
    setMrn("");
    setAllergies("");
    setIntolerances("");
    setCarer("");
    setSignificantHistory("");
    setReviewDate(todayISO());
    setReviewCompletedBy("");
    setTreatmentGoals("");
    setNextReviewDate("");
    setNextReviewMode("");
    setBeforeNextReview("");
    setNotes("");
    setCustomColumns([]);
    setSections([]);
    setAddSystemId("");
    setSearch("");
    setIncompleteOnly(false);
    setShowMore(false);
    setInputMode("smart");
    setDense(false);
    setConfirmResetOpen(false);
    setScribeResetSignal((prev) => prev + 1);

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}

    showToast({ message: "Draft cleared" });
  }

  function applyScribeDraft(draft: ScribeDraft) {
    const meds = Array.isArray(draft?.medications) ? draft.medications : [];

    if (draft.patientName?.trim()) {
      setPatientName((prev) => prev.trim() || draft.patientName!.trim());
    }

    if (draft.caseNumber?.trim()) {
      setMrn((prev) => prev.trim() || draft.caseNumber!.trim());
    }

    if (draft.significantHistory?.trim()) {
      setSignificantHistory((prev) =>
        prev.trim()
          ? `${prev}\n${draft.significantHistory!.trim()}`
          : draft.significantHistory!.trim(),
      );
    }

    let addedCount = 0;
    let skippedCount = 0;

    if (meds.length > 0) {
      setSections((prev) => {
        const next = [...prev];

        for (const item of meds) {
          const systemId = (item.systemId ?? "").trim();
          const medication = (item.medication ?? "").trim();

          if (!medication) {
            skippedCount++;
            continue;
          }

          let secIndex = systemId
            ? next.findIndex((s) => s.systemId === systemId)
            : -1;

          if (systemId && secIndex === -1 && systemById.has(systemId)) {
            const sys = systemById.get(systemId);
            next.push({
              id: `sec-${uid()}`,
              systemId,
              diagnosis:
                ((item.diagnosis ?? "").trim() || sys?.diagnosis) ?? "",
              diagnosisDate: sys?.diagnosis_date ?? "",
              rows: [],
            });
            secIndex = next.length - 1;
          }

          if (secIndex === -1) {
            skippedCount++;
            continue;
          }

          const extra: Record<string, string> = {};
          for (const c of customColumns) extra[c.id] = "";

          const sec = next[secIndex];
          next[secIndex] = {
            ...sec,
            diagnosis: sec.diagnosis || (item.diagnosis ?? "").trim(),
            rows: [
              ...sec.rows,
              {
                id: `med-${uid()}`,
                medication,
                dose: (item.dose ?? "").trim(),
                how: (item.how ?? "").trim(),
                purpose: (item.purpose ?? "").trim(),
                plan: (item.plan ?? "").trim() || "Start",
                extra,
              },
            ],
          };

          addRecent(systemId, medication);
          addedCount++;
        }

        return next;
      });
    }

    const appliedSummary: string[] = [];
    if (draft.patientName?.trim()) appliedSummary.push("patient name");
    if (draft.caseNumber?.trim()) appliedSummary.push("case number");
    if (draft.significantHistory?.trim()) appliedSummary.push("history");
    if (addedCount > 0) {
      appliedSummary.push(
        `${addedCount} medication${addedCount > 1 ? "s" : ""}`,
      );
    }

    const reviewCount = [
      draft.age?.trim(),
      draft.sex?.trim(),
      draft.chiefComplaint?.trim(),
      draft.associatedSymptoms?.length ? "symptoms" : "",
      draft.examFindings?.trim(),
      draft.labSummary?.trim(),
      draft.imagingSummary?.trim(),
      draft.diagnosisHints?.length ? "diagnosis hints" : "",
      draft.warnings?.length ? "warnings" : "",
    ].filter(Boolean).length;

    const summary = [...appliedSummary];
    if (reviewCount > 0) {
      summary.push(`${reviewCount} review item${reviewCount > 1 ? "s" : ""}`);
    }
    if (skippedCount > 0) summary.push(`${skippedCount} skipped`);

    showToast({
      message:
        appliedSummary.length > 0
          ? `Applied: ${summary.join(" • ")}`
          : summary.length > 0
            ? `Processed: ${summary.join(" • ")}`
            : "Nothing new was applied.",
    });

    setTab("meds");
  }

  /* ===================== Styles ===================== */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bg", "246 248 252");
    root.style.setProperty("--surface", "255 255 255");
    root.style.setProperty("--card", "251 252 254");
    root.style.setProperty("--text", "15 23 42");
    root.style.setProperty("--muted", "100 116 139");
    root.style.setProperty("--border", "226 232 240");
    root.style.setProperty("--primary", "37 99 235");
    root.style.setProperty("--primary-soft", "219 234 254");
    root.style.setProperty("--success", "5 150 105");
    root.style.setProperty("--warn", "217 119 6");
    root.style.setProperty("--danger", "220 38 38");
  }, []);

  return (
    <div className="min-h-screen bg-[rgb(var(--bg))] text-[rgb(var(--text))]">
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-5 md:px-6 xl:px-8">
        <section className="overflow-hidden rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] shadow-sm">
          <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-start lg:justify-between lg:px-7 lg:py-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-[rgb(var(--border))] bg-[rgba(var(--card),0.8)] px-3 py-1 text-xs font-semibold text-[rgb(var(--muted))]">
                  Intelligent Medication Report
                </span>

                <span
                  className={[
                    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                    readyToPrint
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  ].join(" ")}
                >
                  {readyToPrint
                    ? "Ready to print"
                    : `${requiredMissing} item${requiredMissing > 1 ? "s" : ""} missing`}
                </span>

                <span
                  className={[
                    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                    saveState === "saved"
                      ? "border-sky-200 bg-sky-50 text-sky-700"
                      : saveState === "saving"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-slate-50 text-slate-600",
                  ].join(" ")}
                >
                  {saveState === "saving"
                    ? "Saving..."
                    : saveState === "saved"
                      ? "Saved"
                      : "Draft"}
                </span>

                {!online && (
                  <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                    Offline
                  </span>
                )}
              </div>

              <div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Clinical Medication Review
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[rgb(var(--muted))]">
                  Capture patient details, build medication sections, and
                  prepare a clean printable review without exposing technical
                  processing to the clinician.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:w-[340px]">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-2xl bg-[rgb(var(--primary))] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Print / Save PDF
              </button>

              <button
                type="button"
                onClick={() => setConfirmResetOpen(true)}
                className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm font-semibold text-[rgb(var(--text))] transition hover:bg-[rgba(var(--card),0.8)]"
              >
                Reset draft
              </button>

              <button
                type="button"
                onClick={() => setTab("patient")}
                className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm font-semibold text-[rgb(var(--text))] transition hover:bg-[rgba(var(--card),0.8)]"
              >
                Patient details
              </button>

              <button
                type="button"
                onClick={() => setTab("meds")}
                className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm font-semibold text-[rgb(var(--text))] transition hover:bg-[rgba(var(--card),0.8)]"
              >
                Medications
              </button>
            </div>
          </div>
        </section>

        <VoiceScribe
          onApply={applyScribeDraft}
          resetSignal={scribeResetSignal}
        />

        <section className="rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                { key: "meds", label: "Medications" },
                { key: "patient", label: "Patient" },
                { key: "review", label: "Review & print" },
              ].map((item) => {
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key as TabKey)}
                    className={[
                      "rounded-2xl px-4 py-2 text-sm font-semibold transition",
                      active
                        ? "bg-[rgb(var(--primary))] text-white"
                        : "border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--text))] hover:bg-[rgba(var(--card),0.8)]",
                    ].join(" ")}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
              <div className="relative min-w-[240px]">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search medications, systems, dose, purpose..."
                  className="w-full rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm outline-none transition focus:border-[rgb(var(--primary))]"
                />
              </div>

              <label className="inline-flex items-center gap-2 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3 text-sm text-[rgb(var(--text))]">
                <input
                  type="checkbox"
                  checked={incompleteOnly}
                  onChange={(e) => setIncompleteOnly(e.target.checked)}
                />
                Show incomplete only
              </label>

              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm font-semibold text-[rgb(var(--text))] transition hover:bg-[rgba(var(--card),0.8)]"
              >
                {showMore ? "Hide advanced" : "Advanced"}
              </button>
            </div>
          </div>

          {showMore && (
            <div className="mt-4 grid gap-4 rounded-3xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.8)] p-4 xl:grid-cols-[1fr_auto_auto] xl:items-end">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Add custom column
                </label>
                <div className="flex gap-2">
                  <input
                    value={newColTitle}
                    onChange={(e) => setNewColTitle(e.target.value)}
                    placeholder="Example: Prescriber / Route / Supply"
                    className="w-full rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm outline-none transition focus:border-[rgb(var(--primary))]"
                  />
                  <button
                    type="button"
                    onClick={addCustomColumn}
                    className="rounded-2xl bg-[rgb(var(--primary))] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Entry mode
                </label>
                <select
                  value={inputMode}
                  onChange={(e) => setInputMode(e.target.value as InputMode)}
                  className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm outline-none"
                >
                  <option value="smart">Smart</option>
                  <option value="pick">Pick lists</option>
                  <option value="type">Free type</option>
                </select>
              </div>

              <label className="inline-flex items-center gap-2 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3 text-sm text-[rgb(var(--text))]">
                <input
                  type="checkbox"
                  checked={dense}
                  onChange={(e) => setDense(e.target.checked)}
                />
                Dense table layout
              </label>

              {customColumns.length > 0 && (
                <div className="xl:col-span-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                    Custom columns
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {customColumns.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1.5 text-sm"
                      >
                        {c.title}
                        <button
                          type="button"
                          onClick={() => removeCustomColumn(c.id)}
                          className="text-[rgb(var(--muted))] transition hover:text-[rgb(var(--danger))]"
                          aria-label={`Remove ${c.title}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {tab === "patient" && (
          <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <div className="rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Patient details</h2>
                <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                  These fields appear in the printed report and should stay
                  clean and clinician-facing.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Patient name" required>
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

            <div className="rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">History</h2>
                <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                  Significant history imported from voice or entered manually.
                </p>
              </div>

              <Field label="Significant history">
                <textarea
                  value={significantHistory}
                  onChange={(e) => setSignificantHistory(e.target.value)}
                  className="field min-h-[300px]"
                  placeholder="Relevant background, chronic conditions, prior issues..."
                />
              </Field>
            </div>
          </section>
        )}

        {tab === "meds" && (
          <section className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <aside className="rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Systems</h2>
                <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                  Add a clinical system, then attach medications underneath it.
                </p>
              </div>

              <Field label="Add system">
                <div className="flex gap-2">
                  <select
                    value={addSystemId}
                    onChange={(e) => setAddSystemId(e.target.value)}
                    className="field"
                  >
                    <option value="">Select system</option>
                    {systems.map((sys) => (
                      <option key={sys.id} value={sys.id}>
                        {sys.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => addSystemSection(addSystemId)}
                    className="rounded-2xl bg-[rgb(var(--primary))] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    Add
                  </button>
                </div>
              </Field>

              <div className="mt-5 space-y-2">
                {sections.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[rgb(var(--border))] bg-[rgba(var(--card),0.8)] px-4 py-4 text-sm text-[rgb(var(--muted))]">
                    No systems added yet.
                  </div>
                ) : (
                  sections.map((sec) => {
                    const sys = systemById.get(sec.systemId);
                    const active = filteredSections.some(
                      (x) => x.id === sec.id,
                    );
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => {
                          setTab("meds");
                          const el = document.getElementById(
                            `section-${sec.id}`,
                          );
                          el?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }}
                        className={[
                          "w-full rounded-2xl border px-4 py-3 text-left transition",
                          active
                            ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary-soft))]"
                            : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:bg-[rgba(var(--card),0.8)]",
                        ].join(" ")}
                      >
                        <div className="text-sm font-semibold">
                          {sys?.name ?? "Unknown system"}
                        </div>
                        <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                          {sec.rows.length} medication
                          {sec.rows.length !== 1 ? "s" : ""}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
            <div className="space-y-4">
              {filteredSections.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-6 py-12 text-center shadow-sm">
                  <div className="text-lg font-semibold">
                    No matching medication sections
                  </div>
                  <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                    Add a system from the left panel or import medications from
                    Voice Intake.
                  </p>
                </div>
              ) : (
                filteredSections.map((sec) => {
                  const sys = systemById.get(sec.systemId);
                  const templates = sys?.row_templates ?? [];

                  return (
                    <section
                      key={sec.id}
                      id={`section-${sec.id}`}
                      className="rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 shadow-sm md:p-5"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div>
                            <h3 className="text-lg font-semibold">
                              {sys?.name ?? "System"}
                            </h3>
                            <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                              Manage medications under this system.
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Diagnosis">
                              <input
                                value={sec.diagnosis}
                                onChange={(e) =>
                                  setSections((prev) =>
                                    prev.map((s) =>
                                      s.id === sec.id
                                        ? { ...s, diagnosis: e.target.value }
                                        : s,
                                    ),
                                  )
                                }
                                className="field"
                                placeholder="Diagnosis"
                              />
                            </Field>

                            <Field label="Diagnosis date">
                              <input
                                type="date"
                                value={sec.diagnosisDate}
                                onChange={(e) =>
                                  setSections((prev) =>
                                    prev.map((s) =>
                                      s.id === sec.id
                                        ? {
                                            ...s,
                                            diagnosisDate: e.target.value,
                                          }
                                        : s,
                                    ),
                                  )
                                }
                                className="field"
                              />
                            </Field>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openAddRow(sec.id)}
                            className="rounded-2xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                          >
                            Add medication
                          </button>

                          <button
                            type="button"
                            onClick={() => removeSystemSection(sec.id)}
                            className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold text-[rgb(var(--danger))] transition hover:bg-[rgba(var(--card),0.8)]"
                          >
                            Remove system
                          </button>
                        </div>
                      </div>

                      {templates.length > 0 && (
                        <div className="mt-4 rounded-3xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.75)] p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                            Quick templates
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {templates.map((t, idx) => {
                              const medName =
                                t.medication_options?.[0] ||
                                `Template ${idx + 1}`;
                              return (
                                <button
                                  key={`${sec.id}-template-${idx}`}
                                  type="button"
                                  onClick={() => {
                                    openAddRow(sec.id);
                                    setTimeout(() => {
                                      applyTemplateToEditor(sec.id, idx);
                                    }, 0);
                                  }}
                                  className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1.5 text-sm font-medium transition hover:bg-[rgba(var(--primary),0.08)]"
                                >
                                  {medName}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="mt-4">
                        {sec.rows.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-[rgb(var(--border))] bg-[rgba(var(--card),0.6)] px-4 py-8 text-center text-sm text-[rgb(var(--muted))]">
                            No medications added in this system yet.
                          </div>
                        ) : (
                          <>
                            <div className="hidden overflow-x-auto lg:block">
                              <table
                                className={[
                                  "w-full min-w-[980px] border-separate border-spacing-0 overflow-hidden rounded-3xl border border-[rgb(var(--border))]",
                                  dense ? "text-[13px]" : "text-sm",
                                ].join(" ")}
                              >
                                <thead>
                                  <tr className="bg-[rgba(var(--card),0.8)] text-left text-[rgb(var(--muted))]">
                                    <th className="border-b border-[rgb(var(--border))] px-4 py-3 font-semibold">
                                      Medication
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-4 py-3 font-semibold">
                                      Dose
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-4 py-3 font-semibold">
                                      How
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-4 py-3 font-semibold">
                                      Purpose
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-4 py-3 font-semibold">
                                      Plan
                                    </th>
                                    {customColumns.map((c) => (
                                      <th
                                        key={c.id}
                                        className="border-b border-[rgb(var(--border))] px-4 py-3 font-semibold"
                                      >
                                        {c.title}
                                      </th>
                                    ))}
                                    <th className="border-b border-[rgb(var(--border))] px-4 py-3 font-semibold">
                                      Actions
                                    </th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {sec.rows.map((row, idx) => (
                                    <tr
                                      key={row.id}
                                      className={
                                        idx % 2 === 0
                                          ? "bg-[rgb(var(--surface))]"
                                          : "bg-[rgba(var(--card),0.5)]"
                                      }
                                    >
                                      <td className="border-b border-[rgb(var(--border))] px-4 py-3 align-top">
                                        <div className="font-semibold">
                                          {row.medication || (
                                            <span className="text-[rgb(var(--muted))]">
                                              —
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-4 py-3 align-top">
                                        {row.dose || (
                                          <span className="text-[rgb(var(--muted))]">
                                            —
                                          </span>
                                        )}
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-4 py-3 align-top">
                                        {row.how || (
                                          <span className="text-[rgb(var(--muted))]">
                                            —
                                          </span>
                                        )}
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-4 py-3 align-top">
                                        {row.purpose || (
                                          <span className="text-[rgb(var(--muted))]">
                                            —
                                          </span>
                                        )}
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-4 py-3 align-top">
                                        {row.plan || (
                                          <span className="text-[rgb(var(--muted))]">
                                            —
                                          </span>
                                        )}
                                      </td>

                                      {customColumns.map((c) => (
                                        <td
                                          key={`${row.id}-${c.id}`}
                                          className="border-b border-[rgb(var(--border))] px-4 py-3 align-top"
                                        >
                                          {row.extra?.[c.id] || (
                                            <span className="text-[rgb(var(--muted))]">
                                              —
                                            </span>
                                          )}
                                        </td>
                                      ))}

                                      <td className="border-b border-[rgb(var(--border))] px-4 py-3 align-top">
                                        <div className="flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openEditRow(sec.id, row.id)
                                            }
                                            className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold transition hover:bg-[rgba(var(--card),0.8)]"
                                          >
                                            Edit
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              duplicateRow(sec.id, row.id)
                                            }
                                            className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold transition hover:bg-[rgba(var(--card),0.8)]"
                                          >
                                            Duplicate
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              moveRow(sec.id, row.id, -1)
                                            }
                                            className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold transition hover:bg-[rgba(var(--card),0.8)]"
                                          >
                                            ↑
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              moveRow(sec.id, row.id, 1)
                                            }
                                            className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold transition hover:bg-[rgba(var(--card),0.8)]"
                                          >
                                            ↓
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeRow(sec.id, row.id)
                                            }
                                            className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold text-[rgb(var(--danger))] transition hover:bg-[rgba(var(--card),0.8)]"
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

                            <div className="grid gap-3 lg:hidden">
                              {sec.rows.map((row) => (
                                <div
                                  key={row.id}
                                  className="rounded-3xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.7)] p-4"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold">
                                        {row.medication ||
                                          "Untitled medication"}
                                      </div>
                                      <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                                        {row.dose || "No dose"} •{" "}
                                        {row.plan || "No plan"}
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openEditRow(sec.id, row.id)
                                        }
                                        className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          duplicateRow(sec.id, row.id)
                                        }
                                        className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold"
                                      >
                                        Duplicate
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeRow(sec.id, row.id)
                                        }
                                        className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold text-[rgb(var(--danger))]"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>

                                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <SummaryTile
                                      label="Dose"
                                      value={row.dose || "—"}
                                    />
                                    <SummaryTile
                                      label="How"
                                      value={row.how || "—"}
                                    />
                                    <SummaryTile
                                      label="Purpose"
                                      value={row.purpose || "—"}
                                    />
                                    <SummaryTile
                                      label="Plan"
                                      value={row.plan || "—"}
                                    />
                                    {customColumns.map((c) => (
                                      <SummaryTile
                                        key={`${row.id}-${c.id}-mobile`}
                                        label={c.title}
                                        value={row.extra?.[c.id] || "—"}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          </section>
        )}

        {tab === "review" && (
          <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <div className="space-y-4">
              <div className="rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Review summary</h2>
                <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                  Final printable snapshot before exporting.
                </p>

                <div className="mt-4 grid gap-3">
                  <SummaryTile
                    label="Patient"
                    value={patientName || "Not entered"}
                  />
                  <SummaryTile label="MRN" value={mrn || "Not entered"} />
                  <SummaryTile
                    label="Review date"
                    value={reviewDate || "Not entered"}
                  />
                  <SummaryTile
                    label="Completed by"
                    value={reviewCompletedBy || "Not entered"}
                  />
                  <SummaryTile label="Systems" value={`${sections.length}`} />
                  <SummaryTile label="Medications" value={`${totalRows}`} />
                </div>
              </div>

              <div className="rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Review notes</h2>
                <div className="mt-4 grid gap-4">
                  <Field label="Review completed by" required>
                    <input
                      value={reviewCompletedBy}
                      onChange={(e) => setReviewCompletedBy(e.target.value)}
                      className="field"
                      placeholder="Clinician name"
                    />
                  </Field>

                  <Field label="Treatment goals">
                    <textarea
                      value={treatmentGoals}
                      onChange={(e) => setTreatmentGoals(e.target.value)}
                      className="field min-h-[140px]"
                      placeholder="Treatment goals"
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-[rgb(var(--border))] bg-white p-6 shadow-sm print:shadow-none">
              <div className="border-b border-[rgb(var(--border))] pb-4">
                <h2 className="text-2xl font-semibold">
                  Clinical Medication Review
                </h2>
                <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                  Printable report preview
                </p>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <SummaryTile label="Patient name" value={patientName || "—"} />
                <SummaryTile label="Date of birth" value={dob || "—"} />
                <SummaryTile label="MRN / case number" value={mrn || "—"} />
                <SummaryTile label="Carer" value={carer || "—"} />
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <SummaryTile label="Allergies" value={allergies || "—"} />
                <SummaryTile label="Intolerances" value={intolerances || "—"} />
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Significant history
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.7)] p-4 text-sm">
                  {significantHistory || "—"}
                </div>
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Medications by system
                </div>

                <div className="mt-3 space-y-4">
                  {sections.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[rgb(var(--border))] bg-[rgba(var(--card),0.65)] p-5 text-sm text-[rgb(var(--muted))]">
                      No medication systems added yet.
                    </div>
                  ) : (
                    sections.map((sec) => {
                      const sys = systemById.get(sec.systemId);

                      return (
                        <div
                          key={`review-${sec.id}`}
                          className="rounded-3xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.6)] p-4"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="font-semibold">
                                {sys?.name ?? "System"}
                              </div>
                              <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                                Diagnosis: {sec.diagnosis || "—"} • Date:{" "}
                                {sec.diagnosisDate || "—"}
                              </div>
                            </div>
                            <div className="text-xs font-medium text-[rgb(var(--muted))]">
                              {sec.rows.length} medication
                              {sec.rows.length === 1 ? "" : "s"}
                            </div>
                          </div>

                          {sec.rows.length > 0 ? (
                            <div className="mt-4 overflow-x-auto">
                              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
                                <thead>
                                  <tr className="text-left text-[rgb(var(--muted))]">
                                    <th className="border-b border-[rgb(var(--border))] px-3 py-2 font-semibold">
                                      Medication
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-3 py-2 font-semibold">
                                      Dose
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-3 py-2 font-semibold">
                                      How
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-3 py-2 font-semibold">
                                      Purpose
                                    </th>
                                    <th className="border-b border-[rgb(var(--border))] px-3 py-2 font-semibold">
                                      Plan
                                    </th>
                                    {customColumns.map((c) => (
                                      <th
                                        key={`review-${sec.id}-${c.id}`}
                                        className="border-b border-[rgb(var(--border))] px-3 py-2 font-semibold"
                                      >
                                        {c.title}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {sec.rows.map((row) => (
                                    <tr key={`review-row-${row.id}`}>
                                      <td className="border-b border-[rgb(var(--border))] px-3 py-2">
                                        {row.medication || "—"}
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-3 py-2">
                                        {row.dose || "—"}
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-3 py-2">
                                        {row.how || "—"}
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-3 py-2">
                                        {row.purpose || "—"}
                                      </td>
                                      <td className="border-b border-[rgb(var(--border))] px-3 py-2">
                                        {row.plan || "—"}
                                      </td>
                                      {customColumns.map((c) => (
                                        <td
                                          key={`review-row-${row.id}-${c.id}`}
                                          className="border-b border-[rgb(var(--border))] px-3 py-2"
                                        >
                                          {row.extra?.[c.id] || "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="mt-3 text-sm text-[rgb(var(--muted))]">
                              No medications in this system.
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <SummaryTile
                  label="This review date"
                  value={reviewDate || "—"}
                />
                <SummaryTile
                  label="Review completed by"
                  value={reviewCompletedBy || "—"}
                />
                <SummaryTile
                  label="Next review date"
                  value={nextReviewDate || "—"}
                />
                <SummaryTile label="Mode" value={nextReviewMode || "—"} />
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Treatment goals
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.7)] p-4 text-sm">
                  {treatmentGoals || "—"}
                </div>
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Before next review
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.7)] p-4 text-sm">
                  {beforeNextReview || "—"}
                </div>
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Notes
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.7)] p-4 text-sm">
                  {notes || "—"}
                </div>
              </div>
            </div>
          </section>
        )}

        {editorOpen && (
          <EditorOverlay onClose={closeEditor}>
            <div className="rounded-t-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 md:rounded-[28px] md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    {editorRowId ? "Edit medication" : "Add medication"}
                  </h2>
                  <p className="mt-1 text-sm text-[rgb(var(--muted))]">
                    Fill the medication details cleanly. This is the part humans
                    love making messy.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-sm font-semibold"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Medication" required>
                  <FieldInput
                    mode={inputMode}
                    value={editorDraft.medication}
                    onChange={(v) =>
                      setEditorDraft((prev) => ({ ...prev, medication: v }))
                    }
                    options={
                      getTemplateOptions(
                        systemById.get(
                          sections.find((s) => s.id === editorSectionId)
                            ?.systemId || "",
                        ),
                        editorTemplateIndex,
                      ).medication_options
                    }
                    placeholder="Medication"
                    inputRef={refMed}
                  />
                </Field>

                <Field label="Dose" required>
                  <FieldInput
                    mode={inputMode}
                    value={editorDraft.dose}
                    onChange={(v) =>
                      setEditorDraft((prev) => ({ ...prev, dose: v }))
                    }
                    options={
                      getTemplateOptions(
                        systemById.get(
                          sections.find((s) => s.id === editorSectionId)
                            ?.systemId || "",
                        ),
                        editorTemplateIndex,
                      ).dose_options
                    }
                    placeholder="Dose"
                    inputRef={refDose}
                  />
                </Field>

                <Field label="How" required>
                  <FieldInput
                    mode={inputMode}
                    value={editorDraft.how}
                    onChange={(v) =>
                      setEditorDraft((prev) => ({ ...prev, how: v }))
                    }
                    options={
                      getTemplateOptions(
                        systemById.get(
                          sections.find((s) => s.id === editorSectionId)
                            ?.systemId || "",
                        ),
                        editorTemplateIndex,
                      ).how_options
                    }
                    placeholder="How"
                    inputRef={refHow}
                  />
                </Field>

                <Field label="Purpose">
                  <FieldInput
                    mode={inputMode}
                    value={editorDraft.purpose}
                    onChange={(v) =>
                      setEditorDraft((prev) => ({ ...prev, purpose: v }))
                    }
                    options={
                      getTemplateOptions(
                        systemById.get(
                          sections.find((s) => s.id === editorSectionId)
                            ?.systemId || "",
                        ),
                        editorTemplateIndex,
                      ).purpose_options
                    }
                    placeholder="Purpose"
                    inputRef={refPurpose}
                  />
                </Field>

                <Field label="Plan" required>
                  <FieldInput
                    mode={inputMode}
                    value={editorDraft.plan}
                    onChange={(v) =>
                      setEditorDraft((prev) => ({ ...prev, plan: v }))
                    }
                    options={
                      getTemplateOptions(
                        systemById.get(
                          sections.find((s) => s.id === editorSectionId)
                            ?.systemId || "",
                        ),
                        editorTemplateIndex,
                      ).plan_options
                    }
                    placeholder="Plan"
                    inputRef={refPlan}
                  />
                </Field>
              </div>

              {customColumns.length > 0 && (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {customColumns.map((c) => (
                    <Field key={c.id} label={c.title}>
                      <input
                        value={editorDraft.extra?.[c.id] ?? ""}
                        onChange={(e) =>
                          setEditorDraft((prev) => ({
                            ...prev,
                            extra: { ...prev.extra, [c.id]: e.target.value },
                          }))
                        }
                        className="field"
                        placeholder={c.title}
                      />
                    </Field>
                  ))}
                </div>
              )}

              {(() => {
                const currentSection = sections.find(
                  (s) => s.id === editorSectionId,
                );
                const currentSystemId = currentSection?.systemId ?? "";
                const favorites = favs[currentSystemId] ?? [];
                const recent = recents[currentSystemId] ?? [];

                if (favorites.length === 0 && recent.length === 0) return null;

                return (
                  <div className="mt-5 rounded-3xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.8)] p-4">
                    {favorites.length > 0 && (
                      <>
                        <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                          Favorites
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {favorites.map((item) => (
                            <button
                              key={`fav-${item}`}
                              type="button"
                              onClick={() =>
                                setEditorDraft((prev) => ({
                                  ...prev,
                                  medication: item,
                                }))
                              }
                              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1.5 text-sm"
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {recent.length > 0 && (
                      <>
                        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                          Recent
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {recent.map((item) => (
                            <button
                              key={`recent-${item}`}
                              type="button"
                              onClick={() =>
                                setEditorDraft((prev) => ({
                                  ...prev,
                                  medication: item,
                                }))
                              }
                              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1.5 text-sm"
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    const section = sections.find(
                      (s) => s.id === editorSectionId,
                    );
                    const systemId = section?.systemId ?? "";
                    const med = editorDraft.medication.trim();
                    if (systemId && med) toggleFav(systemId, med);
                  }}
                  className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm font-semibold text-[rgb(var(--text))]"
                >
                  Toggle favorite
                </button>

                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 text-sm font-semibold text-[rgb(var(--text))]"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={saveEditor}
                    className="rounded-2xl bg-[rgb(var(--primary))] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    Save medication
                  </button>
                </div>
              </div>
            </div>
          </EditorOverlay>
        )}

        {confirmResetOpen && (
          <ConfirmDialog
            title="Reset this draft?"
            description="This clears the current report, medication sections, and saved local draft data."
            confirmLabel="Reset"
            cancelLabel="Cancel"
            onCancel={() => setConfirmResetOpen(false)}
            onConfirm={clearAll}
          />
        )}

        {toast && (
          <div className="fixed bottom-4 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-[rgb(var(--text))]">
                {toast.message}
              </div>

              {toast.onUndo && toast.undoLabel && (
                <button
                  type="button"
                  onClick={() => {
                    toast.onUndo?.();
                    setToast(null);
                  }}
                  className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold"
                >
                  {toast.undoLabel}
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 1rem;
          border: 1px solid rgb(var(--border));
          background: rgb(var(--surface));
          padding: 0.75rem 1rem;
          font-size: 0.95rem;
          color: rgb(var(--text));
          outline: none;
          transition:
            border-color 160ms ease,
            box-shadow 160ms ease,
            background 160ms ease;
        }

        .field:focus {
          border-color: rgb(var(--primary));
          box-shadow: 0 0 0 4px rgba(var(--primary), 0.12);
        }

        textarea.field {
          resize: vertical;
        }

        @media print {
          .print\\:shadow-none {
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function rowIncomplete(row: MedicationRow) {
  return (
    !row.medication.trim() ||
    !row.dose.trim() ||
    !row.how.trim() ||
    !row.plan.trim()
  );
}

function getTemplateOptions(
  system?: SystemTemplate,
  templateIndex?: number,
): RowTemplate {
  const empty: RowTemplate = {
    medication_options: [],
    dose_options: [],
    how_options: [],
    purpose_options: [],
    plan_options: [],
  };

  if (!system) return empty;

  if (typeof templateIndex === "number") {
    return system.row_templates?.[templateIndex] ?? empty;
  }

  const merged: RowTemplate = {
    medication_options: [],
    dose_options: [],
    how_options: [],
    purpose_options: [],
    plan_options: [],
  };

  for (const t of system.row_templates ?? []) {
    merged.medication_options.push(...(t.medication_options ?? []));
    merged.dose_options.push(...(t.dose_options ?? []));
    merged.how_options.push(...(t.how_options ?? []));
    merged.purpose_options.push(...(t.purpose_options ?? []));
    merged.plan_options.push(...(t.plan_options ?? []));
  }

  return {
    medication_options: Array.from(new Set(merged.medication_options)),
    dose_options: Array.from(new Set(merged.dose_options)),
    how_options: Array.from(new Set(merged.how_options)),
    purpose_options: Array.from(new Set(merged.purpose_options)),
    plan_options: Array.from(new Set(merged.plan_options)),
  };
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-[rgb(var(--text))]">
        {label}
        {required && <span className="ml-1 text-[rgb(var(--danger))]">*</span>}
      </label>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              "px-3 py-2 text-sm font-semibold transition",
              active
                ? "bg-[rgb(var(--primary))] text-white"
                : "text-[rgb(var(--muted))] hover:bg-[rgba(var(--card),0.75)]",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold",
        checked
          ? "border-[rgb(var(--primary))] bg-[rgba(var(--primary),0.08)] text-[rgb(var(--text))]"
          : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]",
      ].join(" ")}
      aria-pressed={checked}
    >
      <span
        className={[
          "relative h-4 w-7 rounded-full border transition",
          checked
            ? "border-[rgba(var(--primary),0.35)] bg-[rgba(var(--primary),0.20)]"
            : "border-[rgb(var(--border))] bg-[rgba(var(--card),0.9)]",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all",
            checked
              ? "left-3 bg-[rgb(var(--primary))]"
              : "left-1 bg-[rgb(var(--muted))]",
          ].join(" ")}
        />
      </span>
      {label}
    </button>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.75)] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
        {label}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-[rgb(var(--text))]">
        {value}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-md rounded-3xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-2xl">
        <div className="text-lg font-semibold">{title}</div>
        <p className="mt-2 text-sm leading-6 text-[rgb(var(--muted))]">
          {description}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />

      <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center">
        <div className="w-full md:max-w-3xl">{children}</div>
      </div>
    </div>
  );
}

function SmartSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };

    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    const nq = normalize(q);
    if (!nq) return options.slice(0, 12);
    return options.filter((o) => normalize(o).includes(nq)).slice(0, 12);
  }, [q, options]);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        ref={(el) => {
          if (inputRef) {
            (
              inputRef as React.MutableRefObject<
                HTMLInputElement | HTMLSelectElement | null
              >
            ).current = el;
          }
        }}
        className="field"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
      />

      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] shadow-[0_10px_30px_rgba(2,8,23,0.12)]">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-[rgba(var(--primary),0.08)]"
              onClick={() => {
                onChange(opt);
                setQ(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldInput({
  mode,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  inputRef,
}: {
  mode: InputMode;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
}) {
  if (mode === "pick" && options.length > 0) {
    const hasCustom =
      value && !options.some((x) => x.toLowerCase() === value.toLowerCase());

    return (
      <select
        ref={(el) => {
          if (inputRef) {
            (
              inputRef as React.MutableRefObject<
                HTMLInputElement | HTMLSelectElement | null
              >
            ).current = el;
          }
        }}
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {hasCustom && <option value={value}>{`Custom: ${value}`}</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (mode === "smart" && options.length > 0) {
    return (
      <SmartSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        inputRef={inputRef}
      />
    );
  }

  return (
    <input
      ref={(el) => {
        if (inputRef) {
          (
            inputRef as React.MutableRefObject<
              HTMLInputElement | HTMLSelectElement | null
            >
          ).current = el;
        }
      }}
      className="field"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}
