import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/service";

export const dynamic = "force-dynamic";
// Serverless platforms default to short function timeouts; upstream disclosure
// sources are slow (the House index is a multi-MB ZIP), so allow up to 60s.
export const maxDuration = 60;

export async function GET() {
  try {
    const snapshot = await getSnapshot();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to build snapshot: ${message}` },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
