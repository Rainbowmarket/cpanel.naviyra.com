import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applySessionCookie,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { applyPending2faCookie } from "@/lib/auth-2fa";
import { prisma } from "@/lib/prisma";
import { bootstrapMainServer } from "@/lib/services/bootstrap";
import { getPanelHostname } from "@/lib/base-domain";
import {
  assertLoginAllowed,
  clearLoginFailures,
  getClientIp,
  recordLoginFailure,
} from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  try {
    const body = loginSchema.parse(await request.json());

    try {
      assertLoginAllowed(ip, body.email);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Too many failed attempts",
        },
        { status: 429 }
      );
    }

    const email = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      recordLoginFailure(ip, body.email);
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    clearLoginFailures(ip, body.email);

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const response = NextResponse.json({
        requires2fa: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
      return applyPending2faCookie(response, user.id, user.sessionVersion);
    }

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
    return applySessionCookie(response, user.id, user.sessionVersion);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("[auth/login]", error);
    const message =
      error instanceof Error ? error.message : "Login failed";
    const isDb =
      /sqlite|prisma|database|better-sqlite/i.test(message);
    return NextResponse.json(
      {
        error: isDb
          ? "Database error. On the server run: rm -f data/naviyra.db* && npx prisma db push && npm rebuild better-sqlite3"
          : "Login failed",
      },
      { status: 500 }
    );
  }
}

// Bootstrap first admin (only when no users exist)
const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  domain: z.string().min(3).optional(),
});

export async function PUT(request: Request) {
  const count = await prisma.user.count();
  if (count > 0) {
    return NextResponse.json({ error: "Setup already completed" }, { status: 403 });
  }

  try {
    const body = registerSchema.parse(await request.json());
    const domainName = getPanelHostname() || body.domain?.trim();
    if (!domainName) {
      return NextResponse.json(
        {
          error:
            "Main domain is not set. Re-run the installer or set PANEL_HOSTNAME in .env.",
        },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(body.password);
    const email = body.email.trim().toLowerCase();

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email,
        passwordHash,
        role: "ADMIN",
      },
    });

    const userPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    let bootstrap: Awaited<ReturnType<typeof bootstrapMainServer>> | null = null;
    try {
      bootstrap = await bootstrapMainServer({
        userId: user.id,
        domainName,
      });
    } catch (error) {
      console.error("Main server bootstrap failed:", error);
      const response = NextResponse.json(
        {
          user: userPayload,
          warning:
            error instanceof Error
              ? error.message
              : "Admin created but main server setup failed",
        },
        { status: 201 }
      );
      return applySessionCookie(response, user.id, user.sessionVersion);
    }

    const response = NextResponse.json({
      user: userPayload,
      server: bootstrap.server,
      domain: bootstrap.domain,
    });
    return applySessionCookie(response, user.id, user.sessionVersion);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("[auth/setup]", error);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
