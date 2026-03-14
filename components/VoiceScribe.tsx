"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type ExtractionJobStatus = "queued" | "processing" | "done" | "error";
type UiPhase = "idle" | "recording" | "processing" | "applied" | "error";

const SCRIBE_STORAGE_KEY = "imr_v5_scribe_ui";

export type ScribeMedication = {
  systemId: string;
  diagnosis: string;
  rawMedication?: string;
  medication: string;
  dose: string;
  how: string;
  purpose: string;
  plan: string;
};

export type ScribeDraft = {
  transcript?: string;
  patientName?: string;
  caseNumber?: string;
  dob?: string;
  age?: string;
  sex?: string;
  occupation?: string;
  supervisingDoctor?: string;
  carer?: string;
  allergies?: string;
  intolerances?: string;
  chiefComplaint?: string;
  significantHistory?: string;
  associatedSymptoms?: string[];
  examFindings?: string;
  labSummary?: string;
  imagingSummary?: string;
  diagnosisHints?: string[];
  reviewCompletedBy?: string;
  treatmentGoals?: string;
  nextReviewDate?: string;
  nextReviewMode?: "In-person" | "Video" | "";
  beforeNextReview?: string;
  notes?: string;
  aiSuggestion?: string;
  medications?: ScribeMedication[];
  warnings?: string[];
};

type VoiceScribeProps = {
  onApply?: (draft: ScribeDraft) => void;
  resetSignal?: number;
};

type PersistedScribeState = {
  phase: UiPhase;
  transcript: string;
  detectedLanguage: string;
  jobId: string;
  jobStatus: ExtractionJobStatus | "";
  result: ScribeDraft | null;
  error: string;
};

function pickSupportedMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/ogg;codecs=opus",
  ];

  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return "";
}

function fileExtensionFromMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  return "webm";
}

function summarizeAppliedResult(result: ScribeDraft | null) {
  if (!result) return "";

  const parts: string[] = [];
  if (result.patientName?.trim()) parts.push("patient name");
  if (result.caseNumber?.trim()) parts.push("case number");
  if (result.occupation?.trim()) parts.push("occupation");
  if (result.supervisingDoctor?.trim()) parts.push("supervising doctor");
  if (result.significantHistory?.trim()) parts.push("history");
  if (result.aiSuggestion?.trim()) parts.push("AI suggestion");
  if ((result.medications?.length ?? 0) > 0) {
    parts.push(
      `${result.medications!.length} medication${result.medications!.length > 1 ? "s" : ""}`,
    );
  }

  return parts.join(" • ");
}

