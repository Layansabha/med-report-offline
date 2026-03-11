from __future__ import annotations

import asyncio
import json
import math
import os
import tempfile
import time
import wave
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel


TARGET_SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLE_WIDTH_BYTES = 2
BYTES_PER_SECOND = TARGET_SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH_BYTES

ASR_MODEL = os.getenv("ASR_MODEL", "small")
ASR_DEVICE = os.getenv("ASR_DEVICE", "cpu")
ASR_COMPUTE_TYPE = os.getenv("ASR_COMPUTE_TYPE", "int8")
ASR_CPU_THREADS = int(os.getenv("ASR_CPU_THREADS", "0"))
ASR_NUM_WORKERS = int(os.getenv("ASR_NUM_WORKERS", "1"))

VAD_RMS_THRESHOLD = int(os.getenv("ASR_VAD_RMS_THRESHOLD", "700"))
VAD_SILENCE_MS = int(os.getenv("ASR_VAD_SILENCE_MS", "650"))
VAD_MIN_UTTERANCE_MS = int(os.getenv("ASR_VAD_MIN_UTTERANCE_MS", "500"))
VAD_PREROLL_MS = int(os.getenv("ASR_VAD_PREROLL_MS", "250"))

WHISPER_BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "1"))
WHISPER_INITIAL_PROMPT = os.getenv(
    "ASR_INITIAL_PROMPT",
    (
        "Medical dictation in Arabic and English. "
        "Preserve medication names, dosages, numbers, ages, and case details exactly. "
        "إملاء طبي بالعربية والإنجليزية. "
        "حافظ على أسماء الأدوية والجرعات والأرقام والعمر وتفاصيل الحالة كما هي."
    ),
)


def pcm_duration_ms(pcm: bytes) -> float:
    if not pcm:
        return 0.0
    return (len(pcm) / BYTES_PER_SECOND) * 1000.0


def trim_bytearray_tail(buffer: bytearray, max_bytes: int) -> None:
    if len(buffer) > max_bytes:
        del buffer[:-max_bytes]


def rms_int16_le(data: bytes) -> float:
    usable = len(data) - (len(data) % 2)
    if usable <= 0:
        return 0.0

    view = memoryview(data[:usable]).cast("h")
    if len(view) == 0:
        return 0.0

    total = 0
    for sample in view:
        total += sample * sample

    return math.sqrt(total / len(view))


