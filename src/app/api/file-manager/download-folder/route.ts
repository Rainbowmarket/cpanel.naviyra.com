import { NextResponse } from "next/server";

/**
 * Stub: folder ZIP download is not implemented yet.
 * The File Manager client may open this route; callers should expect 501
 * until an agent-backed archive action is wired up.
 */
export async function GET() {
  return NextResponse.json(
    { success: false, message: "Folder ZIP download is not available yet." },
    { status: 501 }
  );
}
