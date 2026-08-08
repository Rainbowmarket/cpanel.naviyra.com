import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireSessionUser();
    const server = await prisma.server.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    const agentKey = server?.agentKey || getAgentApiKey();
    const result = await callAgent<{
      node: string | null;
      python: string | null;
      go: string | null;
    }>({ action: "runtime_versions" }, agentKey);

    if (!result.success) {
      return NextResponse.json(
        { node: null, python: null, go: null, error: result.error },
        { status: 200 }
      );
    }
    return NextResponse.json(result.data ?? { node: null, python: null, go: null });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { node: null, python: null, go: null },
      { status: 200 }
    );
  }
}
