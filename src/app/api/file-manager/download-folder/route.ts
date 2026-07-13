import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { success: false, message: "Folder ZIP download is not available yet." },
    { status: 501 }
  );
}
