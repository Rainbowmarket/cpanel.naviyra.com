"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SESSION_IDLE_SECONDS } from "@/lib/session-timeout";

const IDLE_MS = SESSION_IDLE_SECONDS * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const CHECK_EVERY_MS = 10_000;

/**
 * Logs out of the panel after 30 minutes without pointer/keyboard use.
 * Also slides the httpOnly session cookie so it cannot outlive idle time.
 */
export function SessionIdleGuard() {
  const router = useRouter();
  const lastActivityRef = useRef(Date.now());
  const lastTouchRef = useRef(0);
  const loggingOutRef = useRef(false);

  const logoutIdle = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* still send them to login */
    }
    router.replace("/login?idle=1");
    router.refresh();
  }, [router]);

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    const now = Date.now();
    if (now - lastTouchRef.current < TOUCH_EVERY_MS) return;
    lastTouchRef.current = now;
    void fetch("/api/auth/touch", { method: "POST" }).then((res) => {
      if (res.status === 401) void logoutIdle();
    });
  }, [logoutIdle]);

  useEffect(() => {
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    for (const event of events) {
      window.addEventListener(event, markActivity, { passive: true });
    }

    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_MS) void logoutIdle();
    }, CHECK_EVERY_MS);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current >= IDLE_MS) void logoutIdle();
      else markActivity();
    };
    document.addEventListener("visibilitychange", onVisibility);

    markActivity();

    return () => {
      for (const event of events) {
        window.removeEventListener(event, markActivity);
      }
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [markActivity, logoutIdle]);

  return null;
}
