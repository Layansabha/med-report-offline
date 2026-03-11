import { NextResponse } from "next/server";
import { enqueueExtraction } from "../../../../lib/scribe/queue";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const transcript =
      typeof body?.transcript === "string" ? body.transcript.trim() : "";

    if (!transcript) {
      return NextResponse.json(
        { error: "Missing transcript." },
        { status: 400 },
      );
    }

    const job = enqueueExtraction(transcript);

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to enqueue extraction." },
      { status: 500 },
    );
  }
}
