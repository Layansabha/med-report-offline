import { extractStructuredDraft, StructuredDraft } from "./extract";

export type ExtractionJobStatus = "queued" | "processing" | "done" | "error";

export type ExtractionJob = {
  id: string;
  transcript: string;
  status: ExtractionJobStatus;
  result: StructuredDraft | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

declare global {
  var __scribeJobs: Map<string, ExtractionJob> | undefined;
  var __scribePending: string[] | undefined;
  var __scribeWorkerState: { running: boolean } | undefined;
}

const jobs = globalThis.__scribeJobs ?? (globalThis.__scribeJobs = new Map());
const pending = globalThis.__scribePending ?? (globalThis.__scribePending = []);
const workerState =
  globalThis.__scribeWorkerState ??
  (globalThis.__scribeWorkerState = { running: false });

function nowIso() {
  return new Date().toISOString();
}

function cloneJob(job: ExtractionJob) {
  return JSON.parse(JSON.stringify(job)) as ExtractionJob;
}

async function runWorker() {
  if (workerState.running) return;
  workerState.running = true;

  try {
    while (pending.length > 0) {
      const jobId = pending.shift();
      if (!jobId) continue;

      const job = jobs.get(jobId);
      if (!job) continue;

      job.status = "processing";
      job.updatedAt = nowIso();

      try {
        const result = await extractStructuredDraft(job.transcript);
        job.result = result;
        job.status = "done";
        job.error = null;
        job.updatedAt = nowIso();
      } catch (error: any) {
        job.status = "error";
        job.error = error?.message || "Extraction failed.";
        job.updatedAt = nowIso();
      }
    }
  } finally {
    workerState.running = false;
  }
}

export function enqueueExtraction(transcript: string) {
  const job: ExtractionJob = {
    id: crypto.randomUUID(),
    transcript,
    status: "queued",
    result: null,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  jobs.set(job.id, job);
  pending.push(job.id);
  void runWorker();

  return cloneJob(job);
}

export function getExtractionJob(jobId: string) {
  const job = jobs.get(jobId);
  return job ? cloneJob(job) : null;
}
