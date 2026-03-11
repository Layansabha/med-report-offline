import { NextResponse } from "next/server";
import { extractStructuredDraft } from "../../../lib/scribe/extract";

export const runtime = "nodejs";

type TimingEntry = {
  step: string;
  ms: number;
};

type TimingSummary = {
  totalMs: number;
  byStep: Record<string, number>;
  steps: TimingEntry[];
};

function nowMs() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}

class StepTimer {
  private readonly startedAt = nowMs();
  private readonly steps: TimingEntry[] = [];

  async time<T>(step: string, fn: () => Promise<T>): Promise<T> {
    const start = nowMs();
    try {
      return await fn();
    } finally {
      this.steps.push({ step, ms: roundMs(nowMs() - start) });
    }
  }

  timeSync<T>(step: string, fn: () => T): T {
    const start = nowMs();
    try {
      return fn();
    } finally {
      this.steps.push({ step, ms: roundMs(nowMs() - start) });
    }
  }

  summary(): TimingSummary {
    const totalMs = roundMs(nowMs() - this.startedAt);
    const byStep: Record<string, number> = {};

    for (const entry of this.steps) {
      byStep[entry.step] = entry.ms;
    }

    return {
      totalMs,
      byStep,
      steps: [...this.steps],
    };
  }
}

function buildServerTimingHeader(summary: TimingSummary) {
  const safeName = (name: string) =>
    name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);

  const parts = summary.steps.map((entry, index) => {
    const metric = `${index + 1}_${safeName(entry.step)}`;
    return `${metric};dur=${entry.ms}`;
  });

  parts.push(`total;dur=${summary.totalMs}`);
  return parts.join(", ");
}

function logTimingSummary(summary: TimingSummary) {
  console.log("========== /api/scribe timings ==========");
  for (const entry of summary.steps) {
    console.log(`${entry.step}: ${entry.ms}ms`);
  }
  console.log(`TOTAL: ${summary.totalMs}ms`);
  console.log("=========================================");
}

function normalizeTranscript(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export async function POST(req: Request) {
  const timer = new StepTimer();

  let status = 200;
  let body: any = null;

  try {
    const payload = await timer.time("parseJsonBody", async () => {
      return await req.json();
    });

    const transcript = timer.timeSync("normalizeTranscript", () =>
      normalizeTranscript(payload?.transcript),
    );

    if (!transcript) {
      status = 400;
      body = {
        error: "Missing transcript.",
      };
    } else if (transcript.length > 50000) {
      status = 400;
      body = {
        error: "Transcript is too long.",
      };
    } else {
      const result = await timer.time("extractStructuredDraft", async () => {
        return await extractStructuredDraft(transcript);
      });

      body = result;
    }
  } catch (e: any) {
    const isInvalidJson =
      e instanceof SyntaxError || /json/i.test(String(e?.message || ""));

    const message =
      e?.name === "AbortError"
        ? "Extraction request timed out."
        : isInvalidJson
          ? "Invalid JSON body."
          : e?.message || "Scribe extraction failed.";

    status = 500;
    body = { error: message };
  }

  const timingSummary = timer.summary();
  const headers = new Headers({
    "Server-Timing": buildServerTimingHeader(timingSummary),
  });

  logTimingSummary(timingSummary);

  return NextResponse.json(
    {
      ...body,
      timings: timingSummary,
    },
    {
      status,
      headers,
    },
  );
}
