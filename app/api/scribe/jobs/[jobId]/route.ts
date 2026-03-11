import { NextResponse } from "next/server";
import { getExtractionJob } from "../../../../../lib/scribe/queue";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } },
) {
  const job = getExtractionJob(params.jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json(job);
}
