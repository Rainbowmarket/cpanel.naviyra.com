import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { openPhpPgAdminSession } from "@/lib/services/phppgadmin";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const url = new URL(request.url);
    const password = url.searchParams.get("password") ?? undefined;

    const result = await openPhpPgAdminSession({
      id,
      userId: user.id,
      role: user.role,
      password: password || undefined,
    });

    if (result.needsPassword) {
      return NextResponse.json(
        {
          error: "Database password required for phpPgAdmin",
          needsPassword: true,
        },
        { status: 409 }
      );
    }

    return NextResponse.redirect(new URL(result.url, request.url));
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to open phpPgAdmin",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      password?: string;
    };

    const result = await openPhpPgAdminSession({
      id,
      userId: user.id,
      role: user.role,
      password: body.password,
    });

    if (result.needsPassword) {
      return NextResponse.json(
        {
          error: "Database password required for phpPgAdmin",
          needsPassword: true,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ url: result.url });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to open phpPgAdmin",
      },
      { status: 500 }
    );
  }
}
