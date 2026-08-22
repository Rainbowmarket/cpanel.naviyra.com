import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { getSiteAppEnv } from "@/lib/services/apps";

const querySchema = z.object({
  kind: z.enum(["domain", "subdomain"]),
  id: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser("apps");
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      kind: url.searchParams.get("kind"),
      id: url.searchParams.get("id"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "kind and id required" }, { status: 400 });
    }
    const data = await getSiteAppEnv(parsed.data.kind, parsed.data.id, user);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to read site .env",
        vars: [],
      },
      { status: 200 }
    );
  }
}
