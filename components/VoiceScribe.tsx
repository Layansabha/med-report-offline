"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type WsEvent =
  | { type: "ready"; sampleRate: number; model: string }
  | { type: "started" }
  | {
      type: "partial";
      delta: string;
      text: string;
      detectedLanguage?: string | null;
    }
  | {
      type: "session_final";
      text: string;
      detectedLanguage?: string | null;
      audioSeconds?: number;
      chunks?: number;
    }
  | { type: "error"; message: string };

function downsampleFloat32ToInt16(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate = 16000,
): Int16Array {
  if (!input.length) return new Int16Array();

  if (inputSampleRate === outputSampleRate) {
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Int16Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < input.length;
      i += 1
    ) {
      accum += input[i];
      count += 1;
    }

    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

export default function VoiceScribe({ onApply }: VoiceScribeProps) {
  const wsUrl = useMemo(
    () =>
      process.env.NEXT_PUBLIC_ASR_WS_URL || "ws://127.0.0.1:8001/ws/transcribe",
    [],
  );

  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [status, setStatus] = useState("جاهز");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState<ExtractionJobStatus | "">("");
  const [result, setResult] = useState<StructuredDraft | null>(null);
  const [error, setError] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const clearPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const cleanupAudio = async () => {
    try {
      workletRef.current?.disconnect();
    } catch {}

    try {
      sourceRef.current?.disconnect();
    } catch {}

    try {
      muteRef.current?.disconnect();
    } catch {}

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      await audioContextRef.current.close();
    }

    workletRef.current = null;
    sourceRef.current = null;
    muteRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  };

  const closeSocket = () => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
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
        onApply?.(data.result);
        setStatus("تم تطبيق البيانات");
        return;
      }

      if (data.status === "error") {
        clearPolling();
        setError(data.error || "Extraction failed.");
        setStatus("فشل الاستخراج");
        return;
      }

      pollTimerRef.current = window.setTimeout(() => {
        void pollJob(currentJobId);
      }, 1200);
    } catch (err: any) {
      clearPolling();
      setError(err?.message || "Polling failed.");
      setStatus("فشل متابعة النتيجة");
    }
  };

  const submitExtraction = async (transcript: string) => {
    if (!transcript.trim()) return;

    setJobId("");
    setJobStatus("queued");
    setResult(null);

    const res = await fetch("/api/scribe/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transcript }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error || "Failed to create extraction job.");
    }

    setJobId(data.jobId);
    setJobStatus(data.status);
    await pollJob(data.jobId);
  };

  const startRecording = async () => {
    clearPolling();
    setError("");
    setResult(null);
    setJobId("");
    setJobStatus("");
    setLiveTranscript("");
    setDetectedLanguage("");
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

    const audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(
      "/worklets/mic-capture-processor.js",
    );
    await audioContext.resume();

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(
      audioContext,
      "mic-capture-processor",
    );
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;

    source.connect(workletNode);
    workletNode.connect(muteGain);
    muteGain.connect(audioContext.destination);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    streamRef.current = stream;
    audioContextRef.current = audioContext;
    sourceRef.current = source;
    workletRef.current = workletNode;
    muteRef.current = muteGain;
    wsRef.current = ws;

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const float32 = event.data;
      const pcm16 = downsampleFloat32ToInt16(
        float32,
        audioContext.sampleRate,
        16000,
      );

      if (pcm16.byteLength > 0) {
        const payload = new ArrayBuffer(pcm16.byteLength);
        new Uint8Array(payload).set(
          new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength),
        );
        socket.send(payload);
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start" }));
      setIsRecording(true);
      setIsStopping(false);
      setStatus("جاري التسجيل...");
    };

    ws.onmessage = async (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as WsEvent;

      if (payload.type === "ready") {
        setStatus("الخدمة جاهزة");
        return;
      }

      if (payload.type === "started") {
        setStatus("جاري التفريغ المباشر...");
        return;
      }

      if (payload.type === "partial") {
        setLiveTranscript(payload.text || "");
        setDetectedLanguage(payload.detectedLanguage || "");
        setStatus("النص عم يطلع");
        return;
      }

      if (payload.type === "session_final") {
        setLiveTranscript(payload.text || "");
        setDetectedLanguage(payload.detectedLanguage || "");
        setStatus("خلص التفريغ. جاري الاستخراج الطبي...");
        setIsRecording(false);
        setIsStopping(false);

        await cleanupAudio();
        closeSocket();

        if (payload.text?.trim()) {
          await submitExtraction(payload.text);
        } else {
          setStatus("ما طلع نص");
        }

        return;
      }

      if (payload.type === "error") {
        setError(payload.message || "ASR error.");
        setStatus("صار خطأ");
        setIsRecording(false);
        setIsStopping(false);
        await cleanupAudio();
        closeSocket();
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection failed.");
      setStatus("فشل الاتصال");
    };

    ws.onclose = () => {
      if (!isStopping) {
        setIsRecording(false);
      }
    };
  };

  const stopRecording = async () => {
    setIsStopping(true);
    setStatus("بوقف التسجيل وبجهز النص النهائي...");

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
    } else {
      setIsRecording(false);
      setIsStopping(false);
      await cleanupAudio();
      closeSocket();
    }
  };

  useEffect(() => {
    return () => {
      clearPolling();
      void cleanupAudio();
      closeSocket();
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={isRecording}
          className="rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Start
        </button>

        <button
          type="button"
          onClick={() => void stopRecording()}
          disabled={!isRecording || isStopping}
          className="rounded-2xl border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Stop
        </button>

        <div className="text-sm text-neutral-600">
          <span className="font-medium">Status:</span> {status}
        </div>

        {!!detectedLanguage && (
          <div className="text-sm text-neutral-600">
            <span className="font-medium">Language:</span> {detectedLanguage}
          </div>
        )}

        {!!jobId && (
          <div className="text-sm text-neutral-600">
            <span className="font-medium">Job:</span> {jobStatus} ({jobId})
          </div>
        )}
      </div>

      {!!error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Live Transcript</h2>
        <div className="min-h-40 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-7 whitespace-pre-wrap">
          {liveTranscript || "ابدئي تسجيل."}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Structured Draft</h2>
        <pre className="min-h-40 overflow-auto rounded-2xl border border-neutral-200 bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">
          {result ? JSON.stringify(result, null, 2) : "لسه ما في نتيجة."}
        </pre>
      </section>
    </div>
  );
}
