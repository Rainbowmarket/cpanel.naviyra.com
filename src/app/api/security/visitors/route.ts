import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { listLiveVisitors, listVisitors } from "@/lib/services/security";

function parseDateParam(value: string | null, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  // YYYY-MM-DD → local day bounds
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    if (endOfDay) return new Date(y!, m! - 1, d!, 23, 59, 59, 999);
    return new Date(y!, m! - 1, d!, 0, 0, 0, 0);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser("security");
    const params = new URL(request.url).searchParams;
    const domainId = params.get("domainId") ?? undefined;
    const live = params.get("live") === "1";

    if (live) {
      const rows = await listLiveVisitors(user.id, domainId, user.role);
      return NextResponse.json({ live: rows });
    }

    const from = parseDateParam(params.get("from"), false);
    const to = parseDateParam(params.get("to"), true);
    const format = params.get("format");
    const limit = format === "csv" ? 5000 : Number(params.get("limit") ?? 500);

    const visitors = await listVisitors(user.id, {
      domainId,
      search: params.get("search") ?? undefined,
      from,
      to,
      limit,
      role: user.role,
    });

    if (format === "csv") {
      const header = [
        "visitedAt",
        "domain",
        "ipAddress",
        "url",
        "method",
        "browser",
        "os",
        "country",
        "statusCode",
        "isBot",
      ];
      const lines = [
        header.join(","),
        ...visitors.map((v) =>
          [
            v.visitedAt.toISOString(),
            v.domain.name,
            v.ipAddress,
            v.url,
            v.method,
            v.browser ?? "",
            v.os ?? "",
            v.countryName ?? "",
            v.statusCode ?? "",
            v.isBot ? "1" : "0",
          ]
            .map((cell) => csvEscape(String(cell)))
            .join(",")
        ),
      ];
      const stamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="visitors-${stamp}.csv"`,
        },
      });
    }

    return NextResponse.json({ visitors, count: visitors.length });
  } catch (error) {
    return authFailureResponse(error);
  }
}