def write_pcm_to_wav_file(pcm: bytes) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp_path = tmp.name

    with wave.open(tmp_path, "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(SAMPLE_WIDTH_BYTES)
        wav_file.setframerate(TARGET_SAMPLE_RATE)
        wav_file.writeframes(pcm)

    return tmp_path


def build_model() -> WhisperModel:
    return WhisperModel(
        ASR_MODEL,
        device=ASR_DEVICE,
        compute_type=ASR_COMPUTE_TYPE,
        cpu_threads=ASR_CPU_THREADS,
        num_workers=ASR_NUM_WORKERS,
    )


def transcribe_utterance(model: WhisperModel, pcm: bytes) -> dict:
    wav_path = write_pcm_to_wav_file(pcm)
    try:
        segments, info = model.transcribe(
            wav_path,
            language=None,
            task="transcribe",
            beam_size=WHISPER_BEAM_SIZE,
            vad_filter=False,
            condition_on_previous_text=False,
            word_timestamps=False,
            initial_prompt=WHISPER_INITIAL_PROMPT,
        )

        parts: list[str] = []
        for segment in segments:
            text = (segment.text or "").strip()
            if text:
                parts.append(text)

        text = " ".join(parts).strip()
        return {
            "text": text,
            "language": getattr(info, "language", None),
            "languageProbability": getattr(info, "language_probability", None),
        }
    finally:
        try:
            Path(wav_path).unlink(missing_ok=True)
        except Exception:
            pass


@dataclass
class SessionState:
    websocket: WebSocket
    queue: asyncio.Queue[Optional[bytes]] = field(default_factory=asyncio.Queue)
    worker_task: Optional[asyncio.Task] = None
    full_pcm: bytearray = field(default_factory=bytearray)
    preroll_pcm: bytearray = field(default_factory=bytearray)
    utterance_pcm: bytearray = field(default_factory=bytearray)
    transcript_parts: list[str] = field(default_factory=list)
    in_speech: bool = False
    last_voice_at: float = 0.0
    started: bool = False
    stopped: bool = False
    last_detected_language: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.model = build_model()
    yield


app = FastAPI(title="Local ASR Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "model": ASR_MODEL,
        "device": ASR_DEVICE,
        "computeType": ASR_COMPUTE_TYPE,
        "sampleRate": TARGET_SAMPLE_RATE,
    }


async def transcription_worker(session: SessionState) -> None:
    model: WhisperModel = app.state.model

    while True:
        pcm = await session.queue.get()
        try:
            if pcm is None:
                return

            result = await asyncio.to_thread(transcribe_utterance, model, pcm)
            text = (result.get("text") or "").strip()

            if text:
                session.transcript_parts.append(text)
                session.last_detected_language = result.get("language") or session.last_detected_language

                await session.websocket.send_json(
                    {
                        "type": "partial",
                        "delta": text,
                        "text": " ".join(session.transcript_parts).strip(),
                        "detectedLanguage": session.last_detected_language,
                    }
                )
        finally:
            session.queue.task_done()


async def flush_current_utterance(session: SessionState, force: bool = False) -> None:
    if not session.utterance_pcm:
        session.in_speech = False
        return

    duration_ms = pcm_duration_ms(session.utterance_pcm)

    if duration_ms >= VAD_MIN_UTTERANCE_MS or force:
        await session.queue.put(bytes(session.utterance_pcm))

    session.utterance_pcm.clear()
    session.in_speech = False
    session.last_voice_at = 0.0


async def process_audio_chunk(session: SessionState, chunk: bytes) -> None:
    if not chunk:
        return

    now = time.monotonic()
    pre_roll_before_chunk = bytes(session.preroll_pcm)
    chunk_rms = rms_int16_le(chunk)
    is_speech = chunk_rms >= VAD_RMS_THRESHOLD

    session.full_pcm.extend(chunk)

    if is_speech:
        if not session.in_speech:
            session.in_speech = True
            session.utterance_pcm = bytearray(pre_roll_before_chunk)
        session.utterance_pcm.extend(chunk)
        session.last_voice_at = now
    else:
        if session.in_speech:
            session.utterance_pcm.extend(chunk)
            silence_ms = (now - session.last_voice_at) * 1000.0
            if silence_ms >= VAD_SILENCE_MS:
                await flush_current_utterance(session)

    session.preroll_pcm.extend(chunk)
    trim_bytearray_tail(session.preroll_pcm, int((VAD_PREROLL_MS / 1000.0) * BYTES_PER_SECOND))


async def finalize_session(session: SessionState) -> None:
    if session.in_speech and session.utterance_pcm:
        await flush_current_utterance(session, force=True)

    await session.queue.join()
    await session.queue.put(None)

    if session.worker_task:
        await session.worker_task

    final_text = " ".join(session.transcript_parts).strip()

    await session.websocket.send_json(
        {
            "type": "session_final",
            "text": final_text,
            "detectedLanguage": session.last_detected_language,
            "audioSeconds": round(len(session.full_pcm) / BYTES_PER_SECOND, 2),
            "chunks": len(session.transcript_parts),
        }
    )


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()

    session = SessionState(websocket=websocket)
    session.worker_task = asyncio.create_task(transcription_worker(session))

    await websocket.send_json(
        {
            "type": "ready",
            "sampleRate": TARGET_SAMPLE_RATE,
            "model": ASR_MODEL,
        }
    )

    try:
        while True:
            message = await websocket.receive()

            if "text" in message and message["text"] is not None:
                data = json.loads(message["text"])
                event_type = data.get("type")

                if event_type == "start":
                    session.started = True
                    await websocket.send_json({"type": "started"})
                    continue

                if event_type == "stop":
                    session.stopped = True
                    await finalize_session(session)
                    break

            elif "bytes" in message and message["bytes"] is not None:
                if not session.started or session.stopped:
                    continue
                await process_audio_chunk(session, message["bytes"])

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": str(exc),
                }
            )
        except Exception:
            pass
    finally:
        try:
            if session.worker_task and not session.worker_task.done():
                await session.queue.put(None)
                await session.worker_task
        except Exception:
            pass