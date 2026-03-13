"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type ExtractionJobStatus = "queued" | "processing" | "done" | "error";
type UiPhase = "idle" | "recording" | "processing" | "applied" | "error";

const SCRIBE_STORAGE_KEY = "imr_v4_scribe";

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
  if ((result.medications?.length ?? 0) > 0) {
    parts.push(
      `${result.medications!.length} medication${
        result.medications!.length > 1 ? "s" : ""
      }`,
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
      headers: {
        "Content-Type": "application/json",
      },
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
        const maybeEvent = event as Event & {
          error?: { message?: string };
        };

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

        const fileName = `visit-${Date.now()}.${fileExtensionFromMimeType(
          finalMimeType,
        )}`;

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

    if (!file) {
      return;
    }

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
      // ignore
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
      return "Recording visit audio. Stop when the dictation is complete.";
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

    return "Record or upload mixed Arabic and English visit audio. The transcript stays bilingual, then patient details, history, review fields, and medications apply directly to the form.";
  }, [phase, result]);

  return (
    <section className="rounded-3xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[rgb(var(--text))]">
              Voice Intake
            </h2>
            <span
              className={[
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                phase === "applied"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : phase === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : phase === "processing" || phase === "recording"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-slate-50 text-slate-600",
              ].join(" ")}
            >
              {phaseLabel}
            </span>
          </div>

          <p className="max-w-3xl text-sm text-[rgb(var(--muted))]">
            {helperText}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={busy}
            className="rounded-2xl bg-[rgb(var(--primary))] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRecording ? "Recording..." : "Start Recording"}
          </button>

          <button
            type="button"
            onClick={stopRecording}
            disabled={!isRecording || isStopping}
            className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold text-[rgb(var(--text))] transition hover:bg-[rgba(var(--card),0.7)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStopping ? "Stopping..." : "Stop"}
          </button>

          <button
            type="button"
            onClick={openFilePicker}
            disabled={busy}
            className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-2 text-sm font-semibold text-[rgb(var(--text))] transition hover:bg-[rgba(var(--card),0.7)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Upload Audio
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={handlePickedFile}
          />
        </div>
      </div>

      {(phase === "recording" || phase === "processing") && (
        <div className="mt-4 overflow-hidden rounded-full border border-[rgb(var(--border))] bg-[rgba(var(--card),0.7)]">
          <div
            className={[
              "h-2 rounded-full bg-[rgb(var(--primary))] transition-all duration-500",
              phase === "recording" ? "w-1/3" : "w-2/3",
            ].join(" ")}
          />
        </div>
      )}

      {!!error && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
    </section>
  );
}
