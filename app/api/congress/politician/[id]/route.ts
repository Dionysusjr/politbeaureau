import { NextResponse } from "next/server";
import { getPoliticianDetail } from "@/lib/service";

export const dynamic = "force-dynamic";
// Serverless platforms default to short function timeouts; upstream disclosure
// sources are slow (the House index is a multi-MB ZIP), so allow up to 60s.
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const detail = await getPoliticianDetail(params.id);
    if (!detail) {
      return NextResponse.json(
        { error: `No filer found with id "${params.id}"` },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load filer: ${message}` },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
