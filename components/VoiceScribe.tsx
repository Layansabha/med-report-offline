"use client";

import { useMemo, useRef, useState } from "react";

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

export type AiClinicalSupport = {
  summary: string;
  likelyDiagnosis: string;
  reasoning: string;
  currentTreatment: string;
  nextSteps: string[];
  redFlags: string[];
  confidence: "low" | "medium" | "high";
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
  nextReviewMode: string;
  beforeNextReview: string;
  notes: string;
  medications: ScribeMedication[];
  warnings: string[];
  aiClinicalSupport: AiClinicalSupport;
};

type Props = {
  onApplyDraft: (draft: ScribeDraft) => void;
};

type TranscribeResponse = {
  text?: string;
  mixedText?: string;
  language?: string;
  languageHint?: string;
  error?: string;
};

type ScribeResponse = ScribeDraft & {
  error?: string;
};

function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "Unexpected error.");
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || "Invalid server response.");
  }
}

export default function VoiceScribe({ onApplyDraft }: Props) {
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<ScribeDraft | null>(null);
  const [status, setStatus] = useState(
    "Ready for dictation or pasted transcript.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const warnings = useMemo(() => draft?.warnings ?? [], [draft]);

  async function transcribeBlob(blob: Blob, fileName: string) {
    setError(null);
    setStatus("Transcribing audio...");
    setIsTranscribing(true);

    try {
      const form = new FormData();
      form.append("file", blob, fileName);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      });
      const payload = await parseJsonResponse<TranscribeResponse>(res);
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Audio transcription failed.");
      }

      const nextTranscript = (payload.mixedText || payload.text || "").trim();
      setTranscript(nextTranscript);
      setStatus(
        payload.languageHint
          ? `Transcript ready (${payload.languageHint}). Review it, then run extraction.`
          : "Transcript ready. Review it, then run extraction.",
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
      setStatus("Recording... press stop when finished.");
    } catch (err) {
      setError(readErrorMessage(err));
      setStatus("Microphone access failed.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setStatus("Processing recording...");
  }

  async function extractDraft() {
    const cleanTranscript = transcript.trim();
    setError(null);
    if (!cleanTranscript) {
      setError("Add or transcribe a transcript first.");
      return;
    }

    setIsExtracting(true);
    setStatus("Extracting structured draft...");

    try {
      const res = await fetch("/api/scribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: cleanTranscript }),
      });
      const payload = await parseJsonResponse<ScribeResponse>(res);
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Structured extraction failed.");
      }
      setDraft(payload);
      setStatus(
        "Structured draft ready. Apply it to the form when it looks right.",
      );
    } catch (err) {
      setError(readErrorMessage(err));
      setStatus("Structured extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <section className="panel panel-lg">
      <div className="section-head">
        <div>
          <p className="eyebrow">Voice intake</p>
          <h2>Transcript and AI extraction</h2>
          <p className="muted">
            Record mixed Arabic and English dictation, or paste a transcript
            directly.
          </p>
        </div>
        <div className="toolbar-row">
          {!isRecording ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={startRecording}
              disabled={isTranscribing || isExtracting}
            >
              Start recording
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              onClick={stopRecording}
            >
              Stop recording
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isTranscribing || isExtracting}
          >
            Upload audio
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={extractDraft}
            disabled={isTranscribing || isExtracting || !transcript.trim()}
          >
            {isExtracting ? "Extracting..." : "Run extraction"}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          await transcribeBlob(file, file.name);
          event.currentTarget.value = "";
        }}
      />

      <label className="field-block">
        <span className="field-label">Transcript</span>
        <textarea
          className="textarea transcript-area"
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder="Paste or transcribe the clinical dictation here."
          rows={7}
        />
        <span className="field-hint">
          Edit the transcript if ASR missed wording, then run extraction again.
        </span>
      </label>

      <div className="status-row">
        <p className="muted">{status}</p>
        {error ? <p className="error-text">{error}</p> : null}
      </div>

      {warnings.length ? (
        <div className="notice warning">
          <strong>Extraction warnings</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft ? (
        <div className="snapshot-grid">
          <div className="snapshot-card">
            <p className="eyebrow">Patient</p>
            <h3>{draft.patientName || "—"}</h3>
            <p className="muted">
              {draft.caseNumber ? `MRN ${draft.caseNumber}` : "MRN —"}
              {draft.age ? ` • ${draft.age}` : ""}
              {draft.sex ? ` • ${draft.sex}` : ""}
            </p>
          </div>
          <div className="snapshot-card">
            <p className="eyebrow">Likely diagnosis</p>
            <h3>
              {draft.aiClinicalSupport.likelyDiagnosis ||
                draft.diagnosisHints[0] ||
                "—"}
            </h3>
            <p className="muted">
              Confidence: {draft.aiClinicalSupport.confidence || "low"}
            </p>
          </div>
          <div className="snapshot-card snapshot-card-wide">
            <div className="row-between">
              <div>
                <p className="eyebrow">Internal AI clinical support</p>
                <p className="muted">
                  Visible inside the app only. It will not print in the PDF.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onApplyDraft(draft)}
              >
                Apply to form
              </button>
            </div>
            <p>
              {draft.aiClinicalSupport.summary ||
                "No internal support generated."}
            </p>
            {draft.medications.length ? (
              <div className="pill-list">
                {draft.medications.map((medication, index) => {
                  const text = [
                    medication.medication || medication.rawMedication,
                    medication.dose,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <span key={`${text}-${index}`} className="pill">
                      {text}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
