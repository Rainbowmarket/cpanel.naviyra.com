import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { listGitDeployments, saveAndDeployGit } from "@/lib/services/git-deploy";

const deploySchema = z.object({
  kind: z.enum(["domain", "subdomain"]),
  id: z.string().min(1),
  repoUrl: z.string().min(8).max(500),
  branch: z.string().max(200).optional(),
});

export async function GET() {
  try {
    const user = await requireSessionUser("apps");
    const sites = await listGitDeployments(user);
    return NextResponse.json({ sites });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "Forbidden")
    ) {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load git sites" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("apps");
    const body = deploySchema.parse(await request.json());
    const deployment = await saveAndDeployGit({
      user,
      kind: body.kind,
      id: body.id,
      repoUrl: body.repoUrl,
      branch: body.branch,
    });
    return NextResponse.json({ deployment });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "Forbidden")
    ) {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Git deploy failed" },
      { status: 400 }
    );
  }
}
