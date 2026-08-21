import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPanelHostname } from "@/lib/base-domain";
import { getDefaultServerHostname } from "@/lib/paths";

export async function GET() {
  try {
    const count = await prisma.user.count();
    const panelDomain = getPanelHostname();
    return NextResponse.json({
      needsSetup: count === 0,
      panelDomain,
      primaryHostname: getDefaultServerHostname(),
    });
  } catch (error) {
    console.error("[auth/setup]", error);
    return NextResponse.json({
      needsSetup: true,
      panelDomain: getPanelHostname(),
      primaryHostname: getDefaultServerHostname(),
      error:
        error instanceof Error
          ? error.message
          : "Database is not ready. Complete install, then open this page again.",
    });
  }
}
