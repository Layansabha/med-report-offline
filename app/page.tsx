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
  const [systemsLoaded, setSystemsLoaded] = useState(false);

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
      .then((data) => setSystems(Array.isArray(data) ? data : []))
      .finally(() => setSystemsLoaded(true));
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

      setTab(parsed.tab ?? "meds");

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

      setInputMode(parsed.inputMode ?? "smart");
      setDense(!!parsed.dense);
      setSearch(parsed.search ?? "");
      setIncompleteOnly(!!parsed.incompleteOnly);
    } catch {}
  }, []);

  /* ===================== Autosave persist ===================== */
  useEffect(() => {
    const payload = {
      tab,
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
      inputMode,
      dense,
      search,
      incompleteOnly,
    };

    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {}
    }, 550);

    return () => window.clearTimeout(t);
  }, [
    tab,
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
    inputMode,
    dense,
    search,
    incompleteOnly,
  ]);

  /* ===================== Index systems ===================== */
  const systemById = useMemo(() => {
    const map = new Map<string, SystemTemplate>();
    for (const s of systems) map.set(s.id, s);
    return map;
  }, [systems]);

  /* ===================== Ensure extra keys ===================== */
  function ensureExtraKeys(row: MedicationRow): MedicationRow {
    const next: Record<string, string> = {};
    for (const c of customColumns) next[c.id] = row.extra?.[c.id] ?? "";
    return { ...row, extra: next };
  }

  useEffect(() => {
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        rows: sec.rows.map((r) => ensureExtraKeys(r)),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customColumns]);

  /* ===================== Toast ===================== */
  function showToast(next: ToastState, ms = 5500) {
    setToast(next);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }

  /* ===================== Core actions ===================== */
  function resetAll() {
    setTab("meds");

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
    setNewColTitle("");
    setSections([]);
    setAddSystemId("");

    setSearch("");
    setIncompleteOnly(false);
    setShowMore(false);
    setInputMode("smart");
    setDense(false);

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  function printPdf() {
    const name = patientName.trim() || "Patient";
    document.title = `Medication Report - ${name}`;
    window.print();
  }

  function addColumn() {
    const title = newColTitle.trim();
    if (!title) return;

    const col: CustomColumn = { id: `col-${uid()}`, title };
    setCustomColumns((prev) => [...prev, col]);
    setNewColTitle("");
  }

  function removeColumn(colId: string) {
    setCustomColumns((prev) => prev.filter((c) => c.id !== colId));

    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        rows: sec.rows.map((r) => {
          const next = { ...(r.extra ?? {}) };
          delete next[colId];
          return { ...r, extra: next };
        }),
      })),
    );
  }

  function createEmptyRow(): MedicationRow {
    const extra: Record<string, string> = {};
    for (const c of customColumns) extra[c.id] = "";

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

  function addSectionForSystem(systemId: string) {
    const sys = systemById.get(systemId);
    if (!sys) return;

    const sec: SystemSection = {
      id: `sec-${uid()}`,
      systemId: sys.id,
      diagnosis: sys.diagnosis ?? "",
      diagnosisDate: sys.diagnosis_date ?? "",
      rows: [],
    };

    setSections((prev) => [...prev, sec]);
    setTab("meds");
  }

  function removeSection(sectionId: string) {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === sectionId);
      if (idx === -1) return prev;

      const removed = prev[idx];
      const next = prev.filter((s) => s.id !== sectionId);

      showToast({
        message: "System removed.",
        undoLabel: "Undo",
        onUndo: () =>
          setSections((p) => {
            const copy = [...p];
            copy.splice(idx, 0, removed);
            return copy;
          }),
      });

      return next;
    });
  }

  function updateSection(sectionId: string, patch: Partial<SystemSection>) {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    );
  }

  function addTemplateRows(sectionId: string) {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;

    const sys = systemById.get(sec.systemId);
    if (!sys) return;

    const toAdd: MedicationRow[] = sys.row_templates.map((_, idx) => ({
      ...createEmptyRow(),
      id: `tpl-${sec.systemId}-${idx}-${uid()}`,
      templateIndex: idx,
    }));

    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, rows: [...s.rows, ...toAdd] } : s,
      ),
    );
  }

  function deleteRow(sectionId: string, rowId: string) {
    setSections((prev) => {
      const secIdx = prev.findIndex((s) => s.id === sectionId);
      if (secIdx === -1) return prev;

      const sec = prev[secIdx];
      const rowIdx = sec.rows.findIndex((r) => r.id === rowId);
      if (rowIdx === -1) return prev;

      const removed = sec.rows[rowIdx];

      const nextSections = [...prev];
      const nextSec: SystemSection = {
        ...sec,
        rows: sec.rows.filter((r) => r.id !== rowId),
      };
      nextSections[secIdx] = nextSec;

      showToast({
        message: "Medication deleted.",
        undoLabel: "Undo",
        onUndo: () =>
          setSections((p) => {
            const copy = [...p];
            const s = copy[secIdx];
            if (!s) return p;
            const rowsCopy = [...s.rows];
            rowsCopy.splice(rowIdx, 0, removed);
            copy[secIdx] = { ...s, rows: rowsCopy };
            return copy;
          }),
      });

      return nextSections;
    });
  }

  function duplicateRow(sectionId: string, rowId: string) {
    setSections((prev) =>
      prev.map((sec) => {
        if (sec.id !== sectionId) return sec;

        const r = sec.rows.find((x) => x.id === rowId);
        if (!r) return sec;

        const copy: MedicationRow = {
          ...r,
          id: `dup-${uid()}`,
          templateIndex: undefined,
          extra: { ...(r.extra ?? {}) },
        };

        return { ...sec, rows: [...sec.rows, copy] };
      }),
    );
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

  /* ===================== Recents / Favorites ===================== */
  function persistRecents(next: MapList) {
    setRecents(next);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {}
  }

  function persistFavs(next: MapList) {
    setFavs(next);
    try {
      localStorage.setItem(FAVS_KEY, JSON.stringify(next));
    } catch {}
  }

  function addRecent(systemId: string, medicationName: string) {
    const v = medicationName.trim();
    if (!v) return;

    const current = recents[systemId] ?? [];
    const next = {
      ...recents,
      [systemId]: uniqKeepOrder([v, ...current]).slice(0, 12),
    };

    persistRecents(next);
  }

  function toggleFavorite(systemId: string, medicationName: string) {
    const v = medicationName.trim();
    if (!v) return;

    const current = favs[systemId] ?? [];
    const exists = current.some((x) => x.toLowerCase() === v.toLowerCase());

    const nextList = exists
      ? current.filter((x) => x.toLowerCase() !== v.toLowerCase())
      : uniqKeepOrder([v, ...current]).slice(0, 20);

    const next = { ...favs, [systemId]: nextList };
    persistFavs(next);
  }

  function isFavorite(systemId: string, medicationName: string) {
    const v = medicationName.trim().toLowerCase();
    if (!v) return false;
    return (favs[systemId] ?? []).some((x) => x.toLowerCase() === v);
  }

  /* ===================== Options per system/template ===================== */
  function getOptions(systemId: string, templateIndex?: number): RowTemplate {
    const empty: RowTemplate = {
      medication_options: [],
      dose_options: [],
      how_options: [],
      purpose_options: [],
      plan_options: [],
    };

    const sys = systemById.get(systemId);
    if (!sys) return empty;

    if (typeof templateIndex === "number") {
      return sys.row_templates[templateIndex] ?? empty;
    }

    const merged: RowTemplate = {
      medication_options: [],
      dose_options: [],
      how_options: [],
      purpose_options: [],
      plan_options: [],
    };

    for (const t of sys.row_templates) {
      merged.medication_options.push(...t.medication_options);
      merged.dose_options.push(...t.dose_options);
      merged.how_options.push(...t.how_options);
      merged.purpose_options.push(...t.purpose_options);
      merged.plan_options.push(...t.plan_options);
    }

    merged.medication_options = Array.from(new Set(merged.medication_options));
    merged.dose_options = Array.from(new Set(merged.dose_options));
    merged.how_options = Array.from(new Set(merged.how_options));
    merged.purpose_options = Array.from(new Set(merged.purpose_options));
    merged.plan_options = Array.from(new Set(merged.plan_options));

    return merged;
  }

  /* ===================== Suggestions for custom columns ===================== */
  const customColumnSuggestions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of customColumns) map[c.id] = [];

    for (const sec of sections) {
      for (const r of sec.rows) {
        for (const c of customColumns) {
          const v = (r.extra?.[c.id] ?? "").trim();
          if (v) map[c.id].push(v);
        }
      }
    }

    for (const c of customColumns) {
      map[c.id] = Array.from(new Set(map[c.id])).slice(0, 50);
    }

    return map;
  }, [sections, customColumns]);

  /* ===================== Completion status ===================== */
  function rowIncomplete(r: MedicationRow) {
    return (
      !r.medication.trim() ||
      !r.dose.trim() ||
      !r.how.trim() ||
      !r.purpose.trim() ||
      !r.plan.trim()
    );
  }

  const overall = useMemo(() => {
    let total = 0;
    let incomplete = 0;

    for (const sec of sections) {
      for (const r of sec.rows) {
        total++;
        if (rowIncomplete(r)) incomplete++;
      }
    }

    const ready = total > 0 && incomplete === 0;
    return { total, incomplete, ready };
  }, [sections]);

  /* ===================== Filtering ===================== */
  const filteredSections = useMemo(() => {
    const q = normalize(search);

    return sections
      .map((sec) => {
        const sysName = systemById.get(sec.systemId)?.name ?? "";

        const rows = sec.rows.filter((r) => {
          const hay = normalize(
            [
              sysName,
              sec.diagnosis,
              sec.diagnosisDate,
              r.medication,
              r.dose,
              r.how,
              r.purpose,
              r.plan,
              ...customColumns.map((c) => r.extra?.[c.id] ?? ""),
            ].join(" "),
          );

          const matches = q ? hay.includes(q) : true;
          const okIncomplete = !incompleteOnly || rowIncomplete(r);

          return matches && okIncomplete;
        });

        return { sec, rows };
      })
      .filter(({ rows }) => (q ? rows.length > 0 : true));
  }, [sections, search, incompleteOnly, systemById, customColumns]);

  const printEnabled = overall.total > 0;

  /* ===================== Editor Open/Close/Save ===================== */

  function openCreateMedication(sectionId: string, templateIndex?: number) {
    const base = createEmptyRow();
    base.templateIndex = templateIndex;

    setEditorSectionId(sectionId);
    setEditorRowId(null);
    setEditorTemplateIndex(templateIndex);
    setEditorDraft(base);
    setEditorOpen(true);

    setTimeout(() => refMed.current?.focus(), 20);
  }

  function openEditMedication(sectionId: string, row: MedicationRow) {
    setEditorSectionId(sectionId);
    setEditorRowId(row.id);
    setEditorTemplateIndex(row.templateIndex);
    setEditorDraft({ ...ensureExtraKeys(row) });
    setEditorOpen(true);

    setTimeout(() => refMed.current?.focus(), 20);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorRowId(null);
    setEditorSectionId("");
    setEditorTemplateIndex(undefined);
    setEditorDraft(createEmptyRow());
  }

  function saveEditorCore(): { systemId: string; medication: string } | null {
    const secId = editorSectionId;
    if (!secId) return null;

    const sec = sections.find((s) => s.id === secId);
    const systemId = sec?.systemId ?? "";

    const cleaned: MedicationRow = ensureExtraKeys({
      ...editorDraft,
      templateIndex: editorTemplateIndex,
    });

    setSections((prev) =>
      prev.map((sec2) => {
        if (sec2.id !== secId) return sec2;

        if (editorRowId) {
          return {
            ...sec2,
            rows: sec2.rows.map((r) =>
              r.id === editorRowId ? { ...cleaned, id: editorRowId } : r,
            ),
          };
        }

        return {
          ...sec2,
          rows: [...sec2.rows, { ...cleaned, id: `med-${uid()}` }],
        };
      }),
    );

    if (systemId) addRecent(systemId, cleaned.medication);

    return { systemId, medication: cleaned.medication };
  }

  function saveEditor() {
    saveEditorCore();
    closeEditor();
  }

  function saveAndAddAnother() {
    const res = saveEditorCore();
    if (!res) return;

    setEditorRowId(null);
    setEditorTemplateIndex(undefined);

    const base = createEmptyRow();
    setEditorDraft(base);

    setTimeout(() => refMed.current?.focus(), 20);
  }

  return (
    <div className="min-h-screen">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-card { box-shadow: none !important; border: none !important; background: #ffffff !important; }
          body { background: #ffffff !important; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-40 border-b border-[rgb(var(--border))] bg-[rgba(var(--surface),0.88)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--primary))] font-bold text-white">
              MR
            </div>

            <div className="leading-tight">
              <div className="text-lg font-semibold">Medication Report</div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted))]">
                <span>
                  {systemsLoaded
                    ? `Systems: ${systems.length}`
                    : "Loading systems..."}
                </span>

                <span
                  className={[
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    online
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700",
                  ].join(" ")}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {online ? "Online" : "Offline"}
                </span>

                <span
                  className={[
                    "inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    overall.ready
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : overall.total === 0
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : "border-amber-200 bg-amber-50 text-amber-800",
                  ].join(" ")}
                  title="Completion status"
                >
                  {overall.total === 0
                    ? "No meds"
                    : overall.ready
                      ? "Ready to print"
                      : `${overall.incomplete} incomplete`}
                </span>

                <span className="hidden sm:inline text-[rgb(var(--muted))]">
                  Auto-saved
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={printPdf}
              disabled={!printEnabled}
              className="rounded-xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              title={
                !printEnabled ? "Add medications first" : "Print / Save PDF"
              }
            >
              Print
            </button>

            <button
              onClick={() => setShowMore((p) => !p)}
              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
            >
              More
            </button>

            <button
              onClick={resetAll}
              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
              title="Clear everything"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="border-t border-[rgb(var(--border))] bg-[rgb(var(--surface))]">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
            <TabButton active={tab === "meds"} onClick={() => setTab("meds")}>
              Medications
            </TabButton>

            <TabButton
              active={tab === "patient"}
              onClick={() => setTab("patient")}
            >
              Patient
            </TabButton>

            <TabButton
              active={tab === "review"}
              onClick={() => setTab("review")}
            >
              Review & Notes
            </TabButton>

            <div className="ml-auto flex items-center gap-2">
              <input
                className="w-48 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm sm:w-72"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search meds / system / plan..."
              />
            </div>
          </div>
        </div>

        {showMore && (
          <div className="border-t border-[rgb(var(--border))] bg-[rgb(var(--surface))]">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  value={inputMode}
                  onChange={setInputMode}
                  options={[
                    { value: "smart", label: "Smart" },
                    { value: "pick", label: "Pick" },
                    { value: "type", label: "Type" },
                  ]}
                />

                <Toggle checked={dense} onChange={setDense} label="Compact" />

                <Toggle
                  checked={incompleteOnly}
                  onChange={setIncompleteOnly}
                  label="Incomplete only"
                />
              </div>

              <div className="text-xs text-[rgb(var(--muted))]">
                Tip: In editor: <b>Enter</b> moves forward, <b>Ctrl+Enter</b>{" "}
                saves, <b>Esc</b> closes.
              </div>
            </div>
          </div>
        )}
      </div>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="print-only hidden">
          <div className="print-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <h1 style={{ margin: 0, fontSize: 18 }}>Medication Report</h1>
              <div style={{ fontSize: 11 }}>Printed: {todayISO()}</div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div>
                <b>Patient:</b> {patientName || "__________"}
              </div>
              <div>
                <b>DOB:</b> {dob || "__________"}
              </div>
              <div>
                <b>MRN:</b> {mrn || "__________"}
              </div>
              <div>
                <b>Allergies:</b> {allergies || "__________"}
              </div>
              <div>
                <b>Intolerances:</b> {intolerances || "__________"}
              </div>
              <div>
                <b>Carer:</b> {carer || "__________"}
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div>
                <b>This Review Date:</b> {reviewDate || "__________"}
              </div>
              <div>
                <b>Review completed by:</b> {reviewCompletedBy || "__________"}
              </div>
              <div>
                <b>Treatment Goals:</b> {treatmentGoals || "__________"}
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div>
                <b>Significant Medical & Surgical History:</b>{" "}
                {significantHistory || "__________"}
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div>
                <b>Next Review Date:</b> {nextReviewDate || "__________"}
              </div>
              <div>
                <b>Mode:</b> {nextReviewMode || "__________"}
              </div>
              <div>
                <b>Before Next Review:</b> {beforeNextReview || "__________"}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {sections.map((sec) => {
                const sys = systemById.get(sec.systemId);
                if (!sec.rows?.length) return null;

                return (
                  <div
                    key={sec.id}
                    className="avoid-break"
                    style={{ marginTop: 12 }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {sys?.name || "System"}{" "}
                      <span style={{ fontWeight: 400, fontSize: 11 }}>
                        (Dx: {sec.diagnosis || "____"} | Date:{" "}
                        {sec.diagnosisDate || "____"})
                      </span>
                    </div>

                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 11,
                        marginTop: 6,
                      }}
                    >
                      <thead>
                        <tr>
                          {[
                            "Medication",
                            "Dose",
                            "How",
                            "Purpose",
                            "Plan",
                            ...customColumns.map((c) => c.title),
                          ].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid #111827",
                                padding: "6px 4px",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {sec.rows.map((r) => (
                          <tr key={r.id}>
                            <td
                              style={{
                                borderBottom: "1px solid #E5E7EB",
                                padding: "6px 4px",
                              }}
                            >
                              {r.medication || "____"}
                            </td>
                            <td
                              style={{
                                borderBottom: "1px solid #E5E7EB",
                                padding: "6px 4px",
                              }}
                            >
                              {r.dose || "____"}
                            </td>
                            <td
                              style={{
                                borderBottom: "1px solid #E5E7EB",
                                padding: "6px 4px",
                              }}
                            >
                              {r.how || "____"}
                            </td>
                            <td
                              style={{
                                borderBottom: "1px solid #E5E7EB",
                                padding: "6px 4px",
                              }}
                            >
                              {r.purpose || "____"}
                            </td>
                            <td
                              style={{
                                borderBottom: "1px solid #E5E7EB",
                                padding: "6px 4px",
                              }}
                            >
                              {r.plan || "____"}
                            </td>

                            {customColumns.map((c) => (
                              <td
                                key={c.id}
                                style={{
                                  borderBottom: "1px solid #E5E7EB",
                                  padding: "6px 4px",
                                }}
                              >
                                {r.extra?.[c.id] || "____"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12, fontSize: 12 }}>
              <div>
                <b>Notes:</b> {notes || "__________"}
              </div>
            </div>
          </div>
        </div>

        <div className="no-print space-y-5">
          {tab === "meds" && (
            <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-base font-bold">Medications</div>
                  <div className="text-xs text-[rgb(var(--muted))]">
                    Grouped by system. Fast add/edit from a sheet. Status shows
                    what’s missing.
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm sm:w-72"
                    value={addSystemId}
                    onChange={(e) => setAddSystemId(e.target.value)}
                  >
                    <option value="">Add System...</option>
                    {systems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="rounded-xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={!addSystemId}
                    onClick={() => {
                      addSectionForSystem(addSystemId);
                      setAddSystemId("");
                    }}
                  >
                    Add System
                  </button>
                </div>
              </div>

              <VoiceScribe onApply={applyScribeDraft} />

              <div className="mt-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.55)] p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-semibold">Custom Columns</div>

                  <div className="flex gap-2">
                    <input
                      className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm sm:w-72"
                      value={newColTitle}
                      onChange={(e) => setNewColTitle(e.target.value)}
                      placeholder="e.g. Route / Duration / PRN / Notes..."
                    />

                    <button
                      type="button"
                      className="rounded-xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={!newColTitle.trim()}
                      onClick={addColumn}
                    >
                      Add
                    </button>
                  </div>
                </div>

                {customColumns.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {customColumns.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1 text-xs"
                      >
                        {c.title}
                        <button
                          type="button"
                          className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2 py-0.5 text-xs font-semibold"
                          onClick={() => removeColumn(c.id)}
                          title="Remove column"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-4">
                {filteredSections.length === 0 ? (
                  <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 text-sm text-[rgb(var(--muted))]">
                    No systems yet. Add one from the dropdown above.
                  </div>
                ) : (
                  filteredSections.map(({ sec, rows }) => {
                    const sys = systemById.get(sec.systemId);
                    const secRows = normalize(search) ? rows : sec.rows;

                    const secIncomplete = sec.rows.filter(rowIncomplete).length;
                    const secReady = sec.rows.length > 0 && secIncomplete === 0;

                    return (
                      <div
                        key={sec.id}
                        className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-bold">
                                {sys?.name ?? "System"}
                              </div>

                              <span
                                className={[
                                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                  sec.rows.length === 0
                                    ? "border-slate-200 bg-slate-50 text-slate-600"
                                    : secReady
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-amber-200 bg-amber-50 text-amber-800",
                                ].join(" ")}
                              >
                                {sec.rows.length === 0
                                  ? "No meds"
                                  : secReady
                                    ? "Ready"
                                    : `${secIncomplete} incomplete`}
                              </span>
                            </div>

                            <div className="text-xs text-[rgb(var(--muted))]">
                              Diagnosis + date are per system.
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openCreateMedication(sec.id)}
                              className="rounded-xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
                            >
                              + Add Medication
                            </button>

                            <button
                              type="button"
                              onClick={() => addTemplateRows(sec.id)}
                              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
                              title="Add system template rows"
                            >
                              Add Templates
                            </button>

                            <button
                              type="button"
                              onClick={() => removeSection(sec.id)}
                              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
                              title="Remove system"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <LabeledInput
                            label="Diagnosis"
                            value={sec.diagnosis}
                            onChange={(v) =>
                              updateSection(sec.id, { diagnosis: v })
                            }
                          />

                          <LabeledDate
                            label="Diagnosis date"
                            value={sec.diagnosisDate}
                            onChange={(v) =>
                              updateSection(sec.id, { diagnosisDate: v })
                            }
                          />
                        </div>

                        <div className="mt-4 hidden md:block">
                          <div className="overflow-x-auto rounded-2xl border border-[rgb(var(--border))]">
                            <table
                              className={[
                                "min-w-[980px] w-full",
                                dense ? "text-[13px]" : "text-sm",
                              ].join(" ")}
                            >
                              <thead className="bg-[rgba(var(--card),0.6)] text-xs text-[rgb(var(--muted))]">
                                <tr>
                                  <th className="px-3 py-2 text-left">
                                    Medication
                                  </th>
                                  <th className="px-3 py-2 text-left">Dose</th>
                                  <th className="px-3 py-2 text-left">How</th>
                                  <th className="px-3 py-2 text-left">
                                    Purpose
                                  </th>
                                  <th className="px-3 py-2 text-left">Plan</th>
                                  {customColumns.map((c) => (
                                    <th
                                      key={c.id}
                                      className="px-3 py-2 text-left"
                                    >
                                      {c.title}
                                    </th>
                                  ))}
                                  <th className="px-3 py-2 text-left">
                                    Actions
                                  </th>
                                </tr>
                              </thead>

                              <tbody>
                                {secRows.length === 0 ? (
                                  <tr>
                                    <td
                                      colSpan={6 + customColumns.length}
                                      className="px-3 py-4 text-sm text-[rgb(var(--muted))]"
                                    >
                                      No medications yet. Click “Add
                                      Medication”.
                                    </td>
                                  </tr>
                                ) : (
                                  secRows.map((r) => {
                                    const incomplete = rowIncomplete(r);

                                    return (
                                      <tr
                                        key={r.id}
                                        className={[
                                          "border-t border-[rgb(var(--border))]",
                                          incomplete ? "bg-amber-50" : "",
                                        ].join(" ")}
                                      >
                                        <td className="px-3 py-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openEditMedication(sec.id, r)
                                            }
                                            className="w-full text-left"
                                          >
                                            <div className="font-semibold">
                                              {r.medication || (
                                                <span className="text-[rgb(var(--muted))]">
                                                  Click to edit…
                                                </span>
                                              )}
                                            </div>
                                          </button>
                                        </td>

                                        <td className="px-3 py-2">
                                          {r.dose || (
                                            <span className="text-[rgb(var(--muted))]">
                                              —
                                            </span>
                                          )}
                                        </td>

                                        <td className="px-3 py-2">
                                          {r.how || (
                                            <span className="text-[rgb(var(--muted))]">
                                              —
                                            </span>
                                          )}
                                        </td>

                                        <td className="px-3 py-2">
                                          {r.purpose || (
                                            <span className="text-[rgb(var(--muted))]">
                                              —
                                            </span>
                                          )}
                                        </td>

                                        <td className="px-3 py-2">
                                          {r.plan || (
                                            <span className="text-[rgb(var(--muted))]">
                                              —
                                            </span>
                                          )}
                                        </td>

                                        {customColumns.map((c) => (
                                          <td key={c.id} className="px-3 py-2">
                                            {r.extra?.[c.id] || (
                                              <span className="text-[rgb(var(--muted))]">
                                                —
                                              </span>
                                            )}
                                          </td>
                                        ))}

                                        <td className="px-3 py-2">
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openEditMedication(sec.id, r)
                                              }
                                              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold"
                                            >
                                              Edit
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() =>
                                                duplicateRow(sec.id, r.id)
                                              }
                                              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold"
                                            >
                                              Duplicate
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() =>
                                                deleteRow(sec.id, r.id)
                                              }
                                              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold"
                                            >
                                              Delete
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="mt-4 space-y-3 md:hidden">
                          {secRows.length === 0 ? (
                            <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 text-sm text-[rgb(var(--muted))]">
                              No medications yet.
                            </div>
                          ) : (
                            secRows.map((r) => {
                              const incomplete = rowIncomplete(r);

                              return (
                                <details
                                  key={r.id}
                                  className={[
                                    "rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4",
                                    incomplete ? "ring-1 ring-amber-200" : "",
                                  ].join(" ")}
                                >
                                  <summary className="list-none cursor-pointer">
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <div className="font-semibold">
                                          {r.medication ||
                                            "Medication (tap to edit)"}
                                        </div>
                                        <div className="text-xs text-[rgb(var(--muted))]">
                                          {r.dose || "Dose —"} •{" "}
                                          {r.how || "How —"}
                                        </div>
                                      </div>

                                      <span className="text-xs text-[rgb(var(--muted))]">
                                        Expand
                                      </span>
                                    </div>
                                  </summary>

                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEditMedication(sec.id, r)
                                      }
                                      className="rounded-xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
                                    >
                                      Edit
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => duplicateRow(sec.id, r.id)}
                                      className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
                                    >
                                      Duplicate
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => deleteRow(sec.id, r.id)}
                                      className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
                                    >
                                      Delete
                                    </button>
                                  </div>

                                  <div className="mt-3 text-sm">
                                    <div>
                                      <b>Purpose:</b> {r.purpose || "—"}
                                    </div>
                                    <div>
                                      <b>Plan:</b> {r.plan || "—"}
                                    </div>

                                    {customColumns.map((c) => (
                                      <div key={c.id}>
                                        <b>{c.title}:</b>{" "}
                                        {r.extra?.[c.id] || "—"}
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {tab === "patient" && (
            <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4">
              <div className="text-sm font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
                Patient Information
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card title="Demographics">
                  <Grid2>
                    <LabeledInput
                      label="Patient name"
                      value={patientName}
                      onChange={setPatientName}
                    />

                    <LabeledDate
                      label="Date of birth"
                      value={dob}
                      onChange={setDob}
                    />

                    <LabeledInput label="MRN" value={mrn} onChange={setMrn} />

                    <LabeledInput
                      label="Carer"
                      value={carer}
                      onChange={setCarer}
                    />

                    <LabeledInput
                      label="Allergies"
                      value={allergies}
                      onChange={setAllergies}
                    />

                    <LabeledInput
                      label="Intolerances"
                      value={intolerances}
                      onChange={setIntolerances}
                    />
                  </Grid2>
                </Card>

                <Card title="Significant Medical & Surgical History">
                  <textarea
                    className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm"
                    rows={10}
                    value={significantHistory}
                    onChange={(e) => setSignificantHistory(e.target.value)}
                  />
                </Card>
              </div>
            </div>
          )}

          {tab === "review" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4">
                <div className="text-sm font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Review
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Card title="Review Details">
                    <Grid2>
                      <LabeledDate
                        label="This Review Date"
                        value={reviewDate}
                        onChange={setReviewDate}
                      />

                      <LabeledInput
                        label="Review completed by"
                        value={reviewCompletedBy}
                        onChange={setReviewCompletedBy}
                      />
                    </Grid2>

                    <div className="mt-3">
                      <label className="mb-1 block text-sm font-semibold">
                        Treatment Goals
                      </label>

                      <textarea
                        className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm"
                        rows={5}
                        value={treatmentGoals}
                        onChange={(e) => setTreatmentGoals(e.target.value)}
                      />
                    </div>
                  </Card>

                  <Card title="Next Review">
                    <div className="grid grid-cols-1 gap-3">
                      <LabeledDate
                        label="Date"
                        value={nextReviewDate}
                        onChange={setNextReviewDate}
                      />

                      <div>
                        <label className="mb-1 block text-sm font-semibold">
                          In-person / Video
                        </label>

                        <select
                          className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm"
                          value={nextReviewMode}
                          onChange={(e) =>
                            setNextReviewMode(
                              e.target.value as "" | "In-person" | "Video",
                            )
                          }
                        >
                          <option value="">Select...</option>
                          <option value="In-person">In-person</option>
                          <option value="Video">Video</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold">
                          Before Next Review
                        </label>

                        <textarea
                          className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm"
                          rows={5}
                          value={beforeNextReview}
                          onChange={(e) => setBeforeNextReview(e.target.value)}
                        />
                      </div>
                    </div>
                  </Card>
                </div>
              </div>

              <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4">
                <div className="text-sm font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
                  Notes
                </div>

                <textarea
                  className="mt-3 w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm"
                  rows={6}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {editorOpen && (
        <EditorOverlay
          onClose={closeEditor}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              saveEditor();
              return;
            }

            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              const el = document.activeElement as HTMLElement | null;

              const step = () => {
                if (el === refMed.current) refDose.current?.focus();
                else if (el === refDose.current) refHow.current?.focus();
                else if (el === refHow.current) refPurpose.current?.focus();
                else if (el === refPurpose.current) refPlan.current?.focus();
              };

              const tag = (el?.tagName || "").toLowerCase();
              if (tag === "input" || tag === "select") {
                e.preventDefault();
                step();
              }
            }
          }}
        >
          <MedicationEditor
            title={editorRowId ? "Edit Medication" : "Add Medication"}
            inputMode={inputMode}
            setInputMode={setInputMode}
            dense={dense}
            setDense={setDense}
            systemName={
              systemById.get(
                sections.find((s) => s.id === editorSectionId)?.systemId ?? "",
              )?.name ?? ""
            }
            systemId={
              sections.find((s) => s.id === editorSectionId)?.systemId ?? ""
            }
            options={(() => {
              const sec = sections.find((s) => s.id === editorSectionId);
              if (!sec) {
                return {
                  medication_options: [],
                  dose_options: [],
                  how_options: [],
                  purpose_options: [],
                  plan_options: [],
                } as RowTemplate;
              }
              return getOptions(sec.systemId, editorTemplateIndex);
            })()}
            customColumns={customColumns}
            customSuggestions={customColumnSuggestions}
            recents={recents}
            favs={favs}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            draft={editorDraft}
            setDraft={setEditorDraft}
            onSave={saveEditor}
            onSaveAddAnother={saveAndAddAnother}
            onCancel={closeEditor}
            refs={{
              med: refMed,
              dose: refDose,
              how: refHow,
              purpose: refPurpose,
              plan: refPlan,
            }}
          />
        </EditorOverlay>
      )}

      {toast && (
        <div className="no-print fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3 shadow-[0_10px_30px_rgba(2,8,23,0.18)]">
            <div className="text-sm">{toast.message}</div>

            {toast.onUndo && (
              <button
                type="button"
                onClick={() => {
                  toast.onUndo?.();
                  setToast(null);
                }}
                className="rounded-xl bg-[rgb(var(--primary))] px-3 py-2 text-xs font-semibold text-white"
              >
                {toast.undoLabel ?? "Undo"}
              </button>
            )}

            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== UI Components ===================== */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl border px-4 py-2 text-sm font-semibold",
        active
          ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary))] text-white"
          : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-[rgb(var(--primary))]" />
        <div className="text-sm font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
          {title}
        </div>
      </div>
      {children}
    </section>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold">{label}</label>
      <input
        className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function LabeledDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold">{label}</label>
      <input
        className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm"
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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
              "px-3 py-2 text-sm font-semibold",
              active
                ? "bg-[rgb(var(--primary))] text-white"
                : "bg-transparent text-[rgb(var(--muted))] hover:bg-[rgba(var(--surface),0.7)]",
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
          ? "border-[rgb(var(--border))] bg-[rgba(var(--primary),0.10)] text-[rgb(var(--text))]"
          : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]",
      ].join(" ")}
      aria-pressed={checked}
    >
      <span
        className={[
          "relative h-4 w-7 rounded-full border",
          checked
            ? "border-[rgba(var(--primary),0.35)] bg-[rgba(var(--primary),0.25)]"
            : "border-[rgb(var(--border))] bg-[rgb(var(--card))]",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full",
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

function EditorOverlay({
  children,
  onClose,
  onKeyDown,
}: {
  children: React.ReactNode;
  onClose: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />

      <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center">
        <div className="w-full md:max-w-2xl md:rounded-2xl md:shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
          {children}
        </div>
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
        className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm disabled:opacity-60"
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
  preferSmartDropdown,
  inputRef,
}: {
  mode: InputMode;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  preferSmartDropdown?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
}) {
  const baseClass =
    "w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-2 text-sm disabled:opacity-60";

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
        className={baseClass}
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

  if (mode === "smart" && options.length > 0 && preferSmartDropdown) {
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
      className={baseClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

function MedicationEditor({
  title,
  inputMode,
  setInputMode,
  dense,
  setDense,
  systemName,
  systemId,
  options,
  customColumns,
  customSuggestions,
  recents,
  favs,
  isFavorite,
  toggleFavorite,
  draft,
  setDraft,
  onSave,
  onSaveAddAnother,
  onCancel,
  refs,
}: {
  title: string;
  inputMode: InputMode;
  setInputMode: (m: InputMode) => void;
  dense: boolean;
  setDense: (v: boolean) => void;
  systemName: string;
  systemId: string;
  options: RowTemplate;
  customColumns: CustomColumn[];
  customSuggestions: Record<string, string[]>;
  recents: MapList;
  favs: MapList;
  isFavorite: (systemId: string, med: string) => boolean;
  toggleFavorite: (systemId: string, med: string) => void;
  draft: MedicationRow;
  setDraft: (r: MedicationRow) => void;
  onSave: () => void;
  onSaveAddAnother: () => void;
  onCancel: () => void;
  refs: {
    med: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
    dose: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
    how: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
    purpose: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
    plan: React.RefObject<HTMLInputElement | HTMLSelectElement | null>;
  };
}) {
  const pad = dense ? "p-4" : "p-5";

  const recentList = recents[systemId] ?? [];
  const favList = favs[systemId] ?? [];

  return (
    <div
      className={[
        "border border-[rgb(var(--border))] bg-[rgb(var(--surface))] md:rounded-2xl",
        pad,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{title}</div>
          <div className="text-xs text-[rgb(var(--muted))]">
            {systemName ? `System: ${systemName}` : "System"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Toggle checked={dense} onChange={setDense} label="Compact" />
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
          >
            Close
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
          Input mode
        </div>

        <Segmented
          value={inputMode}
          onChange={setInputMode}
          options={[
            { value: "smart", label: "Smart" },
            { value: "pick", label: "Pick" },
            { value: "type", label: "Type" },
          ]}
        />
      </div>

      {(favList.length > 0 || recentList.length > 0) && (
        <div className="mt-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.55)] p-4">
          {favList.length > 0 && (
            <>
              <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
                Favorites
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {favList.slice(0, 10).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1 text-xs font-semibold"
                    onClick={() => setDraft({ ...draft, medication: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}

          {recentList.length > 0 && (
            <>
              <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
                Recent
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {recentList.slice(0, 10).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1 text-xs font-semibold"
                    onClick={() => setDraft({ ...draft, medication: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <label className="mb-1 block text-sm font-semibold">
              Medication
            </label>

            <button
              type="button"
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1 text-xs font-semibold"
              onClick={() => toggleFavorite(systemId, draft.medication)}
              title="Toggle favorite"
            >
              {isFavorite(systemId, draft.medication)
                ? "★ Favorite"
                : "☆ Favorite"}
            </button>
          </div>

          <FieldInput
            mode={inputMode}
            value={draft.medication}
            onChange={(v) => setDraft({ ...draft, medication: v })}
            options={options.medication_options}
            placeholder="Medication..."
            disabled={false}
            preferSmartDropdown
            inputRef={refs.med}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">Dose</label>
          <FieldInput
            mode={inputMode}
            value={draft.dose}
            onChange={(v) => setDraft({ ...draft, dose: v })}
            options={options.dose_options}
            placeholder="Dose..."
            disabled={false}
            preferSmartDropdown
            inputRef={refs.dose}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">How</label>
          <FieldInput
            mode={inputMode}
            value={draft.how}
            onChange={(v) => setDraft({ ...draft, how: v })}
            options={options.how_options}
            placeholder="How..."
            disabled={false}
            preferSmartDropdown
            inputRef={refs.how}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">Purpose</label>
          <FieldInput
            mode={inputMode}
            value={draft.purpose}
            onChange={(v) => setDraft({ ...draft, purpose: v })}
            options={options.purpose_options}
            placeholder="Purpose..."
            disabled={false}
            preferSmartDropdown
            inputRef={refs.purpose}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-semibold">Plan</label>
          <FieldInput
            mode={inputMode}
            value={draft.plan}
            onChange={(v) => setDraft({ ...draft, plan: v })}
            options={options.plan_options}
            placeholder="Plan..."
            disabled={false}
            preferSmartDropdown
            inputRef={refs.plan}
          />
        </div>
      </div>

      {customColumns.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgba(var(--card),0.55)] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--muted))]">
            Custom Fields
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {customColumns.map((c) => (
              <div key={c.id}>
                <label className="mb-1 block text-sm font-semibold">
                  {c.title}
                </label>

                <FieldInput
                  mode={inputMode}
                  value={draft.extra?.[c.id] ?? ""}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      extra: { ...(draft.extra ?? {}), [c.id]: v },
                    })
                  }
                  options={customSuggestions[c.id] ?? []}
                  placeholder={`${c.title}...`}
                  disabled={false}
                  preferSmartDropdown
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={onSaveAddAnother}
          className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold"
          title="Save then keep adding meds"
        >
          Save & Add another
        </button>

        <button
          type="button"
          onClick={onSave}
          className="rounded-xl bg-[rgb(var(--primary))] px-5 py-2 text-sm font-semibold text-white"
        >
          Save
        </button>
      </div>
    </div>
  );
}
