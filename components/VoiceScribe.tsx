"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type ExtractionJobStatus = "queued" | "processing" | "done" | "error";

export type ScribeMedication = {
  systemId: string;
  diagnosis: string;
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
  age?: string;
  sex?: string;
  chiefComplaint?: string;
  significantHistory?: string;
  associatedSymptoms?: string[];
  examFindings?: string;
  labSummary?: string;
  imagingSummary?: string;
  diagnosisHints?: string[];
  medications?: ScribeMedication[];
  warnings?: string[];
};

type StructuredDraft = {
  transcript: string;
  patientName: string;
  caseNumber: string;
  age: string;
  sex: string;
  chiefComplaint: string;
  significantHistory: string;
  associatedSymptoms: string[];
  examFindings: string;
  labSummary: string;
  imagingSummary: string;
  diagnosisHints: string[];
  medications: ScribeMedication[];
  warnings: string[];
};

type VoiceScribeProps = {
  onApply?: (draft: ScribeDraft) => void;
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
      // ignore browser quirks
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

export default function VoiceScribe({ onApply }: VoiceScribeProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [status, setStatus] = useState("جاهز");
  const [transcript, setTranscript] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState<ExtractionJobStatus | "">("");
  const [result, setResult] = useState<StructuredDraft | null>(null);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const pollTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        setStatus("تم تجهيز التقرير");
        onApply?.(data.result);
        return;
      }

      if (data.status === "error") {
        clearPolling();
        setError(data.error || "Extraction failed.");
        setStatus("فشل الاستخراج الطبي");
        return;
      }

      pollTimerRef.current = window.setTimeout(() => {
        void pollJob(currentJobId);
      }, 1200);
    } catch (err) {
      clearPolling();
      setError(err instanceof Error ? err.message : "Polling failed.");
      setStatus("فشل متابعة النتيجة");
    }
  };

  const submitExtraction = async (rawTranscript: string) => {
    const cleaned = rawTranscript.trim();
    if (!cleaned) {
      throw new Error("ما طلع نص من التسجيل.");
    }

    setJobId("");
    setJobStatus("queued");
    setResult(null);

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
      setStatus("برفع التسجيل للتفريغ...");
      setDetectedLanguage("");

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
        typeof data?.text === "string" ? data.text.trim() : "";

      setTranscript(finalTranscript);
      setDetectedLanguage(
        typeof data?.language === "string" ? data.language : "",
      );

      if (!finalTranscript) {
        throw new Error("ما طلع نص من الملف.");
      }

      setStatus("جاري الاستخراج الطبي...");
      await submitExtraction(finalTranscript);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unexpected transcription error.",
      );
      setStatus("فشل التفريغ");
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
        throw new Error("المتصفح ما بدعم تسجيل الصوت.");
      }

      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder مش مدعوم على هذا الجهاز.");
      }

      clearPolling();
      setError("");
      setResult(null);
      setTranscript("");
      setDetectedLanguage("");
      setJobId("");
      setJobStatus("");
      setStatus("بجهز المايك...");

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

        setError(maybeEvent.error?.message || "فشل التسجيل.");
        setStatus("فشل التسجيل");
        setIsRecording(false);
        setIsStopping(false);
        cleanupMedia();
      };

      recorder.onstop = () => {
        const finalMimeType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalMimeType });

        if (!blob.size) {
          setError("التسجيل طلع فاضي.");
          setStatus("ما طلع صوت");
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
      setStatus("جاري التسجيل...");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start recording.",
      );
      setStatus("فشل بدء التسجيل");
      cleanupMedia();
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return;
    }

    setIsStopping(true);
    setStatus("بوقف التسجيل وبجهز الملف...");
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
    setStatus("تم اختيار ملف صوت");

    void transcribeBlob(file, file.name);
  };

  useEffect(() => {
    return () => {
      clearPolling();
      cleanupMedia();
    };
  }, []);

  const busy =
    isRecording ||
    isStopping ||
    isTranscribing ||
    jobStatus === "queued" ||
    jobStatus === "processing";

  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={busy}
          className="rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isRecording ? "جاري التسجيل..." : "Start Recording"}
        </button>

        <button
          type="button"
          onClick={stopRecording}
          disabled={!isRecording || isStopping}
          className="rounded-2xl border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isStopping ? "Stopping..." : "Stop"}
        </button>

        <button
          type="button"
          onClick={openFilePicker}
          disabled={busy}
          className="rounded-2xl border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
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

      <div className="mt-4 space-y-2 text-sm text-neutral-700">
        <div>
          <span className="font-semibold">Status:</span> {status}
        </div>

        {!!detectedLanguage && (
          <div>
            <span className="font-semibold">Language:</span> {detectedLanguage}
          </div>
        )}

        {!!jobId && (
          <div>
            <span className="font-semibold">Job:</span> {jobStatus} ({jobId})
          </div>
        )}

        {!!error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 p-3">
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Transcript
          </h3>
          <pre className="whitespace-pre-wrap break-words text-sm text-neutral-700">
            {transcript || "ابدئي تسجيل أو ارفعي ملف."}
          </pre>
        </div>

        <div className="rounded-2xl border border-neutral-200 p-3">
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Structured Draft
          </h3>
          <pre className="whitespace-pre-wrap break-words text-sm text-neutral-700">
            {result ? JSON.stringify(result, null, 2) : "لسه ما في نتيجة."}
          </pre>
        </div>
      </div>
    </div>
  );
}
