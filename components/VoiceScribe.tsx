"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

export type ScribeDraft = {
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
  timings?: {
    totalMs?: number;
    byStep?: Record<string, number>;
    steps?: Array<{ step: string; ms: number }>;
  };
};

type TranscribeResult = {
  text?: string;
  mixedText?: string;
  language?: string;
  languageHint?: string;
  duration?: number | null;
  model?: string;
  error?: string;
};

type VoiceScribeProps = {
  onApplyDraft: (draft: ScribeDraft) => void;
};

function compactText(value: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function formatMs(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unexpected request failure.";
}

export default function VoiceScribe({ onApplyDraft }: VoiceScribeProps) {
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<ScribeDraft | null>(null);
  const [languageHint, setLanguageHint] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [transcribeModel, setTranscribeModel] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [audioFileName, setAudioFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(
    "Record audio, upload a file, or paste a transcript, then extract the structured draft.",
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current?.stop?.();
    };
  }, []);

  const metrics = useMemo(() => {
    const words = transcript
      ? transcript.split(/\s+/).filter(Boolean).length
      : 0;
    return {
      words,
      meds: draft?.medications.length || 0,
      warnings: draft?.warnings.length || 0,
    };
  }, [draft, transcript]);

  async function transcribeBlob(blob: Blob, fileName: string) {
    setError(null);
    setIsTranscribing(true);
    setStatus("Transcribing audio...");
    setAudioFileName(fileName);

    try {
      const formData = new FormData();
      formData.append("file", blob, fileName || `dictation-${Date.now()}.webm`);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const payload = (await res.json()) as TranscribeResult;
      if (!res.ok) {
        throw new Error(payload.error || "Transcription failed.");
      }

      const nextTranscript = compactText(
        payload.mixedText || payload.text || "",
      );
      setTranscript(nextTranscript);
      setLanguageHint(
        compactText(payload.languageHint || payload.language || ""),
      );
      setDuration(
        typeof payload.duration === "number" ? payload.duration : null,
      );
      setTranscribeModel(compactText(payload.model || ""));
      setStatus(
        "Transcript ready. Extract the structured draft when you are ready.",
      );
    } catch (err) {
      setError(readErrorMessage(err));
      setStatus("Audio transcription failed.");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function startRecording() {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support audio recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (blob.size) {
          await transcribeBlob(blob, `dictation-${Date.now()}.webm`);
        }
      };

      recorder.start();
      setIsRecording(true);
      setStatus("Recording... stop when the dictation is done.");
    } catch (err) {
      setError(readErrorMessage(err));
      setStatus("Could not start recording.");
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;
    setIsRecording(false);
    setStatus("Stopping recording and preparing upload...");
    mediaRecorderRef.current.stop();
  }

  async function handleFileSelect(file: File | null) {
    if (!file) return;
    await transcribeBlob(file, file.name);
  }

  async function extractDraft() {
    const cleanedTranscript = compactText(transcript);
    if (!cleanedTranscript) {
      setError("Add or generate a transcript first.");
      return;
    }

    setError(null);
    setIsExtracting(true);
    setStatus("Extracting structured medical draft and AI clinical support...");

    try {
      const res = await fetch("/api/scribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: cleanedTranscript }),
      });

      const payload = (await res.json()) as ScribeDraft & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Structured extraction failed.");
      }

      const nextDraft = {
        ...payload,
        transcript: cleanedTranscript,
      };

      setDraft(nextDraft);
      setStatus(
        "Structured draft ready. Review it, then apply it to the form.",
      );
    } catch (err) {
      setError(readErrorMessage(err));
      setStatus("Structured extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <section className="glass-card print-card overflow-hidden">
      <div className="border-b border-[rgb(var(--border))] bg-[linear-gradient(135deg,rgba(var(--primary),0.08),rgba(var(--primary),0.02))] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="kicker">Voice intake</div>
            <h2 className="mt-2 text-xl font-bold text-[rgb(var(--text))]">
              Dictation, transcript cleanup, and AI extraction
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[rgb(var(--muted))]">
              The transcript can stay mixed Arabic and English. The AI then
              extracts as many structured fields as it can, plus an internal
              clinical support note that stays out of the printable report.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:min-w-[360px]">
            <div className="metric-card">
              <div className="metric-label">Transcript words</div>
              <div className="metric-value">{metrics.words}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Med rows</div>
              <div className="metric-value">{metrics.meds}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Warnings</div>
              <div className="metric-value">{metrics.warnings}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.9fr]">
          <div className="section-card space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {!isRecording ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startRecording}
                  disabled={isTranscribing || isExtracting}
                >
                  Start recording
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={stopRecording}
                >
                  Stop recording
                </button>
              )}

              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRecording || isTranscribing}
              >
                Upload audio
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={extractDraft}
                disabled={
                  isTranscribing || isExtracting || !compactText(transcript)
                }
              >
                {isExtracting ? "Extracting..." : "Extract structured draft"}
              </button>

              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.webm"
                onChange={(event) =>
                  handleFileSelect(event.target.files?.[0] || null)
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="chip">Status: {status}</div>
              <div className="chip">Language hint: {languageHint || "—"}</div>
              <div className="chip">
                Duration: {duration ? `${duration.toFixed(1)} s` : "—"}
              </div>
              <div className="chip">
                Source:{" "}
                {audioFileName || transcribeModel || "Manual transcript"}
              </div>
            </div>

            <div>
              <label className="field-label">Transcript</label>
              <textarea
                className="field-textarea min-h-[260px]"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder="Paste or record the bilingual transcript here."
              />
              <div className="field-hint">
                Edit the transcript if the ASR missed wording, then run
                extraction again.
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-[rgba(var(--danger),0.2)] bg-[rgba(var(--danger),0.06)] px-4 py-3 text-sm text-[rgb(var(--danger))]">
                {error}
              </div>
            ) : null}
          </div>

          <div className="section-card space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="field-label mb-0">
                  Structured draft snapshot
                </div>
                <div className="field-hint mt-1">
                  Quick read before applying it to the main form.
                </div>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => draft && onApplyDraft(draft)}
                disabled={!draft}
              >
                Apply to form
              </button>
            </div>

            {draft ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="metric-card">
                    <div className="metric-label">Patient</div>
                    <div className="mt-1 text-base font-semibold">
                      {draft.patientName || "—"}
                    </div>
                    <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                      MRN {draft.caseNumber || "—"} • {draft.sex || "—"} •{" "}
                      {draft.age || "—"}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Likely diagnosis</div>
                    <div className="mt-1 text-base font-semibold">
                      {draft.aiClinicalSupport?.likelyDiagnosis ||
                        draft.diagnosisHints[0] ||
                        "—"}
                    </div>
                    <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                      Confidence: {draft.aiClinicalSupport?.confidence || "—"}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4">
                  <div className="text-sm font-semibold">
                    Internal AI clinical support
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[rgb(var(--muted))]">
                    {draft.aiClinicalSupport?.summary ||
                      draft.aiSuggestion ||
                      "No AI clinical support generated."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4">
                    <div className="text-sm font-semibold">
                      Documented medications
                    </div>
                    <ul className="mt-2 space-y-2 text-sm text-[rgb(var(--muted))]">
                      {draft.medications.length ? (
                        draft.medications.map((item, index) => (
                          <li key={`${item.medication}-${index}`}>
                            {item.medication ||
                              item.rawMedication ||
                              "Unnamed medication"}
                            {item.dose ? ` • ${item.dose}` : ""}
                            {item.how ? ` • ${item.how}` : ""}
                          </li>
                        ))
                      ) : (
                        <li>—</li>
                      )}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4">
                    <div className="text-sm font-semibold">Server timings</div>
                    <ul className="mt-2 space-y-2 text-sm text-[rgb(var(--muted))]">
                      {draft.timings?.steps?.length ? (
                        draft.timings.steps.map((step) => (
                          <li key={step.step}>
                            {step.step}: {formatMs(step.ms)}
                          </li>
                        ))
                      ) : (
                        <li>Total: {formatMs(draft.timings?.totalMs)}</li>
                      )}
                    </ul>
                  </div>
                </div>

                {draft.warnings.length ? (
                  <div className="rounded-2xl border border-[rgba(var(--warning),0.25)] bg-[rgba(var(--warning),0.08)] p-4 text-sm text-[rgb(var(--text))]">
                    <div className="font-semibold">Warnings</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[rgb(var(--muted))]">
                      {draft.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--surface-alt))] p-6 text-sm text-[rgb(var(--muted))]">
                No draft yet. Humans call this the waiting room.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