export default function VoiceScribe({
  onApply,
  resetSignal = 0,
}: VoiceScribeProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState<ExtractionJobStatus | "">("");
  const [result, setResult] = useState<ScribeDraft | null>(null);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const pollTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasHydratedRef = useRef(false);

  const clearPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const cleanupMedia = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.onerror = null;
      if (mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
    }

    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
  };

  const hardReset = () => {
    clearPolling();
    cleanupMedia();
    setIsRecording(false);
    setIsStopping(false);
    setIsTranscribing(false);
    setPhase("idle");
    setTranscript("");
    setDetectedLanguage("");
    setJobId("");
    setJobStatus("");
    setResult(null);
    setError("");
    try {
      localStorage.removeItem(SCRIBE_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const pollJob = async (currentJobId: string) => {
    try {
      const res = await fetch(`/api/scribe/jobs/${currentJobId}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch extraction job.");
      }

      setJobStatus(data.status);

      if (data.status === "done") {
        clearPolling();
        setResult(data.result);
        setPhase("applied");
        setError("");
        onApply?.(data.result);
        return;
      }

      if (data.status === "error") {
        clearPolling();
        setError(data.error || "Extraction failed.");
        setPhase("error");
        return;
      }

      setPhase("processing");
      pollTimerRef.current = window.setTimeout(() => {
        void pollJob(currentJobId);
      }, 1200);
    } catch (err) {
      clearPolling();
      setError(err instanceof Error ? err.message : "Polling failed.");
      setPhase("error");
    }
  };

  const submitExtraction = async (rawTranscript: string) => {
    const cleaned = rawTranscript.trim();
    if (!cleaned) {
      throw new Error("No transcript was returned.");
    }

    setJobId("");
    setJobStatus("queued");
    setResult(null);
    setPhase("processing");

    const res = await fetch("/api/scribe/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: cleaned }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Failed to create extraction job.");
    }

    setJobId(data.jobId);
    setJobStatus(data.status);
    await pollJob(data.jobId);
  };

  const transcribeBlob = async (blob: Blob, explicitFileName?: string) => {
    try {
      setIsTranscribing(true);
      setError("");
      setResult(null);
      setJobId("");
      setJobStatus("");
      setDetectedLanguage("");
      setPhase("processing");

      const mimeType = blob.type || "audio/webm";
      const ext = fileExtensionFromMimeType(mimeType);
      const generatedFileName =
        explicitFileName || `visit-${Date.now()}.${ext}`;
      const file =
        blob instanceof File
          ? blob
          : new File([blob], generatedFileName, { type: mimeType });

      const formData = new FormData();
      formData.append("file", file, file.name);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Transcription failed.");
      }

      const finalTranscript =
        typeof data?.mixedText === "string"
          ? data.mixedText.trim()
          : typeof data?.text === "string"
            ? data.text.trim()
            : "";

      setTranscript(finalTranscript);
      setDetectedLanguage(
        typeof data?.languageHint === "string"
          ? data.languageHint
          : typeof data?.language === "string"
            ? data.language
            : "",
      );

      if (!finalTranscript) {
        throw new Error("No transcript was returned from the audio.");
      }

      await submitExtraction(finalTranscript);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unexpected transcription error.",
      );
      setPhase("error");
    } finally {
      setIsTranscribing(false);
      setIsRecording(false);
      setIsStopping(false);
      cleanupMedia();
    }
  };

  const startRecording = async () => {
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        throw new Error("This browser does not support audio recording.");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder is not supported on this device.");
      }

      clearPolling();
      setError("");
      setResult(null);
      setTranscript("");
      setDetectedLanguage("");
      setJobId("");
      setJobStatus("");
      setPhase("idle");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const mimeType = pickSupportedMimeType();
      const options: MediaRecorderOptions = mimeType
        ? { mimeType, audioBitsPerSecond: 32000 }
        : { audioBitsPerSecond: 32000 };

      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event: Event) => {
        const maybeEvent = event as Event & { error?: { message?: string } };
        setError(maybeEvent.error?.message || "Recording failed.");
        setPhase("error");
        setIsRecording(false);
        setIsStopping(false);
        cleanupMedia();
      };

      recorder.onstop = () => {
        const finalMimeType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        if (!blob.size) {
          setError("The recording is empty.");
          setPhase("error");
          setIsRecording(false);
          setIsStopping(false);
          cleanupMedia();
          return;
        }

        const fileName = `visit-${Date.now()}.${fileExtensionFromMimeType(finalMimeType)}`;
        void transcribeBlob(blob, fileName);
      };

      recorder.start(500);
      setIsRecording(true);
      setIsStopping(false);
      setPhase("recording");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start recording.",
      );
      setPhase("error");
      cleanupMedia();
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }
    setIsStopping(true);
    recorder.stop();
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handlePickedFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    clearPolling();
    setError("");
    setResult(null);
    setTranscript("");
    setDetectedLanguage("");
    setJobId("");
    setJobStatus("");
    setPhase("processing");
    void transcribeBlob(file, file.name);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCRIBE_STORAGE_KEY);
      if (!raw) {
        hasHydratedRef.current = true;
        return;
      }

      const parsed = JSON.parse(raw) as PersistedScribeState;
      setPhase(parsed.phase ?? "idle");
      setTranscript(parsed.transcript ?? "");
      setDetectedLanguage(parsed.detectedLanguage ?? "");
      setJobId(parsed.jobId ?? "");
      setJobStatus(parsed.jobStatus ?? "");
      setResult(parsed.result ?? null);
      setError(parsed.error ?? "");

      if (
        parsed.jobId &&
        (parsed.jobStatus === "queued" || parsed.jobStatus === "processing")
      ) {
        void pollJob(parsed.jobId);
      }
    } catch {
      // ignore broken local state
    } finally {
      hasHydratedRef.current = true;
    }

    return () => {
      clearPolling();
      cleanupMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    const payload: PersistedScribeState = {
      phase,
      transcript,
      detectedLanguage,
      jobId,
      jobStatus,
      result,
      error,
    };

    try {
      localStorage.setItem(SCRIBE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [phase, transcript, detectedLanguage, jobId, jobStatus, result, error]);

  useEffect(() => {
    if (!resetSignal) return;
    hardReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  const busy =
    isRecording ||
    isStopping ||
    isTranscribing ||
    jobStatus === "queued" ||
    jobStatus === "processing";

  const phaseLabel = useMemo(() => {
    if (phase === "recording") return "Recording";
    if (phase === "processing") return "Processing";
    if (phase === "applied") return "Imported";
    if (phase === "error") return "Attention needed";
    return "Ready";
  }, [phase]);

  const helperText = useMemo(() => {
    if (phase === "recording") {
      return "Recording the visit audio. Stop when the dictation is complete.";
    }
    if (phase === "processing") {
      return "Processing bilingual audio and applying matched data to the report.";
    }
    if (phase === "applied") {
      const summary = summarizeAppliedResult(result);
      return summary
        ? `Latest import applied: ${summary}.`
        : "Latest audio import finished.";
    }
    if (phase === "error") {
      return "The audio import needs attention.";
    }
    return "Record or upload visit audio.";
  }, [phase, result]);

  const summary = useMemo(() => summarizeAppliedResult(result), [result]);

  return (
    <div className="voice-intake-card">
      <div className="voice-intake-head">
        <div>
          <p className="eyebrow">Assistant capture</p>
          <h3>Voice intake</h3>
        </div>
        <span
          className={`status-chip status-chip-${phase === "error" ? "danger" : phase === "applied" ? "success" : phase === "processing" || phase === "recording" ? "warning" : "neutral"}`}
        >
          {phaseLabel}
        </span>
      </div>

      <p className="voice-intake-copy">{helperText}</p>

      <div className="voice-intake-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void startRecording()}
          disabled={busy}
        >
          {isRecording ? "Recording…" : "Start recording"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={stopRecording}
          disabled={!isRecording || isStopping}
        >
          {isStopping ? "Stopping…" : "Stop"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={openFilePicker}
          disabled={busy}
        >
          Upload audio
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={hardReset}
          disabled={busy && phase !== "error"}
        >
          Clear
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={handlePickedFile}
        />
      </div>

      {phase === "recording" || phase === "processing" ? (
        <div className="voice-progress">
          <div className="voice-progress-bar" />
        </div>
      ) : null}

      {detectedLanguage ? (
        <div className="voice-inline-meta">
          <span className="status-chip status-chip-neutral">
            Detected language: {detectedLanguage}
          </span>
        </div>
      ) : null}

      {!!error ? (
        <div className="inline-alert inline-alert-danger">{error}</div>
      ) : null}

      {summary || transcript || jobId ? (
        <div className="voice-result-grid">
          {summary ? (
            <div className="voice-result-card">
              <span className="voice-result-label">Applied summary</span>
              <strong>{summary}</strong>
            </div>
          ) : null}
          {jobId ? (
            <div className="voice-result-card">
              <span className="voice-result-label">Job status</span>
              <strong>{jobStatus || "queued"}</strong>
            </div>
          ) : null}
          {result?.warnings?.length ? (
            <div className="voice-result-card voice-result-card-wide">
              <span className="voice-result-label">Warnings</span>
              <strong>{result.warnings.join(" • ")}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {transcript ? (
        <details className="voice-details">
          <summary>Transcript preview</summary>
          <div className="voice-details-body">{transcript}</div>
        </details>
      ) : null}
    </div>
  );
}
